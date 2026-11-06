# Authorization audit: every state-changing route

5 November 2026. **Nothing here is committed, pushed or deployed.** Reproduce it with `npm run build && npm run authz` (also a CI step). The harness is `scripts/authz-audit.mjs`; the route list comes from `scripts/route-dump-hook.mjs`.

## Result

| | |
|---|---|
| State-changing routes found (POST, PUT, PATCH, DELETE) | **151** (116 POST, 22 DELETE, 10 PATCH, 3 PUT), of which 13 belong to the original app (`/classic-api`). Taken from the running server, not from a regex over the source: 266 registrations in total, including reads, sub-routers and sub-applications |
| Without credentials | **145 refused** (139 with `401`, 6 with `403 RUN_ENGINE_DISABLED`: the disabled run engine refuses before it asks who you are, and reveals nothing); **6 public by design** (sign-in, sign-up, forgot, reset, logout, CSP reports) |
| Attacked as another user | **145 routes, 499 requests**: with the owner's real ids, the owner's **database-only** ids (records the running server never loaded into memory), **unknown** ids, and **no ids at all** (the caller's default scope, where an unscoped statement hides) |
| Outcome | **0** changes to the owner's or the bystander's database rows (checked after *every single request*), **0** responses containing the owner's data, **0** requests that caused another user's provider key to be sent upstream, **0** server errors except 15 *configuration-dependent* answers (listed below), and the owner's and bystander's data were unchanged after the attacker erased his own account at the end |
| Role or permission checks | **There are no roles, by decision** (SECURITY.md, "Account recovery and operator access"). Server-wide operations are therefore not available to any signed-in user in strict mode (finding #62), and operator actions need host access (`scripts/admin.mjs`) |
| Does it catch real holes? | Yes, shown twice. With the file-delete ownership check and the knowledge-base scoping deliberately removed, the audit failed with 8 violations (rows of the owner and the bystander deleted via real and database-only ids, the owner's marker in a response, `knowledge_chunks 4->0`, `knowledge_sources 4->0`); the sources were restored and the audit is clean again. An earlier version missed the knowledge-base wipe because it always sent the owner's ids; the "no ids at all" attack was added because of that |

Configuration-dependent answers (the feature needs something the operator configures; not authorization issues; they are listed, not hidden): `POST /api/chat`, `/api/studio/chat`, `/api/document/ai-generate`, `/api/presentation/ai-generate`, `/api/presentation/ai-edit-slide` answer `500` and `/classic-api/api/image` `500` when no model key / image model is configured (the Low item "500 instead of 503", RELEASE-READINESS.md); `POST /api/document/export-pdf` answers `503 PDF_ENGINE_UNAVAILABLE` when no browser engine is installed.

## What the audit does

1. **Seeds three accounts**: A (the owner), B (the attacker), C (a bystander). A and C own records in every family: conversations and messages, projects with files, versions, RAG documents, artifacts and visual assets, shared files, memory notes, prompts (two versions), models with a key, Copilot conversations, knowledge-base documents, original-app conversations, shares and webhooks, and agent sessions. Some of A's conversation, project, file and artifact records are written straight into the database.
2. **Attacks every route as B** with a plausible state-changing request, four ways (above).
3. **After every request** compares all rows owned by A or C (a hash per table, joined through the owner of the parent record for tables without a `user_id`), checks B's response for any of A's or C's markers, e-mail addresses and ids, and checks that the stand-in model provider never received A's or C's key.
4. **At the end** B erases his own account; then A's and C's rows and what they can read through the API (13 views) must be exactly what they were.
5. Exit code 1 on any violation, so it can gate CI.

## Findings of the final review that this audit and its predecessors produced

| # (SECURITY.md) | Severity | Finding | Found by |
|---|---|---|---|
| 52 | Medium | chat route re-created a conversation that existed only in the database | probe |
| 55 | **High** | shared files listable, readable and deletable by any signed-in user | two-account probe |
| 56 | **High** | Architecture Advisor acted on the first project on the server / any user's same-named file | probe |
| 57 | **High** | one user could erase every user's knowledge base; delete by project id unchecked; Q&A wrote into any conversation | probe |
| 58 | Medium | id guards only knew records in memory; chat trusted client-chosen file / project ids | review, then **mutation-tested at the prompt level** (`tests/agent-runtime-authz.test.ts`) |
| 59 | **High (privacy)** | a copy of every provider key survived model deletion and account erase | this audit (a model row owned by nobody involved) |
| 60 | Medium | `analyze` / `analysis` created data for ids that do not exist | this audit |
| 61 | Medium | one 100 MB JSON limit on every route | review (per-route tiers, tested) |
| 62 | **High (availability)** | any signed-in user could change the server-wide storage limit, wipe the shared cache and read the storage path | hand review of id-less routes |

## How each family decides who owns a record

| Family | Files | Mechanism | Evidence |
|---|---|---|---|
| Accounts, erase, sign-in, recovery | `server/account/routes.ts`, `server/security/privacy.ts`, `server/recovery-routes.ts` | act on the session's user only (no id in the request); recovery uses single-use hashed tokens | audit (self-only routes run last), `tests/recovery.test.ts`, smoke |
| Conversations | `server/server.ts`, `conversation-routes.ts` | `app.param("cid")` guard asks `server/ownership.ts` (memory **and** database) and the handlers re-check; lists and "delete all" are filtered by user id | audit (real / database-only / unknown ids), `tests/ownership.test.ts` |
| Projects and everything under `/api/projects/:pid` | `server/server.ts`, `project-routes.ts`, `rag-routes.ts` | `app.param("pid")` guard (same module); handlers that must create nothing for an unknown id re-check (`analyze`, `analysis`, the advisor) | audit, smoke |
| Shared files | `server/project-routes.ts` | `fileOwnership` in every route; lists filtered by owner | audit, smoke, unit |
| Memory, prompts | `server/memory.ts`, `prompts.ts` | every statement has `WHERE user_id = ?`; another user's id is `404` | audit, `tests/memory.test.ts`, `tests/prompts.test.ts` |
| Models | `server/server.ts`, `db.ts` | per-user model store and `WHERE user_id` rows; one row per model (finding #59) | audit, smoke, unit |
| Copilot | `server/copilot/routes.ts` | `WHERE user_id = ?` | audit, smoke |
| Knowledge base | `server/rag-routes.ts` | `pidAllowed` (own space or own project; `knowledge_<id>` spaces only for that user); searches scoped by user; Q&A checks the conversation | audit ("no ids" attack), smoke |
| Artifacts, visual assets | `server/artifact-access.ts` | path guard and the bulk download use one dependency-injected rule that reads the database | `tests/artifact-access.test.ts`, audit |
| Agent | `server/agent/*` | sessions filtered by owner, write tools always need the owner's approval inside the loop; files and project ids used in the prompt must be the caller's | audit, `tests/agent-sessions.test.ts`, `tests/agent-runtime-authz.test.ts` |
| Builder, studio, documents, diagrams | `server/studio/routes.ts`, `server.ts`, `documents/*` | jobs are owner-checked; the rest is stateless (nothing stored under an id) and needs a session | audit |
| Original app (`/classic-api`) | `server/classic/legacy-api.ts` | rows carry `user_id`; shares are public by id on purpose (read only) | audit (13 routes), smoke |
| Server-wide settings | `server/server.ts` (`/api/storage/*`) | `operatorOnly`: `403 OPERATOR_ONLY` in strict mode (finding #62) | smoke |
| Upload routes | `server/project-routes.ts`, `rag-routes.ts` | multipart: size and signature limits; ownership of the target project / conversation as above | audit (multipart attacks), upload tests |

## Handlers reviewed by hand (not method routes)

| Handler | Decision |
|---|---|
| `USE /api/` and the strict-mode gate | refuses every unauthenticated request outside the public list; run-engine routes refuse first with `403 RUN_ENGINE_DISABLED` |
| `USE /api/preview/:port` (a reverse proxy to any local port) | **blocked by the gate unless `ENABLE_RUN_ENGINE=true`**, which the documentation restricts to private single-user instances. In that opt-in mode any signed-in user could reach any local port: do not enable it on a shared server (it is also why the run engine is off by default) |
| `USE /api/artifacts/:id`, `/api/visual-assets/:id` | owner guard backed by the database (`artifact-access.ts`) |
| `USE /api/auth/login`, `/api/auth/signup` | the per-address and per-account limiters |
| `USE /api/agent/run` | per-user concurrency limit; the stateless run cannot select a write tool |
| `ALL /api/csp-report` | public by design; bounded, logs counts only (no query string) |
| `USE /api` and `/classic-api` (catch-all), `USE /classic-api` (mount) | the JSON `404` catch-all and the original app's mount |

## Limits of this audit (read before relying on it)

- It judges **behaviour**: another user's rows must not change and must not be returned. It cannot see a harmful change that touches no row (a global setting, a file on disk, the shared cache: finding #62 was found by hand for that reason), nor an unauthorised *read* that returns something that is not a marker (reads are covered by the route sweep, the probes and the unit tests, not by this tool).
- A generic request body may be rejected for validation before the code under test runs, so a `400` is not proof of safety. The four attack kinds, the seeded data and the database-only records are what make each route's ownership logic actually run, but a route that needs a very specific body to reach its logic may not be fully exercised. The routes' own unit and smoke tests cover the specific ones that were found.
- Multi-step flows, race conditions (two requests at once), business-logic abuse and denial of service by volume are out of scope. Routes added later are covered only when `npm run authz` is run again (it is a CI step).
- Runs against a stand-in model provider: real provider behaviour is unverified. It does not test the Vercel front door or any real deployment.
- **An independent human review or penetration test of the state-changing routes is still recommended before real users** (RELEASE-READINESS.md).

## Per-route matrix (generated by the audit)

Each cell is the HTTP status the attacker (or an anonymous caller) received. `CHANGED` would mean another user's data changed and `LEAK` that it was returned: neither appears. "File" is the source file that registers the route.

| Route | File | No credentials | Another user, A's ids | A's database-only ids | Unknown ids | No ids at all |
|---|---|---|---|---|---|---|
| `POST /api/csp-report` | `server/security/csp.ts` | 204 | public by design (sign-in, sign-up, recovery, CSP reports): rate limited, reviewed by hand below | - | - | - |
| `DELETE /api/privacy/erase` | `server/security/privacy.ts` | 401 | ends B's own session or account: run last | - | - | - |
| `POST /api/agent/run` | `server/agent/routes.ts` | 401 | 200 | - | 200 | 400 |
| `POST /api/agent/sessions` | `server/agent/session-routes.ts` | 401 | 200 | - | 200 | 400 |
| `POST /api/agent/sessions/:id/approve` | `server/agent/session-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/agent/sessions/:id/resume` | `server/agent/session-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/agent/sessions/:id/pause` | `server/agent/session-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/agent/sessions/:id/cancel` | `server/agent/session-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `DELETE /api/agent/sessions/:id` | `server/agent/session-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/documents/extract` | `server/documents/routes.ts` | 401 | 200 | - | 200 | 200 |
| `POST /api/documents/export` | `server/documents/routes.ts` | 401 | 400 | - | 400 | 400 |
| `POST /api/documents/convert` | `server/documents/routes.ts` | 401 | 400 | - | 400 | 400 |
| `POST /api/copilot/conversations` | `server/copilot/routes.ts` | 401 | 201 | - | 201 | 201 |
| `PATCH /api/copilot/conversations/:id` | `server/copilot/routes.ts` | 401 | 404 | 404 | 404 | 400 |
| `DELETE /api/copilot/conversations/:id` | `server/copilot/routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `DELETE /api/copilot/conversations` | `server/copilot/routes.ts` | 401 | 200 | - | 200 | 200 |
| `POST /api/copilot/chat` | `server/copilot/routes.ts` | 401 | 404 | - | 404 | 400 |
| `PATCH /api/account` | `server/account/routes.ts` | 401 | 200 | - | 200 | 400 |
| `POST /api/account/sessions/revoke-others` | `server/account/routes.ts` | 401 | ends B's own session or account: run last | - | - | - |
| `POST /api/account/password` | `server/account/routes.ts` | 401 | ends B's own session or account: run last | - | - | - |
| `POST /api/builder/projects/:pid/brief` | `server/studio/routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/builder/projects/:pid/outline` | `server/studio/routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/builder/projects/:pid/generate` | `server/studio/routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/builder/jobs/:id/cancel` | `server/studio/routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/builder/image` | `server/studio/routes.ts` | 401 | 400 | - | 400 | 400 |
| `POST /api/storage/limit` | `server/server.ts` | 401 | 403 | - | 403 | 403 |
| `POST /api/storage/clear-cache` | `server/server.ts` | 401 | 403 | - | 403 | 403 |
| `POST /api/auth/forgot` | `server/recovery-routes.ts` | 501 | ends B's own session or account: run last | - | - | - |
| `POST /api/auth/reset` | `server/recovery-routes.ts` | 400 | ends B's own session or account: run last | - | - | - |
| `POST /api/auth/signup` | `server/server.ts` | 400 | ends B's own session or account: run last | - | - | - |
| `POST /api/auth/login` | `server/server.ts` | 400 | ends B's own session or account: run last | - | - | - |
| `POST /api/auth/logout` | `server/server.ts` | 200 | ends B's own session or account: run last | - | - | - |
| `POST /api/models` | `server/server.ts` | 401 | 201 | - | 409 | 201 |
| `PUT /api/models/:id` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `DELETE /api/models/:id` | `server/server.ts` | 401 | 200 | 200 | 200 | 200 |
| `POST /api/models/:id/enable` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/models/set-active` | `server/server.ts` | 401 | 404 | - | 404 | 200 |
| `POST /api/models/test` | `server/server.ts` | 401 | 400 | - | 400 | 400 |
| `PATCH /api/conversations/:cid/meta` | `server/conversation-routes.ts` | 401 | 404 | 404 | 404 | 400 |
| `POST /api/conversations/:cid/branch` | `server/conversation-routes.ts` | 401 | 404 | 404 | 400 | 400 |
| `POST /api/prompts/import` | `server/prompts-routes.ts` | 401 | 400 | - | 400 | 400 |
| `POST /api/prompts/render` | `server/prompts-routes.ts` | 401 | 200 | - | 200 | 400 |
| `POST /api/prompts/run` | `server/prompts-routes.ts` | 401 | 404 | - | 404 | 400 |
| `POST /api/prompts/compare` | `server/prompts-routes.ts` | 401 | 400 | - | 400 | 400 |
| `POST /api/prompts` | `server/prompts-routes.ts` | 401 | 400 | - | 400 | 400 |
| `PATCH /api/prompts/:id` | `server/prompts-routes.ts` | 401 | 404 | 404 | 404 | 400 |
| `DELETE /api/prompts/:id` | `server/prompts-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/prompts/:id/versions/:n/restore` | `server/prompts-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `PUT /api/memory/settings` | `server/memory-routes.ts` | 401 | 200 | - | 200 | 400 |
| `POST /api/memory/preview` | `server/memory-routes.ts` | 401 | 200 | - | 200 | 200 |
| `POST /api/memory/import` | `server/memory-routes.ts` | 401 | 400 | - | 400 | 400 |
| `POST /api/memory` | `server/memory-routes.ts` | 401 | 201 | - | 409 | 400 |
| `PATCH /api/memory/:id` | `server/memory-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `DELETE /api/memory/:id` | `server/memory-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `DELETE /api/memory` | `server/memory-routes.ts` | 401 | 400 | - | 400 | 400 |
| `POST /api/compare` | `server/compare-routes.ts` | 401 | 404 | - | 404 | 400 |
| `POST /api/conversations` | `server/server.ts` | 401 | 201 | - | 201 | 201 |
| `DELETE /api/conversations` | `server/server.ts` | 401 | 200 | - | 200 | 200 |
| `DELETE /api/conversations/:cid` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `PATCH /api/conversations/:cid/title` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/conversations/:cid/messages` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/conversations/:cid/messages/:msg_id/edit` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/conversations/:cid/chat` | `server/server.ts` | 401 | 404 | 404 | 200 | 400 |
| `POST /api/conversations/:cid/regenerate` | `server/server.ts` | 401 | 404 | 404 | 400 | 400 |
| `POST /api/files/shared` | `server/project-routes.ts` | 401 | 201 | - | 201 | 400 |
| `POST /api/files/upload` | `server/project-routes.ts` | 401 | 200 | - | 200 | 200 |
| `DELETE /api/files/:id` | `server/project-routes.ts` | 401 | 404 | 404 | 200 | 200 |
| `POST /api/projects/upload-zip/chunk` | `server/project-routes.ts` | 401 | 400 | - | 400 | 400 |
| `POST /api/projects/upload-zip` | `server/project-routes.ts` | 401 | 400 | - | 400 | 400 |
| `POST /api/projects/upload-files` | `server/project-routes.ts` | 401 | 403 | - | 200 | 200 |
| `POST /api/projects/:pid/analyze` | `server/project-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/files` | `server/project-routes.ts` | 401 | 404 | 404 | 200 | 404 |
| `PUT /api/projects/:pid/files` | `server/project-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/folders` | `server/project-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `PATCH /api/projects/:pid/files/rename` | `server/project-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `PATCH /api/projects/:pid/folders/rename` | `server/project-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `DELETE /api/projects/:pid/files` | `server/project-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `DELETE /api/projects/:pid/folders` | `server/project-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/knowledge/reindex` | `server/project-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/diagnostics` | `server/project-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/diagnostics/project` | `server/project-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/diagnostics/ai-fix` | `server/project-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/explain-architecture` | `server/project-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/apply-changes` | `server/project-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/github/branches` | `server/project-routes.ts` | 401 | 400 | - | 400 | 400 |
| `POST /api/github/import` | `server/project-routes.ts` | 401 | 400 | - | 400 | 400 |
| `POST /api/projects/:pid/github/sync` | `server/project-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/rag/upload` | `server/rag-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/rag/index-project-files` | `server/rag-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/rag/reindex` | `server/rag-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `DELETE /api/projects/:pid/rag/documents` | `server/rag-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `DELETE /api/projects/:pid/rag/documents/:docId` | `server/rag-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/rag/search` | `server/rag-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/rag/settings` | `server/rag-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/rag/test-vector-store` | `server/rag-routes.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/knowledge/rag/upload` | `server/rag-routes.ts` | 401 | 403 | - | 403 | 200 |
| `POST /api/knowledge/rag/search` | `server/rag-routes.ts` | 401 | 200 | - | 200 | 200 |
| `DELETE /api/knowledge/rag/documents` | `server/rag-routes.ts` | 401 | 403 | - | 403 | 200 |
| `DELETE /api/knowledge/rag/documents/clear-all` | `server/rag-routes.ts` | 401 | 403 | - | 403 | 200 |
| `POST /api/knowledge/rag/reindex` | `server/rag-routes.ts` | 401 | 403 | - | 403 | 200 |
| `POST /api/knowledge/rag/ask` | `server/rag-routes.ts` | 401 | 200 | - | 200 | 400 |
| `POST /api/projects` | `server/server.ts` | 401 | 200 | - | 200 | 400 |
| `DELETE /api/projects/:pid` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/chat` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/generate` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/artifacts` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `DELETE /api/artifacts/:id` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `PATCH /api/artifacts/:id` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/artifacts/:id/apply` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/advisor/apply-fix` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/advisor/apply-all-fixes` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/artifacts/download-zip` | `server/server.ts` | 401 | 400 | - | 400 | 400 |
| `POST /api/diagrams/render-image` | `server/server.ts` | 401 | 400 | - | 400 | 400 |
| `POST /api/projects/:pid/assets/generate-image` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `DELETE /api/projects/:pid/assets/:id` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/terminals` | `server/server.ts` | 403 | 403 | 403 | 403 | 403 |
| `POST /api/terminals/:tid/stop` | `server/server.ts` | 403 | 403 | - | 403 | 403 |
| `POST /api/terminals/:tid/restart` | `server/server.ts` | 403 | 403 | - | 403 | 403 |
| `POST /api/terminals/:tid/input` | `server/server.ts` | 403 | 403 | - | 403 | 403 |
| `POST /api/projects/:pid/run` | `server/server.ts` | 403 | 403 | 403 | 403 | 403 |
| `POST /api/projects/:pid/stop` | `server/server.ts` | 403 | 403 | 403 | 403 | 403 |
| `POST /api/projects/:pid/versions` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `POST /api/projects/:pid/runs` | `server/server.ts` | 401 | 404 | 404 | 404 | 404 |
| `PATCH /api/runs/:run_id` | `server/server.ts` | 401 | 200 | - | 200 | 200 |
| `POST /api/document/import-docx` | `server/document-export-routes.ts` | 401 | 400 | - | 400 | 400 |
| `POST /api/document/export-docx` | `server/document-export-routes.ts` | 401 | 200 | - | 200 | 200 |
| `POST /api/document/export-pdf` | `server/document-export-routes.ts` | 401 | 503 | - | 503 | 503 |
| `POST /api/chat` | `server/server.ts` | 401 | 500 | - | 500 | 400 |
| `POST /api/studio/chat` | `server/server.ts` | 401 | 500 | - | 500 | 400 |
| `POST /api/studio/generate-image` | `server/server.ts` | 401 | 200 | - | 200 | 400 |
| `POST /api/document/ai-generate` | `server/server.ts` | 401 | 500 | - | 500 | 400 |
| `POST /api/document/stream-generate` | `server/server.ts` | 401 | 200 | - | 200 | 400 |
| `POST /api/document/ai-edit` | `server/server.ts` | 401 | 400 | - | 400 | 400 |
| `POST /api/presentation/ai-edit-slide` | `server/server.ts` | 401 | 500 | - | 500 | 400 |
| `POST /api/studio/selection-edit` | `server/server.ts` | 401 | 400 | - | 400 | 400 |
| `POST /api/studio/execute-instruction` | `server/server.ts` | 401 | 400 | - | 400 | 400 |
| `POST /api/presentation/export-pptx` | `server/server.ts` | 401 | 200 | - | 200 | 200 |
| `POST /api/presentation/ai-generate` | `server/server.ts` | 401 | 500 | - | 500 | 400 |
| `POST /classic-api/api/chat` | `server/classic/legacy-api.ts` | 401 | 400 | - | 400 | 400 |
| `POST /classic-api/api/chat/stream` | `server/classic/legacy-api.ts` | 401 | 400 | - | 400 | 400 |
| `POST /classic-api/api/upload` | `server/classic/legacy-api.ts` | 401 | 400 | - | 400 | 400 |
| `POST /classic-api/api/image` | `server/classic/legacy-api.ts` | 401 | 500 | - | 500 | 400 |
| `POST /classic-api/api/translate` | `server/classic/legacy-api.ts` | 401 | 400 | - | 400 | 400 |
| `POST /classic-api/api/search` | `server/classic/legacy-api.ts` | 401 | 200 | - | 200 | 400 |
| `POST /classic-api/api/code` | `server/classic/legacy-api.ts` | 401 | 403 | - | 403 | 403 |
| `POST /classic-api/api/conversations` | `server/classic/legacy-api.ts` | 401 | 400 | - | 400 | 400 |
| `DELETE /classic-api/api/conversations/:id` | `server/classic/legacy-api.ts` | 401 | 200 | 200 | 200 | 200 |
| `POST /classic-api/api/share` | `server/classic/legacy-api.ts` | 401 | 400 | - | 400 | 400 |
| `POST /classic-api/api/analytics` | `server/classic/legacy-api.ts` | 401 | 400 | - | 400 | 400 |
| `POST /classic-api/api/webhooks` | `server/classic/legacy-api.ts` | 401 | 400 | - | 400 | 400 |
| `DELETE /classic-api/api/webhooks/:id` | `server/classic/legacy-api.ts` | 401 | 200 | 200 | 200 | 200 |

