# Staging readiness report (Phase 1)

Prepared 6 November 2026 on branch `release-hardening`. **Nothing was deployed, merged, committed or changed on any external service in this phase.** Sections marked *verified* were checked against the repository, the GitHub API or a local run on that date; anything about a real platform is marked *not verified*.

Companion documents: [STAGING-ENVIRONMENT-INVENTORY.md](STAGING-ENVIRONMENT-INVENTORY.md) · [STAGING-DEPLOYMENT-PLAN.md](STAGING-DEPLOYMENT-PLAN.md) · [STAGING-VERIFICATION-CHECKLIST.md](STAGING-VERIFICATION-CHECKLIST.md) · [STAGING-ROLLBACK-PLAN.md](STAGING-ROLLBACK-PLAN.md). Existing documents these build on (not duplicated): [../DEPLOY.md](../DEPLOY.md), [OPERATIONS-VERIFICATION.md](OPERATIONS-VERIFICATION.md), [ENVIRONMENT-VARIABLES.md](ENVIRONMENT-VARIABLES.md), [ARCHITECTURE.md](ARCHITECTURE.md), [AUTHORIZATION-AUDIT.md](AUTHORIZATION-AUDIT.md), [RELEASE-READINESS.md](RELEASE-READINESS.md).

## 1. Repository and release state (verified 6 Nov 2026)

| Item | Result |
|---|---|
| Branch / HEAD | `release-hardening` at `9607514` |
| Remote | `origin` = `github.com/hitmancoder6961234-coder/AI` (public repository); `origin/release-hardening` = `9607514` |
| `main` | `46223be`, identical locally and on `origin`: **not modified** |
| Ahead / behind `main` | 10 ahead, 0 behind (the eight planned commits `0d0579b` ... `695e156`, plus `0babe13` gitleaks allow-list and `9607514` run-engine fix) |
| Pull request | #1, open, `merged=false`, `mergeable_state=clean`, 10 commits, head `9607514` |
| Latest CI | run `42118240655` (pull_request, head `9607514`): success. Linux Node 22, Linux Node 24, Windows, macOS, dependency audit + secret scan: all success. Earlier run `42113163658` (head `695e156`) failed on two real findings, both fixed |
| Working tree at the start | clean (0 entries). This phase then edited documentation only (listed in section 9) and left it **uncommitted** for your review |

## 2. Architecture overview

Detail and layering rules: [ARCHITECTURE.md](ARCHITECTURE.md). This section is the request path, checked against `server/server.ts` and `server/security/privacy.ts`.

**Processes.** One Node 22 process (`dist/server.js`, built by `npm run build`: Vite for `web/` into `dist/`, esbuild for the server) serves the API, the built UI and the original app at `/classic/`. Optionally a stateless Vercel Edge function (`api/proxy.js`) sits in front and forwards only `/api/*` and `/classic-api/*` to the API host. There is no queue, worker, cache server or second service.

**A chat message, step by step**

1. Browser: UI (Vite bundle, no inline script or handler) calls `POST /api/conversations/:cid/chat` with the session cookie (`darkness_session`: `HttpOnly`, `Secure` on HTTPS, `SameSite=Lax`, host-only, 30 days).
2. Optional front door: `api/proxy.js` checks the path, forwards with streaming preserved, passes `X-Request-Id` and the client IP; the browser only ever sees the front-door origin.
3. Express middleware in order (`createServer`, `server.ts` ~l. 977-1100): request id and context, upload-temp sweeper, cookie parser, **privacy middleware** (security headers, CSP per surface, per-address rate limits for API / auth / AI, log redaction, strict auth gate: every API path needs a valid session unless it is in `PUBLIC_API`), CORS, **CSRF Origin guard** (cookie-only state-changing requests must come from this site or `CORS_ORIGINS`), per-route body-size parser (1 / 25 / 100 MB tiers, early 413), ownership guards for `:pid` and `:cid` (memory and database), artifact access guard.
4. Session: the token is looked up in the `sessions` table on every request (expiry and revocation are immediate); an in-memory map is a cache only.
5. Route handler: ownership of the conversation (and of any attached file or project) is re-checked; relevant user memory notes are selected; the model is chosen from the user's own models (keys decrypted only here, with the vault key).
6. The SSE response is opened immediately (headers and a comment frame) so a hosting front door does not time out on a slow first token.
7. Provider call through `server/provider-http.ts` only: connect / first-byte / idle timeouts, bounded retries for transient failures before any text, cancellation when the browser disconnects, secret scrubbing of errors. The model's stream is filtered and written as SSE frames.
8. Persistence: the user and assistant messages are written to SQLite (and held in in-memory maps, see single-instance limits); an optional encrypted mirror write goes to Aiven PostgreSQL.
9. Logging: one JSON line per request with the request id and no body, query string or header values.

