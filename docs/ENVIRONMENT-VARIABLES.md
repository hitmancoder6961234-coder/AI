# Environment-variable inventory

Every variable the code reads, 5 November 2026. Generated from the source (`process.env` and the variable lists in `scripts/preflight.mjs`, `server/mailer.ts`, `server/provider-http.ts`, `server/security/*`) and checked against [.env.example](../.env.example). **No value appears in this file.** Where to set them: [DEPLOY.md](../DEPLOY.md). How they are checked: `node scripts/preflight.mjs` (names only, never values). Verification steps: [OPERATIONS-VERIFICATION.md](OPERATIONS-VERIFICATION.md) section 6.

Columns: **Req** = R required in production, O optional, D development / test only. **Svc** = where it is read: **API** (the Node server on Render / Docker / your host), **Vercel** (the static front door), **Build** (Vite build), **Tools** (scripts). **Secret** = Y means the value is a credential: store it only in the host's secret store or a `chmod 600` `.env` that is never committed.

## Runtime and storage

| Variable | Purpose | Req | Svc | Secret | How to set |
|---|---|---|---|---|---|
| `NODE_ENV` | `production` turns on production defaults (secure cookies, enforced CSP, preflight warnings) | R | API | N | `production` on every deployed host |
| `PORT` | HTTP port | host-set | API | N | Render sets it; Docker maps it. Must be a number |
| `DARKNESS_STORAGE_ROOT` | folder for the database, uploads, projects, RAG data and backups | R | API, Tools | N | a persistent disk or volume (Render `/var/data`, Docker `/data`); never temp storage |
| `DARKNESS_DB_PATH` | exact SQLite file (overrides `<root>/database/darkness.db`) | O | API, Tools | N | only if the database must live elsewhere; backups honour it. Unset it when restoring a backup into a scratch root |
| `DARKNESS_PROJECTS_DIR` | where generated projects live | O | API | N | a persistent volume |
| `DARKNESS_UPLOAD_TMP` | temp folder for streamed uploads | O | API | N | a larger or faster disk if you accept big uploads |
| `DARKNESS_UPLOAD_IDLE_MS` | abort an upload that sends nothing for this long | O | API | N | default is fine |
| `HOST_PORT` | host port Docker publishes (compose only) | O | Docker | N | default 3000 |
| `READINESS_MIN_FREE_MB` | `/api/ready` fails below this much free disk | O | API | N | default 100 |
| `SHUTDOWN_GRACE_MS` | time in-flight requests get after SIGTERM | O | API | N | default 10000; keep below the platform's stop timeout |
| `LOG_FORMAT`, `LOG_LEVEL`, `LOG_ACCESS` | log format (`json`/`pretty`), level, access-log on/off | O | API | N | defaults are right for production |
| `K_SERVICE` | read only to detect a container/cloud host (run-engine safety check); set by the platform | O | API | N | do not set by hand |
| `APPDATA`, `XDG_DATA_HOME` | operating-system variables used to find a default data folder | - | API | N | set by the OS |

## Privacy, security and limits

