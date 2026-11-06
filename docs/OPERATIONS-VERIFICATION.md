# Operations verification

How to prove, on a real deployment, the things this repository can only check locally. Written 5 Nov 2026.

**Nothing in this file has been executed against a live host, a real model provider, a real mail provider, Aiven, Supabase, Render, Vercel or a real domain.** None of that access exists in the environment where the code was written. Section 1 lists exactly what *was* run locally. Everything else is a procedure for you to run, with the result to expect. Tick a box only when you have seen the result yourself.

Related: [DEPLOY.md](../DEPLOY.md) (how to deploy), [SECURITY.md](../SECURITY.md), [RELEASE-READINESS.md](RELEASE-READINESS.md) (verdict and open items), [.env.example](../.env.example).

Contents: 1 Evidence gathered locally · 2 Production environment checklist · 3 Real provider tests · 4 Backup and restore verification · 5 Multi-instance limitations · 6 Environment-variable checklist · 7 Rollback · 8 What is still unverified

---

## 1. Evidence gathered locally (what was actually run)

All on a Windows 11 development machine, Node 22 (and 24 for unit tests and smoke earlier in the effort), the production build (`dist/server.js`), with throw-away data folders and fake providers.

| Area | What was run | Result |
|---|---|---|
| Whole gate | `npm run verify` (lockfile, architecture, lint budget, typecheck, unit tests, build) | see RELEASE-READINESS for the final numbers (latest, 6 Nov 2026: 381 unit tests, 97 smoke, 0 authorization violations, CI green) |
| End to end | `node scripts/smoke.mjs` boots `dist/server.js` and drives it over HTTP, including account recovery through the real operator CLI | all checks passed |
| Backup / restore drill | a production-build server with real accounts and data: `backup create` **while the server runs** -> `verify` -> a copy of the backup with one flipped byte -> `verify` fails and `restore` refuses it -> data changed after the backup -> server stopped -> `restore --yes` -> server restarted | 15 / 15: the server was ready on restored data, the pre-backup account could sign in again but its **old session was dead** (a restore invalidates every session and reset token), post-backup data was gone, the replaced data was kept aside (the drill script is not in the repository; the steps are in section 4) |
| A defect the drill work found | `restore` with `DARKNESS_DB_PATH` pointing outside the storage root left the **old `-wal` file beside the restored database**, which SQLite would replay onto it. Fixed in `scripts/backup.mjs` (the old file and its `-wal` / `-shm` are moved aside) with a regression test | fixed, tested |
| A second restore defect | a restored database brought back **sign-in sessions and password-reset tokens exactly as they were at backup time**: a session that was signed out afterwards, or a reset link used afterwards, would have become valid again. `restore` now deletes every session and reset token in the restored database and reports how many; accounts, data and disabled flags are kept | fixed, tested (unit test and the drill) |
| Clean room | a fresh copy of the tree without `node_modules`, `dist`, `.git` or `data`: `npm ci`, lockfile check, build, typecheck, architecture check, lint budget, unit tests, smoke, on **Node 22.23 and Node 24.22** | both: 349 / 349 unit tests, 94 / 94 smoke, 0 lint errors (1,033 warnings, the budget), 0 import cycles |
| Mail | the SMTP client against a local fake server: login, envelope, dot-stuffing, STARTTLS and implicit TLS (self-signed test certificate, verification on), refusal when STARTTLS is not offered, timeouts; Resend against a fake `fetch` | passes; **a real mailbox was never reached** |
| Front door | the real `api/proxy.js` handler in front of the production build (cookies, CORS/CSRF, streaming, header hygiene) | passes locally; **Vercel itself was never involved** |
| Preflight | `scripts/preflight.mjs` unit-tested against good and bad environments, never prints a value | passes |

## 2. Production environment verification checklist

Run after every deploy, and in full on the first one. `$APP` is your public URL.

### 2.1 Before traffic

- [ ] **Preflight on the API host** (Render shell / `docker compose exec app node scripts/preflight.mjs`): no `FAIL`; you can explain every `WARN`. It checks the environment of *that* process, so run it where the real variables exist. It reports names, never values.
- [ ] **Node version** is 22 or newer (`node -v` in the same shell). The server uses `node:sqlite`.
- [ ] **Persistent storage**: `DARKNESS_STORAGE_ROOT` is on a mounted disk or volume (preflight checks it is writable, has free space and is not the system temp folder). Restart the service and confirm the data is still there (create a note, restart, reload).
- [ ] **Secrets present** (section 6) and not duplicated in a `VITE_*` variable at build time.
- [ ] **A backup exists and verifies** (section 4) *before* the first real user.