**Entry points.** `server/server.ts` (API + UI), `api/proxy.js` (front door), `scripts/preflight.mjs`, `scripts/backup.mjs`, `scripts/admin.mjs` (operator tools, run on the host / container), `scripts/smoke.mjs` and `scripts/authz-audit.mjs` (verification, local throw-away servers).

**External APIs.** AI providers (Gemini, OpenAI-compatible, Anthropic, OpenRouter, Groq, Together, Mistral, or any base URL a user adds), optional mail provider (SMTP or Resend), optional Aiven PostgreSQL, optional Supabase (legacy cloud sync), GitHub Actions (CI only).

**Potential single points of failure.** The single API instance and its disk (database, uploads, projects); the one `PRIVACY_ENCRYPTION_KEY` (if lost, sealed provider keys and the Aiven mirror are unreadable); the model provider(s); the front door (stateless, replaceable); backups are manual (no scheduler exists, see P1-09).

**Development-only behaviour that could break in staging.** Dev mode (`NODE_ENV` unset) serves the UI through Vite with report-only CSP, pretty logs, no HSTS and 0 trusted proxy hops: staging must set `NODE_ENV=production`. `ENABLE_RUN_ENGINE` must stay off (it runs user commands on the host). Free hosting tiers have no persistent disk (the database would reset on every restart).

## 3. Documentation reconciliation

Compared with the code and configuration on 6 Nov 2026.

| Document | Statement | Finding |
|---|---|---|
| docs/RELEASE-READINESS.md, OPERATIONS-VERIFICATION.md (section 8), SECURITY.md, DEPLOY.md | "the CI workflow has never run on GitHub" | **Outdated**: it ran on PR #1. **Corrected** in this phase (see section 9), including that it has not run on `main` and branch protection was not inspected |
| DEPLOY.md | "`deploy-server.ps1` pulls `main`" | Accurate by default, but the script has a `-Branch` parameter (default `main`): a staging deploy from this branch must pass `-Branch release-hardening` (plan, step 5) |
| The request named `docs/DEPLOY.md` | - | There is no such file: the deployment guide is `DEPLOY.md` at the repository root |
| docs/ENVIRONMENT-VARIABLES.md | complete inventory | Four names were missing (`AUTHZ_PORT`, `ROUTE_DUMP`, `VITE_API_URL`, `ASSETS`); **added** (section 4). Otherwise matches the code |
| DEPLOY.md / OPERATIONS-VERIFICATION.md | schema changes are additive and idempotent | **Mostly true, with exceptions**: boot migrations also rebuild four legacy tables (projects, conversations, workspace_files, models) and drop the old ones, only when the old shape is detected (P1-03) |
| OPERATIONS-VERIFICATION.md section 5 | exactly one instance | **Confirmed** by the code (in-memory maps, per-process limiters; section 7 below) |
| render.yaml | health check `/api/ready`, disk `/var/data`, Node 22 | Matches the code; but it describes one production-shaped service (P1-07) |
| Dockerfile / docker-compose.yml | non-root, volume `/data`, `127.0.0.1` binding, `.dockerignore` excludes `.env`, `data`, `.git` | Matches; **never built here** (no Docker), only its content is unit-tested |
| docs/AUTHORIZATION-AUDIT.md | 151 routes, 145 attacked, 0 violations | Reproduced by CI on Linux Node 22 and 24 (`npm run authz` step) |

## 4. Environment-variable audit

Method: every `process.env.X`, `env.X`, `env["X"]` and `import.meta.env.X` in `server/`, `scripts/`, `api/`, `web/`, `vite.config.ts` was extracted (74 names read directly) and compared with `.env.example` (71 names), `docs/ENVIRONMENT-VARIABLES.md` and `render.yaml` (18 keys). Method and results are reproducible with the script described in section 9.

