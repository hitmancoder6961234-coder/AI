# Improvement log

A running record of the work done against the *Darkness AI Master Improvement Blueprint* (audit baseline 4 Nov 2026) and the
management-page redesign. **Nothing here is committed, pushed or deployed.** Update this file as each step lands.

## Verification (last run)

| Check | Result |
|---|---|
| `npm run lint` | 0 errors, 1,033 warnings; `lint:ci` fails if the count grows (the warning budget is 1,033; 115 were removed in Task 5) |
| `npm run check:architecture` | 90 modules, 204 runtime imports, **0 cycles, 0 layering violations** (it found, and drove the removal of, the one cycle) |
| `npm run typecheck` | **0 errors**, blocking in CI (it reported a 184 "baseline" that was hiding more: see Task 3) |
| `npm test` | **343 / 343** passed (final build, Node 22) |
| `npm run build` | passes |
| `npm run smoke` (end-to-end, real server) | **92 / 92** passed on Node 22 (final build); about 20 seconds (it used to print the result and then hang) |
| Browser, final build of the second round | account recovery 25, auth gate 33 (one cold run 31 / 33, a lock-out step timed out; 33 / 33 alone), sessions 20, manage 35, models 54, CSP 29, agent page 45, memory 63, Prompt Studio 56, compare 27, history 22, branch 9, project page 39, uploads 12, crawl 105 inspected / 0 dead, accessibility audit 0 findings, route sweep 244 routes (35 / 35 cross-user reads refused), header probe (only the known 100 MB body limit fails), restore drill 14; `npm audit` 0 vulnerabilities, 623 signatures and 120 attestations verified |
| Browser: cookie sessions (`session` walkthrough) | 20 / 20 |
| Browser: Models, Settings, atmospheres, mobile | 54 / 54 |
| Browser: uploads through the real UI (Library, project ZIP, several files, 20 MB chunked ZIP, fake PDF) | 12 / 12 |
| Browser: Project page interactions (header, 12 tabs, menus, modals, re-analyze, delete, run/stop, mobile) | 39 / 39 |
| Browser crawl: every clickable element on every project tab | 105 inspected on the latest run (279 earlier, desktop + mobile), 0 dead, 0 errors (before the fixes: 61 inspected, 5 dead) |
| Browser: Content-Security-Policy in enforce mode (every route, Copilot/Agent pages, launcher, Classic app, markdown/SVG/Mermaid/KaTeX, converted buttons, attack probes, report delivery) | 28 / 28; 0 violations from the app's own code |
| Browser: sessions / uploads / Project page / Models / Manage / Auth gate on the final build | 20 (one cross-tab check is flaky on a cold start, see Known issues) / 12 / 39 / 54 / 35 / 33; crawl: 105 elements, 0 dead, desktop and mobile |
| Browser: Mermaid/SVG style conversion vs the browser's native handling (7 diagram types x 2 themes, 14-60 elements and 15 properties each) | 14 / 14 identical computed styles |
| Browser: Overview, Usage, Account | passes, no console errors |
| Browser (final build): Dashboards (Agent workflow, Models usage, System, Overview ask card) 54 / 54, History 22 / 22, Branch 9 / 9, Compare 27 / 27, accessibility audit 0 findings (15 routes x desktop/mobile x light/dark); regression: CSP 29 / 29, Project page 39 / 39, Models 54 / 54, Manage 35 / 35, Auth gate 33 / 33, sessions 20 / 20, uploads 12 / 12, crawl 105 inspected, 0 dead, 0 errors | all passed |
| `npm audit` (production and everything) | **0** vulnerabilities (was 21 in production, 1 critical, 13 high; and 7 moderate in dev tooling) |
| `npm audit signatures` | 621 packages with verified registry signatures, 119 with verified attestations |
| Clean-room: fresh copy -> `npm ci` -> lockfile check, build, typecheck, lint, 195 unit tests, 77 smoke checks | all passed on Windows (Node 22) |

## Blueprint tasks

### Phase 1 - security and quality gates

| Task | Status | Evidence |
|---|---|---|
| Remove SQL parameter logging (P0.1) | Done | `describeSqlFailure` in `server/db.ts`; `tests/db-logging.test.ts` fails on the old logging, passes now |
| Regression test for structured-value log redaction | Done | same test (object/array parameters) |
| Harden browser session handling (P0.2) | Done | HttpOnly cookie is now the only session in the browser: auth gate parses cookies first, no token in `localStorage`, no Bearer from page scripts, CSRF guard, one-time migration of old stored tokens. `scripts/smoke.mjs` + `tests/csrf.test.ts` + 20-check browser walkthrough |
| Route-specific upload limits, aggregate and concurrency controls (P0.3) | Done | `UPLOAD_PROFILES` / `wrapUploadMiddleware` in `server/upload-config.ts`; `tests/upload-limits.test.ts` |
| ZIP extraction limits and zip-bomb tests | Done | entry cap, magic-byte check, declared-size rejection before inflating; `tests/zip-safety.test.ts` |
| Temp-file cleanup | Done | uploads now stream to a private temp folder; removed on every outcome, at start-up and by a periodic sweep (see "Streaming uploads" below) |
| Replace placeholder lint | Done | `eslint.config.js`; a deliberate violation makes `npm run lint` exit 1 |
| TypeScript checks | Done (baseline) | `tsconfig.json`, `npm run typecheck`; 186 errors recorded, reported not blocking |
| Verify actual test count and update docs | Done | runner count is the truth; docs now say 107 unit / 60 end-to-end |
| Dependency and secret scanning in CI | Done | CI `security` job: `npm audit` (reported) + gitleaks (blocking, not run locally) |
| Dependency advisories | Done | `npm audit fix` (semver-safe) + `overrides` for `uuid` and `image-size`; prod audit clean |

### Streaming uploads (blueprint P0.3, completed)

| Requirement | Status | Where |
|---|---|---|
| Inspect all upload routes first | Done | 10 routes: `/api/files/upload`, `/api/projects/upload-files`, `/upload-zip`, `/upload-zip/chunk`, two RAG uploads, `/api/documents/extract` and `/convert`, Classic `/api/upload`, `/api/document/import-docx` |
| Replace in-memory handling with streaming / temp storage | Done | `server/upload-config.ts`, `server/upload-temp.ts`; handlers unchanged (lazy `file.buffer`) |
| File-signature validation for supported types | Done | `server/upload-validation.ts` |
| Preserve supported formats and features | Done | unknown extensions/empty files still accepted; existing end-to-end checks and 12 real-browser upload checks pass |
| File-size, request-size and concurrency limits | Done | per-file limit enforced while streaming, `Content-Length` cap, 3 per caller / 16 server-wide, 60 s idle cut-off |
| Temp-file cleanup, failed and interrupted uploads | Done | per-request registration, removal on response close, start-up purge, 10-minute sweep; tests for success, refused, oversized, interrupted and stalled uploads |
| ZIP bombs, path traversal, malicious archive contents | Done | ratio + declared-size + entry-count + magic-byte checks; **found and fixed a path traversal in the chunk route's `uploadId`** (`server/upload-chunks.ts`) |
| Regression tests | Done | `tests/upload-validation.test.ts`, `upload-streaming.test.ts`, `upload-chunks.test.ts`, `upload-limits.test.ts`, `zip-safety.test.ts`, `csrf.test.ts` + end-to-end checks |
| Docs | Done | `SECURITY.md` findings 27-30, this log, `.env.example` (`DARKNESS_UPLOAD_TMP`) |

## Task 1: Reliability, monitoring and provider stability (completed)

**Inspected first.** No request ids anywhere; `/api/health` always said "ok" (even with the database down), called Supabase on each
probe and returned the *length* of the Gemini/Google keys; no readiness endpoint; Gemini had retries and timeouts but the timeout
was a `Promise.race` that never cancelled the request; the OpenAI-compatible chat path had **no timeout and no retry**; agent
providers had timeouts but no retries, and `agent-runtime.ts` dropped its timeout whenever a signal was passed; model test, AI fix,
image download and GitHub calls had none; SSE routes already aborted on client disconnect; `console.*` was pattern-redacted but
unstructured.

| Requirement | Done | Where |
|---|---|---|
| 1. Unique request ids | `req_<12 chars>` per request; a well-formed incoming `X-Request-Id` (<= 64 chars of `A-Za-z0-9._-`) is kept, anything else replaced; returned as `X-Request-Id` | `server/observability/request-context.ts` |
| 2. Ids in logs and error responses | every JSON error body gets `requestId` (only added to errors, never to successes or arrays); every log line and every `console.*` line written while serving a request carries it; context survives body parsing and async work (re-bound after the parsers) and never mixes between concurrent requests | same + `logger.ts` |
| 3. Health and readiness | `/api/health` (liveness, no secrets, no dependencies); `/api/ready` (database, storage + free disk, upload temp, optional Supabase/Aiven, draining) with accurate 200/503 and no leaked details | `server/observability/health.ts`, `server.ts` |
| 4. Database and service availability | real SQLite probe, storage writable + free space, upload temp writable; optional services cached 15-30 s and only degrade; graceful shutdown flips to `draining` | same |
| 5. Timeouts for every provider | `provider-http.ts` (`fetchWithPolicy`, `iterateWithIdleTimeout`, `attemptSignal`); wired into Gemini, OpenAI-compatible chat (+regenerate), agent/Studio/Copilot providers (`agent/providers.ts`), `agent-runtime.ts`, model test, AI fix, image download, GitHub | `server/provider-http.ts` and call sites |
| 6-7. Safe retries, no retries where wrong | bounded attempts/time, backoff + jitter, `Retry-After`; never 4xx client errors, never after text started | `provider-http.ts`, Gemini layer keeps its own model-fallback rules |
| 8-9. Cancellation and cleanup | caller abort ends the in-flight request, interrupts backoff sleeps at once, stops further attempts, closes the upstream connection and clears timers; Gemini timeouts now really cancel | verified with sockets observed on the stub side |
| 10. Logging hygiene | JSON logs, redaction by field name and by value, no query strings/bodies/headers/cookies, errors described not dumped; end-to-end proof that key, token and prompt never reach the log | `server/observability/logger.ts` |
| 11. Regression tests | below | |
| 12. Docs | this log, `SECURITY.md` findings 31-35, `DEPLOY.md` (health, request ids, logs, provider stability, shutdown), `.env.example`, `render.yaml` | |

**Behaviour changes to be aware of**

- `/api/health` no longer includes `supabase`, `geminiKeyLength` or `googleKeyLength` (nothing in the web app used them).
- `render.yaml` now health-checks `/api/ready` instead of `/api/health`.
- **A failing configured provider no longer silently falls back to Gemini.** Before, the prompt was sent to Gemini with the server's key and the user saw an unrelated Google error; now the provider's own error (for example `HTTP 401: Invalid API key`) is shown and nothing is rerouted. This is a fix, but it is visible.
- Error JSON gained a `requestId` field; no existing field changed.