### 2.2 After deploy

- [ ] `curl -s $APP/api/health` -> 200. `curl -s -o /dev/null -w "%{http_code}" $APP/api/ready` -> 200 (`ready`; `degraded` means an optional mirror is down, read the body).
- [ ] **Headers**: `curl -sI $APP/` shows `content-security-policy` (not `-report-only`), `strict-transport-security`, `x-content-type-options: nosniff`, no `x-powered-by`, no backend address in any header when behind Vercel.
- [ ] **TLS**: certificate valid for your domain, HTTP redirects to HTTPS, no mixed-content warnings in the browser console.
- [ ] **Cookie** (browser dev tools -> Application -> Cookies after signing in): `darkness_session` is `HttpOnly`, `Secure`, `SameSite=Lax` (or `None` only for a split-origin setup), **no `Domain` attribute**.
- [ ] **No shared demo account**: signing in as `user@darkness.local` / `password123` fails, and a request with `Authorization: Bearer default_token` returns 401. (`PRIVACY_STRICT=true` removes both; the smoke test checks this locally.)
- [ ] **Anonymous access is refused**: `curl -s -o /dev/null -w "%{http_code}" $APP/api/models` -> 401.
- [ ] **Sign-up, reload, sign-out** work; after sign-out the old cookie no longer works (`curl` it with `-b` -> 401).
- [ ] **Client IP / proxy hops** (this decides whether rate limits mean anything): from one machine make more failed sign-ins than `RATE_LIMIT_AUTH_PER_15MIN` allows and confirm you get `429 RATE_LIMITED` with `Retry-After`; from a **different network** confirm you are *not* limited; and confirm that adding `-H "X-Forwarded-For: 203.0.113.9"` to your requests does **not** reset your limit. If the second network is limited too, `TRUST_PROXY_HOPS` is too low (everyone looks like the proxy); if the forged header resets it, it is too high. Behind Vercel -> Render the value is 2, behind one proxy 1.
- [ ] **CORS**: from a page on another origin, a cookie-authenticated `POST` is refused (403) unless that origin is in `CORS_ORIGINS`.
- [ ] **Streaming** through the proxy: send a chat message through `$APP` and watch it arrive in chunks (not all at once); upload a ~10 MB project ZIP through the Vercel domain (Vercel refuses bodies over ~4.5 MB; the app splits ZIPs into 3 MB parts).
- [ ] **Logs** (Render logs / `docker compose logs app`): JSON lines, `"level":"error"` count is zero for a normal session, no e-mail addresses, tokens, keys or prompts appear, no `csp_violation` from your own pages.
- [ ] **Code execution is off**: `ENABLE_RUN_ENGINE` is not `true`.
- [ ] **Encryption status**: Overview -> System status reports provider keys as encrypted when `PRIVACY_ENCRYPTION_KEY` is set; the boot log has `secrets_status` with `plaintext: 0` once migrated.
- [ ] **Request-size limits are in force behind your proxies** (a proxy in front may have its own, smaller limit): signed in, `curl -s -o /dev/null -w "%{http_code}" -X POST -H "content-type: application/json" -H "authorization: Bearer <token>" --data-binary @2mb.json $APP/api/memory` -> `413`; the same file to `$APP/api/files/shared` -> `201`/`400` (not `413`). The answer for the first names its limit (`"maxMB":1`).
- [ ] **Server-wide settings are closed to users**: signed in as an ordinary user, `POST $APP/api/storage/limit`, `POST $APP/api/storage/clear-cache` and `GET $APP/api/storage/status` all answer `403` with `"code":"OPERATOR_ONLY"`.
- [ ] **Run the authorization audit against a staging copy** (`npm run build && npm run authz`, on the same build): no violations. It uses a local stand-in model provider and a throw-away database, never your real data.
- [ ] **Operator tools work in the deployed environment**: `node scripts/admin.mjs users` lists accounts masked; `node scripts/backup.mjs create --out ...` succeeds.

