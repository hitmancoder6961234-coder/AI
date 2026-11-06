# Staging rollback plan

Prepared 6 November 2026. **A plan only: no rollback was performed or rehearsed.** Platform steps (Render rollback, Vercel promote / instant rollback, Docker image tags) follow the platforms' documentation and [OPERATIONS-VERIFICATION.md](OPERATIONS-VERIFICATION.md) section 7; none has been tried with a real account. This plan is for **staging only**. Production rollback needs its own approval and is not authorised by this document.

Related: [STAGING-DEPLOYMENT-PLAN.md](STAGING-DEPLOYMENT-PLAN.md) · [STAGING-VERIFICATION-CHECKLIST.md](STAGING-VERIFICATION-CHECKLIST.md).

## 1. Decide what went wrong first (code and data roll back separately)

| Symptom | Roll back | Data touched? |
|---|---|---|
| New build crashes at start, errors on every request, UI broken | the **code** (section 3) | no |
| A bad environment-variable change | revert the variable and restart (no redeploy) | no |
| Wrong `TRUST_PROXY_HOPS` / CORS / CSP | revert the variable; for the Vercel static CSP header, redeploy `vercel.json` | no |
| Data lost or corrupted in staging | restore a **backup** onto the staging disk (section 4) | yes (replaced, old data moved aside) |
| A provider or mail credential leaked | rotate it at the provider, then update the variable; **this needs your approval** (credential rotation is not done silently) | no |
| A security finding (HIGH / CRITICAL) | stop the affected operation, preserve evidence, report; do not rotate, reset or delete without authorisation | - |

## 2. What rolls back automatically and what does not

| Item | Automatic? | Notes |
|---|---|---|
| A failed build on Render | the platform keeps the previous deploy running (per Render's documentation, **not verified**) | the new build is not promoted |
| A crash-looping new deploy | **no** | the health check `/api/ready` keeps it out of rotation but does not return to the previous build; roll back by hand |
| Schema changes | **no** (and not needed): boot migrations are additive; an older build ignores newer tables and columns | the four legacy-table rebuild migrations never run on a fresh staging database (readiness report P1-03) |
| Environment variables | **no** | keep a masked record of the previous values' names and change dates; the secret values live only in the host |
| Sessions | a **restore** deletes every session and unused reset token on purpose | everyone signs in again |
| Aiven mirror rows | **no** | the mirror is append / upsert; a rollback of the code does not remove mirrored rows |
| Provider usage already billed | **no** | cannot be reversed |
| Uploaded files, projects, artifacts | **no** | live on the disk; only a restore changes them |

**The encryption hazard.** After `SECRETS_MIGRATE=encrypt`, users' saved model keys are sealed. A build older than the vault would read the sealed text as the key and every provider call would fail. Builds that contain the vault are safe to move between, with or without the key configured. In staging a fresh install has no old keys; if the test plan runs the encryption migration, take the automatic snapshot and a backup first, and keep `PRIVACY_ENCRYPTION_KEY` for as long as sealed keys exist.

## 3. Code rollback

**Render (staging service)**
1. If the app still runs, take a backup first (`node scripts/backup.mjs create --out /var/data/backups`, then `verify`).
2. Turn **auto-deploy off** for the staging service.
3. Dashboard -> the service -> Deploys -> the last good deploy -> **Rollback** (per Render's documentation; the exact button and behaviour with a disk are not verified).
4. Wait for `/api/ready` = 200, run checklist sections 2 and 3.
5. Fix forward on `release-hardening` as a new, tested commit; re-enable auto-deploy only after the fix is verified.

**Vercel (staging project)**
1. Deployments -> the last good deployment -> **Promote to Production** or **Instant Rollback** (per Vercel's documentation; not verified).
2. `BACKEND_URL` is a project setting, not part of a deployment: confirm it still points at the staging API.
3. If `server/security/csp.ts` changed between the two commits, `vercel.json` must carry the matching header; the unit test checks this on the commit you roll back to.
4. Roll back Render and Vercel together when one change touched both the API and the proxy; the proxy is stateless and tolerant, so usually only the API moves.

**Docker host**
1. Before each deploy: `docker tag darkness-ai:latest darkness-ai:previous` (the deploy script always tags `latest`, so there is no previous image unless you keep one).
2. Roll back: `docker compose stop app`, `docker tag darkness-ai:previous darkness-ai:latest`, `docker compose up -d --no-build`, then `curl -s localhost:3000/api/ready`.
3. **Never** run `docker compose down -v` (it deletes the data volume).

## 4. Data restore (staging)

Only with your approval, because it replaces the staging data (the old data is moved aside, not deleted).

1. **Stop the server** (Render: suspend the service; Docker: `docker compose stop app`). Restoring under a running server can corrupt the database.
2. `node scripts/backup.mjs restore <backup folder> --yes` (add `--root <dir>` if it is not `DARKNESS_STORAGE_ROOT`). It refuses an unverified backup and prints where the previous data went (`<root>.before-restore-<stamp>`).
3. Start the server, check `/api/ready`, sign in, spot-check. Everything written after the backup is gone; **all sessions are invalid**; an account erased after the backup comes back (repeat the erasure).
4. Remove the "before-restore" folder only when you are sure; it contains staging data.

Reversibility: a restore is reversible until the "before-restore" folder is deleted. Backups themselves contain accounts, password hashes and chats: keep them off the server, encrypted, with the encryption key kept elsewhere.

## 5. Before any risky staging operation

- Identify what data could be affected (the staging database and disk only).
- Confirm a verified backup exists and a restore of it has been rehearsed on a scratch root.
- State whether the operation is reversible.
- Get your approval for anything destructive: database reset, deletion, a destructive migration, a disk replacement, credential rotation.

## 6. After any rollback

- [ ] `/api/ready` = 200; sign in; send a chat message; open a project.
- [ ] Checklist sections 2 and 3 (headers, cookie, rate-limit hop test).
- [ ] Write down the cause, the commit returned to, and the error ID; make the fix a new, tested change. Do not hide the failed deploy.

## 7. Limits of this plan

Not rehearsed on any platform. The disk behaviour of Render rollbacks, Vercel's instant rollback, health-check timing and cold starts are unverified. Phase 2 must rehearse a code rollback (checklist 5.4) and a restore onto a scratch root (5.3) before Phase 2 can be called complete.
