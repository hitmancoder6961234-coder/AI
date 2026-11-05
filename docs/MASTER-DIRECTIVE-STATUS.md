# Master directive: status by requirement

This answers the "Ultimate Master Development, Engineering, Security and Product Expansion Instruction" (5 Nov 2026) against what is actually in the
working tree. Classifications follow Part 24: **VERIFIED** (implemented and tested with evidence), **IMPLEMENTED** (code present, verification incomplete),
**PARTIAL**, **BLOCKED** (needs access, credentials, an external service or approval) and **DEFERRED** (postponed, with a reason). Nothing is committed or deployed.

Much of the directive repeats work that earlier tasks finished and documented; those rows point to the record instead of redoing it
([IMPROVEMENT-LOG.md](IMPROVEMENT-LOG.md), [SECURITY.md](../SECURITY.md), [RELEASE-READINESS.md](RELEASE-READINESS.md), [PRODUCT-PLAN.md](PRODUCT-PLAN.md)).

## Built in this round (the first genuinely unfinished items)

| Item | Class | Evidence |
|---|---|---|
| 3.4 Provider API keys encrypted at rest (AES-256-GCM, bound to user and model, also the Supabase mirror copy), tolerant reads, key rotation (`PRIVACY_ENCRYPTION_KEY_PREVIOUS`), explicit snapshot-first migration (`SECRETS_MIGRATE`), secure delete, `preflight` checks | **VERIFIED** locally; **opt-in** (off until the operator sets a key); Supabase path **BLOCKED** (no account) | 9 unit tests (a mutation of the save path fails one), 2 preflight tests, a 20-check end-to-end run on the production build (plaintext, boot migration with snapshot, sealed on disk and in the WAL, models still answer through sealed keys, restart without the key, restart with it, delete). Two real bugs found and fixed on the way: a server started without the key wrote "no key" over sealed keys; preflight accepted vault keys the vault itself refused |
| Image sections 1 and 3: **Agent Workflow** (`#/agents`) and **System status** (`#/system`) | **VERIFIED** | `server/insights.ts` + `insights-routes.ts` (agent runs recorded when they finish; no goal or tool output stored), 6 unit tests (also in three time zones), smoke check (auth, isolation, no secrets or paths), browser suite 54 checks, a11y audit 0 findings |
| Image section 2: **Token Use style model cards** on Usage | **VERIFIED**; tokens are **estimates** (characters / 4) and labelled so; a cost appears only if the user types a price (kept in the browser) | same suite; the API and the page both state the method |
| Image section 4: **Overview "ask" card** (focus chips, question box that opens a new chat and sends it) and **Recent / Pinned** tabs | **VERIFIED** | browser suite (chips, keyboard tabs, send opens a chat and the prompt is consumed once) |
| Earlier today: History search/tags/folders/pinning, branching, model comparison, accessibility pass, conversation-takeover fix, route sweep | **VERIFIED** | see the log and RELEASE-READINESS |

## Requirement by requirement

