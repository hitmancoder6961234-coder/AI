# Staging backup and restore plan (Phase 1 proposal, not implemented)

Prepared 6 November 2026. **A plan only. Nothing here has been run on a real platform, no backup storage account exists, and nothing in this plan changes production.** Prices and platform behaviour come from vendor documentation and third-party summaries found on that date (cited in section 9); they must be re-checked on the vendors' own pages before you buy anything. The application's backup tool itself (`scripts/backup.mjs`) *has* been tested locally (backup while running, tamper detection, restore, drill 15/15).

Related: [STAGING-ROLLBACK-PLAN.md](STAGING-ROLLBACK-PLAN.md) · [OPERATIONS-VERIFICATION.md](OPERATIONS-VERIFICATION.md) section 4 · [PROPOSED-FIXES-P1.md](PROPOSED-FIXES-P1.md) (P1-09).

## 1. What there is to protect, and what each safety net actually covers

| Net | Covers | Does **not** cover | Verdict |
|---|---|---|---|
| **SQLite database + folders on the Render disk** (the real data: accounts, sessions, chats, projects, memory, prompts, agent sessions, uploads, artifacts, RAG data) | everything | a lost disk, a bad deploy that corrupts data, user or operator error | the thing to protect |
| **`scripts/backup.mjs`** (`VACUUM INTO` consistent snapshot while the server runs, folders, manifest with checksums, `verify`, `restore --yes` that moves old data aside and invalidates every session and reset token) | the whole data directory | nothing off-site by itself; it writes where you tell it | **the primary backup mechanism** |
| **Render disk snapshots** (per Render's documentation: automatic once every 24 hours, kept for at least 7 days, whole-disk restore only, later changes are lost) | the whole disk at 24 h granularity | partial restore; and **Render's own documentation warns against snapshot restores for a disk that backs a database**, because the database may restore in a corrupted state | an extra safety net only, never the only backup |
| **Aiven PostgreSQL mirror** | an *encrypted copy of conversation messages only* (`server/security/aiven.ts`: `mirrorMessage`, `recoverConversation`) | accounts, password hashes, projects, files, uploads, memory, prompts, agent sessions, models and keys | **not a backup of the application.** It can recover chat text after a disk loss, nothing else. Aiven's free plan states that backups are included, but that backs up the mirror, not the app |
| Git | code | data | irrelevant to data |

Conclusion for your request "Aiven database backup": with the mirror left out of initial staging (your decision), the backup of record is the application backup tool, copied off the server. If the mirror is added later it is a partial recovery aid for chats, not a replacement.

## 2. The scheduling problem (verified in Render's documentation, search of 6 Nov 2026)

A Render persistent disk is attached to **one service only**, cannot be used by a cron job, a one-off job, or a build / pre-deploy command, and prevents scaling past one instance. So **a Render cron job cannot back up the web service's disk**. The options are:

| Option | How | Pros | Cons / cost |
|---|---|---|---|
| **A. Manual** (works today) | Render shell: `node scripts/backup.mjs create --out /var/data/backups`, `verify`, then copy off the server by hand | no code, no extra service | depends on a person; copying a folder off a Render shell needs a tool (archive + upload with `curl` to storage you control, or Render's SSH if available on your plan: unverified) |
| **B. In-process scheduler** (needs your approval: part of P1-09) | the API process runs `createBackup` every N hours, verifies the result, prunes old ones, logs `backup_ok` / `backup_failed`, shows the age of the last backup in the readiness output | automatic; works with the one-disk rule; no extra service | new code to test; a backup runs on the live instance (I/O while it runs); stops during deploys; off-site copy still needs step C |
| **C. Off-site copy** | the scheduler (or a manual step) uploads an **encrypted** archive to object storage (any S3-compatible bucket, for example Backblaze B2) | survives loss of the disk and of the Render account | a storage account and a write-only access key; upload code (an S3-signature client or a dependency, both new); you decide the provider |
| **D. Docker host variant** (if you choose Docker later) | host `cron` runs `docker exec darkness-ai node scripts/backup.mjs create ...` then `rclone`/`rsync` off-box | complete control, no application change | your own server to maintain |

**Recommendation for staging:** start with **A** (documented, rehearsed) so Phase 2 is not blocked, and approve **B** (and optionally **C**) as P1-09 before Phase 4, when backup and restore testing is required.

## 3. Frequency and retention (proposal)

| Item | Staging | Production (for later) |
|---|---|---|
| Scheduled backup | every 24 h (staging data is synthetic; a day of loss is acceptable) | every 6 h, to be decided with you after Phase 4 measurements |
| Extra backups | **before every deploy** and before any `SECRETS_MIGRATE`, restore or migration step | same |
| Local retention (on the disk) | last 3 | last 4 plus the pre-deploy ones |
| Off-site retention | 7 daily + 4 weekly | 14 daily + 8 weekly + 6 monthly (adjust to your privacy policy: a backup keeps an erased account until it ages out) |
| Integrity check | `verify` after each backup, automatically | same, plus a monthly restore test |

Disk sizing: backups stored **on the same disk** share its space (the blueprint's disk is 5 GB). Keep the local count small, or size the disk for data plus three backups. `/api/ready` already fails below `READINESS_MIN_FREE_MB`.

## 4. Encryption and credential handling

- A backup contains accounts with password hashes, chats and, unless `PRIVACY_ENCRYPTION_KEY` is set, users' saved provider keys. Treat it like the live disk.
- **Archive encryption (off-site copies):** encrypt the archive before it leaves the server with a key that is **not** `PRIVACY_ENCRYPTION_KEY` and is stored in your password manager (for example AES-256-GCM through `openssl`, or `age`). Never store this key beside the backups. (Uses a new variable in the scheduler proposal, for example `BACKUP_ENCRYPTION_KEY`; not implemented.)
- **`PRIVACY_ENCRYPTION_KEY` recovery:** keep it in two places that are not the backup location; without it sealed provider keys in a restored database cannot be read (users would re-enter them).
- **Storage credentials:** a bucket-scoped key that can only **write** (and list) the backup bucket; a separate read key held only by you for restores; no credential in git, logs or chat; rotate if ever exposed (rotation needs your approval).
- **Logs:** backup events log counts, sizes and durations only, never paths of user data or contents.

## 5. Where backups are stored

1. On the staging disk: `/var/data/backups` (protects against logical mistakes and bad deploys, **not** against losing the disk).
2. Off the server (needed): an encrypted copy in object storage you control. Backblaze B2 is one candidate (third-party summaries list about $6.95 per TB-month, the first 10 GB free, uploads free, downloads free up to 3x stored data; to be confirmed on backblaze.com). A staging database of a few hundred MB falls inside the free allowance, so the expected cost is about **zero** at staging scale.
3. Render's own daily snapshots as an additional net (part of the disk's price; per Render's documentation).

Which storage provider you use is **your decision** and nothing has been created.

## 6. Restore procedure

Live restore (disaster recovery) is in [STAGING-ROLLBACK-PLAN.md](STAGING-ROLLBACK-PLAN.md) section 4: stop the service, `restore <backup> --yes`, start, check `/api/ready`. It refuses an unverified backup, moves existing data aside (never deletes it) and invalidates every session and reset token.

If the backup is off-site: download, decrypt, `node scripts/backup.mjs verify <folder>`, then restore as above.

## 7. How restoration is tested without touching live (or production) data

**Rehearsal on the staging service, never on the live root and never on production:**

1. Take a backup (`create --out /var/data/backups`) and `verify` it.
2. Restore it into a **scratch root on the same disk**: `node scripts/backup.mjs restore <backup> --root /var/data/restore-test --yes`. (`--root` makes the live root untouched; the tool refuses an unverified backup.)
3. Check the scratch copy **read-only**: `DARKNESS_STORAGE_ROOT=/var/data/restore-test node scripts/admin.mjs users` lists the accounts (masked); `PRAGMA integrity_check` on the scratch database returns `ok`; table row counts match the numbers in the backup's manifest; the `sessions` and `password_resets` tables are empty (a restore must not revive them).
4. Delete `/var/data/restore-test` (it holds staging data).
5. Record the date, backup name, size, durations and results in the Phase 4 reliability report.

A full replacement of the **live** staging data is rehearsed once, only with your approval, because it replaces data (reversible until the "before-restore" folder is deleted). **No step touches production**, and the staging data is synthetic.

## 8. Expected costs and operational limits

| Item | Cost (from sources of 6 Nov 2026, to be re-checked) | Note |
|---|---|---|
| Render web service Starter plus disk | about $7 per month plus about $0.25 per GB-month (a 5 GB disk about $1.25) per third-party summaries; Render's own page not confirmed | a disk needs a paid plan; free web services cannot have a disk |
| Render snapshots | included with the disk per Render's documentation | 24 h granularity, whole-disk only |
| Object storage for off-site copies | about zero at staging size (first 10 GB free at Backblaze per third-party pages) | your choice of provider |
| Aiven | free plan: 1 GB, backups included, 20 connections (Aiven docs); Developer from about $5 and Hobbyist from about $12 per month per Aiven's pricing page | **not part of initial staging** |

Limits: RPO equals the backup interval (up to 24 h for staging with a daily schedule); one instance only, so the backup shares CPU and I/O with the API while it runs; a deploy interrupts a running backup; the first off-site copy depends on a human until the scheduler exists; the backup tool has been tested only on a local database, not on a Render disk.

## 9. Sources

Render persistent disks and snapshots: https://render.com/docs/disks . Render pricing summaries (third-party, to be confirmed): https://www.usagepricing.com/blueprint/render , https://devtune.ai/verticals/deployment-and-hosting-platforms/render/pricing . Aiven free plan and pricing: https://aiven.io/docs/platform/concepts/free-plan , https://aiven.io/pricing/postgresql . Backblaze B2 pricing: https://www.backblaze.com/cloud-storage/pricing (partly via third-party pages).