**Tests added**: `tests/provider-reliability.test.ts` (14: success, retry, bounded retries, Retry-After, no retry for 400/401/404, key never leaked, timeout with connections closed, reset retried, cancel in flight, cancel during backoff, idle timeout, stream cancel, SDK iterator idle, classification), `tests/gemini-reliability.test.ts` (9, the **real Google SDK** against a stub: retry, no retry on 403, timeouts that close connections, cancel, cancel during backoff, stream idle timeout keeps partial text and is not retried, stream cancel), `tests/observability.test.ts` (18: ids unique/validated/propagated/isolated, error bodies, console prefix, access log, aborted requests, error handler, redaction by name and value, readiness incl. a **really closed SQLite handle**, timeout, degraded, caching, draining), and 8 end-to-end checks through the **real chat route** with a misbehaving provider (healthy, 503 retried, 401 not retried with message kept and key never echoed, hang cut off with connections closed, stall keeps partial text and is not retried, tab closed cancels upstream, logs contain no key/token/prompt). Negative check: with the abort wiring disabled the Gemini tests hang, which is the original bug.

**Remaining / not done**: the Gemini model-fallback ladder is unchanged (it still moves between Gemini models on quota errors). Rate limits and the readiness cache are per process. Existing `console.*` call sites were not rewritten to `logger` (they are redacted and carry the request id, but are not JSON fields). There is no metrics endpoint (Prometheus) or error-monitoring integration; that needs an operator choice. Live behaviour behind Vercel + Render is untested.

### Project page: dead buttons and broken interactions (completed)

**Method.** Static scan (ids bound vs ids rendered, calls into other scopes) + a crawler that opens a real project, clicks every
visible button/link on every tab and records whether anything happened (DOM change, request, navigation, dialog, error), + 39
targeted assertions on real outcomes. Baseline before any change: **61 elements inspected, 5 with no effect**, and the crawler
cannot see buttons that are never rendered, which is where most of the damage was.

**Bugs found and fixed**

