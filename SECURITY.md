# Security

## Reporting

Please report vulnerabilities privately to the repository owner (GitHub: *Security -> Report a vulnerability*)
instead of opening a public issue.

## Findings fixed in this fork (relative to upstream Darkness)

These were verified by `scripts/smoke.mjs` against the real server:

| # | Issue upstream | Fix |
|---|---|---|
| 1 | A request with **no or an unknown token was treated as the most recently active / most recently registered user** - any anonymous visitor could read another user's data | Strict mode: unknown token = anonymous = `401`. `/api/auth/me` returns `{user:null}` and issues no cookie |
| 2 | Hardcoded session token **`default_token`** mapped to a shared account, re-created on every boot | Not created in strict mode; purged from the database on upgrade |
| 3 | Seeded demo account **`user@darkness.local` / `password123`** | Not seeded in strict mode; purged on upgrade |
| 4 | **Remote code execution surface**: terminals / run engine spawn user-supplied commands; `/api/preview/:port` proxies to local ports | `403` unless `ENABLE_RUN_ENGINE=true` (private, single-user instances only) |
| 5 | CORS reflected **any origin with credentials**, cookies `SameSite=None` | Origin allow-list (`CORS_ORIGINS`), `SameSite=Lax` |
| 6 | Debug/diagnostic endpoints disclosed routes and key lengths | Closed in strict mode |
| 7 | SQL error handlers printed full row arguments (file contents, chats) to logs | Removed |
| 8 | Minimum password length 4 | 8 in strict mode |
| 9 | No rate limits, security headers or log redaction | Added (`security/privacy.ts`) |
| 10 | Chat, studio and image routes logged the first 50-60 characters of every user prompt | Log only the prompt length |

## Agent hardening

`fetch_url` resolves and validates the destination **inside the socket's own DNS lookup** (so the address checked
is the address connected to), refuses private/loopback/link-local/CGNAT/multicast and IPv4-embedded IPv6 forms,
limits ports to 80/443/8080/8443, follows at most 3 redirects with re-validation, and caps size/time. The
calculator is a parser, never `eval`. Observations are delimited and declared untrusted in the system prompt.
This reduces - it cannot eliminate - prompt-injection risk: keep agent tools read-only, as they are now.

## Operator checklist

- [ ] `PRIVACY_STRICT=true` (default) and `ENABLE_RUN_ENGINE` unset
- [ ] HTTPS only (Vercel/Render provide it; for your own server use `deploy/server/Caddyfile.example`)
- [ ] `PRIVACY_CSP=enforce` after confirming the browser console shows no violations on your domain
- [ ] `PRIVACY_ENCRYPTION_KEY` set and backed up if you use Aiven
- [ ] Aiven `ip_filter` restricted to your backend's outbound IPs
- [ ] SSH: key login only (`scripts/setup-ssh-key.ps1`), then `PasswordAuthentication no`
- [ ] Rotate any credential that was ever pasted into chat, e-mail or a ticket

## Known limitations

* Legacy password hashes (plain/MD5/SHA-256) from very old upstream databases are still *verifiable* for migration;
  new accounts always use scrypt.
* The SQLite database is not encrypted by the application (use disk encryption).
* In-memory rate limiting and the single-process job queue assume one instance.