| Check | Result |
|---|---|
| Read by code, missing from the inventory | `AUTHZ_PORT`, `ROUTE_DUMP` (tools), `VITE_API_URL` (browser override), `ASSETS` (not an env var: a dead Cloudflare-style branch). **Fixed in the inventory** |
| In `.env.example` but never read | `HOST_PORT` (read only by `docker-compose.yml`: correct) |
| In `render.yaml` but not read by code | `NODE_VERSION`, `PUPPETEER_SKIP_DOWNLOAD` (platform / install-time: correct) |
| Read by code but not in `.env.example` | the `SMTP_*` and `RESEND_API_KEY` names (documented as comments), OS variables (`APPDATA`, `XDG_DATA_HOME`, `K_SERVICE`), tool variables, the legacy `VITE_GEMINI_API_KEY` / `VITE_GOOGLE_API_KEY` / `API_KEY` aliases. No gap that matters |
| Duplicates | none found in `.env.example` |
| Hard-coded credentials | none: the tree-wide scan (204 changed files plus gitleaks in CI) found only the exact fake test fixtures |
| Hard-coded URLs | provider base URLs and documentation links only; the API origin is never hard-coded (`BACKEND_URL` on Vercel, same-origin otherwise) |
| Development-only defaults | `TRUST_PROXY_HOPS` defaults to **1** in production (0 in development) while Vercel -> Render needs **2** (render.yaml sets it): a wrong value silently weakens or breaks per-address rate limits (P1-10) |
| CORS | production allows only `CORS_ORIGINS` (empty = same origin); dev adds localhost origins |
| Cookies | `HttpOnly`, `Secure` when HTTPS, `SameSite=Lax` (or `None` only when `COOKIE_SAMESITE=none`), no `Domain` |
| Validated at startup? | **Partly.** Numeric limits and the CSP / body-limit variables are parsed and junk is ignored; the encryption key shape disables the vault or stops the Aiven mirror. **There is no fail-fast check of the overall configuration at boot**: the server starts with missing provider keys, a wrong proxy-hop count or no encryption key. `scripts/preflight.mjs` does these checks but must be run (P1-01) |

A local preflight run with a staging-like environment and no secrets gave: 10 ok, 2 warnings (no provider key, no encryption key), 0 failures; the front-door check failed a non-https `BACKEND_URL` as designed.

## 5. Database readiness

*Primary store:* SQLite (`node:sqlite`), one file under `DARKNESS_STORAGE_ROOT/database/darkness.db` (or `DARKNESS_DB_PATH`), WAL mode, `foreign_keys=ON`, `synchronous=NORMAL`, `secure_delete=ON`. *Optional mirrors:* Aiven PostgreSQL (encrypted conversation mirror; accounts and files are not mirrored) and Supabase (legacy).

| Topic | Finding |
|---|---|
| Schema | 36 tables created with `CREATE TABLE IF NOT EXISTS` at boot (`initDatabaseSchema`, inside a transaction): users, sessions, projects, project_files, conversations, messages, models, knowledge_*, memories, prompts, agent_*, password_resets, artifacts and others. 39 index statements, 26 foreign-key references |
| Migration strategy | **Automatic at every boot, no version table.** Additive changes (`ADD COLUMN`, new tables) are idempotent. Four legacy rebuild migrations (rename old table, copy, drop) run only when the old shape is detected; **the `projects` one drops the original when the copy fails (proven, P1-03)**; the others log or swallow their errors. No automatic pre-migration snapshot |
| Rollback | None built in. Older builds ignore newer tables and columns, so a code rollback needs no database change; **the encryption hazard** in OPERATIONS-VERIFICATION section 7 applies after `SECRETS_MIGRATE=encrypt` |
| Connection pooling / limits | Not applicable to SQLite (one in-process connection, single writer). The Aiven mirror uses a PostgreSQL client pool (max 4 connections); connection exhaustion there only degrades the optional `/api/ready` check |
| Ownership relationships | `user_id` on projects, conversations, files, models, memories, prompts, agent sessions; enforced in code (the audit proves it) and not by row-level database policy |
| Transactions | schema creation, the secret migration (all rows in one transaction, snapshot first) and the user-id migration use transactions; ordinary writes are single statements |
| Backups | `scripts/backup.mjs` (consistent `VACUUM INTO` snapshot plus folders, manifest and checksums, `verify`, `restore --yes` that moves data aside and invalidates every session and reset token): tested locally (drill 15/15), **not on a Render disk or Docker volume**. No scheduler exists |
| Persistence | requires a mounted disk or volume; free tiers without a disk lose the database on restart |
| Can staging use a separate database? | **Yes, and must.** A fresh staging root creates an empty database; the legacy-shape migrations do not trigger on a new file. Do not copy a database that holds real accounts into staging |
| Migrations that could destroy or modify existing data | **`projects` rebuild: proven to destroy all legacy rows if its copy step fails (see P1-03)**; the `conversations`, `workspace_files` and `models` rebuilds (legacy shapes only); the boot remap of two legacy user ids to fixed UUIDs (`UPDATE OR IGNORE`, no effect on a fresh database; see P1-04); `SECRETS_MIGRATE=encrypt|rotate` (snapshot written first); `dbPurgeSharedModelCopies` (deletes the duplicate `user_default` model rows in strict mode). None runs against production in this phase |