## 3. Real provider testing

Do this with **keys that have a spending cap**. Every test below sends tiny prompts, but you pay for them.

### 3.1 AI model providers (Gemini, OpenAI, Anthropic, OpenRouter, Groq, Together, Mistral, ...)

For each provider you intend to offer:

1. **Models** page -> add the model with its real key -> **Test connection**. Expect success within a few seconds; the key field then shows only that a key is stored, never the key.
2. **Chat**: a short prompt, streaming on. Expect tokens to arrive progressively. Stop it midway: the request ends and (provider dashboard) usage stops growing.
3. **Failure handling** (use a throw-away key): revoke it in the provider's console, send a message. Expect a clear "provider rejected the key" style error, **no retry storm** (client errors are not retried), and no key in the response or the logs. Then test a rate limit if you can (a free-tier key with a burst): expect a retried or clearly reported `429`, not a hung request.
4. **Timeouts**: unplug the network from the server or point a model at a blackhole URL (`AGENT_BASE_URL` / a custom base URL): the call must end within `PROVIDER_TIMEOUT_MS` with a readable error.
5. **Compare** (2 models) and **Prompt Studio** test runs: both answers appear, one failing model does not hide the other, closing the tab stops the upstream calls.
6. **Agent** with a real model: a goal that needs a web fetch; confirm the run's steps, the approval card for the write tool (`remember`: ask "remember that I prefer short answers" -> it must stop and wait), pause / resume, and that nothing was saved before you approved.
7. **Encryption at rest** (if `PRIVACY_ENCRYPTION_KEY` is set): after adding a key, `strings` the SQLite file (or `sqlite3 ... "select api_key from models"`) and confirm the value is sealed, not the provider key; the model must still answer.
8. **What providers actually return**: token counts shown on the Usage page are *estimates* (characters / 4). Compare one with the provider's own usage dashboard to see how far off they are for your content.

Record: provider, model id, date, result, anything surprising. Un-verified providers should stay out of any "supported" claim.

### 3.2 Mail provider (needed only for "Forgot password?" by e-mail)

