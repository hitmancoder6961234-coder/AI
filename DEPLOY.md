# Deploying Darkness AI

Three supported paths, one codebase, one set of environment variables ([.env.example](.env.example)).

```
Browser --> Vercel (static UI + /api proxy) --> Render (API + UI, disk) --> Aiven PostgreSQL (encrypted mirror)
Browser --> your own server: Caddy (TLS) --> Docker (API + UI)
```

> **Secrets never go in git.** Provider keys, `PRIVACY_ENCRYPTION_KEY`, `AIVEN_PG_URI` and passwords are entered in the
> host's dashboard or in a `.env` on the server. If a password was ever shared in a chat, e-mail or ticket, change it.

## What changes if you already deployed the old Darkness backend

The repository root used to be the original backend (`server.js` + `package.json`, kept in `legacy/`). It is now the
unified server. The original app is unchanged and still served by GitHub Pages from the root `index.html`; the same
app is also available inside the unified deployment at `/classic/`.

- An existing Render service that runs `npm install` then `node server.js` will fail until its **build command** is
  `npm ci && npm run build` (the new `render.yaml` does this). Re-create it from the Blueprint, or edit the commands.
- Your original app's "AI Backend URL" can point at the new deployment: `https://<service>/classic-api` (users must be
  signed in to the new app first - the API now needs a session).

## 0. Generate secrets (Windows PowerShell)

```powershell
.\scripts\new-secrets.ps1          # writes .secrets\secrets.env (git-ignored): PRIVACY_ENCRYPTION_KEY
```

Back the value up in a password manager - without it, mirrored data cannot be decrypted.

## 1. Render (API + UI)

1. Dashboard -> **New -> Blueprint** -> select this repo (`render.yaml` at the root).
2. Fill the `sync: false` variables: at least one provider key (e.g. `GEMINI_API_KEY`) and `PRIVACY_ENCRYPTION_KEY`.
3. Deploy, then check `https://<service>.onrender.com/api/health`.

