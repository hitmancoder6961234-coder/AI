# Staging environment inventory (Phase 1)

Prepared 6 November 2026. **Planning document: nothing listed here has been created, and no value, key or password appears in it.** Secrets are named only. Per-variable descriptions are in [ENVIRONMENT-VARIABLES.md](ENVIRONMENT-VARIABLES.md); this file adds what staging needs: the services, and the staging value and validation status of each variable.

**Rules for staging:** a separate service, disk, database, provider keys and encryption key from production; synthetic data only; the staging application must never be given a production credential or database URI.

## 1. Services

| Service | Purpose | Environment | Configuration | Credentials (names only) | Depends on | Risks | Verification |
|---|---|---|---|---|---|---|---|
| **Backend hosting**: Render web service (as in `render.yaml`) **or** one Docker host (`docker-compose.yml` + Caddy) | runs `dist/server.js`: API, built UI, `/classic/` | staging (separate from production) | Node 22; build `npm ci && npm run build`; start `npm start`; health `/api/ready`; disk mounted at `/var/data` (Render) or volume `/data` (Docker); **one instance**; deploy branch `release-hardening` | host dashboard login (not an app secret) | disk, provider(s), optional mirrors | single instance, brief outage on every deploy, free tier has no disk, `autoDeploy` would redeploy on every push to the branch | `npm run preflight` on the host; `/api/health` 200; `/api/ready` 200; restart keeps data |
| **Frontend hosting**: Vercel project (static UI + `api/proxy.js`) | serves `dist/` and forwards `/api/*` and `/classic-api/*` to the backend so cookies stay first-party | staging | build `npm run build:web`, output `dist`; **`BACKEND_URL`** = staging backend `https://` origin | `BACKEND_URL` (not secret) | backend | Edge runtime flagged deprecated; 4.5 MB request cap; 25 s to first byte; two places must carry identical CSP | `preflight --frontdoor`; header and cookie checks (checklist section 3) |
| **Primary database**: SQLite file on the backend disk | all accounts, sessions, conversations, projects, memory, prompts, agent sessions | staging (its own file) | `DARKNESS_STORAGE_ROOT`; WAL; created on first boot | none | persistent disk | lost with the disk; single writer; backups are manual | backup `create` + `verify`, restore on a scratch copy, restart persistence |
| **Persistent file storage**: same disk | uploads, projects, artifacts, RAG data, backups | staging | `DARKNESS_STORAGE_ROOT` (+ optional `DARKNESS_PROJECTS_DIR`, `DARKNESS_UPLOAD_TMP`) | none | disk size (Render blueprint: 5 GB) | disk full (readiness fails below `READINESS_MIN_FREE_MB`); no object storage exists | preflight disk check; upload and cleanup tests |
| **AI model provider(s)** (Gemini, OpenAI, Anthropic, OpenRouter, Groq, Together, Mistral; users can add their own) | answers, agent, compare, Prompt Studio, illustrations (Gemini) | staging keys only | at least one server key, or users add their own models | `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `TOGETHER_API_KEY`, `MISTRAL_API_KEY` (use only the ones you approve) | provider uptime, quota | cost, rate limits, prompt content leaves the server | per-provider test (Phase 3.3); revoked-key and timeout behaviour |
| **Encryption key** | seals users' saved provider keys and the Aiven mirror | staging (its own key) | 32 random bytes, base64 | `PRIVACY_ENCRYPTION_KEY` (+ `PRIVACY_ENCRYPTION_KEY_PREVIOUS` only while rotating) | none | losing it makes sealed keys unreadable; storing it beside the backups defeats it | preflight length check; `secrets_status` at boot; a stored key is sealed in the database |
| **Email delivery** (optional): SMTP or Resend | "Forgot password?" mail | staging mailbox / sender | `MAIL_PROVIDER`, `MAIL_FROM`, `PUBLIC_APP_URL` (**the address users open**), provider settings | `SMTP_USER`, `SMTP_PASS` or `RESEND_API_KEY` | DNS (SPF, DKIM, DMARC) | spam placement; leaks if misconfigured; **never tested with a real mailbox** | OPERATIONS-VERIFICATION 3.2; or leave unset and test the 501 + operator CLI path |
| **Aiven PostgreSQL** (optional) | encrypted conversation mirror | staging service only | `AIVEN_PG_URI`, `AIVEN_CA_CERT` (Terraform in `deploy/aiven/`) | `AIVEN_PG_URI` (contains a password) | encryption key; network allow-list | paid; mirror refuses to start without the encryption key; never point at production | boot log `[Aiven] PostgreSQL mirror ready`; row exists and text is encrypted |
| **Supabase** (optional, legacy) | original cloud sync | **not recommended for staging** | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | `SUPABASE_SERVICE_ROLE_KEY` bypasses row security | - | mirror shape mismatch is documented and unverified | leave unset |
| **Authentication and sessions** | sign-in, 30-day cookie sessions | staging | `sessions` table, in-memory cache; `PRIVACY_STRICT=true` | none (tokens are generated) | database | per-process lock-out and limiters; depends on `TRUST_PROXY_HOPS` | Phase 3.1 and the two-network rate-limit test |
| **Background processing** | agent loops, RAG indexing, upload sweeper (10 min), project analysis | in the API process | none | none | the single process | no queue or worker: a restart interrupts running work (agent sessions resumable) | restart-recovery test (Phase 4.6) |
| **Logging and monitoring** | JSON logs with request ids, `/api/health`, `/api/ready` | platform log view | `LOG_FORMAT`, `LOG_LEVEL`, `LOG_ACCESS` (defaults fine) | none | platform | **no metrics, alerting or error tracking exist** (P1-09); logs retained per platform plan | log-content check (no emails, tokens, keys, prompts) |
| **HTTPS and domain** | TLS | platform hostnames (`*.onrender.com`, `*.vercel.app`) | HSTS sent in production; `PUBLIC_APP_URL`, `CORS_ORIGINS` match the user-facing origin | none | platform | custom domain / DNS needs your approval | `curl -sI`, browser lock, cookie flags |
| **Scheduled jobs** | none exist except the in-process upload sweeper | - | backups: a platform cron or external schedule would be needed (not created) | - | - | no automatic backups (P1-09) | agree a routine before Phase 2 ends |
| **CI** | GitHub Actions (`darkness-ai-ci.yml`) | GitHub | runs on `main` pushes, pull requests, manual dispatch | none for the workflow itself | - | whether its jobs are required checks was not inspected | run `42118240655` passed |

## 2. Variable matrix for staging

Legend. **Req**: R required, rec recommended, O optional. **Sens**: Y credential. **Startup**: *Server* = parsed or defaulted at boot (junk ignored, no failure); *Preflight* = checked only by `npm run preflight`; *None* = nothing checks it. "Missing" says what breaks.

| Variable | Req | Sens | Default if unset | Staging value (guidance) | Differs from production | If missing / wrong | Startup |
|---|---|---|---|---|---|---|---|
| `NODE_ENV` | R | N | development behaviour | `production` | no | report-only CSP, pretty logs, no HSTS, 0 proxy hops | Preflight |
| `PORT` | host-set | N | 3000 | platform-set | no | server on the wrong port; health check fails | Server (number) |
| `DARKNESS_STORAGE_ROOT` | R | N | `./data` or per-OS folder | disk mount (`/var/data` or `/data`) | path only | data on ephemeral storage, lost on restart | Preflight (writable, free space, not temp) |
| `DARKNESS_DB_PATH`, `DARKNESS_PROJECTS_DIR`, `DARKNESS_UPLOAD_TMP`, `DARKNESS_UPLOAD_IDLE_MS` | O | N | under the root | leave unset | no | - | None |
| `PRIVACY_STRICT` | R | N | `true` | `true` | no | `false` disables auth gating (never in staging) | Preflight |
| `PRIVACY_CSP` | R | N | `enforce` in production | `enforce` | no | weaker CSP | Preflight |
| `PRIVACY_LOG_REDACTION` | R | N | on | `true` | no | secrets or addresses in logs | Preflight |
| `PRIVACY_ENCRYPTION_KEY` | rec (R with Aiven) | **Y** | none | a new staging-only key, backed up separately | **yes: never share with production** | provider keys stored in plaintext; Aiven mirror refuses to start | Server (length) + Preflight |
| `PRIVACY_ENCRYPTION_KEY_PREVIOUS`, `SECRETS_MIGRATE` | O | Y / N | none | only during a rotation test | no | - | Server |
| `TRUST_PROXY_HOPS` | R | N | 1 prod / 0 dev | **2** behind Vercel -> Render, 1 direct | no | rate limits wrong (P1-10) | Server (number) |
| `CORS_ORIGINS` | O | N | empty (same origin) | empty through the Vercel proxy | origin differs | cross-origin requests refused | Preflight |
| `COOKIE_SAMESITE` | O | N | lax | unset | no | `none` only for split-origin | None |
| `ENABLE_RUN_ENGINE` | O | N | false | `false` | no | `true` lets users run commands on the host | Preflight |
| `RATE_LIMIT_API_PER_MIN`, `RATE_LIMIT_AI_PER_MIN`, `RATE_LIMIT_AUTH_PER_15MIN`, `LOGIN_MAX_FAILS`, `LOGIN_LOCK_SECONDS` | O | N | 600 / 40 / 20 / 5 / 60 | defaults (raise only to run load tests, and record it) | no | weaker brute-force protection if raised | Server |
| `JSON_LIMIT_DEFAULT_MB`, `JSON_LIMIT_AI_MB`, `JSON_LIMIT_FILES_MB` | O | N | 1 / 25 / 100 | defaults | no | oversized bodies accepted / refused | Server (junk keeps default) |
| `CSP_*` (7 names) | O | N | strict | unset | no | CSP weakened | Server |
| `GEMINI_API_KEY` (aliases `GOOGLE_API_KEY`, `GOOGLE_GENAI_API_KEY`, `API_KEY`) and the other `*_API_KEY` | one provider needed | **Y** | none | **none on the server initially (finding P2-01)**; testers add their own keys. Later, staging keys with caps | **yes: separate keys** | server-key chat disabled; users can still add their own models; illustrations skipped without Gemini | Preflight (warns) |
| `OPENAI_BASE_URL`, `AGENT_BASE_URL`, `AGENT_PROVIDER`, `AGENT_MODEL`, `COPILOT_MODEL`, `COPILOT_LOCK_TOPIC`, `DEFAULT_GEMINI_MODEL` | O | N | first provider with a key | only as the test plan needs | no | wrong model or URL | None |
| `IMAGE_ALLOW_THIRD_PARTY` | O | N | false | `false` | no | prompts sent to a third-party generator | None |
| `PROVIDER_*` (7 names) | O | N | 120 s / 60 s / 60 s / 3 attempts ... | defaults | no | - | Server |
| `MAIL_PROVIDER`, `MAIL_FROM`, `PUBLIC_APP_URL` | O (all three together) | N | unset = 501 | only after a mailbox is chosen | **yes: staging sender and URL** | recovery mail unavailable; wrong link target | Preflight |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS`, `SMTP_USER`, `SMTP_PASS`, `RESEND_API_KEY` | O | `SMTP_PASS`, `RESEND_API_KEY` Y | none | provider settings | yes | mail fails (logged without the address) | Preflight |
| `AIVEN_PG_URI`, `AIVEN_CA_CERT`, `AIVEN_ALLOW_PLAINTEXT` | O | URI Y | unset = no mirror | only if approved; separate service | **yes: never the production database** | mirror off; without the CA certificate the server identity is not verified | Server + Preflight |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | O | key Y | unset | leave unset | yes | - | None |
| `BACKEND_URL` | R on Vercel | N | none | staging backend `https://` origin | yes | proxy answers 500 "not configured" | Server (proxy checks per request) + `preflight --frontdoor` |
| `LOG_FORMAT`, `LOG_LEVEL`, `LOG_ACCESS`, `READINESS_MIN_FREE_MB`, `SHUTDOWN_GRACE_MS` | O | N | production JSON, 100 MB, 10 s | defaults | no | - | Server |
| `HOST_PORT` | O | N | 3000 | Docker only | no | - | read by `docker-compose.yml` |
| `NODE_VERSION`, `PUPPETEER_SKIP_DOWNLOAD` | build | N | - | `22`, `true` on Render | no | wrong Node, or a browser download at install | platform |
| `VITE_*` (`VITE_GEMINI_API_KEY`, `VITE_GOOGLE_API_KEY`) | **never set** | would be Y | - | unset | - | Vite inlines them into browser code | Preflight warns |
| `VITE_API_URL` | O | N | same origin | unset | - | browser override of the API base (split-origin only) | None |
| `K_SERVICE`, `APPDATA`, `XDG_DATA_HOME` | platform | N | - | platform-set | - | - | - |
| `AUTHZ_PORT`, `ROUTE_DUMP`, `LOCKFILE`, `SMOKE_LOG_LEVELS`, `SMOKE_LOG_SUMMARY` | tools | N | - | only when running the audit / smoke | - | - | - |

## 3. Checks required before any staging deploy

- [ ] No variable above holds a production value; the encryption key and all provider keys are new.
- [ ] `PRIVACY_ENCRYPTION_KEY` is stored in the host's secret store **and** a second safe place that is not the backup location.
- [ ] No `VITE_*` variable exists on the build machine.
- [ ] `npm run preflight` on the staging host: no FAIL, every WARN understood (expected WARNs: no mail provider, if mail is not being tested).