## 6. Security readiness

| Area | State (code and local / CI evidence) | Open for staging |
|---|---|---|
| Authentication | salted scrypt password hashing, per-account and per-address lock-out, constant-ish timing, structured errors; sessions are DB rows with expiry and revocation | real-browser behaviour on the staging domain |
| Session / cookies | flags as in section 4; restore and password reset revoke sessions | cookie flags in a real browser through the real front door |
| CSRF | Origin guard on cookie-only state-changing requests | behind real proxies |
| CORS | allow-list only | confirm with the real front-door origin |
| CSP | enforced; `server/security/csp.ts` and `vercel.json` kept identical by a test | headers actually served by Vercel (not measured) |
| Password reset | hashed single-use tokens, 30 minutes, neutral answers, 501 without a mail provider | **never tried with a real mailbox** |
| API authorization | ownership checks everywhere, `OPERATOR_ONLY` for server-wide settings; audit 151 / 145 / 0 | see audit limits below |
| File uploads | content-based validation, size tiers, streamed to a private temp folder, safe ZIP extraction | real Vercel 4.5 MB / Render behaviour |
| Secrets | provider keys sealed at rest when the vault key is set; no secret in logs (redaction by name and by value); gitleaks + a unit test | the vault key must be set and backed up in staging |
| Rate limiting | per address and per route class, **in memory per process** | depends on `TRUST_PROXY_HOPS` being right (P1-10) |
| Request-size limits | 1 / 25 / 100 MB tiers, early 413 | proxies in front may impose smaller limits |
| Error responses | JSON with request id, no stack traces | - |
| Operator access | no in-app admin role; `scripts/admin.mjs` needs shell access; `/api/storage/*` is operator-only | - |