| Part | Class | Notes |
|---|---|---|
| 1 Inspection and inventory | **VERIFIED** | `docs/PRODUCT-PLAN.md`, `docs/ARCHITECTURE.md`, `docs/RELEASE-READINESS.md` |
| 3.1 Authentication: cookie sessions (HttpOnly, SameSite, Secure in production), server-enforced expiry and revocation, CSRF origin guard, login lockout, no user enumeration, sign out others, password change | **VERIFIED** | password hashing is **scrypt** (an appropriate existing secure implementation, not Argon2id). Cross-tab sign-out has a known timing-sensitive race (**PARTIAL**) |
| 3.1 Password reset / account recovery | **VERIFIED** locally; real mail delivery **BLOCKED** (no mail account) | single-use hashed 30-minute tokens in the URL fragment, identical answers for known and unknown addresses, all sessions revoked on reset, per-address and per-IP limits, `reset.html`, a "Forgot password?" link; mail through `MAIL_PROVIDER=smtp` or `resend` from environment variables, and **501 instead of pretending** when unset; operator-issued one-time links without mail (`scripts/admin.mjs`). 16 unit tests (fake SMTP incl. STARTTLS and implicit TLS), a smoke check driving the real CLI against the real server, a 25-check browser run. See IMPROVEMENT-LOG Task 9.4 and SECURITY.md. **Not verified**: delivery to a real mailbox (procedure in `docs/OPERATIONS-VERIFICATION.md` 3.2) |
| 3.1 Remember-me / idle timeout | **DEFERRED** | sessions are a fixed 30 days; no remember-me option, no idle timeout |
| 3.2 Authorization: ownership of projects, conversations, artifacts, documents, models, files, knowledge, memory, prompts, agent runs, provider keys | **VERIFIED** for every state-changing route, locally | the authorization audit attacks **all 151 POST / PUT / PATCH / DELETE routes** as another user (real, database-only, unknown and no ids; 499 requests) and checks every other user's rows after each request: **0 violations**, in two working-tree runs and both clean rooms; it fails when holes are re-introduced (mutation-tested). Holes fixed: #40, #47, #48, #52, #55-#57, #59, #60, #62. Reads are covered by the route sweep (244 routes) and probes; races, business-logic abuse and harm that changes no row are **not** covered, so an independent review is still recommended. See AUTHORIZATION-AUDIT.md |
| 3.2 Admin-only operations, role-based access | **EVALUATED, DECLINED by design** | nothing in the product needs an administrator and an in-app admin is a privilege-escalation target, so there is no role. The operator actions that are needed (one-time reset link, revoke sessions, disable / enable an account, masked user list) live in `scripts/admin.mjs`, which requires host access to the database (the existing trust boundary), is not reachable over HTTP, and prints no hashes. `users.disabled_at` is an additive migration enforced at sign-in. Operator-level data (readiness, host details) is not exposed to users |
| 3.3 API security: SQL injection, XSS, CSRF, SSRF, traversal, command injection, request size, error messages, rate limits | **VERIFIED** | smoke, route sweep, header probe, CSP suite. Request size is limited **per route** (1 MB default, 25 MB for model requests, 100 MB only for 13 file / export routes, early `413`, tested). **PARTIAL**: inputs are validated by hand, not with a schema library; memory under many concurrent large requests on the 100 MB tier is unmeasured |
| 3.5 File security (streaming, signatures, limits, ZIP bombs and traversal, cleanup) | **VERIFIED** | dozens of unit tests, smoke, browser upload suite |
| 3.6 CSP | **VERIFIED** | enforced, no inline script or eval, reports; hashes (no nonces) where a style is unavoidable |
| 3.7 Privacy: export, account / conversation / document deletion, backups | **VERIFIED** | smoke "erasure" and export checks; memory notes, prompts, agent runs and password-reset tokens are included in the export / removed by the erase. Automatic retention policy: **DEFERRED** (agent runs are purged after 30 days; reset tokens a day after they expire) |
| 4.1 Request ids, structured logs, consistent errors, timeouts, retries, cancellation, graceful shutdown | **VERIFIED** | Task 1 |
| 4.2 Health, readiness, provider diagnostics, no sensitive details | **VERIFIED** | `/api/health`, `/api/ready`, the new status page; provider connectivity test exists on the Models page |
| 4.3 API consistency (validation, pagination, sorting, versioning) | **PARTIAL** | errors are consistent; there is no common pagination or `/v1` versioning |
| 4.4 Durable background jobs | **DEFERRED** | the workload does not need a queue; Project Studio generation already has job status and cancel |
| 5.1 / 5.4 Provider abstraction, reliability | **PARTIAL** | `provider-http.ts` (timeouts, bounded retries, cancellation, scrubbing) is used by chat, agent and comparison; Gemini has its own resilient wrapper. No circuit breaker (**DEFERRED**: no evidence it is needed at this scale) |
| 5.2 Model management | **PARTIAL** | capabilities and limits come from a lookup table plus what the user configures; nothing is invented. No automatic model discovery |
| 5.3 Model comparison | **VERIFIED** for what it does (2-3 models, parallel, per-model timeout and errors, latency, disconnect cancels all, no keys). **PARTIAL**: no provider token counts, no per-model cancel button |
| 6 Chat: search, folders, tags, pinning, branching, rename, delete, export | **VERIFIED** | archiving and bulk management: **PARTIAL / DEFERRED** |
| 6.4 Attachments | **PARTIAL** | upload validation and progress exist; no attachment preview redesign |
| 7 Agents: planning, task breakdown, progress, approvals, pause / resume / cancel, checkpoints, failure recovery, tool permissions, execution history | **VERIFIED** | durable sessions with a mandatory approval gate for write tools (`remember`) that no request or model output can bypass, restart recovery, audit trail; see IMPROVEMENT-LOG Task 9.3. Progress is as reported by the model. Sandboxing: the agent has no shell, filesystem or execution tool; the run engine is off by default |
| 8 Memory | **VERIFIED** | user-controlled notes (no automatic storage), master switch and per-note pause, categories, duplicate and secret refusal, ownership, privacy export and erase, relevance-bounded retrieval into chat and Regenerate with a visible "Used N memories"; see IMPROVEMENT-LOG Task 9.1. Retrieval is word-overlap based |
| 9 Unified workspace | **PARTIAL** | grouped navigation, Overview with ask card and recent / pinned, Agent workflow, System status, Compare, History. A full re-organisation of every page was not attempted |
| 10 Projects | **VERIFIED** for working controls (crawl: 105 elements, 0 dead; 39-check suite). Project-level search and status: **PARTIAL** |
| 11 Knowledge base and RAG | **PARTIAL** | existing ingestion, retrieval and sources work and are tested; no relevance or dedup work was done this round |
| 12 Document generation | **PARTIAL** | existing DOCX / PPTX / XLSX / PDF / CSV / TXT paths are tested; no new document-intelligence features |
| 13 Prompt studio | **VERIFIED** | `#/prompts`: editor, 11 templates, variables with defaults, version history with diff and restore, test on 1-3 models, A/B/C variation comparison, import / export, search and organisation; see IMPROVEMENT-LOG Task 9.2 |
| 14 Usage and cost analytics | **PARTIAL** | calls, daily history, last used, agent success / failure, average time: counted. Tokens: estimated. Cost: only from a price the user enters. Provider-reported usage and limits are not recorded |
| 15 UI/UX | **PARTIAL** | the four new sections follow the existing tokens and cards in light and dark; a wholesale redesign was not attempted (the directive itself warns against random redesign) |
| 16 Accessibility | **VERIFIED** for the audited checks (17 routes, desktop and mobile, light and dark); not a compliance claim |
| 17 Database | **PARTIAL** | indexes, transactions, backup / restore / verify are tested, and a restore drill on the production build passed 14 / 14 (it found and fixed a stale-WAL defect, SECURITY.md #53); not run on a real Render disk or Docker volume. The SQLite versus PostgreSQL evaluation: SQLite is right for one instance; PostgreSQL becomes necessary only when scaling out (the in-memory state would also have to move). No migration was done |
| 18 Performance | **PARTIAL** | bundle measured and cut in Task 5 (2.6 to 1.7 MB); no load or memory profiling |
| 19 Testing | **VERIFIED** | see numbers below |
| 20 Deployment | **BLOCKED** for live checks | preflight (now also the mail settings), Docker / Render / Vercel configuration tests and the front-door simulation pass; nothing was deployed. `docs/OPERATIONS-VERIFICATION.md` has the production checklist, real-provider and mail test procedures, backup / restore verification, the multi-instance report, the env-var checklist and rollback steps; every live box in it is unticked |
| 21 Documentation | **VERIFIED** | kept in step with the code |
| 22 Additional ideas | **DEFERRED** | assessed in PRODUCT-PLAN; not started: voice, local-model presets, sharing, artifact versions, workflow automation, PWA |

## Numbers (final tree; clean rooms on Node 22.23 and Node 24.22)

Unit tests **363 / 363**, smoke **97 / 97**, authorization audit **0 violations over 151 routes**, all three also from a fresh `npm ci` on **Node 22 and Node 24** (11 steps each, all exit 0); lint 0 errors and 1,033 warnings (the budget), typecheck 0 errors, architecture 0 cycles (92 modules), `npm audit` 0 vulnerabilities. Browser suites and probes: **22 entries; 21 passed in the batch, 1 (project page) failed on a test-timing defect and passes 5 / 5 after the fix; 0 skipped, 0 blocked** (exact table in RELEASE-READINESS). **Final classification: READY FOR STAGING** (not ready for controlled production, not production verified). Status words used: VERIFIED, PARTIAL, DEFERRED, BLOCKED, UNVERIFIED. Rows above that say VERIFIED mean tested locally with evidence; **nothing is verified on a real platform**. The reviews added five high-severity fixes (SECURITY.md #55-#57, #59, #62) that earlier "authorisation VERIFIED" rows had missed; row 3.2 is now backed by the route-by-route audit, but an independent review or penetration test of the state-changing routes is still recommended before real users.

## Next (in order)

1. Per-route JSON size limits (small by default, large for document, export and project routes).
2. Schema validation for the highest-risk write routes.
3. Memory design (consent, review, deletion, export) before any storage.
4. Real-provider comparison and agent runs once credentials are available (BLOCKED here).
5. GitHub CI run and a first supervised deployment.
