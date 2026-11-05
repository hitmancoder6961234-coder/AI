# Architecture

How Darkness AI is put together, the rules that keep it maintainable, and what is still too big. Three of the rules below are enforced
by `npm run check:architecture` (CI runs it), so they cannot rot silently.

## Shape

```
Browser (Vite-built UI in web/)  --cookie-->  Express API (server/server.ts)  -->  SQLite (storage root)  [+ optional Aiven / Supabase mirrors]
        |                                            |-- AI providers (Gemini, OpenAI-compatible, Anthropic ...) through provider-http.ts
        +-- hosted behind Vercel: api/proxy.js forwards /api/* and /classic-api/* to the Render service (see DEPLOY.md)
```

One Node process serves the API, the built UI (`dist/`) and the original single-file app at `/classic/`. Everything stateful lives under
`DARKNESS_STORAGE_ROOT` (database, projects, artifacts, uploads); the rest is rebuildable.

## Server layers (`server/`)

Imports go **down** only: a module may import its own layer or a lower one, never a higher one, and nothing imports `server/server.ts`.
`scripts/check-architecture.mjs` builds the import graph, fails on any runtime cycle and on any upward import (type-only imports are
ignored: the compiler erases them).

| Layer | Modules | Responsibility |
|---|---|---|
| **foundation** | `storage-manager`, `env-loader`, `upload-config`, `upload-temp`, `upload-validation`, `upload-chunks`, `provider-http`, `security/vault` + `security/secret-store` (keys at rest), `observability/*` (logger, request-context, health), `security/redact`, `csp`, `csrf`, `login-guard` | no knowledge of the application: paths, uploads, logging, HTTP policy, pure helpers |
| **data** | `db`, `supabase`, `project-storage` | persistence: SQLite schema and queries, optional cloud mirrors, files on disk |
| **domain** | analyzers and engines (`project-analyzer`, `architecture-engine`, `file-generator`, `rag-engine`, `agent-runtime`, `agent/*` (loop, tools, policy, sessions), `artifact-access`, `conversation-library`, `model-compare`, `insights`, `memory`, `prompts`, `recovery` (reset tokens, limiter), `mailer` (SMTP / Resend client), `studio/*`, `agent/*`, ...) | what the product does, independent of HTTP |
| **routes** | `*-routes.ts` (e.g. `conversation-routes`, `compare-routes`, `insights-routes`, `memory-routes`, `prompts-routes`, `recovery-routes`), `*/routes.ts`, `security/privacy` | Express handlers: validate input, call the domain, shape the response |
| **entry** | `server.ts` | wires middleware, state caches and every route group, starts listening |

Cross-cutting rules (each has a test or a tool behind it):

* **Auth first.** `security/privacy.ts` installs headers, rate limits, redaction and the strict auth gate before any route; a route is public only if it is in `PUBLIC_API`. Cookie sessions are checked against the database row on every request (expiry and revocation are immediate).
* **Ownership.** `:pid` and `:cid` are guarded globally; anything addressed by another id goes through `artifact-access.ts`, including bulk operations that take ids in the body. Unknown and foreign ids both read as "not found".
* **Dependencies are injected into domain code that needs state** (`createArtifactAccess({ projects, artifacts, ...lookups })`), so it can be unit-tested without the server.
* **No secrets in logs or the repo.** `security/redact.ts` is a dependency-free leaf used by the logger, the provider layer and the privacy middleware (that is what removed the one import cycle the project had). `.gitleaks.toml` and a unit test scan for credentials.
* **Providers are called through `provider-http.ts` only**: timeouts, retries for safe failures, cancellation, secret scrubbing.
* **Content-Security-Policy** is built in one place (`security/csp.ts`); markup uses `data-act` handlers, never inline `onclick`.

## Web (`web/`)

Plain ES modules plus a small React island, bundled by Vite (root `web/`, output `dist/`; `web/public/**` is copied unchanged).
`web/src/main.jsx` is the entry: it imports `js/lib` (utilities, markdown, store), `js/services` (api, auth, theme), `js/ui` (chat, sidebar,
modals, code viewer, `delegated-actions`) and `js/pages` (one file per route). Pages register themselves on `window.Darkness`; the router in `js/app.js`
renders them. Styling is tokens + component CSS in `web/css/`. Third-party browser assets that are not npm packages (Mermaid, html2pdf, fonts) are
self-hosted under `web/public/vendor/`; KaTeX, React, Cytoscape come from npm and are split into their own long-cached chunks (`vite.config.ts`).

## Where the size is

| File | Lines | State |
|---|---|---|
| `web/js/pages/project.js` | 11.2k | the Project page: 12 tabs in one module. Correct and tested end to end (browser suite, crawler) but still the largest liability. Next split: one module per tab, starting with the upload pipeline (done: `lib/zip-upload.js`) |
| `server/server.ts` | 8.2k | down from 8.7k. Still holds most inline route groups; each group that has no dependency on its closure can move the way `document-export-routes.ts` and `artifact-access.ts` did |
| `web/js/ui/chat.js` | 3.7k | chat rendering, streaming, export |
| `server/file-generator.ts` | 3.1k | DOCX / XLSX / PPTX / PDF generation |
| `server/architecture-engine.ts` | 2.9k | architecture graph derivation |
| `web/css/pages.css`, `components.css` | ~120 kB each | not split: no measurable benefit yet, and CSS order matters |

## How to change things safely

1. Add or move a route group: keep paths, methods, auth and status codes identical; put it in `server/<name>-routes.ts` exporting `register...Routes(app, deps)`; add the call in `server.ts`; run `npm run verify` and `npm run smoke`.
2. Before moving logic out of a closure, write down which maps and helpers it uses and pass exactly those (see `createArtifactAccess`); TypeScript and `eslint no-undef` list anything you missed.
3. Never import `server/server.ts`; never import a route module from the data or domain layer. `npm run check:architecture` will tell you.
4. A behaviour you change needs a test that fails on the old code (the smoke and unit suites have many examples; the log in `docs/IMPROVEMENT-LOG.md` lists the proofs).
