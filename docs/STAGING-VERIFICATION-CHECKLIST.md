# Staging verification checklist

Prepared 6 November 2026 for Phase 2 and Phase 3. **Every item is NOT TESTED.** Mark an item only when you or I have seen the result on the real staging environment, and write the date, the environment and the evidence next to it. Local and CI results never count here. This file orders and selects checks; the detailed commands and expected results are in [OPERATIONS-VERIFICATION.md](OPERATIONS-VERIFICATION.md) (section numbers below point there). `$BACKEND` is the staging API origin, `$APP` the origin users open (the Vercel staging domain when the front door is used).

Status values: PASS, FAIL, BLOCKED, NOT TESTED (default).

## 1. Before deployment (Phase 2.1)

| # | Check | Evidence to keep | Status |
|---|---|---|---|
| 1.1 | Branch `release-hardening`, commit recorded, working tree clean, `origin/main` still `46223be`, PR #1 open and unmerged | `git` output | NOT TESTED |
| 1.2 | CI green for that commit | run URL | NOT TESTED |
| 1.3 | `npm run verify`, smoke and authz green locally on that commit | counts | NOT TESTED |
| 1.4 | Staging secrets are new and different from production; the encryption key is backed up apart from the backups | masked names only | NOT TESTED |
| 1.5 | Staging database and disk are separate from production; the disk is empty before the first boot | `ls` of the mount | NOT TESTED |
| 1.6 | Rollback plan read and the previous good deploy / image identified ([STAGING-ROLLBACK-PLAN.md](STAGING-ROLLBACK-PLAN.md)) | - | NOT TESTED |
| 1.7 | No real user data will be used; test accounts are synthetic | - | NOT TESTED |

## 2. Backend (Phase 2.3)

| # | Check | Expected | Status |
|---|---|---|---|
| 2.1 | `node scripts/preflight.mjs` in the backend shell | no FAIL; WARNs explained | NOT TESTED |
| 2.2 | Node version | 22 or newer | NOT TESTED |
| 2.3 | `GET /api/health` | 200 | NOT TESTED |
| 2.4 | `GET /api/ready` | 200 `ready` (`degraded` only if an approved optional mirror is down) | NOT TESTED |
| 2.5 | Boot log | listening line, `secrets_status`, no error-level line, no secret or address | NOT TESTED |
| 2.6 | Headers on `$BACKEND/` | `content-security-policy` (not report-only), HSTS, `nosniff`, no `x-powered-by` | NOT TESTED |
| 2.7 | Anonymous `GET /api/models` | 401 | NOT TESTED |
| 2.8 | No shared demo account (`Authorization: Bearer default_token`) | 401 | NOT TESTED |
| 2.9 | Ordinary user calls `/api/storage/limit`, `/api/storage/clear-cache`, `/api/storage/status` | 403 `OPERATOR_ONLY` | NOT TESTED |
| 2.10 | Request limits behind the proxy: 2 MB JSON to `/api/memory` | 413 naming `maxMB: 1`; `/api/files/shared` not 413 | NOT TESTED |
| 2.11 | Persistence: create a note, restart the service, reload | note still there | NOT TESTED |
| 2.12 | Code execution off | `ENABLE_RUN_ENGINE` not `true`; run routes answer `RUN_ENGINE_DISABLED` | NOT TESTED |
| 2.13 | Graceful shutdown on redeploy | `/api/ready` becomes `draining`, then the new instance is ready | NOT TESTED |
| 2.14 | Operator tools in the deployed environment | `admin.mjs users` masked list; `backup.mjs create` succeeds | NOT TESTED |

## 3. Frontend and integration (Phase 2.4, 2.2 of OPERATIONS-VERIFICATION)