| Variable | Purpose | Req | Svc | Secret | How to set |
|---|---|---|---|---|---|
| `PRIVACY_STRICT` | every route needs a session, no shared demo account | R | API | N | `true` (`false` is for local hacking only) |
| `PRIVACY_CSP` | `enforce` / `report-only` / `off` | R | API | N | `enforce` |
| `PRIVACY_LOG_REDACTION` | redact e-mails, tokens, keys and IPs in logs | R | API | N | leave `true` |
| `PRIVACY_ENCRYPTION_KEY` | AES-256-GCM key for users' provider keys at rest and the Aiven mirror: exactly 32 random bytes, base64 | recommended; R with Aiven | API | **Y** | `scripts/new-secrets.ps1` or `openssl rand -base64 32`; back it up **separately** from the database |
| `PRIVACY_ENCRYPTION_KEY_PREVIOUS` | the old key, only while rotating | O | API | **Y** | remove after `SECRETS_MIGRATE=rotate` finished |
| `SECRETS_MIGRATE` | one-time boot conversion: `encrypt` or `rotate` | O | API | N | set for one boot, then unset |
| `TRUST_PROXY_HOPS` | proxies between the app and the real client (rate limits depend on it) | R | API | N | 2 behind Vercel -> Render, 1 behind one proxy; verify with the checks in OPERATIONS-VERIFICATION 2.2 |
| `CORS_ORIGINS` | browser origins allowed cross-origin | O | API | N | exact `https://` origins; empty = same-origin only |
| `COOKIE_SAMESITE` | `none` only for a split-origin setup without the Vercel proxy | O | API | N | normally unset |
| `ENABLE_RUN_ENGINE` | lets users run commands on the server | O | API | N | leave `false`; `true` only on a private single-user instance |
| `RATE_LIMIT_API_PER_MIN`, `RATE_LIMIT_AI_PER_MIN`, `RATE_LIMIT_AUTH_PER_15MIN` | per-address request limits (per process) | O | API | N | defaults are safe; raising them weakens abuse protection |
| `JSON_LIMIT_DEFAULT_MB`, `JSON_LIMIT_AI_MB`, `JSON_LIMIT_FILES_MB` | largest JSON / form request body per kind of route: structured data (default 1 MB), requests that go to a model (25 MB), file and export content sent as JSON (100 MB). An oversized body gets `413 PAYLOAD_TOO_LARGE` naming that route's limit, before it is read. Unusable values (not a number, zero, negative, above 1,024) keep the default | O | API | N | change only if a real workflow needs it; raising them raises the memory one request can use |
| `LOGIN_MAX_FAILS`, `LOGIN_LOCK_SECONDS` | wrong passwords before sign-in pauses, and the first pause | O | API | N | defaults are safe |
| `CSP_CONNECT_EXTRA`, `CSP_IMG_EXTRA` | extra https/wss origins the browser may call / load images from | O | API | N | only if you add such hosts |
| `CSP_IMG_ALLOW_ALL`, `CSP_UPGRADE_INSECURE` | weaker / stricter CSP switches | O | API | N | `CSP_UPGRADE_INSECURE=true` only when served over HTTPS; keep `CSP_IMG_ALLOW_ALL` false |
| `CSP_CLASSIC_ALLOW_EVAL`, `CSP_CLASSIC_STYLE_INLINE` | the Classic app's exceptions | O | API | N | keep `false` unless SECURITY.md says why |
| `AIVEN_ALLOW_PLAINTEXT` | allow the Aiven mirror without the encryption key | O | API | N | keep `false` |
| `DARKNESS_ALLOW_NEWER_SCHEMA` | `true` lets the server start on a database stamped (`PRAGMA user_version`) by a NEWER build than this one; by default it refuses | O | API | N | leave unset; set only deliberately while rolling back, after reading OPERATIONS-VERIFICATION section 7 |

## AI providers (set at least one)

| Variable | Purpose | Req | Svc | Secret | How to set |
|---|---|---|---|---|---|
| `GEMINI_API_KEY` | Google Gemini; also powers illustrations | one provider | API | **Y** | dashboard secret; a key with a spending cap |
| `GOOGLE_API_KEY`, `GOOGLE_GENAI_API_KEY`, `API_KEY` | accepted aliases for the Gemini key (`API_KEY` is a generic name, so do not set it for other tools on the same host) | O | API | **Y** | prefer `GEMINI_API_KEY` |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `TOGETHER_API_KEY`, `MISTRAL_API_KEY` | the other providers (server-level keys; users can also add their own models and keys in the app) | O | API | **Y** | dashboard secrets |
| `OPENAI_BASE_URL`, `AGENT_BASE_URL` | base URL for an OpenAI-compatible provider hosted elsewhere | O | API | N | `https://` gateway URL |
| `AGENT_PROVIDER`, `AGENT_MODEL` | provider / model the agent uses (default: the first provider with a key) | O | API | N | optional |
| `COPILOT_MODEL`, `COPILOT_LOCK_TOPIC` | Copilot model, and an optional topic that locks every Copilot chat | O | API | N | optional |
| `DEFAULT_GEMINI_MODEL` | model used when a request names none | O | API | N | optional |
| `IMAGE_ALLOW_THIRD_PARTY` | also allow a free third-party image generator (prompts leave your server) | O | API | N | keep `false` unless you accept that |
| `PROVIDER_TIMEOUT_MS`, `PROVIDER_HEADERS_TIMEOUT_MS`, `PROVIDER_STREAM_IDLE_MS`, `PROVIDER_MAX_ATTEMPTS`, `PROVIDER_RETRY_BASE_MS`, `PROVIDER_RETRY_MAX_MS`, `PROVIDER_RETRY_BUDGET_MS` | timeouts and retry policy for every provider call | O | API | N | defaults (120 s, 60 s, 60 s, 3 attempts, 0.5-8 s backoff, 30 s budget) are right for most setups |

## Account recovery by e-mail (optional)