| # | Bug | Fix |
|---|---|---|
| 1 | The project detail page had **no header**: Back, "Ask the assistant", Export report, diagram PNG/JPG, Re-Analyze and **Delete project** all had handlers but no markup, so none of them could be used | Header restored (`web/js/pages/project.js`, styles `.pj-*` in `web/css/manage.css`) with an accessible Actions menu (aria-expanded, Escape, outside click) |
| 2 | **Eight finished tabs were unreachable** (no tab button): Maps & Advisor (mind map / pipeline / advisor), Data Flow, APIs, Database, Dependencies, Viva Prep, Deliverables, Run & Test. The tab bar already scrolls sideways, which is only needed for a long bar | All 12 tabs are in the bar with their count badges. **This is a visible UI change** (reversible by trimming `tabDefs`) |
| 3 | `switchTab` was called from the architecture graph (advisor chip) but lives in another function; guarded by `typeof`, so the chip silently did nothing | Tab navigation is published as `window.Darkness.projectNav`; the chip works |
| 4 | `openCodeChangeModal` ("Review changes" on an assistant plan) lived inside the architecture tab and rendered into the Files tab's portal, so it never opened from the assistant | Hoisted to module scope; creates its own portal when none exists. Approve & Apply verified to write the file |
| 5 | `openRepairAllAdvisorModal` was called from a scope that could not see it | Hoisted; takes the project id explicitly |
| 6 | `activeFileRecord` referenced from the assistant tab, so "explain this file" never sent the open file | The open file is published as `window.Darkness.activeProjectFile` (cleared when the project changes); verified the chat request carries `targetFile` |
| 7 | `activateFlow` did not exist ("Trace in graph" would throw) | Real implementation: highlights the flow's nodes and the edges between them and fits the view |
| 8 | **`stopProject()` did not exist** (project delete swallowed the error and left the dev server running, which also blocks deleting the folder on Windows) | `stopProject(projectId, {discard})` in `server/run-engine.ts`: stops every running process of the project (process tree), optionally forgets its sessions. Used by delete (before the storage is removed) and by the `/stop` route, which now reports `stopped` |
| 9 | **`getRunStatus()` did not exist** but the live project Copilot calls it to explain runtime errors | Implemented: latest run's status, command, runtime, exit code, error and logs (`idle` when nothing ran) |
| 10 | After **Stop**, the session showed `failed` (the killed process's exit code overwrote `stopped`), and after a restart the old process exiting could overwrite the new run's status | Exit handler keeps `stopped` and ignores exits from a replaced process |
| 11 | Run & Test failed silently (and polled every second for ever) on servers where running code is off | The tab asks the server first and explains clearly; polling stops when you leave the tab |
| 12 | The Architecture tab restored a saved view mode (mind map / data flow / advisor) that has no switcher any more, trapping users with an old saved value | Always opens on the graph |
| 13 | The Actions menu added a new `document` listener on every re-render | One pair of listeners, replaced on each render (verified: 6 click / 7 keydown listeners before and after three re-renders) |
| 14 | The Problems button did nothing until a file was open | Says "Open a file to see its problems." |

**Tests added**: `tests/run-engine.test.ts` (stopProject kills the real process, is idempotent, discard only touches that project;
getRunStatus; a requested stop stays `stopped`), `tests/project-page.test.ts` (handlers vs markup, tabs vs renderers, shared modals,
listener hygiene; proven to fail on the original bug), the lint gate (`no-undef` on `project.js` is an error again), and the
browser suites above. Running code was exercised end to end with `ENABLE_RUN_ENGINE=true`: Run, terminal output, Stop, Run again,
`/stop` (stopped: 1), delete while running (process stopped, sessions gone).

**Not changed / left**: the architecture tab still contains an older, unreachable copy of the mind map, data-flow and advisor
views (superseded by the Maps & Advisor tab); it is dead code, not a dead button. `web/js/pages/project.js` is still 11k lines.
The crawler's 30 "not found after reload" elements are items whose text changes between loads (inconclusive, not failures).

### Not started (each is its own change, per the blueprint)

- A durable job queue (request ids, readiness checks, provider timeouts and retry budgets are done: Task 1).
- Splitting `server/server.ts` and `web/js/pages/project.js` (the project page is now correct but still 11k lines).
- Phase 4 product features (model comparison, controlled memory, agent checkpoints, token/cost analytics).

## Task 2: Content-Security-Policy (completed)

**Goal**: enforce a strict policy without removing functionality. The policy was report-only and allowed `unsafe-inline`,
`unsafe-eval`, three CDNs and any https image.

**Final policy** (both surfaces, exceptions and rationale are in SECURITY.md, "Content-Security-Policy"): `default-src 'self'`;
`script-src 'self'` (Classic adds `https://accounts.google.com/gsi/client`); `script-src-attr 'none'`; `style-src` and
`style-src-elem` `'self'` (Classic adds Google's `/gsi/style` and the hash of Google's one injected style block);
`style-src-attr 'unsafe-inline'`; `img-src` self + data/blob + seven named image hosts; `font-src 'self' data:`;
`connect-src 'self'`; `frame-src 'self' blob:`; `object-src 'none'`; `base-uri`/`form-action`/`frame-ancestors` self;
`report-uri /api/csp-report`. Default mode is now **enforce**.

**What had to change so nothing breaks** (found by loading every route in a real browser under the enforced policy):

- 16 inline `onclick`/`onerror` sites in the main app (markdown visual cards and copy button, code-viewer cards, studio tab buttons,
  model mapping remove, project file links and diff close, the avatar fallback) became `data-act` attributes handled by one delegated listener
  (`web/js/ui/delegated-actions.js`); the code-file buttons already had delegated handlers, so their inline copies were
  simply removed. Side fix: project file links used to put a file path into a JavaScript string inside an attribute, which a
  crafted path could break out of.
- Inline scripts (the sidebar preference, the Copilot page, the Agent page) and every inline `<style>` (Copilot, Agent, the PDF
  export sheet injected by `chat.js`, the Copilot launcher) moved into files.
- Third-party code self-hosted under `web/public/vendor/` (KaTeX + mhchem + fonts, Mermaid 10.9.3, html2pdf 0.10.1, Inter,
  JetBrains Mono); the unused Font Awesome link was dropped. 5.2 MB, no run-time CDN requests.
- **Libraries that inject `<style>`**: Cytoscape (project architecture graph) is pre-empted by a stylesheet `<link>` carrying the
  id the library checks; Mermaid and model-authored SVG carry a `<style>` inside the SVG, which is now converted to inline styles
  scoped to that SVG through the CSSOM (cascade resolved by importance, specificity and order). A parity test against the
  browser's native handling found one real mismatch in the first version (sequence-diagram message lines, a specificity case)
  that was fixed before this was called done.
- **Classic app**: its ~165 KB inline script and ~125 KB inline style are served as `/classic/app.js` and `app.css` plus
  `boot.js` (the default-backend bootstrap), produced by one shared function for both Vercel (`scripts/postbuild.mjs`) and the
  API server (`server/classic/serve.ts`); fonts self-hosted; 3 inline `onclick` handlers converted; the playground's local `eval`
  fallback now explains that it is blocked instead of failing with a raw error.
- `vercel.json` carried the old report-only policy; it now carries the enforced one (two rules: app and `/classic/`), generated
  from `csp.ts` and guarded by a test. `render.yaml` pinned `PRIVACY_CSP: report-only`; now `enforce`.
- Reporting: `POST /api/csp-report`. Chrome ignores `report-uri` when `report-to` is also present and the Reporting API did not deliver in the
  test setup, so only `report-uri` is sent (tested: delivered immediately).

**Tests added**: `tests/csp.test.ts` (23: policy shape, no wildcard/CDN/`unsafe-*` in scripts, env validation and injection attempts, Classic
policy, mode and per-surface selection, vercel.json sync, no inline handlers / injected styles / `eval` / external hosts in the
source, vendored files exist, Classic page split, report parsing, endpoint limits including malformed and oversized bodies, the
Cytoscape guard); 2 new smoke checks (headers over HTTP, report endpoint, the UI and Classic assets served, no inline code in the
served pages) and updated Classic and header checks.

**Found along the way**: my own first regex in the new "no inline handlers" test matched nothing (a mangled escape), so the test
passed without checking anything. I caught it by feeding it known-bad strings and fixed it; the lesson is recorded here because
the same kind of mistake would have shipped silently. The models/settings browser suite then failed on a toast covering the
Reset button; it fails identically with the policy off, so it is a timing race in the test (now waits for toasts to clear), not a
policy effect. The uploads suite failed once on a not-yet-rendered input and passed on both reruns.

**Files** - new: `server/security/csp.ts`, `server/classic/transform.mjs` (+ `.d.mts`), `scripts/sync-vercel-csp.mjs`,
`tests/csp.test.ts`, `web/js/ui/delegated-actions.js`, `web/public/boot-sidebar.js`, `web/public/agent-page.{js,css}`,
`web/public/copilot-page.{js,css}`, `web/public/copilot-launcher.css`, `web/public/cytoscape-container.css`, `web/css/pdf-export.css`,
`web/public/vendor/**`. Modified: `server/security/privacy.ts`, `server/server.ts`, `server/classic/serve.ts`,
`scripts/postbuild.mjs`, `scripts/smoke.mjs`, `index.html` (Classic), `web/index.html`, `web/src/main.jsx`,
`web/js/lib/markdown.js`, `web/js/ui/chat.js`, `web/js/ui/code-viewer.js`, `web/js/pages/{project,model,presentation-studio,document-studio}.js`,
`web/public/{agent.html,copilot.html,copilot-launcher.js}`, `vercel.json`, `render.yaml`, `.env.example`, `SECURITY.md`, `DEPLOY.md`, `README.md`.

**Not verified / left**: a live Vercel + Render deployment, real Google sign-in, Firefox and Safari, a custom CSP for the API
responses themselves (JSON; not needed), `securityLevel: 'loose'` for Mermaid (unchanged; click callbacks are blocked by the
policy anyway), and `style-src-attr 'unsafe-inline'` (documented exception).

## Task 3: CI pipeline, TypeScript and dependency security (completed)

**CI** (`.github/workflows/darkness-ai-ci.yml`, rewritten): every job blocks. `quality` runs `npm ci`, the lockfile check, `lint:ci`,
`typecheck`, `test`, `build` and `smoke` on Node 22 **and** 24; `cross-platform` runs install, build, tests and smoke on Windows and
macOS; `security` runs `npm audit --omit=dev --audit-level=low`, `npm audit --audit-level=high`, `npm audit signatures` and gitleaks
(config: `.gitleaks.toml`, two exact fake strings allowlisted). Least-privilege token, concurrency cancellation, Dependabot.
Before: typecheck and audit were `continue-on-error`, one Node version, one OS. `tests/ci-and-lockfile.test.ts` (11) fails if a step
becomes non-blocking, a Node/OS entry is dropped, permissions widen, the allowlist grows or goes stale, or a credential-shaped
string appears in the sources.

**Lockfile and the Windows native-binary problem** - reproduced exactly: a clean `npm ci` on Windows installed no
`@esbuild/win32-x64` / `@rollup/rollup-win32-x64-msvc` (nor the `@napi-rs/canvas` / `@resvg/resvg-js` ones) and `npm run build` died
with "Cannot find module @rollup/rollup-win32-x64-msvc". Cause: the lockfile was written on Linux by an npm that records only the
platform it runs on (npm/cli#4828). Fix: `scripts/lockfile-platforms.mjs` finds every optional platform package the lock declares but
lacks (at the version the parent asks for, including `vite`'s own older esbuild), fetches each one's metadata from the registry and adds
the entries in npm's own format: **91 added, 652 existing entries untouched, byte-for-byte idempotent under `npm install
--package-lock-only`**, line endings preserved. After it, `npm ci` in a clean folder on Windows installs the right binaries (and a plain
`npm install` no longer prunes them, which was the old trap). `--check` runs in CI and in the unit tests.

**Dependency review**: production 0 (unchanged). The 7 moderate advisories were all one dev-only chain: `minimatch` ReDoS
(GHSA-g3hv-75wg-m249) reached through `typescript-eslint`; npm's suggested "fix" was a semver-major *downgrade*. Instead a scoped
`overrides` entry takes only that nested dependency to the patched `minimatch` 11.0.4 (engines `20 || >=22`); lint output and type check
are identical. No other package was upgraded, no major upgrade of anything we use. Unresolved advisories: **none**.

**TypeScript: 0 errors** (blocking), from a "184 baseline". Fixing the 51 relative imports that lacked `.js` let the compiler see across
files for the first time and raised the count to 208: most of those errors were real. What was fixed (all behaviour changes are
intended, and each has a test unless marked):

- *Security*: artifact / visual-asset routes had no ownership check (SECURITY.md #40); DOCX export could embed server files (#41).
- *Un-awaited promises used as values*: the architecture-diagram **PNG download** sent `{}` (the JPG path worked), the image service
  base64-encoded `"[object Promise]"`, the four diagram PNGs in the project visuals and DOCX report were Promises, the diagnostics
  route called `.forEach` on a Promise.
- *DOCX*: pictures were stored as `.undefined` (Word cannot open them), chosen margins were ignored (`margins` vs `margin`),
  `artifact-context` threw on any detected repository screenshot (`sc.buffer`).
- *UI contracts*: the per-file Problems panel always showed nothing (the route returned a bare array, the UI reads `{ issues, summary }`);
  project-wide diagnostics always came back empty (read `.issues` from an array).
- *Knowledge*: `POST /api/projects/:pid/rag/upload` always answered 500 (`NOT NULL constraint failed: project_files.path`); single-document
  reindex was always 404; search ignored `topK`; both upload routes stored the file type as the default "Document".
- *Chat*: the deterministic math solver branch never ran (it read `.success` from a string); it now answers only when the solver
  verified its own result, otherwise the question goes to the model as before.
- *Dead or partial features*: "edit this image" dropped its source image (snake_case vs camelCase), project auto-sync from disk
  never imported anything (`relativePath` does not exist), security findings were saved with the wrong rule id and severity,
  notebook chunks had no `chunkType`, the folder-structure edges lacked `evidence`, PPT title slides had no font size and its data-flow
  / API / viva slides always used generic text (`context.analysis`), `temperature` was passed where Gemini ignores it, the database
  node always said PostgreSQL, module paths were undefined in the project-understanding report. (Tested: DOCX, visuals, solver,
  diagnostics, RAG, artifacts; not separately tested: the PPT/Excel text sources, the disk auto-sync and the chunk/edge fields.)
- *Types that were lost or lagging* (no behaviour): the `ProjectIntelligence` interface had disappeared; optional fields on
  `GeneratedArtifact`, `ModelItem`, `ConversationItem`, `MessageItem`, `FileItem`, `AgentContextParams`; `req.params.x` is always a
  string (106 reads wrapped in `String()`, no wildcard routes exist); node:sqlite row casts and `bigint` counts.
- *Deliberately not changed*: the Supabase mirror's user sync (it never worked, so it has always stored a placeholder identity; "fixing"
  it would copy e-mail and password hash to a remote table; now explicit in the code) and the two Supabase chunk-sync calls (cannot be
  verified without Supabase).

**Also fixed in the test tooling**: `scripts/smoke.mjs` never closed its stub provider, so the process stayed alive after printing the
result and every run only ended when an outer timeout killed it (a CI job would have hung); it now closes both fake providers and exits
explicitly (20 s instead of a timeout). Its header assertion, Classic-page and port handling were updated for Task 2.

**Verified on**: Node 22.23.4 and Node 24.22.2 (Windows): 195/195 unit tests, 77/77 smoke, build, typecheck 0, lint budget, lockfile
check, audits. **Not verified**: execution on GitHub's runners (Linux/macOS/Windows hosted images), macOS at all, a live `gitleaks`
scan of git history (only the working tree was scanned, by a unit test with the same patterns).

**Files** - new: `scripts/lockfile-platforms.mjs`, `.github/dependabot.yml`, `.gitleaks.toml`, `tests/ci-and-lockfile.test.ts`,
`tests/generation-fixes.test.ts`. Modified: `.github/workflows/darkness-ai-ci.yml`, `package.json` (scripts, `overrides`), `package-lock.json`
(+91 platform entries, minimatch), `scripts/smoke.mjs`, `README.md`, `SECURITY.md`, `DEPLOY.md`, and for the fixes: `server/server.ts`,
`server/project-routes.ts`, `server/rag-routes.ts`, `server/file-generator.ts`, `server/visual-intelligence.ts`, `server/artifact-context.ts`,
`server/image-service.ts`, `server/agent-runtime.ts`, `server/db.ts`, `server/supabase.ts`, `server/architecture-engine.ts`,
`server/architecture-diagram-renderer.ts`, `server/knowledge-engine.ts`, `server/project-understanding-engine.ts`,
`server/project-analyzer.ts`, `server/study-learning-engine.ts`, `server/rag-engine.ts`, `server/documents/export.ts`,
`server/studio/render-deck.ts`, `web/src/answer-engine.ts`, `tests/copilot.test.ts`, and 17 files whose relative imports gained `.js`.

## Task 4: Live deployment verification and production readiness (completed, with live checks explicitly unverified)

**Approach**: there is no Vercel, Render, Aiven or Docker access here, so nothing was deployed, no production config or data was touched, and
no secret was read or printed. Instead the real production build was run behind the **real `api/proxy.js` handler** (the function Vercel
runs), the deployment files were checked against each other, and what a live deployment would need is now enforced by tools and tests.
The list of what could not be verified is in DEPLOY.md ("Verified vs. not verified").

**Verified end to end (smoke, 4 new checks)**: cookie flags through the proxy (`HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`),
reload, CSRF (foreign origin 403, own origin 200), streaming in chunks, logout and a dead old cookie, path allow-list and non-https
`BACKEND_URL` refusal, no backend address in headers, request ids and client IP forwarding, session **expiry and revocation**, and
the chat stream opening immediately.

**Real problems found and fixed**
- *Sessions never expired while the process stayed up* (in-memory cache trusted without the DB row): SECURITY.md #45. Fails on old code.
- *Uploads through Vercel*: ZIPs went up in 8 MB parts and single requests up to 15 MB; Vercel's function limit is ~4.5 MB. Now 3 MB parts,
  3.5 MB direct, and a clear message for Vercel's bare 413 (also in the shared API client). Caddy example capped bodies at 50 MB while the
  app accepts 100 MB: now 110 MB.
- *Chat streams on a slow model*: the main chat sent no bytes until the provider answered; behind Vercel (25 s to first byte) that is a 504.
  It now opens the stream at once (measured 14 ms with a silent provider); Copilot/Agent already did.
- *`npm run dev` was broken by the enforced CSP* (Task 2 regression: Vite's inline preamble and HMR websocket were blocked, "plugin-react
  can't detect preamble"). The default is now report-only outside production; production and `render.yaml` stay enforced.
- *No backup/restore, no way to check the environment*: `scripts/backup.mjs` and `scripts/preflight.mjs` (below).

**New tooling (shipped in the Docker image)**: `scripts/preflight.mjs` (production environment check; names and verdicts only, never values; `--frontdoor` for Vercel;
`--strict`), `scripts/backup.mjs` (`create` / `verify` / `restore --yes`; consistent SQLite snapshot via `VACUUM INTO` that includes WAL contents a plain file copy would miss,
folders, manifest with checksums, restore refuses damaged backups and keeps the replaced data aside), `npm run preflight` / `npm run backup`.

**Tests added** (18 unit + 4 smoke): `tests/backup.test.ts` (4), `tests/preflight.test.ts` (6), `tests/deploy-config.test.ts` (8: render.yaml passes the preflight, secrets are `sync: false`,
disk mount equals the storage root, `/api/ready`, vercel.json rewrite order and no-store, Dockerfile non-root/volume/healthcheck, compose bound to 127.0.0.1 with least privilege, Caddy limit above the upload
limit, upload piece size under Vercel's cap, `.env.example` documents render.yaml), CSP mode tests updated (production vs development).

**Production log review**: a full smoke run (`SMOKE_LOG_SUMMARY=1` or `SMOKE_LOG_LEVELS=error`) shows structured JSON for requests and
provider retries, no e-mail addresses, tokens or keys, and exactly two `error` lines, both deliberate (image generation with no image model; Copilot with no model). Remaining
noise: legacy `console.log` lines (`[AUTH] ...`, `[API] ...`) are request-id prefixed but unstructured and duplicate the access log; they carry only the first 8 characters of a user id.

**Left / risks**: other SSE routes still send headers with the first token (Studio chat, document stream, knowledge Q&A, project generate); the Vercel Edge runtime is deprecated by Vercel;
multipart uploads other than ZIPs are single requests (~4 MB through Vercel); sessions have a fixed 30-day life with no idle timeout; nothing was run on real Vercel/Render/Docker.

**Files** - new: `scripts/preflight.mjs`, `scripts/backup.mjs`, `tests/backup.test.ts`, `tests/preflight.test.ts`, `tests/deploy-config.test.ts`. Modified: `server/server.ts` (session expiry, early SSE flush),
`server/security/csp.ts` (dev default), `web/js/pages/project.js` (upload sizes), `web/js/services/api.js` (413 message), `web/js/ui/delegated-actions.js` (lint), `Dockerfile`,
`deploy/server/Caddyfile.example`, `package.json`, `scripts/smoke.mjs`, `tests/csp.test.ts`, `.env.example`, `README.md`, `DEPLOY.md`, `SECURITY.md`.

## Task 5: Safe architecture refactoring (completed incrementally; not everything is split)

**Method**: measure first, move only what has a measurable benefit (a removed cycle, dead code, a unit-testable unit, a smaller payload), keep every route,
status code and auth rule identical, and run build + typecheck + lint + unit tests + smoke after each stage (browser suites after the front-end stages).
No cosmetic reshuffling: files that would only have been renamed, or split into pieces that all still need each other, were left alone.

| Stage | Change | Measured result |
|---|---|---|
| 1 | `scripts/check-architecture.mjs` + `tests/architecture.test.ts` + CI step: import-graph cycles and layering rules (foundation < data < domain < routes < entry; nothing imports `server.ts`) | found 1 real cycle (`logger -> privacy -> csp -> logger`) and 3 upward imports; type-only imports are recognised, so no false alarms |
| 1b | `server/security/redact.ts`: the pure `redact()` moved out of `privacy.ts` (re-exported there, no caller changed) | **0 cycles, 0 violations** |
| 2 | `server/artifact-access.ts`: the artifact / visual-asset ownership rule as a dependency-injected module (+ 6 unit tests) | exposed and closed a second hole: `download-zip` accepted other users' artifact ids (SECURITY.md #47); the rule is now unit-testable |
| 3 | Dead code: the older `/diagnostics` and `/diagnostics/ai-fix` copies in `server.ts` (registered after the live ones in `project-routes.ts`, so they never ran) and the orphan `server/server-copilot-route.ts` | -119 and -57 lines; `tsconfig` no longer excludes anything |
| 3b | 114 unused import specifiers removed across the server (TypeScript-parser based; every module import is kept, so evaluation order is unchanged) | lint warnings **1,160 -> 1,045** |
| 4 | `server/document-export-routes.ts`: Word import, DOCX export and PDF export (402 lines) moved verbatim out of `server.ts` | `server.ts` **8,736 -> 8,180 lines**; covered by the DOCX smoke check (the PDF route needs Chrome and is covered only by being a verbatim move) |
| 5 | Front end: the second copy of KaTeX (vendored 0.16 next to the bundled 0.18; the bundled one overwrote it) removed; `vite.config.ts` splits React / Cytoscape / KaTeX into long-cached chunks | main JS **2,615 KB -> 1,744 KB** (gzip 763 -> 487 KB); 644 KB on disk and one script + stylesheet + font set less per page; inline math, chemistry and display equations verified rendering in Chrome |
| 6 | `web/js/lib/zip-upload.js`: the ZIP upload pipeline (188 lines) out of the 11k-line `pages/project.js` as an ES module, with 6 behavioural tests (fake `fetch` / `XMLHttpRequest`: part sizes, ids, retries, 413 handling, the 100 MB limit) | `project.js` 11,399 -> 11,212 lines; the front-door upload cap is now tested by running the code, not by reading its source |

**Not done (and why)**: `project.js` (11.2k lines) is still one module with 12 tabs. It works and is covered end to end, but splitting it safely means one tab at a time with the
browser suites after each, and nothing about it had a measurable defect left to fix in this task. `server.ts` still holds many inline route groups (the pattern of stage 4 applies to
each). `chat.js`, `file-generator.ts`, `architecture-engine.ts` and `db.ts` were not split: no cycles, no dead code and no separable group whose move would be more than renaming.
CSS files were not split (order matters, no measured benefit). The Vite chunking is vendor-only: lazy-loading pages per route would cut first load further but changes when page code
runs, which is a behaviour change.

**Found along the way**: the clean-room run after Task 4 caught **location-dependent tests** (the preflight tests assumed the repository is not under the system temp folder) and two
timing-tight tests (a 400 ms Gemini timeout, a 3 s temp-file wait) that failed only under load; all three were made robust. A final clean room is the last step of this task.

**Docs**: `docs/ARCHITECTURE.md` (layers, rules, where the size is, how to change things safely).

**Files** - new: `scripts/check-architecture.mjs`, `server/security/redact.ts`, `server/artifact-access.ts`, `server/document-export-routes.ts`, `web/js/lib/zip-upload.js`, `docs/ARCHITECTURE.md`,
`tests/architecture.test.ts`, `tests/artifact-access.test.ts`, `tests/zip-upload.test.ts`. Removed: `server/server-copilot-route.ts`, `web/public/vendor/katex/`. Modified: `server/server.ts`,
`server/security/privacy.ts`, `server/observability/logger.ts`, `server/provider-http.ts`, `server/project-routes.ts`, `server/rag-routes.ts`, `server/file-generator.ts`, `server/db.ts` and about 20 other
server modules (imports), `web/js/pages/project.js`, `web/index.html`, `vite.config.ts`, `tsconfig.json`, `package.json`, `.github/workflows/darkness-ai-ci.yml`, `scripts/smoke.mjs`, and the tests named above.

## Task 6: Product expansion (four features built and tested; six deliberately deferred)

**Method**: inspect what exists, write `docs/PRODUCT-PLAN.md` (dependencies, risks, acceptance criteria per feature) *before* coding, implement one feature at a time, and mark nothing done
without a test. No paid external service was introduced (comparison uses the models the user has already configured, with their own keys).

| Feature | What shipped | Evidence |
|---|---|---|
| **A. Conversation search, tags, folders, pinning** | `GET /api/conversations/search`, `GET /facets`, `PATCH /:cid/meta`; History page rebuilt (search box with snippets, folder filter, tag chips, pinned-only, an organise dialog); pinned conversations lead the list (the list endpoint sorts them first, so the sidebar follows) | `server/conversation-library.ts` (DB-agnostic), 10 unit tests, a smoke check with three users (isolation both ways, wildcard literals, validation, pin order), browser suite 22 / 22 (search, `%%`, one-character hint, pin with `aria-pressed`, organise dialog validation, tag and folder filters, reload persistence, keyboard, accessible names, 390 px layout) |
| **B. Conversation branching** | `POST /api/conversations/:cid/branch`: copy up to a chosen message into a new conversation (new ids, tags and folder carried, pin reset); a "Branch from here" action on every saved chat message | unit tests + the same smoke check (foreign conversation, foreign message, missing id, source untouched, branch searchable); browser suite 9 / 9 (labelled button on all four messages, new conversation has exactly the first two, original keeps four, adding to the branch does not touch the original, Enter key) |
| **C. Model comparison** | `POST /api/compare` (2-3 of the user's models, 8,000-character prompt, parallel, 60 s per model, one in flight per user, 6 per minute) and a Compare models page with side-by-side answers, per-model status and latency, copy, cancel | `server/model-compare.ts` + `compare-routes.ts`, 16 unit tests (a mutation check proved the key-scrubbing and the disconnect-abort tests fail when the guards are removed), a smoke check against the real provider layer (a provider that echoes the Authorization header, a hanging provider whose socket the server must close when the browser disconnects, foreign models, bad bodies), browser suite 27 / 27 (a model answering with HTML is shown as text, no key on the page, cancel closes the upstream connection, 3-model cap, empty state, mobile) |
| **D. Accessibility pass** | A route-by-route audit (15 routes, desktop and 390 px mobile, light and dark): accessible names, labels, duplicate ids, aria references, landmarks, headings, focus visibility, horizontal scroll and WCAG AA text contrast | It first reported **31 must-fix findings and 6 warnings**; after the fixes **0** (the audit cannot be vacuous: it found them). `tests/accessibility.test.ts` (8 tests) keeps the token contrast and the keyboard-reachability fix from regressing, and caught one more failure the browser run missed (light `--ink-faint` on `--surface-muted`, 4.39:1) |

**Accessibility findings fixed**: message actions (copy, regenerate, edit, branch) were `visibility: hidden` until hover, so **keyboard users could not reach them** and touch users never saw them
(now opacity-only, shown on focus and always on touch screens, 36 px targets); the light theme's pastel accent used as text was **1.7:1** (new `--accent-text` token, 5.8:1, applied to 114 text uses) and white text on that
accent fill failed in 10 rules (now `--accent-ink`); dark-theme faint text 3.9:1 (now 6.3:1); the Slide Studio rose was 3.7:1 under white text (now 4.7:1, and a lighter rose for text on dark); one unlabeled checkbox
and three placeholder-only textareas got names; the non-empty chat had no heading (a visually hidden `h1`); the mobile "AI chat" toggle in Slide Studio never showed its intended colour because an `!important` rule beat the inline style.
**Not changed on purpose**: text inside the user's own slides and documents (set by the slide theme, e.g. the "creative" theme's white on rose is 3.0-3.7:1) and the creative theme's colour itself, because the same hex is used
for exports; hover-only controls are tested in their revealed state.

**Deferred (with the reasons in `docs/PRODUCT-PLAN.md`)**: memory management (needs a privacy and consent design first), agent approvals / checkpoints (no mutating agent tool exists yet), a unified workspace (a product
redesign, not an increment), a prompt studio for chat (overlaps Project Studio), token / cost analytics (provider usage data is inconsistent; needs maintained price tables), document-intelligence expansion (needs user feedback).

**Not verified**: comparison against real third-party providers (only a local stand-in provider and the OpenAI-compatible wire format; Gemini goes through the existing resilient wrapper, untested live); screen-reader
behaviour (the audit checks names, roles, structure and contrast, not what NVDA or VoiceOver actually speak); contrast of text over images or gradients (skipped by the audit); History and Compare under Vercel.

**Found along the way**: `GET /api/conversations/:cid/messages` returned nothing for conversations that exist only in the database (a branch is one), now falls back to the database; a test race (`waitForFunction` passing before the
click had any effect) and a short-query hint that was overwritten by the render were fixed in the History suite.

**Files** - new: `server/conversation-library.ts`, `server/conversation-routes.ts`, `server/model-compare.ts`, `server/compare-routes.ts`, `web/js/pages/compare.js`, `docs/PRODUCT-PLAN.md`, `tests/conversation-library.test.ts`,
`tests/model-compare.test.ts`, `tests/accessibility.test.ts`. Modified: `server/server.ts`, `web/js/pages/history.js` (rewritten), `web/js/ui/chat.js`, `web/js/ui/sidebar.js`, `web/js/app.js`, `web/js/data/nav.js`, `web/src/main.jsx`,
`web/css/tokens.css`, `web/css/components.css`, `web/css/pages.css`, `web/css/manage.css`, `web/css/code-viewer.css`, `web/css/builder.css`, the studios and knowledge pages (labels), `web/public/copilot-page.css`,
`web/public/agent-page.css`, `scripts/smoke.mjs`, `SECURITY.md`, `docs/ARCHITECTURE.md`.

## Task 7: Final security audit and release readiness (completed; the application is **not** declared production-ready)

The full report is [RELEASE-READINESS.md](RELEASE-READINESS.md): verdict and what could not be verified, how each area was audited, findings by severity, what remains, test results,
a deployment checklist and backup / rollback guidance.

**Method**: a route sweep over all 207 `/api` and `/classic-api` routes (unauthenticated, as a second user with hostile input, and as a second user against the first user's real ids), cross-user probes
on create-by-id routes, a headers / cookie / CSRF / error-shape / traversal probe against the production build, negative proofs that each CI gate fails on a bad change, a secret scan of the tree and `dist/`,
`npm audit` and signature checks, the full unit, smoke and browser suites on the final build (Node 22 and 24), and a final clean room.

**Found and fixed**: one **high** (conversation takeover by reusing an id on `POST /api/conversations`, SECURITY.md #48), an input-validation `500`, unknown `/api` paths answering `200` with HTML, a PDF error that exposed
the browser-engine message, 10 undocumented environment variables, stale numbers in README / DEPLOY, and one upload test that failed under load (400 ms idle timeout, now 1.5 s). Each code fix has a smoke check.
**Remaining** (not fixed, listed with mitigations): provider keys in plaintext at rest, a 100 MB JSON limit on every JSON route, single-instance in-memory state, Vercel front-door limits, fixed 30-day sessions, and
everything that needs live infrastructure.

**CI really blocks**: an undefined name in a `.js` file, a type error, an import cycle and one warning over the lint budget each made the matching gate exit non-zero (an undefined name in a `.ts` file is caught by
the type check, not by lint). The workflow has no `continue-on-error`; the single `npm audit || true` is an informational listing that follows the two blocking audits.

**Files** - new: `docs/RELEASE-READINESS.md`. Modified: `server/server.ts` (create-conversation guard, `studioType` validation, API 404), `server/document-export-routes.ts`, `scripts/smoke.mjs`,
`tests/upload-streaming.test.ts`, `.env.example`, `SECURITY.md`, `README.md`, `DEPLOY.md`, this log.

## Task 8: Master directive round (keys at rest, dashboards from the reference images)

Status of every requirement of the long master directive: [MASTER-DIRECTIVE-STATUS.md](MASTER-DIRECTIVE-STATUS.md) (VERIFIED / IMPLEMENTED / PARTIAL / BLOCKED / DEFERRED, with evidence).

**Security (Stage 2)**: provider API keys are now encrypted at rest when `PRIVACY_ENCRYPTION_KEY` is set (AES-256-GCM, bound to user and model, Supabase mirror copy too), with tolerant reads, key rotation
(`PRIVACY_ENCRYPTION_KEY_PREVIOUS`), an explicit snapshot-first migration (`SECRETS_MIGRATE=encrypt|rotate`) that also removes residue from the WAL and free pages, secure delete and `preflight` checks.
Found and fixed while building it: a server started without the key wrote "no key" over sealed keys (an empty key can no longer overwrite a stored one), and preflight accepted vault keys the vault refused.
Evidence: 9 unit tests (plus a mutation check), 2 preflight tests, a 20-check end-to-end run on the production build. Details: SECURITY.md "Provider API keys at rest", DEPLOY.md.

**Dashboards from the reference images, built on real data and in this site's own design**
| Image | Where | Data |
|---|---|---|
| AI workflow orchestration (agent pool, throughput / efficiency / error / output charts) | **Agent workflow** (`#/agents`) | the agent's real tools as a node map with calls and failures per tool; runs per day, success rate, failed runs, average duration. Runs are recorded when they finish (new table `agent_runs`: times, steps, model, tool names and outcomes; **no goal or tool output is stored**) |
| Token Use (per-tool cards with sparkline, calls, tokens, seen, spend) | **Models** section of **Usage** | calls, last used and daily series are counted; tokens are **estimated** (characters / 4) and labelled ESTIMATED; a cost appears only if you type a price per 1M tokens (kept in the browser) |
| Quanta / Cloud Operative (infrastructure overview, alerts, vitals) | **System status** (`#/system`) | readiness checks (names and ok / fail only), process memory and uptime, key-encryption state, and a map of your own workspace (chats, Copilot, agent, models, projects, library, database, storage). Alerts are derived from those facts and your account. Scoped to the signed-in user: no host details, paths or other users' counts |
| MindLink (greeting, focus chips, ask box, recent conversations with filters) | **Overview** | greeting, focus chips and an ask box that opens a new chat and sends the question; Recent / Pinned tabs (keyboard arrows) |

New code: `server/insights.ts`, `server/insights-routes.ts`, `server/security/secret-store.ts`, `web/js/lib/viz.js` (area charts and node graphs in inline SVG), `web/js/lib/model-usage.js`, `web/js/pages/agents.js`, `web/js/pages/system.js`, `web/css/insights.css`; changed: `home.js`, `usage.js`, `app.js`, `nav.js`, `sidebar.js`, `main.jsx`, `server/db.ts`, `server/supabase.ts`, `server/server.ts`, `server/agent/routes.ts`, `server/security/vault.ts`, `scripts/preflight.mjs`.
Evidence: 6 + 9 + 2 unit tests, a smoke check (auth, isolation, no secrets or paths, goal text never stored), a 54-check browser suite (APIs with two users, graph labels, charts' text alternatives, price estimate, keyboard tabs, ask-to-chat, mobile overflow on four pages), accessibility audit 0 findings over 17 routes.
Found and fixed on the way: a time-zone bug in my first window arithmetic (local midnight mixed with UTC day keys would have dropped today's data east of UTC; now UTC throughout, tested in three zones) and overlapping tool labels in the agent map.
**Not done / limits**: the images' exact visuals (isometric platforms, hex clusters) are re-expressed as flat glowing pads in this site's tokens; agent statistics start from this release (earlier runs were never recorded); tokens are estimates; no cost without a user-entered price; memory, prompt studio, agent approvals and the other deferred parts are listed in MASTER-DIRECTIVE-STATUS.md.

## Task 9.1: AI memory management (completed)

A user-controlled memory: short notes the user chose to keep, used in chats only when relevant. **Nothing is ever stored automatically**: notes come from the Memory page, from "Remember this" on one of your own messages (an editable dialog; nothing is saved until you confirm) or from an import.

| Requirement | How it is met |
|---|---|
| Create, view, edit, delete | `#/memory` page and `/api/memory` (GET, POST, PATCH, DELETE; delete-all needs `?confirm=all` and a confirmation dialog) |
| Disable and re-enable | one master switch (`PUT /api/memory/settings`, a real `role="switch"`, works with Space) plus **Pause / Resume** per note; turning it off keeps the notes and sends nothing, not even "always use" notes |
| Categories | preference, about me, project, writing style, other; filter chips and search; "Always use" flag |
| No cross-user access | every query is scoped to the owner, another user's id answers `404`; export, preview, delete-all and retrieval are scoped too |
| Retrieval in chats | the main chat (via `AgentRuntime`) and Regenerate add a quoted **USER MEMORY** block to the system instruction: only enabled notes that share meaningful words with the question (or are "always"), at most 5 and 1,200 characters; the reply shows **"Used N memories"** with the notes and a link to manage them |
| No duplicates, no irrelevant notes | same text after normalising or about 80% the same words is refused (`409 DUPLICATE` pointing at the original); 3-500 characters; text with no meaningful words refused; irrelevant notes are simply not sent |
| Privacy | notes that look like passwords, keys, tokens or e-mail addresses are refused; notes are framed as data that never overrides the assistant's rules, and delimiter look-alikes and newlines are stripped; included in the privacy export; erased with the account (the erase also covers the agent-run statistics, which it had missed); a "What would be used?" preview sends nothing |
| Limits | 200 notes per user, 100 per import |

Evidence: 10 unit tests (three guards proven by mutation: master switch, ownership filter, secret check), a smoke check (ownership, duplicates, secrets, switch, privacy export, erase removes the rows from the database file), and a 63-check end-to-end run on the production build that includes **what the model provider actually receives**: the relevant note is in the system prompt, an irrelevant one is not, an "always" note is sent with any question, paused and switched-off notes are not, user B's chat never contains A's notes and uses B's own provider key, Regenerate uses memory, a deleted note is gone from the next prompt, plus the Memory page and the chat dialog in a browser (mobile layout, keyboard, accessible names).
Files - new: `server/memory.ts`, `server/memory-routes.ts`, `web/js/pages/memory.js`, `tests/memory.test.ts`; modified: `server/server.ts`, `server/agent-runtime.ts`, `server/security/user-data.ts`, `web/js/ui/chat.js`, `web/js/ui/sidebar.js`, `web/js/app.js`, `web/js/data/nav.js`, `web/src/main.jsx`, `web/css/insights.css`, `scripts/smoke.mjs`.
Limits: retrieval is word overlap, not semantic search (a note phrased with different words than the question is not found unless marked "Always use"); the selected-code fast path and the Studio generators do not receive memory; the "used" list is shown for the current session only (it is not stored with the message).

## Task 9.2: Prompt Engineering Studio (completed)

`#/prompts` ("Prompt Studio", under Create): a personal prompt library with variables, version history, templates, test runs and variation comparison.

| Requirement | How it is met |
|---|---|
| Editor, save and edit | title, category, tags, description and a monospace body with a live character count and live variable detection; "Save as version N" with an optional "what changed?" note; an in-place "Unsaved changes" badge and a discard confirmation |
| Templates and categories | 11 built-in read-only templates in 6 categories (writing, coding, analysis, learning, business, creative); "Use" loads a template as an **unsaved draft**; every template is unit-tested to parse, render and be storable |
| Variables and placeholders | `{{name}}` and `{{name\|default}}`; the Test panel builds a field per variable (following edits as you type); a missing value with no default is refused with the list of missing names, **before any model is called**; values are inserted as text and never re-expanded |
| Version history | every change to title or body is a numbered version (last 50 kept); History shows a line diff against the current text; Restore adds a **new** version (history is never rewritten) |
| Test against models | Run on 1-3 of your enabled models (your own keys), per-model results with latency and errors, Cancel, and a browser disconnect aborts every upstream request; "Use in chat" sends the filled-in prompt into a new chat |
| Compare variations | 2-3 labelled variations of the prompt on one model, results matched back by label; unnamed ones are lettered |
| Import and export | `darkness-prompts` JSON (also a plain list); validated row by row, duplicates and bad rows are reported, never half-saved; 100 per import |
| Search and organisation | text search (wildcards literal), category chips, tags, favourites first |
| Safety | prompts that contain credentials (API keys, tokens) are refused (e-mail addresses are fine); 20,000 characters per prompt, 500 per user; a test prompt is bounded to 8,000 characters after filling; one test at a time and 6 per minute per user; another user's prompt or model reads as 404; the privacy export includes prompts and the account erase removes them and their versions |

Evidence: 13 unit tests (variables, validation, versions including the 50-version cap, ownership, search, import/export, every template, and the HTTP routes with a stand-in provider: guards, the per-user limits, a disconnect aborting both model calls), a smoke check through the real provider layer (a rejected key echoed back by the provider never reaches the response), and a 56-check end-to-end run on the production build that includes **what the provider receives** (the filled-in prompt, each model's own key) and the page in Chrome: templates, live variables with focus kept while typing, save and versions, diff and restore, test runs on two models, a missing variable, variation comparison, Cancel closing the upstream request, favourites / category / search, delete with confirmation, "Use in chat", import through the page, mobile layout and accessible names.
Generalised on the way: the Compare page's runner is now `runJobs` (one model and one prompt per job); `runComparison` is a thin wrapper and its 16 tests still pass.
**Bugs found by the browser test and fixed**: a debounced repaint refocused the search field with the caret at the start, so typing after a pause scrambled the text (the same bug existed on the Memory page; both fixed and tested).
Files - new: `server/prompts.ts`, `server/prompts-routes.ts`, `web/js/pages/prompts.js`, `tests/prompts.test.ts`; modified: `server/model-compare.ts`, `server/server.ts`, `server/security/user-data.ts`, `web/js/pages/memory.js`, `web/js/ui/sidebar.js`, `web/js/app.js`, `web/js/data/nav.js`, `web/src/main.jsx`, `web/css/insights.css`, `scripts/smoke.mjs`.
Limits: no sharing or team libraries; no token or cost figures for test runs (providers' counts are not recorded); the diff is line-based; templates are in English.

## Task 9.3: Agent approvals and checkpoints (completed)

The agent (`/agent.html`, `/api/agent/*`) now runs as a durable **session**: planned, checkpointed after every step, pausable, resumable, cancellable, auditable, and gated by explicit approvals. The old stateless `POST /api/agent/run` is unchanged and read-only (it cannot even select the new write tool).

| Requirement | How it is met |
|---|---|
| Execution planning, task breakdown | optional first model call returns 2-6 tasks (shown as a checklist; it authorises nothing); the plan is added to the instructions and a bad plan never blocks the run |
| Execution progress | the agent reports finished tasks with `"done":[n]`; shown with a progress bar and labelled **as reported, not independently verified**; per-step events stream live |
| Approval requests | **`remember`** is the first tool that changes saved data (it saves one note to the user's memory, through the memory rules). Any tool with risk `write` stops the loop **before** it runs, the session becomes `waiting_approval` and stores the exact call; the page shows the tool, the reason and the arguments; **Approve** or **Deny** (the agent is told and carries on). Strict mode asks before every tool call. Approval ids are checked (a stale or replayed approval is refused) |
| Pause and resume | Pause stops at the next step boundary; closing the tab pauses (nothing is lost, nothing runs unseen); Resume continues from the checkpoint with the step counter and earlier observations intact |
| Cancellation | Stop ends a running, paused or waiting run; a waiting action is never executed after cancel; the upstream model request is closed |
| Checkpoint persistence | the conversation, loop counters, plan and pending call are written to SQLite after every step; a run that was "running" when the server stopped comes back as **failed (interrupted)** with its checkpoint and can be resumed (verified through a real restart) |
| Failure recovery | provider failures keep the checkpoint; Resume retries from it, up to 3 failures, then the run is final; errors are scrubbed of keys |
| Tool permission checks | per-run allowed tools (unknown names dropped), argument validation before any tool runs, a risk level per tool, a **mandatory approval gate inside the loop** (core.ts) that no request field, mode value or model output can switch off; without a way to ask (a caller with no persistence) a write tool is refused instead of run; step budget capped at 12; two runs at a time per user |
| Execution history | `GET /api/agent/sessions` and a timeline per run (created, model, plan, every tool call and result, approvals, decisions, pause, resume, errors); tool **outputs are not stored** (only success and length), arguments are redacted and bounded, 600 entries per run; runs are kept 30 days, deletable any time, in the privacy export and erased with the account (the erase now also covers `agent_runs`, `agent_sessions` and `agent_events`) |

Evidence: 22 unit tests (policy, argument validation, plan, approval before execution, deny, **no-bypass** cases including a model that claims approval and a request with `approvals: "off"`, strict mode, checkpoint-and-resume equivalence with the uninterrupted run, the session state machine, restart recovery, retention, route flows with a scripted model: approve/deny, pause/resume, tab close, cancel, failure recovery and the retry limit, ownership, limits). Mutation checks: removing the write gate fails 8 tests, removing the owner filter fails 4. A smoke check (a stand-in agent model: the note is not saved until approved, even with `approvals: "off"`; Bob cannot approve; replay refused; audit trail; privacy export; the stateless run cannot save). A 45-check browser and server run on the production build, including **a real server restart in the middle of a run** and the `/agent.html` page: approval card with focus, plan list and progress bar, deny, leaving the page and coming back to a waiting run, strict mode, pause / resume / stop, history, timeline, delete, another user's empty history, mobile layout (a 23 px overflow it found is fixed), accessible names.
Fixed on the way: the final step's progress report was not saved (the `done` list is now saved as it is reported).
Sandboxing review: the agent has no shell, filesystem or code-execution tool; network tools go through the SSRF guard (`safe-fetch.ts`); the user-command run engine stays off unless `ENABLE_RUN_ENGINE=true`; nothing the agent does can inherit server permissions because no such tool exists.
Files - new: `server/agent/policy.ts`, `server/agent/sessions.ts`, `server/agent/session-routes.ts`, `tests/agent-sessions.test.ts`; modified: `server/agent/core.ts`, `server/agent/tools.ts`, `server/agent/routes.ts`, `server/memory.ts`, `server/server.ts`, `server/security/user-data.ts`, `web/public/agent.html`, `web/public/agent-page.js`, `web/public/agent-page.css`, `scripts/smoke.mjs`.
Limits: `remember` is the only write tool (no tool deletes data, sends messages or changes settings, because none exists; any future one inherits the gate by declaring risk `write`); resuming after a failure repeats the model call that failed, so a provider is billed for it; progress is as reported by the model; a paused run holds its goal and conversation in the database until deleted or 30 days old.

## Task 9.4: Authentication and authorization, remaining items (account recovery completed; roles evaluated and declined)

**Investigation.** Sign-up, sign-in (scrypt, lockout, no enumeration), cookie sessions, password change and sign-out-everywhere already existed. Missing: password reset / account recovery. There was no way back into an account after a forgotten password, and no operator tool at all.

| Requirement | Outcome |
|---|---|
| Password reset / account recovery | **Built.** `server/recovery.ts` (tokens, limiter, additive `users.disabled_at` migration), `server/recovery-routes.ts` (`GET /api/auth/recovery`, `POST /api/auth/forgot`, `POST /api/auth/reset`), `web/public/reset.html` (+ `reset-page.js`, `reset-page.css`, no inline script) and a "Forgot password?" link on the sign-in screen. Details and threat model: SECURITY.md "Account recovery and operator access" |
| E-mail provider through configuration, no pretending | `server/mailer.ts`: `MAIL_PROVIDER=smtp` (own dependency-free client: STARTTLS or implicit TLS with certificate verification, AUTH PLAIN, dot-stuffing, header-injection refusal, timeouts) or `resend` (HTTPS API). Missing or incomplete settings mean "not configured": the server answers **501** and the page says reset by e-mail is unavailable. `npm run preflight` names missing settings without printing values. **Delivery to a real mailbox is BLOCKED here (no credentials)** and is not claimed: the SMTP client was exercised against a local fake server (plain, STARTTLS and implicit TLS with a throw-away certificate generated at test time), Resend against a fake `fetch`. Steps to verify with a real provider: `docs/OPERATIONS-VERIFICATION.md` |
| Are roles / admin permissions necessary? | **No, and none were added.** Nothing in the product acts on another user's data or needs elevated rights; every route is already owner-scoped, and the route sweep found no admin-only routes. An in-app admin would be new privilege-escalation surface. The operator actions that are genuinely needed (issue a one-time reset link, revoke sessions, disable / enable an account, list accounts masked) are in `scripts/admin.mjs`, which needs host access to the database file: the same trust boundary that already protects the database and the environment. A future multi-tenant or team product would need roles; that would be a design of its own |
| Secure migrations | one additive, idempotent column (`users.disabled_at`) and one new table (`password_resets`), created at boot and by the CLI if missing; nothing is rewritten; the Docker image ships `scripts/admin.mjs` |
| No arbitrary administrator access | no new privileged HTTP route, no role column, no default or hidden account; the CLI cannot be reached over HTTP and prints no password hashes or full addresses |

Evidence: 16 unit tests (`tests/recovery.test.ts`: token hashing / single use / expiry / supersession and a concurrency case, the migration, the limiter, the full mail-config matrix, address and header injection, the Resend request and key hygiene, a real SMTP conversation including dot-stuffing and non-ASCII subjects, refusals / timeouts / "STARTTLS not offered so no credentials are sent", real STARTTLS and implicit TLS, identical answers for known and unknown addresses, mail only for real accounts, 501, per-address and per-IP limits, a mail failure not visible to the caller, all sessions revoked and lockout cleared, a weak password not burning the token, disabled accounts, the CLI's token accepted by the server's code) plus 1 preflight test. A smoke check on the production build drives the real CLI against the real server: 501 without mail, a one-time link, weak password refused without spending the link, reset signs out two sessions, old password dead, link single-use, only a hash stored, disable / enable through the CLI (403 `ACCOUNT_DISABLED`), masked listing, `reset.html` free of inline script, and the account's erase leaves no token rows. A 25-check browser run (Chrome, production build, a fake SMTP server): gate link, request form, bad address, unknown vs known address look identical and only the known one gets mail, the mail's link carries the token in the fragment, the fragment is removed from the address bar, weak / mismatched passwords, show-passwords, success, the old session and password are dead, the change notice is mailed, a used link and a made-up token get the same message, 360 px layout (no overflow, 44 px targets), the "not set up" page on a server without mail, no console or CSP errors.
**Bugs found by these checks and fixed:** the SMTP sender threw synchronously on a bad address instead of rejecting (a caller's `await` would have thrown out of its own `try` scope); account erase did not remove `password_resets` rows (now it does, with a smoke assertion); the forgot-password link was missing from the built sign-in screen until the browser run showed it.
Files - new: `server/recovery.ts`, `server/recovery-routes.ts`, `server/mailer.ts`, `scripts/admin.mjs`, `web/public/reset.html`, `web/public/reset-page.js`, `web/public/reset-page.css`, `tests/recovery.test.ts`; modified: `server/server.ts`, `server/security/user-data.ts`, `web/js/ui/auth-gate.js`, `web/css/auth-gate.css`, `scripts/preflight.mjs`, `scripts/smoke.mjs`, `tests/preflight.test.ts`, `Dockerfile`, `package.json`, `.env.example`, `DEPLOY.md`, `SECURITY.md`, `README.md`, `docs/ARCHITECTURE.md`.
Limits: real mail delivery unverified (and spam-folder / SPF / DKIM behaviour of the operator's domain is outside the app); recovery by e-mail is only as safe as the mailbox; the reset limiter is in memory (one instance); the SMTP client implements only what a transactional message needs (AUTH PLAIN, no OAuth, no attachments, no connection reuse); no "remember me" or idle timeout (sessions stay a fixed 30 days).

## Task 9.5: Infrastructure and provider verification (documented and drilled locally; live verification BLOCKED)

New: [docs/OPERATIONS-VERIFICATION.md](OPERATIONS-VERIFICATION.md). It has the production environment checklist, real model-provider and real mail-provider test procedures, backup and restore verification, the multi-instance limitations report, the secure environment-variable checklist and rollback instructions for Render, Vercel and Docker. It states at the top, and again at the end, that **nothing was run against a live host, provider, mail service or domain** (no access exists here), and its checkboxes are for the operator to tick.

What was actually run (the only live-like evidence): a backup / restore drill on the production build with a real server: backup taken while the server runs, verify, a one-byte-flipped copy detected and refused, restore refused without `--yes`, a real restore with the server stopped, restart on the restored data, the old account and session valid, post-backup data gone, the replaced data kept aside: 14 / 14.
**Real defect found and fixed:** `scripts/backup.mjs restore` with `DARKNESS_DB_PATH` outside the storage root left the old database's `-wal` / `-shm` files beside the restored file (SQLite would replay them onto it). It now moves the old file and its log aside (`external-db/`), with a regression test that failed before the fix.
Multi-instance report (from reading the code): the app must run as one instance (SQLite on one disk; in-memory copies of users, models, conversations, messages, files and projects; in-process rate limits, lockouts and concurrency guards; in-process job state); the report lists each item, the consequence of two instances, and what a scale-out would need (none of it exists).
Also added: `preflight` checks the mail settings (names only); rollback hazard documented (after `SECRETS_MIGRATE=encrypt`, a build older than the vault would read sealed keys as plain keys); `restore` against a scratch root must run with `DARKNESS_DB_PATH` unset (documented, because the variable wins over `--root`).
Files - new: `docs/OPERATIONS-VERIFICATION.md`; modified: `scripts/backup.mjs`, `tests/backup.test.ts`, `DEPLOY.md`.
Limits: every live-verification box in the document is unticked; the restore was not run on a real Render disk or Docker volume; rollback steps for Render, Vercel and Docker come from their documentation and the repository's scripts, not from trying them.

## Task 10: Final engineering review and release preparation (completed locally; classification READY FOR STAGING)

**Method.** Independent re-inspection of the code instead of trusting earlier records: git status (185 entries, one intentional deletion, no secrets: a tree-wide pattern scan found only the allow-listed fakes), then **two-account probes of every id-taking route family**, with *writes and deletes*, not only reads (the earlier route sweep only read, and only with real ids).

**Authorisation defects found and fixed (SECURITY.md #55-#58)** - each was reproduced against the running server before the fix and re-run after:
- **#55 High - shared files**: any signed-in user could list others' files with their content, read a file by id, and delete it.
- **#56 High - Architecture Advisor**: an unknown project id acted on the *first project on the server*; the fix helper also edited *any user's file with a matching name*.
- **#57 High - knowledge base**: `clear-all` ran an unscoped `DELETE FROM knowledge_chunks` / `knowledge_sources` (one request took another user's documents from 1 to 0); the document delete took any project id; the knowledge Q&A wrote into any conversation id.
- **#58 Medium - structural**: the id guards only knew records in memory; chat trusted client-chosen file and project ids; array-valued ids were coerced into ids. One shared module (`server/ownership.ts`: memory, then the database) now serves the guards, the agent runtime and the file and knowledge routes. The prompt-level effect on the chat route could not be observed end to end (UNVERIFIED, stated in SECURITY.md and RELEASE-READINESS.md).
- Also: restore revived sessions and used reset tokens (it now invalidates all of them and reports the count); a restore left the old WAL beside an external database; the account erase missed reset tokens.

**Checked and found sound (VERIFIED):** memories, prompts, conversations (all mutations), Copilot conversations, project files / analysis / RAG / export routes with a real project id (all `404` for another user), models (another user's model is untouched, proven from the database), builder jobs (owner-checked), the `/api/runs` routes (inert stubs), account erase (every table emptied, old token `401`), password reset (single use, expiry, all sessions revoked), agent approvals (cannot be bypassed), secrets (no key in any response, log or frontend bundle in the tests).

**Database (VERIFIED on a fresh database):** `integrity_check` ok, foreign keys enforced and 0 violations, WAL, `secure_delete` on, every user-scoped table indexed except `agent_events` and `prompt_versions` (used only by erase paths, small tables); user-owned tables have no foreign key to `users`, so erasure relies on explicit deletes (tested). Backups contain accounts and (unless the vault key is set) provider keys: treated as confidential in the docs.

**Tests, honestly:** 349 unit tests (this round added 5 for ownership, 2 for restore, 1 for mail preflight and the 16-test recovery suite; one flaky test was strengthened), smoke 94, a clean room on Node 22 and 24, 23 browser suites and probes (20 passed outright, 3 investigated and resolved: a test-timing defect in the auth-gate suite, the known 100 MB JSON limit, a probe false positive). One flaky unit test (`model-compare`, a wall-clock bound that could not even tell parallel from sequential) was replaced by a concurrency count. An earlier mistake of mine is recorded here too: three one-off patch scripts were run as tests, which duplicated the Memory wiring in five source files; it was reverted and the tree re-verified.

**Not done / not verifiable here:** real model providers, real mail, Render / Vercel / Aiven / Docker / a real domain, GitHub Actions, load and capacity, external penetration test. The JSON body limit (global 100 MB) was left alone on purpose: the right fix is a small default with large limits on named heavy routes, which cannot be enumerated safely by testing.
Files - new: `server/ownership.ts`, `tests/ownership.test.ts`, `docs/ENVIRONMENT-VARIABLES.md`, `docs/COMMIT-PLAN.md`; modified: `server/server.ts`, `server/project-routes.ts`, `server/rag-routes.ts`, `server/agent-runtime.ts`, `scripts/backup.mjs`, `scripts/smoke.mjs`, `tests/backup.test.ts`, `tests/model-compare.test.ts`, `render.yaml` (comments only), `DEPLOY.md`, `SECURITY.md`, `docs/OPERATIONS-VERIFICATION.md`, `docs/RELEASE-READINESS.md`, `docs/MASTER-DIRECTIVE-STATUS.md`.

## Task 11: Pre-commit hardening (independent authorization audit, request-size limits, prompt-level verification)

**1. Authorization audit of every state-changing route** ([AUTHORIZATION-AUDIT.md](AUTHORIZATION-AUDIT.md)). A route-dump hook records every registration from the running server (266, of which **151 state-changing**, 13 of them the original app's); `scripts/authz-audit.mjs` (`npm run authz`, also a CI step) seeds an owner, an attacker and a bystander with data in every family (some records written straight into the database so the server never loaded them), attacks every route as the attacker with the owner's real ids, database-only ids, unknown ids and *no ids at all*, and compares the owner's and bystander's rows after **every request** (plus responses, upstream provider keys, and a final state check after the attacker erases his own account). Final result: 145 routes attacked (499 requests), 6 public by design, **0 violations**, in two consecutive runs. **Two mutation tests** (file-delete ownership removed; knowledge `clear-all` unscoped) made it fail with 8 violations, and the first version *missed* the knowledge wipe (it always sent the owner's ids), which is why the "no ids at all" attack exists.
Confirmed and fixed: **#59 (High, privacy)** provider keys were stored a second time under a shared owner and survived model deletion and account erase (one row now, boot purge of old copies in strict mode, unit and smoke tests; backups made earlier still contain them); **#60** `analyze` / `analysis` created data for non-existent project ids; **#62 (High, availability)** any signed-in user could change the server-wide storage limit, wipe the shared cache and read the storage path (now `403 OPERATOR_ONLY` in strict mode; found by hand because it changes no row). Hand review of the non-method handlers is in the audit document, including the preview proxy (blocked unless the run engine is enabled, which is only for private single-user instances).

**2. JSON body limits (#61).** One 100 MB limit on every route is replaced by three tiers (`server/body-limits.ts`): 1 MB default; 25 MB for requests that go to a model (pasted documents, base64 images); 100 MB only for the 13 routes that carry file or export content. An early guard answers `413 PAYLOAD_TOO_LARGE` naming that route's limit from the `Content-Length` header or as soon as a chunked body passes it, discards the rest for at most 2 seconds, then closes (an immediate close made the client lose the 413: found by a smoke check). Multipart uploads are unaffected (uploads suite 12 / 12). Operators can tune a tier (`JSON_LIMIT_*_MB`). 10 unit tests (normal, exactly the maximum, one byte over, announced-oversize before the body is sent, chunked, malformed JSON, per-tier, forms, environment overrides) and a smoke check against the real server. The header probe's 30 MB case now passes (36 / 36).

**3. Prompt-level protection verified (#58).** `tests/agent-runtime-authz.test.ts` runs the real `AgentRuntime.execute` against a stand-in provider that records the request body: the owner's own file and project code reach the model (control), another user's never do. With both ownership checks removed the tests fail, i.e. before the fix another user's file and project code **did** reach the model's prompt. (The earlier "cannot observe it" result was an artefact: the reply stream filter can alter echoed text; the request is what counts.)

**4. Quality gates on the final tree.** `npm run verify`: 363 / 363 unit tests, 0 lint errors at the 1,033-warning budget, typecheck 0 errors, 92 modules / 0 import cycles, build ok; smoke 97 / 97; `npm audit` 0. Browser suites and probes: see RELEASE-READINESS.md for the exact table. Test defects fixed along the way (assertions unchanged, only waiting for the real condition): the auth-gate lock-out step and two steps of the project-page suite used fixed delays that failed on a busy machine (5 / 5 stable runs after the fix); `model-compare`'s timing assertion was replaced earlier by a concurrency count.
Files - new: `server/body-limits.ts`, `scripts/authz-audit.mjs`, `scripts/route-dump-hook.mjs`, `tests/body-limits.test.ts`, `tests/agent-runtime-authz.test.ts`, `docs/AUTHORIZATION-AUDIT.md`; modified: `server/server.ts`, `server/db.ts`, `server/project-routes.ts`, `server/rag-routes.ts`, `server/agent-runtime.ts`, `server/ownership.ts`, `scripts/smoke.mjs`, `tests/ownership.test.ts`, `package.json`, `.github/workflows/darkness-ai-ci.yml`, `.env.example`, `README.md`, `DEPLOY.md`, `SECURITY.md`, `docs/ENVIRONMENT-VARIABLES.md`, `docs/OPERATIONS-VERIFICATION.md`, `docs/RELEASE-READINESS.md`, `docs/MASTER-DIRECTIVE-STATUS.md`, `docs/COMMIT-PLAN.md`.
Limits: the audit judges behaviour (rows and responses), not harm that touches no row; real providers, real mail and every real platform remain unverified; the 100 MB tier still exists on 13 routes; no load test.

## Task 12: P1-03 safe boot migrations (6 Nov 2026, authorised during the Phase 1 review)

**Problem.** The boot migration that gives old tables a `user_id` (and `models` its composite primary key) lost data. Two proven defects (SECURITY.md #63, #64): a failed copy made the `projects` handler drop the renamed original, and even a successful copy deleted every child row through an implicit cascade and left the children pointing at `*_old` tables. Neither defect touches a fresh database or one already on the current schema.

**All migration paths inspected (`server/db.ts`, before the change):** `projects` (rename, create, copy, drop; the handler dropped the original), `conversations` and `workspace_files` (same procedure; handlers only logged; children's foreign keys rewritten, cascade on drop), `models` (`INSERT OR IGNORE` copy, `DROP TABLE models`, empty `catch`), the project-files de-duplication (`DELETE ... rowid NOT IN (MIN(rowid))` on every start with an empty `catch`), the legacy user-id remap (six independent `UPDATE OR IGNORE`s each in an empty `catch`, so a failure left some tables remapped and others not) and the seed (errors logged as a "notice"). The runtime helpers `ensureUserExists` / `ensureProjectExists` / `ensureConversationExists` are not migrations and were left alone.

**Change.** New `server/db-migrations.ts` (data layer; registered in `scripts/check-architecture.mjs`): version guard, read-only planning that refuses unexpected shapes, a verified snapshot, and one atomic rebuild transaction with foreign keys off (details in the module header). `initDatabaseSchema(conn, options)` in `db.ts` now runs that first, then the additive work in one transaction that also stamps `PRAGMA user_version = 1`. The de-duplication runs once (only while the unique index is missing, after a snapshot when duplicates exist, logged with a count); the remap is a SAVEPOINT per mapping; the seed rethrows; the `models` `ADD COLUMN` is guarded by a column check instead of a blanket `catch`. `runTransaction` takes an optional connection.

**Compatibility.** `PRAGMA user_version`: 0 = never stamped (any older database), 1 = stamped by this code after a complete initialisation. Older builds ignore the field, so rolling the code back is safe. A database stamped with a HIGHER number than the build knows is refused at start-up (`DARKNESS_ALLOW_NEWER_SCHEMA=true` overrides); the version is a marker and guard, not the source of truth: structural steps are still decided by table shape, so a repeated start finds nothing to do. Legacy `user_default` rows end up owned by the default UUID owner exactly as before (the existing remap). A legacy table with a column this build does not know, or lacking a required one, is refused instead of copied with data loss: an operator must look at it.

**Limits.** Each of the two stages is atomic; the first stage's result is a valid current-shape schema, so a failure in the second stage is retried on the next start rather than undone. Legacy UNIQUE constraints that exist only as automatic indexes are not carried over (the current table definitions define the constraints). `VACUUM INTO` needs free disk about the size of the database. The legacy shapes used by the tests are derived from the migration's own column lists: no earlier schema definition exists in the git history (the first committed `db.ts` already contained the migration).

**Tests.** `tests/db-migration.test.ts` (18): every legacy table with children and foreign keys; the shape of rebuilt tables equals freshly created ones; models with and without `user_id`; current schema no-op; repeated starts; empty tables; missing optional columns; refusal of missing required / unknown / dependent-view / leftover-table shapes with the database untouched; a copy that fails; a rebuild that fails part-way; a failure before COMMIT; a process killed mid-rebuild; snapshot content and snapshot failure; newer-version refusal and no stamp after a failed start; de-duplication; the atomic remap; and a real child process that must refuse to start on an unmigratable database and start on a good one. Mutation checks: with foreign keys left on, without ROLLBACK, or without the snapshot, 6, 4 and 4 tests fail.

**Compatibility review (6 Nov 2026, read-only probes in temporary folders; no code change).**

| Question | Evidence | Severity | Needed before staging? |
|---|---|---|---|
| Legacy constraints that exist only as automatic indexes | Probe: a legacy `conversations` table with `UNIQUE(title)` and a `CHECK` rebuilt with all rows kept and the explicitly created index preserved, but the UNIQUE and the CHECK were **dropped** (a duplicate title was accepted afterwards). The current table definitions have no UNIQUE or CHECK on these four tables and no committed schema ever had one, so nothing in the application depends on them | LOW (a constraint is lost, no row is) | No. Documented. Optional follow-up if ever wanted: log (or refuse on) a legacy UNIQUE / CHECK that the current table does not define |
| Stage 2 retried instead of rolled back | Probe: legacy database plus an unexpected `users` table that makes the seed fail. After the failure: `projects` already rebuilt with every row, `user_version` 0, exactly one snapshot, no temporary table, `foreign_key_check` clean, and the process refused to start. After the cause was removed the next start completed (version 1, rows intact) and wrote no second snapshot. The intermediate shape is the current shape, which older builds also read | LOW | No. Documented |
| Historical schemas | Databases created by the code of four committed versions (`63bd1c7`, `834f50b`, `b4ff62c`, and `46223be` = `main`), each with sample rows in projects, project_files, conversations, messages, workspace_files, models, users, sessions, opened with the current code: 4 of 4 start, every row preserved, the six core table definitions unchanged, no rebuild and no snapshot (already current shape), `user_version` stamped 1, `foreign_key_check` clean, `integrity_check` ok. The oldest commit (`8c38256`) could not be generated in the harness (its own code did not create a database there), so it is **not tested**. The shapes from before `user_id` existed are not in the git history (the first committed `db.ts` already contained the migration); they are known only from the migration's column lists, and the tests cover missing optional columns (migrated) and missing required or unknown columns (refused, data untouched) | LOW to MEDIUM for a database older than the repository history; none known to exist | No. Any such database must be backed up first and a copy opened on a scratch root before real use |
| Foreign keys and dependent tables | Eleven tables reference `projects(id)` and one references `conversations(id)`, all `ON DELETE CASCADE` (`db.ts`); nothing references `workspace_files` or `models`; no module outside `db.ts` creates a table that references the four rebuilt tables; the code defines no triggers or views. Because foreign keys are off during the rebuild and the new table is renamed over the old one, children keep pointing at the original names. The tests check two projects children and the messages child; the other projects children follow the same mechanism and were not each tested | LOW | No |

None of the four needs a fix before staging, because staging starts from a fresh database. Not tested: a very large database (snapshot time and disk use), and the `DARKNESS_DB_PATH` case where the database lives outside the storage root (the snapshot still goes to `<storage root>/backups`).

## Real bugs found by the new checks (and fixed)

(Project-page bugs are listed in their own section above.)

- Agent document/image steps called functions that were never imported (silent `ReferenceError` inside `try`).
- RAG "delete knowledge" and the artifact lookup in `server.ts` had the same missing-import problem.
- Disabling a model never persisted (`enabled = 0` read back as enabled).
- Files-tab upload called a helper defined in another scope.
- `activeMessage` was never declared in `chat.js` (threw on every outside tap on mobile).
- The auth gate ran before `cookieParser`, so the HttpOnly cookie never authenticated an API call; the app only worked
  through the `localStorage` copy of the token.
- The closed Copilot drawer bled its shadow into the right edge in light mode.
- **Path traversal in the chunked ZIP upload route**: the temp path was built from the client's `uploadId` in the shared system temp folder; parts of abandoned uploads were never removed and users could overwrite each other's parts.

## Known issues still open

- Cross-tab sign-out race in the web app (see SECURITY.md, Known limitations); one browser check for it is timing-sensitive.
- Provider API keys are plaintext in SQLite (and in backups); a 100 MB JSON body limit applies to every JSON route; in-memory limits assume one instance; nothing has run on GitHub or a live host. The full list is in `docs/RELEASE-READINESS.md`.
- `tsconfig.json` is non-strict; "0 errors" is relative to that. A `strict` migration is a separate, larger change.

## Management pages (earlier in this effort)

Grouped sidebar; Overview, Usage, Account, Models and Settings pages (`web/js/pages/`, `web/css/manage.css`,
`web/js/lib/manage.js`); `/api/usage` and `/api/account*` (`server/account/routes.ts`); modern animated sign-in
(`web/js/ui/auth-gate.js`, `server/security/login-guard.ts`).

## Files changed (from `git status`)

```
modified  .env.example
modified  .github/workflows/darkness-ai-ci.yml
modified  DEPLOY.md
modified  README.md
modified  SECURITY.md
modified  package-lock.json
modified  package.json
modified  render.yaml
modified  scripts/smoke.mjs
modified  server/agent-runtime.ts
modified  server/agent/providers.ts
modified  server/classic/legacy-api.ts
modified  server/db.ts
modified  server/documents/routes.ts
modified  server/gemini-resilience.ts
modified  server/image-service.ts
modified  server/project-analyzer.ts
modified  server/project-routes.ts
modified  server/rag-routes.ts
modified  server/run-engine.ts
modified  server/security/privacy.ts
modified  server/server.ts
modified  server/supabase.ts
modified  server/upload-config.ts
modified  web/index.html
modified  web/js/app.js
modified  web/js/data/nav.js
modified  web/js/lib/markdown.js
modified  web/js/pages/home.js
modified  web/js/pages/model.js
modified  web/js/pages/project.js
modified  web/js/pages/settings.js
modified  web/js/services/api.js
modified  web/js/services/auth.js
modified  web/js/ui/chat.js
modified  web/js/ui/sidebar.js
modified  web/js/ui/visual-learning.js
modified  web/public/agent.html
modified  web/public/copilot-launcher.js
modified  web/public/copilot.html
modified  web/src/main.jsx
new       docs/
new       eslint.config.js
new       server/account/
new       server/observability/
new       server/provider-http.ts
new       server/security/csrf.ts
new       server/security/login-guard.ts
new       server/upload-chunks.ts
new       server/upload-temp.ts
new       server/upload-validation.ts
new       tests/csrf.test.ts
new       tests/db-logging.test.ts
new       tests/gemini-reliability.test.ts
new       tests/login-guard.test.ts
new       tests/observability.test.ts
new       tests/project-page.test.ts
new       tests/provider-reliability.test.ts
new       tests/run-engine.test.ts
new       tests/upload-chunks.test.ts
new       tests/upload-limits.test.ts
new       tests/upload-streaming.test.ts
new       tests/upload-validation.test.ts
new       tests/zip-safety.test.ts
new       tsconfig.json
new       web/css/auth-gate.css
new       web/css/manage.css
new       web/js/lib/manage.js
new       web/js/pages/account.js
new       web/js/pages/usage.js
new       web/js/ui/auth-gate.js
```