Prerequisites: a sending domain you control. Set `SPF`, `DKIM` and a `DMARC` policy for it at your DNS provider (the mail provider's dashboard tells you the records); without them mail is likely to land in spam or be rejected.

1. Set `MAIL_PROVIDER`, `MAIL_FROM`, `PUBLIC_APP_URL` (https) and the provider's credentials (`.env.example`). Run `node scripts/preflight.mjs`: `MAIL_*` must be `PASS`. This checks the *settings*, not delivery.
2. Create an account with an e-mail address you can read. On the sign-in screen click **Forgot password?**, enter it. The page answers the same as for any address.
3. **Delivery**: the message arrives (check spam). Open the full headers and confirm `SPF=pass`, `DKIM=pass`, `DMARC=pass`, and the `From` is your `MAIL_FROM`.
4. **The link**: it points to `PUBLIC_APP_URL/reset.html#token=...` (the token is after `#`), opens the form, accepts a new password once, and then the browser's address bar no longer shows the token.
5. **Effects**: every other signed-in device is signed out; the old password fails; you receive the "password was changed" notice; using the same link again says it is not valid.
6. **Unknown address**: request a reset for an address with no account: same on-screen message, and **no mail** is sent (check the provider's log).
7. **Failure path**: temporarily set a wrong `SMTP_PASS` / `RESEND_API_KEY` and restart. The page still shows the neutral confirmation (by design), the server log has `reset_mail_failed` **without the address or the secret**, and nothing is delivered. Restore the right value.
8. **Limits**: 4 requests for the same address within an hour -> `429` with `Retry-After`.
9. **Operator fallback** works without mail: `node scripts/admin.mjs reset-link <email> --url $APP` prints a link that works once.

If any step fails, leave `MAIL_PROVIDER` unset: the page then states that e-mail recovery is not available and the operator CLI remains the way back in.

### 3.3 Other services

- **Aiven mirror** (only if `AIVEN_PG_URI` is set): boot log shows `[Aiven] PostgreSQL mirror ready`; create a conversation; confirm the row exists in Aiven **and that message text there is encrypted**; confirm the connection verifies the server's certificate (`AIVEN_CA_CERT` set; preflight warns otherwise).
- **Supabase** (only if used): the mirror stores a pseudonymous placeholder user, never the real e-mail or password hash; confirm that in the table after a sign-up.
- **Vercel front door**: `BACKEND_URL` is https (`node scripts/preflight.mjs --frontdoor`); the response headers do not reveal the backend host; a response slower than ~25 s to first byte becomes a 504 (Vercel's limit): try the slowest streaming feature you offer.

## 4. Database backup and restore verification

Facts the tooling guarantees (tested): a backup is a consistent copy taken with `VACUUM INTO` (safe while the server runs, includes un-checkpointed WAL data), plus the projects, artifacts, RAG, embeddings and uploads folders, with a manifest of checksums and sizes. `verify` re-checks the integrity of the database, its checksum and the folder sizes. `restore` refuses an unverified backup, needs `--yes`, and **moves the existing data aside instead of deleting it**.

A backup contains accounts (password hashes), sessions, chats and, unless `PRIVACY_ENCRYPTION_KEY` is set, users' provider keys. Treat it as sensitive as the live disk. **If `PRIVACY_ENCRYPTION_KEY` is set, keep that key with your backups' recovery notes**: without it sealed keys inside a restored database cannot be read (users would re-enter them).

### 4.1 Take and verify a backup (do this daily; the first time, by hand)

```bash
# Render shell, or: docker compose exec app sh
node scripts/backup.mjs create --out "$DARKNESS_STORAGE_ROOT/backups"
node scripts/backup.mjs verify "$DARKNESS_STORAGE_ROOT/backups/darkness-backup-<stamp>"
```

- [ ] `create` prints the database size, table count and a checksum; `verify` prints "backup verified".
- [ ] Copy the folder **off the server** (Render: download from the shell or an SFTP-style tool; Docker: `docker cp darkness-ai:/data/backups/<folder> ./`). A backup on the same disk does not survive losing the disk.
- [ ] Encrypt the off-server copy and restrict who can read it.

### 4.2 Prove a restore works (before you need it)

Do the first one on a **scratch root, not on live data**. **Unset `DARKNESS_DB_PATH` for these commands** (`env -u`): when it is set, both the restore tool and the server use that exact file instead of the folder you pass, and you would overwrite the live database.

```bash
mkdir /tmp/restore-test
env -u DARKNESS_DB_PATH node scripts/backup.mjs restore <backup folder> --root /tmp/restore-test --yes
env -u DARKNESS_DB_PATH DARKNESS_STORAGE_ROOT=/tmp/restore-test PORT=3999 node dist/server.js &   # a second instance, another port, same version
curl -s localhost:3999/api/ready                                                                  # expect 200
```

The scratch instance inherits the shell's whole environment, **including provider keys and mail settings**, so use it only for this check, never expose its port, and stop it afterwards. Prefer doing this on your own computer with a downloaded copy of the backup (no keys set there).

- [ ] The server starts on the restored copy and `/api/ready` is 200.
- [ ] You can sign in as a known account (use the same password; accounts and sessions are in the database).
- [ ] A conversation or project you know about is present.
- [ ] A **tampered** copy is refused: change one byte of `database/darkness.db` in a copy of the backup, run `verify` (exit code 1: "checksum does not match") and `restore` (refuses).
- [ ] Stop the scratch instance and delete `/tmp/restore-test` (it holds real data).

### 4.3 The real restore (disaster recovery)

1. **Stop the server** (Render: suspend the service or scale to zero; Docker: `docker compose stop app`). Restoring under a running server can corrupt the database.
2. `node scripts/backup.mjs restore <backup folder> --yes` (against the live root: add `--root <dir>` if it is not `DARKNESS_STORAGE_ROOT`). It prints where the **previous data** was moved (`<root>.before-restore-<stamp>`); keep it until you are sure.
3. Start the server, check `/api/ready`, sign in, spot-check recent data. Everything written after the backup is gone (that is what a restore means): tell users if relevant. **Everyone has to sign in again**: the restore invalidates all sessions and unused reset tokens on purpose (a backup would otherwise revive sessions that were signed out, and links that were used, after it was taken). The tool prints how many.
   **An account its owner erased after the backup comes back with the restore** (the backup contains it). If erasures must stay erased, repeat them after restoring; this is a property of any backup, and backups must be treated and rotated as confidential for the same reason.
4. Once satisfied, remove the "before-restore" folder (it contains real data).

If `DARKNESS_DB_PATH` points outside the storage root, the restore moves that database file and its `-wal` / `-shm` aside as well (`external-db/` inside the same "before-restore" folder).

**Evidence so far**: the same sequence was run locally against the production build (section 1). It has **not** been run on a Render disk or a Docker volume; the first real one should be done on a scratch copy as above.

Also available as safety nets, not replacements: Render disk snapshots, and the Aiven mirror (which holds conversations only, not accounts or files).

## 5. Multi-instance limitations report

**Darkness AI must run as exactly one instance.** This is a design property of the current code, not a configuration problem. Running two copies behind a load balancer gives inconsistent data and weaker security limits. The facts below come from reading the code (`server/`), so they stay true until the code changes.

| What | Where | Why it breaks with two instances |
|---|---|---|
| SQLite database on local disk | `db.ts` | One file with one writer, reachable only from the machine that has the disk. Two hosts cannot share it safely (file locking over network drives is unreliable). A Render disk can be attached to a single instance |
| In-memory copies of data: users, sessions, models, conversations, messages, files, projects | `server.ts` (`users`, `sessions`, `models`, `conversations`, `messages`, `files`, `projects` maps, loaded from SQLite at start) | Writes go to SQLite *and* the local map. A second instance has its own stale maps: a conversation created on A is invisible on B until B restarts; a deleted one can reappear. (Session *validity* is re-checked in the database on each request, so sign-out and expiry do work across instances, but the other maps do not) |
| Rate limits and lockouts | express-rate-limit memory store, `LoginGuard` (per address and per account), reset-request windows, compare / prompt-test limits | Counters are per process: two instances double every limit, and an attacker can alternate instances to dodge lockout |
| Concurrency guards | agent runs per user (`agent/routes.ts`), copilot streams, upload in-flight counts, "one comparison at a time" | Per process only: two instances allow twice as many parallel runs per user |
| Long-running job state | Studio jobs, RAG indexing jobs, project analyses and artifacts, knowledge store, run-engine terminals | A job started on A cannot be polled or cancelled on B (`404`/"not found") |
| Agent sessions | SQLite (durable) but a running loop lives in one process | The checkpoint survives a restart; a *running* session is owned by the process that started it. A second instance would see it as `running` and the restart-recovery step (marks interrupted runs `failed`, resumable) could wrongly mark it |
| Files on disk | projects, artifacts, uploads, RAG, embeddings under `DARKNESS_STORAGE_ROOT` | Local to one machine; object storage is not implemented |
| Rolling / zero-downtime deploys | any platform that starts the new version before stopping the old | Two instances overlap briefly: with a persistent disk Render stops the old one first (documented by Render, not verified here), which means a short outage on deploy. `/api/ready` returns `draining` during shutdown so a load balancer stops sending traffic |
| CSP report statistics, log counters | `security/csp.ts` | Per process (cosmetic) |

What *is* safe to run several of: the **Vercel front door** (`api/proxy.js` is stateless and only forwards).

**To scale out, the following would have to be built** (none of it exists): a shared database (PostgreSQL, with the in-memory maps removed or turned into caches with invalidation), a shared store for rate limits and locks (Redis or the database), a job queue with a worker, shared file storage, and ownership of agent runs by an instance id. Until then, scale **up** (a bigger single instance), not out. On Render choose a single instance with the disk; on Docker run one container.

**Operational consequences today**: a deploy or restart means a short outage (seconds to a minute); in-flight chats end; running agent sessions come back as `failed (interrupted)` and are resumable; in-memory counters reset.

## 6. Secure environment-variable checklist

Where to set them: Render / Vercel dashboard (secrets), or a `.env` on your server with `chmod 600` that is **never** committed. `scripts/preflight.mjs` checks the ones marked P without printing values.

| Variable | Needed | Secret | P | Notes |
|---|---|---|---|---|
| `NODE_ENV=production` | yes | no | P | enables production defaults and warnings |
| `PRIVACY_STRICT=true` | yes | no | P | every route needs a session; no shared demo account |
| `PRIVACY_CSP=enforce` | yes | no | P | `report-only` / `off` are for development |
| `DARKNESS_STORAGE_ROOT` | yes | no | P | a persistent mounted disk, not temp storage |
| `PORT` | host-set | no | P | must be a number |
| `TRUST_PROXY_HOPS` | yes | no | P | 2 behind Vercel -> Render, 1 behind one proxy; verify with 2.2 |
| `CORS_ORIGINS` | if split-origin | no | P | exact https origins; empty = same-origin only |
| `PRIVACY_ENCRYPTION_KEY` | recommended | **yes** | P | exactly 32 random bytes, base64 (`scripts/new-secrets.ps1`); **back it up separately from the database** |
| `PRIVACY_ENCRYPTION_KEY_PREVIOUS`, `SECRETS_MIGRATE` | only during rotation / migration | yes / no | P | remove after use (DEPLOY.md "Provider API keys at rest") |
| `*_API_KEY` for model providers | at least one | **yes** | P | use keys with spending caps; one per environment |
| `MAIL_PROVIDER`, `MAIL_FROM`, `PUBLIC_APP_URL` | only for e-mail recovery | no | P | `PUBLIC_APP_URL` must be https in production |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS`, `SMTP_USER`, `SMTP_PASS` / `RESEND_API_KEY` | per mail provider | `SMTP_PASS`, `RESEND_API_KEY` yes | P | `SMTP_TLS=none` only for localhost |
| `AIVEN_PG_URI`, `AIVEN_CA_CERT` | only for the mirror | URI yes | P | the mirror refuses to run without the encryption key |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | only if used | service-role key **yes** | partly | the service-role key bypasses row security: server only |
| `BACKEND_URL` | Vercel only | no | `--frontdoor` | https origin of the API |
| `ENABLE_RUN_ENGINE` | no (leave `false`) | no | P | `true` runs user commands on the server: private single-user instances only |
| `LOGIN_MAX_FAILS`, `LOGIN_LOCK_SECONDS`, `RATE_LIMIT_*` | optional | no | no | defaults are safe; loosening them weakens brute-force protection |
| `DARKNESS_DB_PATH`, `DARKNESS_PROJECTS_DIR`, `DARKNESS_UPLOAD_TMP` | optional | no | no | keep on persistent storage; backups cover `DARKNESS_DB_PATH` |

Hygiene:

- [ ] No secret is in git, a screenshot, a chat or a ticket. If one ever was: **rotate it** (the provider's key, `SMTP_PASS`, a database URI) and, for `PRIVACY_ENCRYPTION_KEY`, follow the rotation steps.
- [ ] No `VITE_*` variable holds a key on any build machine (Vite inlines `VITE_*` into browser code; preflight warns).
- [ ] The server `.env` is `chmod 600`, owned by the deploy user, and not world-readable in a backup.
- [ ] Provider keys are per environment (never the production key in a laptop `.env`) and have usage caps and alerts.
- [ ] Staff with dashboard access are the only people who can read variables; remove people who left.
- [ ] After any change: restart, run preflight, repeat 2.2.

## 7. Deployment rollback instructions

**First, decide what went wrong**, because code and data roll back separately:

| Symptom | Roll back |
|---|---|
| New release crashes at start, errors on every request, UI broken | the **code** (below). Data does not need to change |
| A bad environment-variable change | revert the variable and restart (no redeploy needed) |
| Data lost or corrupted | restore a **backup** (section 4.3), not a code rollback |

**Database compatibility.** Schema changes made by this codebase are additive and idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN`, created at boot): recent additions are the tables `memories`, `memory_settings`, `prompts`, `prompt_versions`, `agent_sessions`, `agent_events`, `agent_runs`, `password_resets` and the columns `conversations.folder` / `pinned` / `tags` and `users.disabled_at`. An **older build ignores tables and columns it does not know**, so rolling the code back does not require a database rollback. The one exception is below.

**Upgrading a database from an older version (P1-03).** Take a verified backup first (section 4). On the first start this build rebuilds legacy tables (those without `user_id`, and `models` with a primary key on `id` alone) in one atomic transaction after writing `<storage root>/backups/pre-migrate-<time>.db`; if anything is unexpected or fails it **refuses to start** and the database is unchanged (read the `Database migration refused at ...` line, fix or restore, start again). Keep the snapshot until you have checked the data; it contains real data. `PRAGMA user_version` is stamped `1` after a complete start; a database stamped by a newer build is refused (`DARKNESS_ALLOW_NEWER_SCHEMA=true` only if you know why). **Never** start this build, or an older one, against the only copy of a legacy database without a backup.

> **Encryption hazard.** After `SECRETS_MIGRATE=encrypt`, users' model keys are stored sealed. A build **older than the vault** would read the sealed text as if it were the API key, and every provider call would fail with an authentication error. If you must roll back to such a build: restore the snapshot `<root>/backups/pre-secrets-encrypt-<time>.db` (taken automatically before the migration; it is plaintext, treat it as a secret), or ask users to re-enter their keys. Builds that contain the vault, with or without the key configured, are safe to move between. Keep `PRIVACY_ENCRYPTION_KEY` while any sealed key exists.

### Render

1. Take a backup first if the app still runs (section 4.1).
2. Dashboard -> the service -> **Events / Deploys** -> choose the last good deploy -> **Rollback** (per Render's documentation; not verified here). Turn **auto-deploy off** meanwhile, otherwise the next push redeploys the bad commit.
3. Wait for `/api/ready` = 200, then run 2.2.
4. Fix forward on a branch; re-enable auto-deploy only when the fix is verified.

### Vercel

1. Dashboard -> Deployments -> the last good one -> **Promote to Production** (or **Instant Rollback**, per Vercel's documentation; not verified here).
2. `BACKEND_URL` is a project setting, not part of a deployment: check it still points at the right API.
3. If the rollback is because `server/security/csp.ts` changed, remember `vercel.json` must carry the matching headers (`npm test` checks this on the commit you roll back to).

Roll back Render and Vercel together when a change touched both the API and the proxy; otherwise one side can be ahead of the other (the proxy is stateless and tolerant, so usually only the API needs to move).

### Your own Docker server

`deploy-server.ps1` always deploys the tip of `main` (`git reset --hard FETCH_HEAD`) and tags the image `darkness-ai:latest`, so there is **no previous image to return to unless you keep one**. Before each deploy, on the server:

```bash
docker tag darkness-ai:latest darkness-ai:previous      # keep the running image
```

To roll back (steps not verified here: Docker was not available):

```bash
cd ~/darkness-ai/repo
docker compose stop app
docker tag darkness-ai:previous darkness-ai:latest      # or: git checkout <good-commit> && docker compose build
docker compose up -d --no-build                         # no rebuild: use the retained image
docker compose ps && curl -s localhost:3000/api/ready
```

The data lives in the `darkness-data` volume and is untouched by a rebuild or a rollback. Never run `docker compose down -v` (it deletes the volume).

### After any rollback

- [ ] `/api/ready` = 200, sign in, send a chat message, open a project.
- [ ] Section 2.2 headers and cookie checks.
- [ ] Note the cause and the commit you returned to; make the fix a new, tested change.

## 8. What is still unverified (do not claim these)

- Any behaviour on Render, Vercel, Docker hosts, Aiven or Supabase (deploy, disk mount, rollback buttons, health-check timing, cold starts, limits quoted from their documentation).
- Delivery of e-mail through any real SMTP server or Resend, and your domain's SPF / DKIM / DMARC outcome.
- Any real AI provider: key handling, streaming, timeouts and rate-limit behaviour against live APIs; token and cost figures.
- A backup and restore on the real disk or volume (the local drill passed; see section 4).
- TLS, DNS, cookies and CSP on your real domain in real browsers.
- Whether the CI jobs are *required* checks on `main` (branch protection was not inspected). The workflow itself has run: GitHub Actions ran for the first time on 6 November 2026 (PR #1, run 42118240655, head 9607514): all five jobs passed (Linux Node 22 and 24, Windows, macOS, dependency audit and secret scan). It found two real problems that local runs had not: three fake test keys that the secret scan flagged, and a Linux-only hang in `tests/run-engine.test.ts` (project processes were not given their own process group, so `stopProject` could not end the tree); both are fixed.
- Load, memory and concurrency under real traffic, and behaviour with more than one instance (unsupported, section 5).

The honest status is in [RELEASE-READINESS.md](RELEASE-READINESS.md): the code is tested locally; production readiness is *not* declared until the unchecked boxes above are checked on the real deployment.
