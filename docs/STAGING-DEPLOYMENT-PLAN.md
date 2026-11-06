# Staging deployment plan (Phase 1: a plan, not executed)

Prepared 6 November 2026. **Nothing in this plan has been run.** It is executed only in Phase 2, only after you approve Phase 1, and every step that touches real infrastructure, credentials or cost stops for your approval first. Platform behaviour quoted here (Render rollback button, Vercel instant rollback, deploy ordering) comes from the platforms' documentation and from the repository's own docs; it has **not been verified** with real accounts.

Related: [STAGING-ENVIRONMENT-INVENTORY.md](STAGING-ENVIRONMENT-INVENTORY.md) · [STAGING-VERIFICATION-CHECKLIST.md](STAGING-VERIFICATION-CHECKLIST.md) · [STAGING-ROLLBACK-PLAN.md](STAGING-ROLLBACK-PLAN.md) · [../DEPLOY.md](../DEPLOY.md) · [OPERATIONS-VERIFICATION.md](OPERATIONS-VERIFICATION.md).

**Target shape (primary route):** Vercel (staging project, static UI + `api/proxy.js`) -> Render (staging web service with a disk, one instance) -> SQLite on that disk; optional Aiven staging mirror. **Alternative:** one Docker host with Caddy, same sequence from step 3 on. The choice is open (Phase 1 blocker 1).

## Step 0. Gate: do not start unless all are true

- [ ] You approved Phase 1 **and** Phase 2 in writing, and named the hosting target, accounts, providers and cost limits.
- [ ] Release identified: branch `release-hardening` at an exact commit (recorded in the Phase 2 report). If the documentation changes from Phase 1 are to be deployed, they were committed first with your approval.
- [ ] `git status` clean; HEAD equals the recorded commit; `origin/main` still `46223be`; PR #1 still open, not merged.
- [ ] The CI run for that exact commit is green.
- [ ] Local gate on that commit: `npm run verify`, `node scripts/smoke.mjs`, `npm run authz` (record counts; expected on `81216aa`: 381 unit, 97 smoke, 0 violations).
- [ ] Staging secrets exist and are **different** from production: encryption key, provider key(s) with spending caps.
- [ ] A rollback owner and a place to keep the encryption key and backups are agreed.

## Step 1. Infrastructure prerequisites

1. Create (with approval) the staging backend service **under a different name from production** (for example `darkness-ai-staging`), region as agreed, **a paid plan with a persistent disk** (a free web service has no disk and would lose the database on every restart), disk mounted at `/var/data`, **exactly one instance**.
2. Create the staging Vercel project pointing at the same repository; production branch setting = `release-hardening` for this project only.
3. Do **not** reuse `render.yaml` as-is: it names the service `darkness-ai` and sets `autoDeploy: true`. Either create the service by hand with the same values, or copy the blueprint to a staging file with a new name (a change to the repository: requires approval). Turn **auto-deploy off** until the first manual deploy is verified.
4. Optional (only if approved): a separate Aiven staging PostgreSQL service (`deploy/aiven/` Terraform or the console), with the Render outbound address allow-listed.

## Step 2. Database setup

1. The database is a **fresh SQLite file** created on first boot at `/var/data/database/darkness.db`. No restore, no copy of production data, no import.
2. Confirm the disk is empty before the first boot (`ls /var/data`); if it is not, stop and ask: **never reset or reuse a disk that holds data without your explicit approval.**
3. Optional Aiven: only after the encryption key exists. The mirror refuses to start without `PRIVACY_ENCRYPTION_KEY`.

## Step 3. Environment configuration

1. Enter the variables from [STAGING-ENVIRONMENT-INVENTORY.md](STAGING-ENVIRONMENT-INVENTORY.md) section 2 in the host's secret / environment settings (never in git, never in chat). Minimum: `NODE_ENV=production`, `PRIVACY_STRICT=true`, `PRIVACY_CSP=enforce`, `DARKNESS_STORAGE_ROOT=/var/data`, `TRUST_PROXY_HOPS=2` (Vercel in front) or `1`, `PRIVACY_ENCRYPTION_KEY`, at least one staging provider key (or none, if only user-added models are tested), `ENABLE_RUN_ENGINE` unset.
2. Leave `MAIL_*`, `AIVEN_*`, `SUPABASE_*` unset unless approved.
3. Vercel: `BACKEND_URL` = the staging backend's `https://` origin, no path.
4. Run `node scripts/preflight.mjs` in the backend shell (after the first deploy, where the real variables exist) and `node scripts/preflight.mjs --frontdoor` for Vercel. **No FAIL; every WARN explained.** This is the compensating control for P1-01 (the server does not validate its configuration at boot).

