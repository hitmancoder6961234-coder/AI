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

Set `AIVEN_PG_URI` and `AIVEN_CA_CERT` on Render. The boot log shows `[Aiven] PostgreSQL mirror ready`. Without
`PRIVACY_ENCRYPTION_KEY` the mirror refuses to start rather than store plaintext.

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

## Verified vs. not verified

Verified by automated tests on the real server (65 unit tests, 49 end-to-end checks) and in Edge: strict-mode
isolation, ownership checks, export/erase, rate limits, the code-execution gate, log redaction, the agent over SSE,
the SSRF guard, vault encryption, every document type round-tripping (DOCX, PDF, PPTX, XLSX, ODT, RTF, HTML, MD, TXT,
CSV, JSON in; most of them back out), your original API at `/classic-api`, the full Project Studio flow with a scripted
model and in offline mode, and the three atmospheres.

**Not executed here** (no Docker, Terraform, Vercel, Render or Aiven account in the build environment): the
`Dockerfile`, `docker-compose.yml`, `render.yaml`, `vercel.json` / `api/proxy.js`, the Terraform, the Aiven mirror
against a live database, and real calls to AI providers and the image model. They follow each platform's documented
schema - run `docker compose config`, `terraform validate` and a first deploy before relying on them.