`GEMINI_API_KEY` is also what powers **illustrations** (the image service uses the server's key). Without it the Studio
still builds reports and decks and says clearly that images were skipped. `IMAGE_ALLOW_THIRD_PARTY=true` enables a free
third-party generator (the prompt is then sent to that service).

**Free tier:** Render's free web services have no persistent disk, so SQLite resets on every deploy/restart. Use the
`starter` plan in the blueprint (5 GB disk), or stay on free and rely on the Aiven mirror + Supabase as the durable copy.

## 2. Vercel (UI + same-origin proxy)

1. **Add New -> Project** -> import the repo. Vercel reads `vercel.json` (build `npm run build:web`, output `dist`).
2. Environment variable: `BACKEND_URL = https://<service>.onrender.com`.
3. Deploy. The browser only talks to your Vercel domain; `api/proxy.js` forwards `/api/*` and `/classic-api/*`-style
   calls to Render with streaming preserved, so cookies stay first-party. On Render keep `TRUST_PROXY_HOPS=2`.

## 3. Aiven (PostgreSQL mirror)

Optional: a managed, backed-up, **encrypted** copy of conversations that survives Render redeploys.

**Console route:** create a PostgreSQL service -> copy **Service URI** and download the **CA certificate**.

**Terraform route:**

```powershell
cd deploy\aiven
$env:TF_VAR_aiven_api_token = "<token>"
terraform init
terraform apply -var project=<your-project> -var 'allowed_cidrs=["<render-outbound-ip>/32"]'
terraform output -raw service_uri
```

### Provider API keys at rest

API keys that users save for their models are stored in the `models` table. With `PRIVACY_ENCRYPTION_KEY` set (32 random bytes, base64) they are
sealed with AES-256-GCM, bound to the user and model, and decrypted only when a request to the provider is made; the key never appears in an API
response, a log line or the browser. Without it they are stored as plaintext (`preflight` warns in production). Counts, never values, are logged at boot
(`secrets_status`, `secrets_plaintext`, `secrets_unreadable`).

1. **Enable**: generate a key (`scripts/new-secrets.ps1` or `openssl rand -base64 32`), store it in the host's secret store **and in a second safe place** (without it sealed keys cannot be read), set `PRIVACY_ENCRYPTION_KEY`, restart. New keys are sealed immediately; existing ones are read as before.
2. **Convert existing keys** (once): take a backup (`node scripts/backup.mjs create --out <dir>`), set `SECRETS_MIGRATE=encrypt` and restart. The boot log shows `secrets_migrated` with counts; a snapshot `backups/pre-secrets-encrypt-<time>.db` is written first, every value is checked to read back, and all rows change in one transaction. Then **unset `SECRETS_MIGRATE`**, and move the snapshot off the server or delete it (it is the one place a plaintext copy remains).
3. **Rotate**: set the new key as `PRIVACY_ENCRYPTION_KEY` and the old one as `PRIVACY_ENCRYPTION_KEY_PREVIOUS`, set `SECRETS_MIGRATE=rotate`, restart, check `secrets_migrated`/`secrets_unreadable` is 0, then remove the old key and the migrate flag.
4. **If the key is lost or wrong**: sealed keys read as "no key" (the model shows no key; nothing is returned or written back as ciphertext) and the boot log says `secrets_unreadable`. Users re-enter their keys; restoring the right key restores everything.
5. Deleting a model blanks its key first, and `secure_delete` zeroes freed pages. **Backups** taken before step 2 still hold plaintext keys: treat them as secrets and rotate any key that was ever in one you cannot account for.

Set `AIVEN_PG_URI` and `AIVEN_CA_CERT` on Render. The boot log shows `[Aiven] PostgreSQL mirror ready`. Without
`PRIVACY_ENCRYPTION_KEY` the mirror refuses to start rather than store plaintext.

### Account recovery (forgotten passwords) and operator access

There is **no administrator role** in the web app: nothing in the product needs one, and an in-app admin account would be a privilege-escalation target.
The trust boundary for account actions is access to the server itself (a shell that can read the database file), the same boundary that already protects
the database and the environment variables.

* **By e-mail (optional)**: set `MAIL_PROVIDER` (`smtp` or `resend`), `MAIL_FROM`, `PUBLIC_APP_URL` (https in production; **the address your users open**, i.e. your Vercel domain when you use the front door, not the Render address) and the provider's credentials (see `.env.example`).
  "Forgot password?" on the sign-in screen then sends a single-use link (valid 30 minutes, 256-bit token, only its hash is stored, the token travels in the URL
  *fragment* so it never reaches a server log or a Referer). Using it sets the new password, **signs the account out everywhere**, clears the lockout and mails a
  "your password was changed" notice. The reply is identical for known and unknown addresses; limits: 3 requests per address and 20 per IP per hour.
  With nothing configured the page says so (HTTP 501 `RECOVERY_NOT_CONFIGURED`): it never pretends to send mail.
  **Mail delivery has been tested here only against local fake mail servers (SMTP with STARTTLS and implicit TLS, and a fake HTTPS API), never against a real provider.**
  Test it with a real mailbox before relying on it: [docs/OPERATIONS-VERIFICATION.md](docs/OPERATIONS-VERIFICATION.md).
* **By the operator** (works without mail; run on the host or in the container, e.g. `docker compose exec app node scripts/admin.mjs ...`; it reads `DARKNESS_DB_PATH` / the storage root):
  `node scripts/admin.mjs users` (masked list, no hashes), `reset-link <email> [--url <base>]` (a one-time link, valid 30 minutes; **as sensitive as a password**, give it only over a channel you trust),
  `revoke-sessions <email>`, `disable <email>` / `enable <email>` (a disabled account cannot sign in and its sessions end at once).
  Every action is only possible for someone who can already read the database; none of it is exposed over HTTP.

## 4. Your own server (Docker)

### 4a. SSH key (PowerShell)

```powershell
.\scripts\setup-ssh-key.ps1 -HostName <server-ip-or-name> -User <your-user> -AddToSshConfig
```

Creates an Ed25519 key, then connects **once** with your password to install the public key - typed at ssh's own
prompt, never stored and never put on a command line. It rejects malformed addresses (an octet above 255) first, then
proves key-only login works. Afterwards set `PasswordAuthentication no` on the server from a *second* terminal.

### 4b. Prepare the server once

```bash
mkdir -p ~/darkness-ai && cd ~/darkness-ai
nano .env            # based on .env.example ; keep PRIVACY_STRICT=true
chmod 600 .env
```

### 4c. Deploy and re-deploy

```powershell
.\scripts\deploy-server.ps1 -HostName <server-ip-or-name> -User <your-user>
```

Pulls `main`, links `.env`, runs `docker compose up -d --build`. The app binds to `127.0.0.1:3000`; add TLS with
`deploy/server/Caddyfile.example` (or Traefik/nginx with response buffering off for streaming).

## Content-Security-Policy

The policy is **enforced** (`PRIVACY_CSP=enforce`, the default and what `render.yaml` sets). Two places send it, and they must match:

* The API server (`server/security/csp.ts`) sends it with every response it serves: the whole UI on Render, Docker and local runs.
* `vercel.json` sends the same header for the static files Vercel serves itself (`/` and `/classic/` get different policies, so there
  are two header rules). Do not edit those values by hand: change `server/security/csp.ts`, then run
  `node --import tsx scripts/sync-vercel-csp.mjs`. `npm test` fails if they differ.

Optional environment variables (all validated; junk is ignored): `CSP_CONNECT_EXTRA` (API hosts the browser may call),
`CSP_IMG_EXTRA` (more image hosts), `CSP_IMG_ALLOW_ALL=true` (any https image; weakens the policy), `CSP_UPGRADE_INSECURE=true`
(only behind HTTPS), `CSP_CLASSIC_STYLE_HASHES`, `CSP_CLASSIC_STYLE_INLINE`, `CSP_CLASSIC_ALLOW_EVAL` (Classic page only; see
SECURITY.md). A `PRIVACY_CSP` value set in the Render dashboard overrides `render.yaml`.

Violation reports go to `POST /api/csp-report`, which the Vercel rewrite proxies to Render and which needs no sign-in. After
deploying, check:

```
curl -sI https://YOUR-SITE/ | grep -i content-security-policy        # present, and not "-Report-Only"
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://YOUR-SITE/api/csp-report \
     -H "content-type: application/csp-report" -d "{}"               # 204
```

then open the app, sign in, send a message, open a project and a Mermaid diagram, and search the Render logs for
`csp_violation`. Roll back a bad policy change without a redeploy by setting `PRIVACY_CSP=report-only` on Render (the Vercel
static header needs a redeploy of `vercel.json`).

The Classic app is now published as three files next to its page (`/classic/app.css`, `app.js`, `boot.js`) by
`scripts/postbuild.mjs` (Vercel) and `server/classic/serve.ts` (API server), from the same function (`server/classic/transform.mjs`).

## Go-live: limits, checks and checklist

### Limits of the hosted front door (Vercel) that shape the app

| Limit | Effect here | What was done |
|---|---|---|
| A request body sent through a Vercel function is capped at about **4.5 MB** (`FUNCTION_PAYLOAD_TOO_LARGE`); streaming and paid plans do not lift it ([docs](https://vercel.com/docs/functions/limitations), [error](https://vercel.com/docs/errors/function_payload_too_large)) | Uploads through the Vercel domain over ~4 MB are refused before they reach Render | Project ZIPs are now sent in **3 MB parts** (and in one request only up to 3.5 MB); the UI turns Vercel's bare 413 page into a clear message. Other uploads (Library files, several files at once, knowledge documents) are single requests: through Vercel keep them under ~4 MB, or open the app on the Render address for large files |
| The response must **start within 25 s** and may then stream for up to **300 s** (edge runtime; [docs](https://vercel.com/docs/functions/limitations)) | A model that takes longer than 25 s to produce a first token would turn into a 504 even though Render is healthy | The main chat streams (`/api/conversations/:cid/chat` and `/regenerate`) now send their headers and an SSE comment **immediately**; Copilot and Agent already did. Measured with a silent provider: first header after ~15 ms. Still to do: Studio chat, document streaming, knowledge Q&A and project generation send headers with the first token |
| Vercel marks the **Edge** runtime that `api/proxy.js` uses as deprecated in favour of Node.js functions | A future platform change may require moving the proxy | Not changed (cannot be tested without a Vercel account). The proxy is ~70 lines and is tested against the real server (smoke: `front door` checks) so the move can be verified the same way |

### Development versus production

| | Development (`npm run dev`, no `NODE_ENV`) | Production (`NODE_ENV=production`) |
|---|---|---|
| UI | Vite middleware with hot reload | the built `dist/` served statically |
| Content-Security-Policy | **report-only** (Vite's inline refresh script and HMR websocket would be blocked) | **enforced** (`PRIVACY_CSP` overrides either) |
| Logs | pretty, readable | one JSON object per line, with request ids and redaction |
| `Strict-Transport-Security` | not sent | sent |
| Trusted proxy hops | 0 | `TRUST_PROXY_HOPS` (default 1; 2 behind Vercel -> Render) |
| Cookies | `Secure` only when the request is HTTPS | `Secure`, `HttpOnly`, `SameSite=Lax`, host-only |
| CORS / CSRF allow-list | localhost origins allowed | only `CORS_ORIGINS` (empty = same origin) |
| Storage | `./data` | `DARKNESS_STORAGE_ROOT` (a mounted disk) |

### Operator tools (shipped in the Docker image too)

* `npm run preflight` (or `node scripts/preflight.mjs`) checks the environment it runs in: production mode, strict privacy, enforced
  CSP, run engine off, log redaction on, a persistent writable storage root with free space, proxy hops, CORS, encryption key length,
  Aiven settings, provider keys. It prints ok / WARN / FAIL per check and **never a value**; exit code 1 on FAIL (`--strict`: on WARN
  too). On Vercel run `node scripts/preflight.mjs --frontdoor` (checks `BACKEND_URL`). Run it in the Render shell after changing env vars.
* `node scripts/backup.mjs create --out <dir>` writes a consistent snapshot of the database (safe while the server runs) plus the
  project, artifact, RAG and upload folders, with a manifest and checksums. `verify <dir>` checks it; `restore <dir> --yes` puts it
  back (stop the server first; the data being replaced is moved aside, never deleted). **A backup contains accounts, password hashes
  and chats:** keep copies off the server's disk, encrypted, and test a restore. On Render: shell -> `npm run backup -- --out /var/data/backups`,
  then download it; Render's own disk snapshots are an additional safety net, not a replacement.

* `node scripts/admin.mjs ...` account operations (masked user list, one-time reset link, revoke sessions, disable / enable): see "Account recovery" above.

### Upgrading an existing database

A fresh database needs nothing. A database created by an **older version** (tables without `user_id`) is rebuilt on the first start: take a verified backup first (`scripts/backup.mjs`), then start; the build writes `<storage root>/backups/pre-migrate-<time>.db`, rebuilds in one transaction and stamps `PRAGMA user_version = 1`. It refuses to start (and leaves the database unchanged) on a shape it does not recognise or when anything fails: see [docs/OPERATIONS-VERIFICATION.md](docs/OPERATIONS-VERIFICATION.md) section 7 and SECURITY.md #63, #64.

### Go-live checklist

1. `node scripts/preflight.mjs` on the API host: no FAIL, and you understand every WARN. If you configured mail, send yourself a real reset link and use it once (the preflight checks the settings, not delivery).
2. Render env: provider key(s), `PRIVACY_ENCRYPTION_KEY` (if you mirror to Aiven), `TRUST_PROXY_HOPS=2`, `CORS_ORIGINS` empty (same-origin through Vercel) unless the UI is served from another domain; `DARKNESS_STORAGE_ROOT=/var/data` on the mounted disk.
3. Vercel env: `BACKEND_URL=https://<service>.onrender.com` (preflight `--frontdoor`). Redeploy `vercel.json` if `server/security/csp.ts` changed (`node --import tsx scripts/sync-vercel-csp.mjs`).
4. After deploy: `/api/ready` is 200; `curl -sI https://<site>/` shows `content-security-policy` (not report-only) and HSTS; sign up, reload, sign out; the session cookie in the browser's dev tools is `HttpOnly; Secure; SameSite=Lax` with no Domain.
5. Send a chat message and a project ZIP of ~10 MB through the Vercel domain; open a Mermaid diagram and an architecture graph; watch the Render logs for `"level":"error"` and `csp_violation`.
6. Take a backup, `verify` it, and copy it off the server. Put a reminder to repeat it (daily is sensible) and to test a restore.
7. Know the rollback: Render -> previous deploy; Vercel -> promote the previous deployment; data is on the disk and is not touched by either. Details, the Docker procedure and the encryption hazard: [docs/OPERATIONS-VERIFICATION.md](docs/OPERATIONS-VERIFICATION.md) section 7.
8. Run the full verification checklist there (production environment, real provider and mail tests, a restore on a scratch copy, one-instance rule). It lists exactly what has and has not been verified.

## Health, readiness and logs

| Endpoint | Meaning | Status codes |
|---|---|---|
| `GET /api/health` (alias `/api/healthz`) | **Liveness**: the process is up. Cheap, touches no dependency, never reveals configuration. | always 200 while the process runs |
| `GET /api/ready` (alias `/api/readyz`) | **Readiness**: should this instance get traffic? Checks the SQLite database, the storage folder (writable, free space above `READINESS_MIN_FREE_MB`) and the upload temp folder; Supabase and the Aiven mirror only if configured, and only as *optional* checks. | 200 `ready`, 200 `degraded` (an optional service is down), 503 `not_ready` (a required check failed), 503 `draining` (shutting down; sends `Retry-After`) |

`render.yaml` uses `/api/ready`. The Docker `HEALTHCHECK` keeps using `/api/health` (a container is restarted for being *dead*,
not for being briefly unready). Failure details are written to the log, not returned: the response names the failing check
and a coarse reason (`timeout` / `unavailable`).

**Request ids.** Every response carries `X-Request-Id` (a well-formed incoming one, e.g. from a proxy, is kept; anything else
is replaced), every JSON error body carries `requestId`, and every log line written while serving the request carries it too.
When a user reports a problem, ask for the id on the error or the `X-Request-Id` response header and search the logs for it.
The Vercel proxy forwards the header in both directions without changes.

**Logs.** In production each line is JSON: `{"ts","level","event","requestId",...}`. Access-log entries (`http_request`) contain
method, path (never the query string), status, duration and size, never bodies, headers or cookies. Fields named like
`prompt`, `content`, `message`, `body`, `query`, `token`, `password`, `authorization`, `email`... are replaced with
`[redacted]` by name, and API keys, bearer tokens, session ids, JWTs, e-mail addresses and IPs inside any string are scrubbed
by value. Existing `console.*` lines go through the same scrubbing and are prefixed with the request id.

**Provider stability.** Every AI call has a timeout and an idle timeout, transient failures are retried (bounded, with
backoff and `Retry-After`), client errors are never retried, a user closing the tab cancels the upstream request, and a stalled
provider is cut off instead of holding the request open. The knobs are the `PROVIDER_*` variables in `.env.example`.

**Shutdown.** On SIGTERM (a Render deploy) `/api/ready` switches to `draining`, running project processes are stopped, and
in-flight requests get `SHUTDOWN_GRACE_MS` to finish. Render's default 30 s stop timeout is longer than the 10 s default.

## Verified vs. not verified

Verified by automated tests on the real server (363 unit tests and 97 end-to-end checks on the final tree, locally and on GitHub's runners; the local clean-room runs on Node 22 and 24 were 349 / 94 before the last round of fixes and have not been repeated, but the GitHub run starts from a fresh `npm ci` on both) and in Chrome and Edge: strict-mode
isolation, ownership checks, export/erase, rate limits, the code-execution gate, log redaction, the agent over SSE,
the SSRF guard, vault encryption, every document type round-tripping (DOCX, PDF, PPTX, XLSX, ODT, RTF, HTML, MD, TXT,
CSV, JSON in; most of them back out), your original API at `/classic-api`, the full Project Studio flow with a scripted
model and in offline mode, and the three atmospheres.

**Verified locally in this effort (Task 4)**, with the real `api/proxy.js` handler in front of the real production build: the session
cookie arrives with `HttpOnly; Secure; SameSite=Lax; Path=/` and no `Domain`; a page reload keeps the user signed in; a cookie-only
state-changing request from another origin is refused (403) and from the front door's origin accepted; chat streams arrive in several
chunks; logout expires the cookie and the old cookie stops working; expired and revoked sessions are rejected immediately (this was
**broken**, see SECURITY.md #45); only `/api/*` and `/classic-api/*` are forwarded and a non-https `BACKEND_URL` is refused; the backend
address does not leak in response headers; request ids and client IPs survive the hop. Server logs from a full smoke run contain
no e-mail addresses, tokens or keys, and the only `error`-level lines are the two failure cases the tests trigger on purpose.

**Verified on GitHub (6 Nov 2026):** the CI workflow ran on pull request #1 (run 42118240655) and passed on Linux Node 22 and 24, Windows and macOS, with the dependency audit and secret scan; the same commands pass locally. This proves the build, tests and smoke run on clean hosted machines, not that any deployment works.

**Not verified (no live access, no Docker, no Vercel/Render/Aiven account here)**: that Vercel actually runs `api/proxy.js` and
`vercel.json` as assumed (headers, rewrites, the 4.5 MB / 25 s / 300 s limits are taken from Vercel's documentation, not measured);
Render's disk mount, health-check behaviour, deploy/rollback, cold starts and free-plan sleep; the `Dockerfile` / `docker-compose.yml` /
Terraform (never built or applied; the unit tests check their content and consistency); the Aiven and Supabase mirrors against real
services; DNS, TLS and domain cookies on a real domain (cookies were checked as the server issues them, not in a browser on that
domain); real AI providers; backup/restore on a real Render disk (tested on a local database with the same SQLite features);
anything that depends on traffic, cost or provider quotas. Treat the first deploy as the first real test and use the checklist above.
