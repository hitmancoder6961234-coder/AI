# Release readiness (final audit, Task 7)

Date of the audit: 5 November 2026. Scope: the working tree in this folder. **Nothing is committed, pushed or deployed.**
Updated 5 November 2026 after the second development round (memory, Prompt Studio, agent approvals and checkpoints, account recovery, operations verification) and a **final engineering review** (independent re-inspection of the code, two-account probes of every id-taking route family, clean-room runs on Node 22 and 24); the new findings (#52-#62) and results are in the sections below. A later **pre-commit round** added an authorization audit of **every one of the 151 state-changing routes** ([AUTHORIZATION-AUDIT.md](AUTHORIZATION-AUDIT.md)), per-route JSON size limits and a mutation-tested check of what reaches a model prompt. Statuses used in this file: **VERIFIED** (tested, with evidence), **PARTIAL**, **DEFERRED**, **BLOCKED** (needs access, credentials or a decision), **UNVERIFIED** (not adequately tested).

## Verdict

**Classification: READY FOR STAGING.** Not "ready for controlled production deployment", and not "production verified".

*Why staging is supported by evidence:* every check that can run without live infrastructure passes (numbers below), from a fresh install on Node 22 and Node 24; the final review found and fixed every authorisation hole it could demonstrate; the operator tooling (backup, restore, preflight, admin) was exercised end to end; nothing known and severe is left open.

*Why it is not more than that:*

1. **Nothing has run on a real platform**: no Render, Vercel, Docker host, Aiven, real domain, real browser on that domain, real mailbox, real model provider, or GitHub Actions run.
2. **The reviews found five high-severity holes late** (#55-#57 shared files, the Architecture Advisor, the knowledge base; #59 provider keys retained after deletion; #62 server-wide settings open to any user), in route families that the earlier sweep had passed because it only tried *reads*. The pre-commit round then attacked **all 151 state-changing routes** with a tool that fails when a hole is re-introduced (shown twice), and it is clean. That is strong evidence for the routes and the attack shapes it exercises, but it is a tool written by the same team that wrote the code, it cannot see harm that changes no database row (finding #62 was found by hand for that reason), and it does not cover races or business-logic abuse. **Have every state-changing route reviewed independently (or penetration-tested) before real users are admitted.**
3. The application is **single-instance by design**.

So: deploy to a **staging** environment, work through [OPERATIONS-VERIFICATION.md](OPERATIONS-VERIFICATION.md), and decide on production after the independent review above. What was and was not verified:

| Not verified | Why it matters |
|---|---|
| ~~The CI workflow has never run on GitHub~~ **Updated 6 Nov 2026**: it has now run on the pull request (run 42118240655, and again run 42178822719 on the P1-03 commit `81216aa`): all five jobs passed both times. It first failed on two real findings (three fake keys flagged by gitleaks; a Linux-only test hang), both fixed in `0babe13` and `9607514`. It has not run on `main` and its jobs are not yet configured as required checks | the run is on the PR only; branch protection was not inspected or changed |
| Nothing has been deployed: Vercel front door, Render service, Docker image, Caddy | behaviour was verified through the real `api/proxy.js` in front of the real build, not on the providers' platforms |
| No real third-party model provider was called (Gemini, OpenAI, ...) | provider handling was tested against local stand-in providers that misbehave on purpose |
| No external penetration test, no fuzzing campaign | the audit below is a white-box review plus automated probes written by the same team that wrote the code |
| Screen-reader behaviour | the accessibility audit checks names, roles, structure, focus and contrast, not what NVDA or VoiceOver speak |
| Load and capacity | nothing here measures throughput, memory under many users or the single-instance limits below |
| Supabase / Aiven mirrors | cannot run without live accounts |
| **E-mail delivery** (password reset by e-mail) | the SMTP client and the Resend call were tested against local fakes only (incl. STARTTLS / implicit TLS); no real mailbox, SPF / DKIM / DMARC or provider was involved. Unset, the feature reports itself unavailable (501) and operators use `scripts/admin.mjs` |
| **A restore on the real disk or volume** | the backup / restore drill (15 / 15) used the production build and a local folder; it has not been run on a Render disk or a Docker volume |
| Rollback buttons and Docker rollback | steps in `docs/OPERATIONS-VERIFICATION.md` come from the platforms' documentation and the repository's scripts, not from trying them |

Everything in this table is a procedure with unticked boxes in [OPERATIONS-VERIFICATION.md](OPERATIONS-VERIFICATION.md).

"Fully secure" is not a claim anyone can make; what follows is what was checked and what is known to remain.

## What was audited, and how

| Area | Method | Result |
|---|---|---|
| Authentication and sessions | smoke + browser suites: cookie flags, expiry and revocation in the database, login lockout, no user enumeration, weak passwords refused, cross-tab behaviour | pass (one known timing-sensitive cross-tab case, below) |
| Authorisation | **route sweep**: all 207 registered `/api` and `/classic-api` routes, with no credentials (198 closed, 9 deliberately public), as a second user with junk ids and hostile bodies (443 responses, no leaks of another user's data or of a stack), and as a second user against the first user's real ids (35 of 35 reads refused); plus cross-user probes on create-by-id | **1 high finding, fixed** (#48 in SECURITY.md) |
| CSRF / XSS / injection / headers | Origin guard (foreign origin refused, same origin allowed), CSP enforced with no inline script or eval, nosniff, frame protection, referrer policy, no `X-Powered-By`, HSTS; parameterised SQL; user-controlled text rendered as text (comparison answers, tags, titles); CSP browser suite 29/29 | pass |
| Uploads, temp files, archives | streaming to temp storage with limits, signature checks, ZIP traversal / bomb / symlink handling, cleanup on abort and idle timeout: dozens of unit tests, smoke, browser upload suite 12/12 (including a 20 MB chunked ZIP); static path-traversal probes | pass |
| Database logging, error handling | logs contain no e-mails, tokens, keys or prompts (smoke); malformed JSON, oversize bodies, unknown routes give JSON with a request id and no stack | pass after the fixes below |
| API security and rate limits | auth, API and AI rate limits; comparison endpoint: one in flight and 6 a minute per user | pass; limits are per process |
| Provider key protection | keys masked in every model response, scrubbed from provider errors and logs, never in the browser page (tested with a provider that echoes the Authorization header); **encrypted at rest when `PRIVACY_ENCRYPTION_KEY` is set** (AES-256-GCM, bound to user and model; snapshot-first migration, rotation, secure delete: 9 unit tests and a 20-check end-to-end run) | pass; **opt-in**: without the key they are plaintext in SQLite (preflight warns), and backups taken before the conversion still hold them |
| Agent tools | the run engine (user-supplied commands) is off unless `ENABLE_RUN_ENGINE=true`; agent file / network tools have path and SSRF guards (tests) | pass; do not enable the run engine on a multi-user server |
| Privacy export and deletion | smoke: export includes only the user's data, erase removes account, data and sessions | pass |
| Backups | `scripts/backup.mjs`: snapshot with `VACUUM INTO`, verify, restore (unit tests) | pass; backups contain the same plaintext keys as the database |
| Dependencies | `npm audit` 0 vulnerabilities (production and all), 623 registry signatures and 120 attestations verified, lockfile has every platform | pass |
| Deployment configuration | `scripts/preflight.mjs` (never prints values), `tests/deploy-config.test.ts`, go-live checklist in DEPLOY.md | pass locally; live values not checked |
| Desktop and mobile, all features | crawl of every clickable element on every project tab (105 inspected, 0 dead, 0 errors), browser suites for sessions, auth gate, models, management pages, project page, History, branching, comparison; accessibility audit over 15 routes x desktop / 390 px mobile x light / dark (0 findings) | pass |
| CI really blocks | negative proofs run locally: an undefined name in JS, a type error, an import cycle and one lint warning over the budget each made the matching gate exit non-zero; the workflow has no `continue-on-error` (the one `npm audit \|\| true` is an informational listing after the two blocking audits) | pass |
| Documentation against behaviour | test counts, env variables (10 were undocumented and are now in `.env.example`), orphan-file note, feature list | corrected |

## Findings by severity

### Fixed during this audit

| Severity | Finding | Fix and proof |
|---|---|---|
| **High** | **Conversation takeover**: `POST /api/conversations` accepted a client-chosen id and overwrote the owner, so a user who learned another user's conversation id could read all its messages and the owner lost access (SECURITY.md #48) | id validated, foreign id refused with `409`, titles capped; the cross-user probe went from `200 LEAKS A's MESSAGE` to `404`; smoke check |
| **High** | **Shared files readable and deletable by every signed-in user** (SECURITY.md #55): `GET /api/files/shared` and `GET /api/files` listed everyone's unattached files with their content; `/:id/content`, `/:id/raw` and `DELETE /:id` had no ownership check | all five routes are owner-only (another user's file is `404`); script-capable file types are downloads; two-account probe (leaked before, "no leaks" after), unit tests, smoke check |
| **High** | **The Architecture Advisor acted on projects the caller does not own** (#56): an unknown project id fell back to the first project on the server, and the fix helper fell back to any user's file with a matching name | unknown / foreign ids are "no advisor" or `404`; the helper only touches the given project's files and only for its owner; probe and smoke check |
| **High** | **A copy of every provider key survived deleting the model and erasing the account** (#59): every added model was saved again under a shared owner (found by the audit); not usable by other users (tested with a recording provider), but retained in the database and backups | one row per model; strict-mode boot purge of the old copies; unit test and smoke check. **Backups made before this fix still hold the copies: treat them as secrets and rotate keys you cannot account for** |
| **High** | **Any signed-in user could change server-wide settings** (#62): the storage limit (1 GB would break every user's uploads), the shared cache, and the host's storage path and usage | `403 OPERATOR_ONLY` in strict mode (the app has no administrator role by design); smoke check |
| Medium | **One 100 MB JSON limit on every route** (#61) | tiers: 1 MB default, 25 MB for model requests, 100 MB only on 13 file / export routes; early `413` before the body is read; 10 unit tests and a smoke check; the header probe's 30 MB case now passes |
| Medium | **`analyze` / `analysis` created data for non-existent project ids** (#60) | `404` unless the project exists and is the caller's |
| **High** | **One user could erase every user's knowledge base** (#57): `clear-all` ran an unscoped `DELETE FROM knowledge_chunks` / `knowledge_sources` and a delete-everything on the Supabase mirror; the document delete took any `projectId`; the knowledge Q&A wrote into any conversation id | all three scoped and owner-checked; confirmed live (one request took another user's documents from 1 to 0), probe and smoke check |
| Medium | **Id guards only knew records in memory** (#58): ~60 project routes and the conversation routes trusted a guard that passed any record that was only in the database; ids from a JSON body were not type-checked | one shared ownership module (memory, then database) behind both guards, the agent runtime and the file / knowledge routes; unit tests; see the UNVERIFIED note above |
| Low | **Restore brought back revoked sessions and used reset tokens**; restore with an external `DARKNESS_DB_PATH` left the old WAL file | restore invalidates every session and reset token and moves the old database files aside; tests and the drill |
| Medium | **Chat route and foreign conversations that exist only in the database** (SECURITY.md #52): `POST /api/conversations/:cid/chat` re-created a conversation under the caller's account when the id belonged to someone else but was not loaded in memory (the strict-mode id guard only sees memory). Needs the attacker to know the id and an unusual state | only a new, well-formed id can be created there; ids in use by others (memory or database) are `404`, malformed ids `400`; smoke check with a row inserted directly into the database (it answered `200` before the fix) |
| Low | **Restore with `DARKNESS_DB_PATH` outside the storage root** left the old `-wal` / `-shm` beside the restored file (SECURITY.md #53) | old files moved aside; regression test that failed before the fix |
| Low | **Account erase did not remove password-reset tokens** (SECURITY.md #54; new code, caught by a smoke assertion before release) | removed; smoke assertion |
| Medium | `POST /api/studio/execute-instruction` returned `500` with an internal message when `studioType` was missing | `400`; smoke check |
| Medium | unknown `/api/*` paths answered `200` with HTML | JSON `404`; smoke check |
| Low | PDF export leaked the browser-engine error (version, install steps, cache path) | `503` with a plain message |
| Low | 10 environment variables used by the code were undocumented | added to `.env.example` (including a warning about `VITE_`-prefixed key names) |
| Test | an upload test used a 400 ms idle timeout and failed when the machine was busy | 1.5 s |

Earlier tasks fixed 47 numbered findings (SECURITY.md #1-#47) and about 20 further bugs (`docs/IMPROVEMENT-LOG.md`), among them an artifact IDOR, a DOCX file read, non-expiring sessions and a path traversal in chunked uploads.

### Remaining (known, not fixed)

| Severity | Item | Mitigation / what to do |
|---|---|---|
| **Medium** | Provider API keys are encrypted at rest **only if the operator sets `PRIVACY_ENCRYPTION_KEY` and runs the one-time conversion** (DEPLOY.md); until then they are plaintext in SQLite and in every backup, and a plaintext copy remains in any backup taken before the conversion. The Supabase mirror copy is sealed too but could not be exercised without an account | set the key, convert, then treat old backups as secrets and rotate any key you cannot account for; keep the key backed up separately (without it sealed keys cannot be read) |
| Low | The **100 MB JSON tier still exists, but on 13 file / export routes only** (1 MB default, 25 MB for model requests; SECURITY.md #61): a signed-in user can still make the server buffer up to 100 MB per request on those routes, bounded by the rate limits; memory under many concurrent large requests has not been measured | lower `JSON_LIMIT_FILES_MB` if your users do not need it; load-test before opening to many users |
| Medium | In-memory state assumes **one instance**: rate limits, the session cache, build jobs, the agent's concurrency limit | run one instance, or move these to a shared store before scaling out |
| Medium | Vercel front door: bodies above ~4.5 MB are refused (project ZIPs are split into 3 MB parts; other uploads are single requests), and several streaming routes (Studio chat, document stream, knowledge Q&A, project generation) send their first byte with the first token, so a first token slower than 25 s becomes a 504; the Edge runtime used by `api/proxy.js` is deprecated | give large uploads the API's own address, or migrate the proxy; untested without a Vercel account |
| Low | Sessions are a fixed 30 days (no idle timeout or sliding renewal) | sign-out, "sign out other sessions" and password change revoke rows immediately |
| Low | Cross-tab sign-out race (a second tab that is still loading can ignore the `storage` event; about 1 cold start in 5 in the headless test) | the tab recovers on its next API call (`401`) |
| Low | A conversation that exists only in the database (not loaded in memory) owned by someone else answers `403` rather than `404` on `GET /messages` | no data is exposed (the chat route's version of this gap was a real flaw and is fixed, #52) |
| Medium | **Password reset by e-mail is unverified against a real provider**; recovery by e-mail is only as safe as the mailbox; the reset limiter is per process | leave `MAIL_PROVIDER` unset until `OPERATIONS-VERIFICATION.md` 3.2 passes; the operator CLI works without mail |
| Info | **No administrator role** (decided, SECURITY.md "Account recovery and operator access"): operator actions need host access to the database | revisit only if a team / multi-tenant product is planned |
| Medium | **One instance only**: SQLite on one disk, in-memory copies of users / models / conversations / messages / files / projects, per-process limits and jobs (itemised in `OPERATIONS-VERIFICATION.md` section 5) | run exactly one instance; scale up, not out |
| Low | When the Gemini key is not configured, about 25 call sites answer `500` with "set GEMINI_API_KEY" instead of `503` (the authorization audit lists them as configuration-dependent answers, not hides them) | configuration is only revealed, not secrets; one central mapping to `503` is the clean fix |
| Low | The "creative" slide theme (white text on rose, 3.0-3.7:1) and text inside the user's own slides / documents are outside the contrast audit | the same colour is used by the exporters, so it was left unchanged |
| Low | Legacy password hashes (plain / MD5 / SHA-256) from very old databases can still be verified for migration; new accounts use scrypt | remove once no such rows remain |
| Info | `ENABLE_RUN_ENGINE=true` lets users run commands on the server | off by default; only for a private single-user instance |
| Info | SQLite is not encrypted by the application | disk encryption |

### Technical debt

`web/js/pages/project.js` is 11.2k lines (12 tabs in one module); `server/server.ts` is about 8.2k lines with many inline route groups; `tsconfig.json` is non-strict ("0 errors" is relative to that); 1,033 lint warnings are tolerated under a budget that can only go down; the Supabase mirror's RAG-chunk sync shape cannot be verified without an account; `chat.js`, `file-generator.ts`, `architecture-engine.ts` and `db.ts` are large but had no measurable defect to justify splitting.

## Test results (final tree)

All numbers are from runs on the final working tree on 5 November 2026. Nothing was reported as passed that did not run.

### Gates

| Check | Result |
|---|---|
| `npm run verify` (lockfile, architecture, lint budget, typecheck, unit tests, build) | exit 0: 93 modules / 212 imports / **0 import cycles**, **0 lint errors** (1,033 warnings = the budget), typecheck 0 errors, build ok (re-run 6 Nov 2026 on `81216aa`, after the P1-03 migration fix; the 5 Nov figures were 92 modules / 210 imports) |
| Unit tests | **381 / 381** passed, 0 failed, 0 skipped (working tree on Node 22 on 6 Nov 2026, and on GitHub's runners on Node 22 and 24: run 42178822719). The 18 added since 5 Nov are `tests/db-migration.test.ts`. The clean-room runs below were made on 5 Nov 2026 with 363 tests, before that change |
| End-to-end smoke (real server, production build) | **97 / 97** (working tree twice on 6 Nov 2026, GitHub runners, and both clean rooms on 5 Nov) |
| **Authorization audit** (`npm run authz`; every state-changing route attacked as another user) | **151 routes, 145 attacked (499 requests), 6 public by design, 0 violations**: working tree (twice) and both clean rooms. Mutation-tested: with two holes re-introduced it fails with 8 violations. Details: [AUTHORIZATION-AUDIT.md](AUTHORIZATION-AUDIT.md) |
| **Clean room, Node 22.23** (a copy without `node_modules`, `dist`, `.git`, `data`, `.env`: `npm ci`, lockfile check, native packages, build, typecheck, architecture, lint budget, unit tests, smoke, authorization audit) | **all 11 steps exit 0**; 363 / 363, 97 / 97, 0 violations |
| **Clean room, Node 24.22** (same steps) | **all 11 steps exit 0**; 363 / 363, 97 / 97, 0 violations |
| `npm audit` (all and production only) | **0 vulnerabilities**; 623 registry signatures and 120 attestations verified earlier today (the lockfile has not changed since) |
| Prompt-level check (what a model receives) | `tests/agent-runtime-authz.test.ts`: own file / project reach the model, another user's never; the tests **fail** when the two ownership checks are removed |
| Request-size limits | 10 unit tests (`tests/body-limits.test.ts`) + a smoke check against the real server |

### Browser and end-to-end suites and probes: exact accounting

**22 entries run on the final build. In the batch run: 21 passed, 1 failed (the project-page suite). After its test defect was fixed: 22 passed. 0 skipped, 0 blocked, 0 unresolved.**

| # | Suite or probe | Result |
|---|---|---|
| 1 | cross-user probe: files, projects, conversations, memory, prompts | no leaks |
| 2 | cross-user probe: knowledge base (list, delete, clear-all, Q&A injection) | no leaks |
| 3 | account erase probe | every row of the user gone; the old token is `401` |
| 4 | account recovery (browser, fake mail server) | 25 / 25 |
| 5 | auth gate (sign-in screen) | **33 / 33** (it was 32 / 33 in an earlier batch: a test defect, fixed; 33 / 33 on every run since) |
| 6 | sessions | 20 / 20 |
| 7 | manage pages | 35 / 35 |
| 8 | models | 54 / 54 |
| 9 | Content-Security-Policy | 29 / 29 (0 violations from the app's own code) |
| 10 | accessibility audit | 0 findings (0 must-fix) |
| 11 | agent page | 45 / 45 |
| 12 | memory (API, what the model receives, page, chat chip) | 63 / 63 |
| 13 | Prompt Studio | 56 / 56 |
| 14 | compare | 27 / 27 |
| 15 | history | 22 / 22 |
| 16 | branch | 9 / 9 |
| 17 | **project page** | **crashed in the batch at check 27, and failed one check in one of four reruns** (two fixed-delay races in the suite, not application defects: the terminal-output check waited a fixed 1.2 s for a spawned process, and a header button was clicked 500 ms after a viewport change). The suite now waits for the real condition (assertions unchanged): **5 consecutive runs, each 39 / 39** |
| 18 | uploads (chunked ZIP, several files, 20 MB, fake PDF) | 12 / 12 (the lower JSON limits did not affect multipart uploads) |
| 19 | crawl of every clickable element, every project tab | 105 inspected, 85 verified working, **0 dead, 0 errors** |
| 20 | route sweep (244 routes, reads) | exit 0, **10 findings, all configuration-dependent answers** (see accepted limitations); 35 / 35 cross-user reads refused |
| 21 | header probe | **36 / 36** (the 30 MB JSON body is now refused: it was 35 / 36 before the size limits) |
| 22 | backup / restore drill (real server, real restore) | 15 / 15 |

### Known accepted limitations of these results (not counted as passes)

- **Route sweep, 10 findings**: `POST /api/chat`, `/api/document/ai-generate`, `/api/presentation/ai-generate`, `/api/presentation/ai-edit-slide` answer `500` when no model key is configured (3 repeats of the PDF export `503` when no browser engine is installed, and `501` for e-mail recovery when no mail provider is set). They reveal configuration, not secrets or data; the clean fix (one central `503`) is open (Low).
- **Crawl**: 105 elements inspected; 4 were skipped on purpose (destructive buttons such as delete / sign out, which have their own checks) and 16 could not be re-located after a page reload, so they were **not clicked** (neither ok nor dead): a coverage gap, not a pass.
- **Accessibility audit** does not cover `/reset.html` (checked separately for 360 px layout, 44 px targets and focus), screen-reader speech, or the user's own documents and slides.
- The browser suites are scripts that run **outside** the repository (they need Chrome and long runs); they are not part of `npm run verify` or CI. (The CI workflow has since run on GitHub: see the 6 Nov 2026 update in the table of unverified items.)
- All browser results are from a local headless Chrome against local servers with stand-in providers.

### Defects in the tests themselves that were fixed (assertions kept as strict)

`model-compare` (a 150 ms timing bound that could not tell parallel from sequential: now counts calls in flight), the auth-gate lock-out step (fixed 1.5 s waits: now waits for the server's answer and the screen), the project-page suite (two fixed waits, above), and the smoke tests' own ordering (sign-ups before the deliberate rate-limit exhaustion).

Not done in this round (5 Nov 2026): a load / capacity test, an external penetration test, a real-provider, real-mail or real-platform run (BLOCKED, no access), and a GitHub Actions run (done since, on 6 Nov 2026: five jobs green).

## Deployment checklist

The full, ordered list is in [DEPLOY.md](../DEPLOY.md) (go-live checklist) and [SECURITY.md](../SECURITY.md) (operator checklist). The items that gate a launch:

1. Run `node scripts/preflight.mjs` on the API host (and `--frontdoor` on Vercel): no FAIL, and an explanation for every WARN.
2. Set production mode, strict privacy, a persistent volume for `DARKNESS_STORAGE_ROOT`, and the provider key(s) in the host's secret store, never in the repository.
3. Leave `ENABLE_RUN_ENGINE` off. Run **one** instance.
4. Enable disk encryption on the volume (provider keys are plaintext in the database).
5. ~~Push the repository to GitHub and confirm the CI jobs run~~ (done 6 Nov 2026: Windows, macOS, the secret scan and the audit job all ran and passed on PR #1). **Still open:** make the CI jobs required checks (`main` has no branch protection yet; see docs/BRANCH-PROTECTION-PROPOSAL.md).
6. After the first deploy: sign up, sign in on a second device, sign out other sessions, upload a ZIP, export a document, run one comparison with a real provider key, and watch `/api/ready` and the logs.
7. Rotate any credential that was ever pasted into chat, e-mail or a ticket.

## Backup and rollback

* **Before every deploy**: `node scripts/backup.mjs create --out <dir>` to a location outside the volume, then `node scripts/backup.mjs verify <dir>` on the snapshot. Protect backups like the database itself (they contain provider keys).
* **Restore**: `node scripts/backup.mjs restore <backup dir> --yes` with the service stopped (the replaced data is moved aside, never deleted); unit tests cover snapshot, verify and restore on a real SQLite file, including the external-database-path case fixed in this round, and a drill on the production build passed 15 / 15. A restore now **invalidates every session and unused reset token** (a backup would otherwise revive sessions that were signed out afterwards) and keeps accounts and disabled flags; an account its owner erased after the backup returns with the restore (repeat the erasure).
* **Rollback**: redeploy the previous build (the build is `dist/`, rebuildable from the repository and lockfile); data is outside `dist/`. Schema changes are additive (new tables and columns, created at boot), so an older build keeps working on a newer database. **Exception**: after `SECRETS_MIGRATE=encrypt`, a build older than the key vault would read sealed model keys as plain keys; see `docs/OPERATIONS-VERIFICATION.md` section 7. Restore a snapshot only if data itself must be undone.
* **Not tested**: restoring onto a different host or a real Render disk / Docker volume, or a rollback on the real platforms. Full procedures, checklists and the unticked live-verification boxes: [OPERATIONS-VERIFICATION.md](OPERATIONS-VERIFICATION.md).