**What the authorization audit does not cover** (from [AUTHORIZATION-AUDIT.md](AUTHORIZATION-AUDIT.md) "Limits" and this review): it judges behaviour as row changes and returned data, so it cannot see harmful effects that touch no row (global settings, files on disk, the shared cache: finding #62 was found by hand review); it uses a stand-in provider and a throw-away database on one instance; it does not test the front door or any real deployment; the six public routes are reviewed by hand; it does not test business-logic limits (quotas, expensive operations), session fixation across a real proxy, race conditions between two users, rate-limit bypass behind real proxies, or abuse of the agent's tools with a real model. These belong to Phase 4.

## 7. Single-instance and scale limits (confirmed in code)

In-memory copies of users, sessions, models, conversations, messages, files and projects (`server.ts` lines 416-623), per-process rate limiters (`privacy.ts`, `login-guard.ts`, `recovery.ts`), in-process agent loops and run-engine terminals, and local files make **exactly one instance** the only supported shape. A deploy or restart is a short outage and ends in-flight chats; running agent sessions come back as `failed (interrupted)` and are resumable. Full table: OPERATIONS-VERIFICATION section 5. Scale **up**, not out. Staging must follow the same rule.

## 8. Error and finding register (Phase 1)

Severity per the error-handling protocol (LOW / MEDIUM / HIGH / CRITICAL). No HIGH or CRITICAL issue was found. "Existed before" = present in the base commit `46223be` or earlier unless stated.

| ID | Sev | Description | Root cause (proven / hypothesis) | Status | Approval needed |
|---|---|---|---|---|---|
| P1-01 | MEDIUM | No fail-fast validation of the whole configuration at boot; the server starts with missing provider keys, a wrong `TRUST_PROXY_HOPS`, no encryption key | *Proven*: no validation call in `server.ts` start-up; `preflight.mjs` is a separate command. Existed before | OPEN. Mitigation within scope: the deployment plan runs `npm run preflight` as a gate before and after every deploy. Proposed code fix (call preflight checks at boot in production and refuse `FAIL`s) is a behaviour change | **Yes** (code change; proposed for Phase 2 or later) |
| P1-02 | MEDIUM | Documentation said the CI had never run; `deploy-server.ps1` default branch `main` not mentioned for staging | *Proven*: stale text after PR #1 CI | **FIXED - VERIFICATION PENDING** (statements corrected in 4 files; `git diff` shows exactly the edits; no code touched) | No (review the diff) |
| P1-03 | **HIGH when an older-shaped database is opened (data loss, proven); MEDIUM otherwise** | The `projects` rebuild migration destroys the original table when its copy step fails: `server/db.ts` ~l. 176-182 renames `projects` to `projects_old`, creates the new table, copies, and if the copy throws its `catch` runs `DROP TABLE IF EXISTS projects_old`, inside the outer transaction, which then commits. **Proven by experiment (6 Nov 2026, throw-away database in a temporary folder, no repository or real data touched; probe kept outside the repository): starting the current code against a database whose `projects` table has an older shape (no `user_id`, and no `last_indexed_at` / `metadata` columns) made the rebuild's `INSERT ... SELECT` fail, the `catch` then ran `DROP TABLE IF EXISTS projects_old`, and the outer transaction committed: the legacy project row was GONE afterwards (only the seeded "Global Workspace" row remained). A silent loss of every project in such a database.** The `conversations` and `workspace_files` rebuilds only log (their old tables stay behind, stranded); the `models` rebuild swallows silently. No schema version exists. | *Proven* for `projects` (probe); the other three from reading the code, not probed. Existed before this branch. **Only affects a database created by an older version that this code is started against**: a fresh staging database and the current production schema are not affected | **FIXED (6 Nov 2026), verified locally; GitHub CI for the fix commit is recorded in the Phase 1 report.** Implemented in `server/db-migrations.ts` and `initDatabaseSchema` (see IMPROVEMENT-LOG Task 12, SECURITY.md #63 and #64): snapshot first, unexpected shapes refused, one atomic rebuild transaction with foreign keys off, errors propagate, `PRAGMA user_version` stamped and guarded. A second, wider defect was found while fixing it: even a successful legacy rebuild deleted all child rows (#64). 18 migration tests; full suite 381/381, smoke 97/97 twice, authorization audit 0 violations. The rule "back up any older-version database before starting this build" still applies as ordinary practice | Approved and done (6 Nov 2026) |
| P1-04 | LOW | Boot code remaps two hard-coded legacy ids (`user_default`, a test identifier `DARKNESS-DELAYED-PERSISTENCE-TEST`) to fixed UUIDs | *Proven*: `db.ts` ~l. 592. `UPDATE OR IGNORE`: no effect when no such rows exist; user ids are UUIDs so a user cannot be registered with those strings. Existed before | OPEN (cleanup candidate) | No |
| P1-05 | LOW | `cookieParser()` is registered twice | *Proven*: `server.ts` ~l. 986 and ~l. 1044. Harmless duplicate work | OPEN | No |
| P1-06 | MEDIUM (design limit) | Exactly one instance; in-memory state and per-process limiters | *Proven*: section 7. Existed before. Accepted design limit, not a defect to fix in staging | OPEN (documented; Phase 4.9 evaluates) | Yes to change |
| P1-07 | MEDIUM | `render.yaml` is one production-shaped service (`darkness-ai`, `autoDeploy: true`, region and paid plan fixed). Creating "staging" from it would clone production naming and auto-deploy behaviour | *Proven*: file content | OPEN. Plan: a separately named service, its own disk and secrets, deploying branch `release-hardening` | **Yes** (creating infrastructure and cost) |
| P1-08 | LOW | The Vercel proxy uses the Edge runtime that Vercel marks deprecated; the 4.5 MB / 25 s / 300 s limits are quoted from documentation, not measured | *Proven* in `api/proxy.js`; limits unmeasured | OPEN, measured in Phase 2 / 3 | No |
| P1-09 | MEDIUM | No backup scheduler and no application metrics, alerting or error tracking: backups and monitoring are manual / platform logs only | *Proven*: no scheduled job or metrics module exists (only the in-process upload sweeper) | OPEN. Phase 2 must agree a backup routine; Phase 4.8 evaluates monitoring | **Yes** (external services) |
| P1-10 | MEDIUM | `TRUST_PROXY_HOPS` defaults to 1 in production but Vercel -> Render needs 2; a wrong value makes all clients look like one address (limits trip for everyone) or lets a forged `X-Forwarded-For` reset limits | *Proven*: `privacy.ts` ~l. 266 and `render.yaml`. Existed before | OPEN. The staging checklist includes the two-network test (OPERATIONS-VERIFICATION 2.2) | No |
| P1-11 | LOW | `VITE_API_URL` browser override and `ASSETS` branch were undocumented | *Proven* by the audit | **FIXED - VERIFICATION PENDING** (rows added to ENVIRONMENT-VARIABLES.md) | No |
| P1-12 | LOW | `main` has no branch protection and no required checks; direct pushes (including force-push) are not restricted | *Proven* by the public GitHub API on 6 Nov 2026 (`protected: false`, no rulesets) | OPEN (inspection only; recommended protections are in STAGING-DECISION-BRIEF.md section 3) | **Yes** (changing GitHub settings) |

Not errors but **blockers** (missing access or decisions): see section 10.

## 9. Files changed in this phase (all uncommitted)

New: `docs/STAGING-READINESS-REPORT.md`, `docs/STAGING-DEPLOYMENT-PLAN.md`, `docs/STAGING-ENVIRONMENT-INVENTORY.md`, `docs/STAGING-VERIFICATION-CHECKLIST.md`, `docs/STAGING-ROLLBACK-PLAN.md`.
Added in the follow-up (also new): `docs/STAGING-DECISION-BRIEF.md` (providers, mail, branch protection, open decisions), `docs/STAGING-BACKUP-RESTORE-PLAN.md`, `docs/PROPOSED-FIXES-P1.md` (P1-01, P1-03, P1-09: proposals only), `docs/PHASE-STATUS-REGISTER.md`.
Modified (documentation only): `DEPLOY.md`, `SECURITY.md`, `docs/OPERATIONS-VERIFICATION.md`, `docs/RELEASE-READINESS.md` (stale CI statements), `docs/ENVIRONMENT-VARIABLES.md` (four missing names). No source, test, workflow or configuration file was touched. Existing documents were improved, not duplicated; the five new ones are staging-specific and link to the existing ones instead of repeating them.

The environment audit used a throw-away script kept outside the repository; its method is in section 4.

## 10. Blockers and decisions needed before Phase 2

1. **Hosting targets** for staging: Render (+ Vercel front door) as documented, or a Docker host. *Not decided.*
2. **Accounts and access**: Render / Vercel / (Aiven) accounts or an operator to create the services; I have no credentials and will not use any I was not given.
3. **Cost approval**: a persistent disk needs a paid Render plan; provider keys cost money per request; any Aiven service is paid. Amounts were not verified here.
4. **Staging AI provider key(s)**: separate from production, with a spending cap and alerts. Which providers?
5. **Mail**: use a real staging mailbox and provider, or leave `MAIL_PROVIDER` unset and use the operator CLI for recovery.
6. **Aiven / Supabase**: include the encrypted Aiven mirror in staging? (recommendation: leave Supabase off; Aiven only if you want to test it.)
7. **Domain and DNS**: platform-provided hostnames are enough for staging; a custom domain needs your approval.
8. **Test accounts and data policy**: synthetic data only; no real user data.
9. **Deploy source**: `release-hardening` at a named commit (currently `9607514`); confirm whether the documentation changes from this phase should be committed first.
10. **Fixes to approve**: P1-01 (fail-fast config check), P1-03 (snapshot before migrating), P1-09 (backup schedule and monitoring).

## 11. Phase 1 exit criteria

| Criterion | Result |
|---|---|
| Architecture is documented | **PASS** (section 2 and ARCHITECTURE.md) |
| Infrastructure requirements are identified | **PASS** (STAGING-ENVIRONMENT-INVENTORY.md) |
| Environment variables are inventoried | **PASS** (inventory + audit; four gaps fixed) |
| Database requirements are understood | **PASS** (section 5; real-platform behaviour NOT TESTED) |
| Security readiness is reviewed | **PASS** for the review; real-platform verification NOT TESTED |
| Deployment sequence is documented | **PASS** (STAGING-DEPLOYMENT-PLAN.md) |
| Rollback procedure is documented | **PASS** as a document; **NOT TESTED** on any platform |
| Staging checklist is prepared | **PASS** (STAGING-VERIFICATION-CHECKLIST.md, every item NOT TESTED) |
| Blockers and risks explicitly listed | **PASS** (sections 8 and 10) |

Phase decision: see the completion report in the conversation.
