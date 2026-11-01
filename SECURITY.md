# Security

## Reporting

Please report vulnerabilities privately to the repository owner (GitHub: *Security -> Report a vulnerability*)
instead of opening a public issue.

## Findings fixed (all verified by `scripts/smoke.mjs` against the real server)

| # | Issue found | Fix |
|---|---|---|
| 1 | A request with **no or an unknown token was treated as the most recently active / registered user** - any visitor could read another user's data | Strict mode: unknown token = anonymous = `401`; `/api/auth/me` returns `{user:null}` |
| 2 | Hardcoded session token **`default_token`** mapped to a shared account, re-created on every boot | Not created in strict mode; purged from the database on upgrade |
| 3 | Seeded demo account (`user@darkness.local` / `password123`) | Not seeded in strict mode; purged on upgrade |
| 4 | **Remote code execution surface**: terminals / run engine spawn user-supplied commands; the preview route proxies to local ports | `403` unless `ENABLE_RUN_ENGINE=true` (private, single-user instances only) |
| 5 | CORS reflected **any origin with credentials**; cookies `SameSite=None` | Origin allow-list (`CORS_ORIGINS`), `SameSite=Lax` |
| 6 | Debug/diagnostic endpoints disclosed routes and key lengths | Closed in strict mode |
| 7 | SQL error handlers printed full row arguments (file contents, chats) to logs | Removed |
| 8 | Chat/studio/image routes logged the first 50-60 characters of every prompt | Log only the length |
| 9 | Minimum password length 4 | 8 in strict mode |
| 10 | **Cross-user access by id**: project export and other routes loaded a project by id with no ownership check; uploads and knowledge routes accepted another user's `projectId` | `404` for another user's project/conversation ids (`app.param` guard); `403` on body/query-supplied ids |
| 11 | The original Darkness API returned, overwrote or deleted **any conversation by id**, trusted a client-supplied `userEmail`, returned global analytics, fired webhooks to arbitrary URLs (SSRF) and ran code in a `vm` (not a security boundary) | Ported to `/classic-api`: identity from the session, ownership checks on every read/write/delete, per-user analytics, SSRF-safe HMAC-signed webhooks, code execution off by default and, when enabled, a permission-restricted child process |
| 12 | The original app's service worker cache-first cached API GETs under `/classic-api` | Patched copy served (skips any URL containing `/api/`) |
| 13 | The image service sent every prompt to a third-party generator by default | Opt-in only (`IMAGE_ALLOW_THIRD_PARTY=true`); prompt text removed from logs |
| 14 | No rate limits, security headers or log redaction | Added (`server/security/privacy.ts`) |

## Studio and document hardening

- Project content is wrapped in `<project_evidence>` and declared to be data: instructions inside uploaded files are
  never followed. Secrets (API keys, tokens, connection strings, private keys, passwords) are scrubbed from the evidence
  before it reaches a model.
- A user-supplied prompt replaces only the style layer; the output contract and the no-invention rules are always
  appended last and cannot be removed.
- Archive extraction is bounded (entry count, total bytes, nesting depth); export never fetches remote URLs.
- Build jobs, their files and downloads are owner-scoped and expire after an hour; limits cap concurrent builds.

## Agent hardening

`fetch_url` resolves and validates the destination **inside the socket's own DNS lookup**, refuses private / loopback /
link-local / CGNAT / multicast and IPv4-embedded IPv6 forms (including `::ffff:7f00:1`), limits ports, re-validates
every redirect and caps size and time. The calculator is a parser, never `eval`. Observations are delimited and declared
untrusted. This reduces - it cannot eliminate - prompt-injection risk: keep agent tools read-only, as they are.

## Operator checklist

- [ ] `PRIVACY_STRICT=true` (default); `ENABLE_RUN_ENGINE` unset
- [ ] HTTPS only (Vercel/Render provide it; for your own server use `deploy/server/Caddyfile.example`)
- [ ] `PRIVACY_CSP=enforce` after confirming the browser console shows no violations on your domain
- [ ] `PRIVACY_ENCRYPTION_KEY` set and backed up if you use Aiven
- [ ] Aiven `ip_filter` restricted to your backend's outbound IPs
- [ ] SSH: key login only (`scripts/setup-ssh-key.ps1`), then `PasswordAuthentication no`
- [ ] Rotate any credential that was ever pasted into chat, e-mail or a ticket
- [ ] Original app: add your deployed origin to your Google OAuth client if you use its Google sign-in

## Known limitations

* Legacy password hashes (plain/MD5/SHA-256) from very old databases can still be *verified* for migration; new
  accounts always use scrypt.
* The SQLite database is not encrypted by the application (use disk encryption).
* In-memory rate limits, build jobs and the agent's concurrency limit assume one instance.
* The shared "global knowledge base" is not reachable in strict mode (it would be visible to every user).
* PDF export uses Roboto (Latin, Cyrillic, Greek); other scripts should use DOCX or HTML.
* Images need a server-side image model; without one the Studio says so and skips illustrations.