| # | Check | Expected | Status |
|---|---|---|---|
| 3.1 | `preflight --frontdoor` | `BACKEND_URL` https, PASS | NOT TESTED |
| 3.2 | `curl -sI $APP/` | CSP enforced, HSTS; **no backend host in any header** | NOT TESTED |
| 3.3 | TLS valid, HTTP redirects to HTTPS, no mixed content in the console | - | NOT TESTED |
| 3.4 | Cookie after sign-in | `darkness_session` `HttpOnly; Secure; SameSite=Lax`, no `Domain` | NOT TESTED |
| 3.5 | Sign-up, reload, sign-out, then the old cookie | works; old cookie -> 401 | NOT TESTED |
| 3.6 | Browser routing and refresh on a deep link (`#/history`, `#/project...`) | page renders, session kept | NOT TESTED |
| 3.7 | **Proxy hops**: more failed sign-ins than `RATE_LIMIT_AUTH_PER_15MIN` from one machine, a second network, and a forged `X-Forwarded-For` | 429 with `Retry-After` for the first; second network not limited; forged header does not reset the limit | NOT TESTED |
| 3.8 | CORS: cookie-authenticated POST from another origin | 403 unless the origin is in `CORS_ORIGINS` | NOT TESTED |
| 3.9 | Streaming through the proxy | answer arrives in chunks; first byte well under 25 s | NOT TESTED |
| 3.10 | ~10 MB project ZIP through `$APP` (3 MB parts); a ~6 MB single upload | ZIP works; the large single upload gives the clear "too large for the front door" message | NOT TESTED |
| 3.11 | `POST $APP/api/csp-report` | 204; no `csp_violation` from the app's own pages | NOT TESTED |
| 3.12 | Responsive layout and error states at phone, tablet and desktop widths | usable | NOT TESTED |

## 4. External services (Phase 2.5; only those approved)

| # | Check | Expected | Status |
|---|---|---|---|
| 4.1 | Provider connection test (one provider at a time, capped staging key) | success in seconds; the key field never shows the key | NOT TESTED |
| 4.2 | Short chat, streaming; stop mid-stream | tokens arrive progressively; upstream usage stops | NOT TESTED |
| 4.3 | Revoked key | clear error, no retry storm, no key in response or log | NOT TESTED |
| 4.4 | Timeout to an unreachable base URL | ends within `PROVIDER_TIMEOUT_MS` with a readable error | NOT TESTED |
| 4.5 | Key encryption at rest | the stored value is sealed; the model still answers | NOT TESTED |
| 4.6 | Mail (only if approved): delivery, SPF/DKIM/DMARC, link, single use, unknown address sends nothing, wrong credential logs without address | OPERATIONS-VERIFICATION 3.2 | NOT TESTED |
| 4.7 | Mail not configured: "Forgot password?" says it is unavailable (501) and `admin.mjs reset-link` works once | - | NOT TESTED |
| 4.8 | Aiven (only if approved): boot log `mirror ready`; a conversation row exists and the text is encrypted; certificate verified | - | NOT TESTED |

## 5. Backup, restore and rollback (Phase 2.2, Phase 4.5)

| # | Check | Expected | Status |
|---|---|---|---|
| 5.1 | `backup.mjs create`, then `verify` | verify passes | NOT TESTED |
| 5.2 | Copy the backup off the server | stored encrypted, off-box | NOT TESTED |
| 5.3 | Restore onto a **scratch** root (not the live disk) | server ready on restored data; **old sessions and reset tokens dead** | NOT TESTED |
| 5.4 | Rollback rehearsal of the code (previous deploy) | `/api/ready` 200, sign-in works, data intact | NOT TESTED |
| 5.5 | A backup routine is agreed and written down (none exists in the product) | owner and frequency | NOT TESTED |

## 6. Staging smoke test (Phase 2.6)

| # | Check | Expected | Status |
|---|---|---|---|
| 6.1 | Register a synthetic user, sign in, create a conversation, send a message | answer streams | NOT TESTED |
| 6.2 | Second synthetic user cannot open the first user's conversation, file or project by id | 404 | NOT TESTED |
| 6.3 | Memory note created, shows only for its owner | - | NOT TESTED |
| 6.4 | Project created, a small file uploaded and downloaded by its owner only | - | NOT TESTED |
| 6.5 | Agent write tool stops at the approval card; nothing is saved before approval | - | NOT TESTED |
| 6.6 | Logs for the whole session contain no e-mail addresses, tokens, keys or prompts | - | NOT TESTED |

## 7. Exit of Phase 2 (all must be PASS, or documented as BLOCKED with the reason)

Frontend reachable; backend healthy; database connected and persistent; authentication works; HTTPS works; frontend-backend integration works; approved external services connected; no critical deployment errors; rollback procedure available and rehearsed.

Phase 3 builds the full feature matrix (authentication, chat, providers, history, files, memory, projects, Prompt Studio, agents, dashboards, operator functions, browsers and devices) in `docs/STAGING-FUNCTIONAL-TEST-REPORT.md`; it is not part of this checklist.