| Variable | Purpose | Req | Svc | Secret | How to set |
|---|---|---|---|---|---|
| `MAIL_PROVIDER` | `smtp` or `resend`; unset = e-mail recovery reports itself unavailable (501) and operators use `scripts/admin.mjs` | O | API | N | only after the real-mailbox test in OPERATIONS-VERIFICATION 3.2 |
| `MAIL_FROM` | sender, e.g. `Darkness AI <no-reply@your-domain>` | with `MAIL_PROVIDER` | API | N | a domain with SPF, DKIM and DMARC |
| `PUBLIC_APP_URL` | where the reset link points | with `MAIL_PROVIDER` | API | N | your public `https://` URL |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS`, `SMTP_USER`, `SMTP_PASS` | SMTP server; `SMTP_TLS` = `starttls` (default), `implicit`, or `none` (localhost only); user and password together or neither | with `smtp` | API | `SMTP_PASS` **Y** | provider's SMTP settings |
| `RESEND_API_KEY` | Resend API key | with `resend` | API | **Y** | Resend dashboard |

## Optional mirrors and integrations

| Variable | Purpose | Req | Svc | Secret | How to set |
|---|---|---|---|---|---|
| `AIVEN_PG_URI` | PostgreSQL mirror connection string (contains a password) | O | API | **Y** | Aiven console service URI; needs `PRIVACY_ENCRYPTION_KEY` |
| `AIVEN_CA_CERT` | Aiven project CA certificate (PEM text or a file path) | with Aiven | API | N (public cert) | Aiven console; without it the server's identity is not verified |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | original Darkness cloud sync | O | API | URL N, anon key low | only if used |
| `SUPABASE_SERVICE_ROLE_KEY` | bypasses Supabase row security | with Supabase writes | API | **Y** | server only; never in a browser or `VITE_*` variable |
| `BACKEND_URL` | the API's `https://` origin that `api/proxy.js` forwards to | R on Vercel | Vercel | N | no trailing path; checked by `preflight --frontdoor` |

## Build, tests and tooling (never needed in production)

| Variable | Purpose | Svc | Secret | Notes |
|---|---|---|---|---|
| `VITE_GEMINI_API_KEY`, `VITE_GOOGLE_API_KEY` | legacy names the server still accepts | API, **Build** | **Y** | **Do not set**: Vite inlines `VITE_*` into browser code; preflight warns. Use `GEMINI_API_KEY` |
| `PUPPETEER_SKIP_DOWNLOAD` | skip downloading a browser at install | Build | N | `true` on Render and in CI |
| `LOCKFILE` | lockfile path for `scripts/lockfile-platforms.mjs` | Tools | N | tests only |
| `SMOKE_LOG_LEVELS`, `SMOKE_LOG_SUMMARY` | print server log lines / a summary from the smoke run | Tools | N | development only |
| `MY_SECRET` | appears only inside a sample message in `project-analyzer.ts`; not read by the app | - | - | not a real variable |
| `AUTHZ_PORT` | port the authorization audit (`npm run authz`) starts its throw-away server on (default 3866) | Tools | N | tests only |
| `ROUTE_DUMP` | file the route-list hook (`scripts/route-dump-hook.mjs`) writes the registered routes to | Tools | N | used by the authorization audit only |
| `VITE_API_URL` | **browser-side** override of the API base URL, read as `window.env.VITE_API_URL` (or `window.__DARKNESS_API_BASE__`) in `web/js/services/api.js`; empty = same origin. Only relevant to a split-origin setup without the Vercel proxy (then also set `CORS_ORIGINS` and `COOKIE_SAMESITE=none`) | Build / browser | N | found by the Phase 1 audit (6 Nov 2026); not used by any documented deployment path |
| `ASSETS` | not an environment variable: `server/server.ts` has a Cloudflare-Workers-style `env.ASSETS` fallback object that is never used by the Node server | - | - | dead branch, ignore |

## Checks

- Preflight confirms presence, length and shape of the ones marked above without printing values: `node scripts/preflight.mjs` (and `--frontdoor` on Vercel).
- `.env`, `.env.local`, `.env.production`, `*.pem`, `*.key`, `data/`, `*.db` are ignored by Git (`.gitignore`); `.gitleaks.toml` and the CI secret scan guard the rest. No `.env` file exists in the working tree.
- If a secret was ever pasted into chat, e-mail, a ticket or a screenshot: rotate it (provider key, `SMTP_PASS`, database URI); for `PRIVACY_ENCRYPTION_KEY` follow the rotation steps in DEPLOY.md.