## Step 4. Database migrations

There is no separate migration command: `initDatabaseSchema()` creates and upgrades the schema at boot (see the readiness report, section 5). On a fresh file only `CREATE TABLE IF NOT EXISTS` and index statements run; the legacy rebuild migrations do not trigger. Verification after the first boot (in the shell, read-only): list the tables with `sqlite3` or a short `node:sqlite` query and expect the 36 tables of the schema; confirm `PRAGMA journal_mode` is `wal` and `PRAGMA foreign_keys` is on in the application's connection by the boot log / the readiness check.

## Step 5. Backend deployment

1. Deploy the recorded commit of `release-hardening` (Render: connect the staging service to the branch and run **Manual Deploy** of that commit; Docker: `.\scripts\deploy-server.ps1 -HostName <host> -User <user> -Branch release-hardening`, because the script defaults to `main`).
2. Build: `PUPPETEER_SKIP_DOWNLOAD=true npm ci --no-audit --no-fund && npm run build` (Render), start `npm start`.
3. Watch the log for: listening line, no error-level lines, `secrets_status`, no `csp_violation`.

## Step 6. Backend health verification

`curl -s $BACKEND/api/health` -> 200; `curl -s -o /dev/null -w "%{http_code}" $BACKEND/api/ready` -> 200 (`ready`); headers (`curl -sI`): `content-security-policy` (not report-only), `strict-transport-security`, no `x-powered-by`; anonymous `GET /api/models` -> 401; `POST /api/storage/limit` as an ordinary signed-in user -> 403 `OPERATOR_ONLY`; restart the service and confirm a created record survives. Details: STAGING-VERIFICATION-CHECKLIST section 2.

## Step 7. Frontend deployment

Deploy the same commit to the staging Vercel project (build `npm run build:web`). `vercel.json` carries the CSP header copy; if `server/security/csp.ts` differs from it the unit test already fails, so a green CI commit is consistent.

## Step 8. Frontend-backend integration

Through the Vercel origin: header and cookie checks (`darkness_session`: `HttpOnly; Secure; SameSite=Lax`, no `Domain`), sign-up, reload, sign-out; the two-network rate-limit test that proves `TRUST_PROXY_HOPS`; a streamed chat arriving in chunks; a ~10 MB project ZIP (3 MB parts); `POST /api/csp-report` -> 204.

## Step 9. Provider integration

One provider at a time, with a capped staging key: add the model in the app, test the connection, send a short prompt, stop mid-stream, test a revoked key and a timeout (OPERATIONS-VERIFICATION 3.1). Confirm the stored key is sealed in the database (`secrets_status`, `strings` check) and never appears in a response or log. Mail only if approved (3.2), otherwise confirm the 501 and the operator CLI path. Aiven only if approved.

## Step 10. Staging smoke tests

1. `npm run authz` against a build of the deployed commit (it starts its own throw-away server; it does **not** hit the staging host).
2. The deployment checks of the checklist against the **real staging URL** (they are manual or `curl`; the repository's `scripts/smoke.mjs` and the audit boot local servers and are not a staging test).
3. Take a first backup (`node scripts/backup.mjs create --out ...`), `verify` it, copy it off the server, and restore it once onto a scratch root (OPERATIONS-VERIFICATION 4.2).
4. Record every result in the Phase 2 report with the environment named (staging), never mixed with local results.

## Stop conditions (apply the error protocol)

Stop and report if: any boot error-level log line; `/api/ready` is not 200 after 5 minutes; preflight FAIL; a secret or personal data appears in a log; anonymous or cross-user access succeeds anywhere; the disk is not empty at first boot; any step needs a credential or cost you did not approve. HIGH or CRITICAL findings need your approval before anything risky is done.

## Time and cost notes

Not estimated: platform prices and provider charges were not verified here. Provider usage in staging is small (short prompts) but billed; use keys with a hard cap.
