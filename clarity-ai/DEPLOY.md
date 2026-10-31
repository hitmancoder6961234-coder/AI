# Deploying Darkness AI

Three supported paths. All use the same code and the same environment variables ([.env.example](.env.example)).

```
Browser --> Vercel (static UI + /api proxy) --> Render (API, disk) --> Aiven PostgreSQL (encrypted mirror)
Browser --> your own server: Caddy (TLS) --> Docker (API + UI)
```

> **Secrets never go in git.** Provider keys, `PRIVACY_ENCRYPTION_KEY`, `AIVEN_PG_URI` and passwords are entered in
> the host's dashboard or in a `.env` on the server. If a password was ever shared in a chat, e-mail or ticket,
> change it.

## 0. Generate your secrets (Windows PowerShell)

```powershell
cd clarity-ai
.\scripts\new-secrets.ps1          # writes .secrets\secrets.env (git-ignored): PRIVACY_ENCRYPTION_KEY
```

Back the value up in a password manager - without it, mirrored data cannot be decrypted.

## 1. Render (API)

1. Dashboard -> **New -> Blueprint** -> select this repo -> **Blueprint file path:** `clarity-ai/render.yaml`.
2. Fill the `sync: false` variables: at least one provider key (e.g. `GEMINI_API_KEY`) and `PRIVACY_ENCRYPTION_KEY`.
3. Deploy. Check `https://<service>.onrender.com/api/health`.

**Free tier:** Render's free web services have no persistent disk, so SQLite resets on every deploy/restart. Either use
the `starter` plan in the blueprint (5 GB disk), or stay on free and rely on the Aiven mirror + Supabase as the durable
copy. Free services also sleep when idle (first request is slow).

## 2. Vercel (UI + same-origin proxy)

1. **Add New -> Project** -> import the repo -> **Root Directory:** `clarity-ai`. Vercel reads `vercel.json`.
2. Environment variable: `BACKEND_URL = https://<service>.onrender.com`.
3. Deploy. The browser only ever talks to your Vercel domain; `api/proxy.js` forwards `/api/*` to Render (streaming
   preserved), so cookies are first-party.
4. On Render set `TRUST_PROXY_HOPS=2` (already the blueprint default) so rate limits see the real client IP.

## 3. Aiven (PostgreSQL mirror)

Optional, but gives you a managed, backed-up copy of conversations that survives Render redeploys.

**Console route:** create a PostgreSQL service -> *Overview* -> copy **Service URI** and download the **CA certificate**.

**Terraform route:**

```powershell
cd deploy\aiven
$env:TF_VAR_aiven_api_token = "<token>"        # Aiven console -> User information -> Tokens
terraform init
terraform apply -var project=<your-project> -var 'allowed_cidrs=["<render-outbound-ip>/32"]'
terraform output -raw service_uri
```

Set on Render: `AIVEN_PG_URI` (the URI) and `AIVEN_CA_CERT` (the CA PEM text). On boot the log shows
`[Aiven] PostgreSQL mirror ready (TLS verified, content encrypted)`; `GET /api/aiven/status` (signed in) reports state.
Without `PRIVACY_ENCRYPTION_KEY` the mirror refuses to start rather than store plaintext.

## 4. Your own server (Docker)

### 4a. Create an SSH key and install it (PowerShell)

```powershell
.\scripts\setup-ssh-key.ps1 -HostName <server-ip-or-name> -User <your-user> -AddToSshConfig
```

* Generates an Ed25519 key in `~\.ssh`, then connects **once** with your password to install the public key.
  The password is typed at ssh's own prompt - the script never stores it and never puts it on a command line.
* It rejects malformed addresses (e.g. an octet above 255) before connecting.
* Afterwards it proves key-only login works. Then, from a *second* terminal, set `PasswordAuthentication no` in
  `/etc/ssh/sshd_config` on the server and `sudo systemctl reload ssh`.

### 4b. Prepare the server once

```bash
mkdir -p ~/darkness-ai && cd ~/darkness-ai
nano .env            # paste values based on clarity-ai/.env.example ; keep PRIVACY_STRICT=true
chmod 600 .env
```

### 4c. Deploy (and re-deploy)

```powershell
.\scripts\deploy-server.ps1 -HostName <server-ip-or-name> -User <your-user>
```

Pulls the latest `main`, links `.env`, runs `docker compose up -d --build`. The app binds to `127.0.0.1:3000`; put TLS in
front with `deploy/server/Caddyfile.example` (or your existing Traefik/nginx - disable response buffering for SSE).

## After deploying

- Sign up (8+ char password). There is no demo account.
- Open `/agent.html` and run: *"What is (1273*48)/7 and what day is it in Asia/Kolkata?"*
- Switch atmospheres with the orb in the corner.
- Browser console clean on your domain? Set `PRIVACY_CSP=enforce`.

## Verified vs. unverified in this repository

Verified by automated tests on the real server: strict-mode isolation, anonymous lockout, export/erase, rate limiting,
code-execution gate, log redaction, the agent loop over SSE, SSRF guard, vault encryption, and the three atmospheres
rendering in Edge (no console errors).

**Not executed here** (no Docker, Terraform, Vercel or Aiven account in the build environment): the `Dockerfile`,
`docker-compose.yml`, `render.yaml`, `vercel.json`/`api/proxy.js`, the Terraform in `deploy/aiven`, the Aiven mirror
against a live database, and real calls to AI providers. They follow each platform's documented schema - run
`docker compose config`, `terraform validate` and a first deploy before relying on them.
