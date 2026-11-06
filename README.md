# Darkness AI

One project, everything in it: a private multi-model AI workspace, a **Project Studio** that turns a project
into a professional report and presentation, a working **agent**, universal document upload and export, and your
original Darkness app - all behind one login, one server and one deployment.

| | |
|---|---|
| **Project Studio** | Upload code, documents or just an idea. Darkness analyses it, asks you the right questions, recommends improvements, then writes the **report (DOCX/PDF/...)**, the **presentation (PPTX with speaker notes)** and **illustrations** - with prompts written for deep understanding. Use the inbuilt prompts or write your own. |
| **Documents** | Upload almost anything (PDF, Word, PowerPoint, Excel, ODF, RTF, EPUB, HTML, Markdown, CSV, JSON, code, ZIP, images). Export to DOCX, PDF, PPTX, XLSX, ODT, RTF, HTML, Markdown, TXT, CSV, JSON - or convert one file to another type. |
| **Copilot** | A ChatGPT-style assistant: answers stream token by token, Markdown with code blocks and a Copy button, saved conversations, stop / regenerate / edit, optional web search with numbered citations, and optional grounding in one of your projects. Full page at `/copilot.html` and a slide-in panel on every page (**Ctrl+/**). |
| **Chat & knowledge** | Streaming multi-model chat, knowledge base (RAG) over your documents, Word and Slide studios, diagrams, project workspace. |
| **Agent** | `/agent.html` - reasons step by step with a calculator, date/time, web search, page fetch, notes and your own documents. |
| **Classic Darkness** | Your original app, unchanged, at `/classic/` - served by the same server, with its API ported to `/classic-api`. |
| **Atmospheres** | Classic - Blood Moon - Deep Water: dynamic backgrounds and light, switchable from the orb in the corner. |
| **Privacy** | Strict identity mode, per-user isolation, export/erase, log redaction, encrypted mirror ([PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md)). |

## Quick start

Requires **Node 22.13+** (uses the built-in `node:sqlite`).

```bash
cp .env.example .env        # add at least one provider key, e.g. GEMINI_API_KEY
npm install
npm run dev                 # http://localhost:3000
```

Sign up with an e-mail and a password of 8+ characters. There is no demo account. Without any AI key the Studio
still works in **offline mode** (content derived from your project's structure, never invented); add a model in
*Model* or set a provider key for deeper writing.

```bash
npm run lint                # ESLint: bug-class rules fail, style rules warn
npm run typecheck           # TypeScript compiler (non-blocking in CI until its baseline is 0)
npm test                    # 381 unit tests (the number the runner prints, not a count of test( lines)
npm run build && npm run smoke   # 97 end-to-end checks against the real server
npm run authz               # attacks every state-changing route (151) as another user; fails on any change to anyone else's data (docs/AUTHORIZATION-AUDIT.md)
```

### Quality gates

`npm run verify` runs the same blocking gates as CI, in order: `check:lockfile`, `check:architecture`, `lint:ci`, `typecheck`, `test`, `build`. CI
(`.github/workflows/darkness-ai-ci.yml`) adds the end-to-end smoke test, a Node 22 + 24 matrix, Windows and macOS builds, and a
security job (dependency audit, registry signatures, secret scan). Nothing is `continue-on-error`.

* **Architecture** - `npm run check:architecture` (`scripts/check-architecture.mjs`) fails on import cycles and on upward imports between the server layers. The map and the rules are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
* **Lint** - `eslint.config.js`. Undefined names, duplicate keys, unreachable code and similar are errors. Hygiene rules
  (unused variables, `var`, empty blocks) are warnings so old code can be cleaned gradually; `lint:ci` passes `--max-warnings`
  with the current count (**1,033**), so the number can only go down. Lower it in `package.json` whenever you clean some up.
* **Typecheck** - `tsconfig.json` (`server/` and `tests/`, non-strict). **0 errors** and blocking. (It used to report a
  "184-error baseline"; most of it was imports the compiler could not resolve, which hid real bugs. See the improvement log.)
* **Dependencies** - `npm audit` is clean for production and for everything (0). `uuid`, `image-size` and `minimatch` (inside
  `typescript-estree`, a dev tool) are pinned to patched versions with `overrides` in `package.json`.
* **Lockfile** - `package-lock.json` lists the native binaries of every platform, so `npm ci` works on Windows, macOS and Linux.
  `npm run check:lockfile` fails if that ever regresses; `node scripts/lockfile-platforms.mjs --fix` repairs it (needs the registry).
* **Operations** - `npm run preflight` checks a deployment's environment (never prints values); `npm run backup` / `scripts/backup.mjs`
  snapshot, verify and restore the data directory. See the go-live checklist in [DEPLOY.md](DEPLOY.md).
* **Node** - `engines` is `>=22.13`; tests, smoke and build are verified on Node 22 and 24. The smoke test takes about 20 seconds.
* **Content-Security-Policy** - enforced: scripts only from this origin, no inline script / handler / eval, no CDNs (third-party
  assets are self-hosted under `web/public/vendor/`), reports at `/api/csp-report`. Policy, exceptions and how to add a library:
  [SECURITY.md](SECURITY.md#content-security-policy). Never write `onclick="..."`: use `data-act` in `web/js/ui/delegated-actions.js`.
* **Progress record** - see `docs/IMPROVEMENT-LOG.md` for completed blueprint tasks, results and files changed, and [docs/RELEASE-READINESS.md](docs/RELEASE-READINESS.md) for the final audit (what was checked, what remains, what could not be verified).

## Copilot

Open **Copilot** in the sidebar, press **Ctrl+/** anywhere, or go to `/copilot.html`.

* **Streaming** - real provider streaming (OpenAI-compatible, Anthropic, Gemini), not a typewriter effect.
* **Conversations** - saved per user, auto-titled, renameable, deletable; **Stop**, **Regenerate** and **Edit** a message.
* **Context, only when you ask** - *Search the web* adds numbered results the model cites as [1]; *Project* adds excerpts from one of **your** projects (ownership-checked).
* **Behaviour** - the prompt in [`server/copilot/prompts.ts`](server/copilot/prompts.ts): answer first, clean Markdown, complete code, honest about uncertainty, never claims to browse or see files unless context was supplied.
* **Focus (answers only about what you choose)** - set **Focus** above the message box to *One topic* (type it) or *My project*. The Copilot then answers only questions about that topic or project and politely declines everything else, whatever the chat says afterwards. In project mode it answers only from the project's files and says "I can't see that in the project's files" instead of guessing. The setting is remembered per conversation. Operators can lock all chats to one topic with `COPILOT_LOCK_TOPIC`.
* **GPT directly** - set `OPENAI_API_KEY` (an OpenAI API key; a ChatGPT subscription has none) and optionally `COPILOT_MODEL` (default `gpt-4o-mini`; `gpt-4o`, `gpt-5` and the o-series work too). *Auto* then uses GPT; if you also configured a model of your own, a **Model** picker appears (Auto / GPT / My model). Without an OpenAI key it uses your own model from the Model page or any other server provider key.

## Sign-in screen

A dark stage with a character, **Dusk**, next to the form. Dusk patrols, watches you type, covers its eyes for the
password (peeks when you show it), stops to think with a changing thought bubble while the server answers, then walks
through the opening gate on success - or shakes its head on failure. It follows the active atmosphere (Classic / Blood
Moon / Deep Water) and respects *reduce motion*.

The form explains every way signing in can go wrong, with the right next step: empty or malformed fields (live, with
e-mail typo suggestions such as `gmial.com`), caps lock, a weak/common/mismatched password at sign-up, wrong password
(with attempts left), an account that already exists, a **lock-out with a live countdown** that survives a reload,
offline, a slow or timed-out request (with Cancel), a server that is down or answers with an error page (with automatic
recovery detection), a blocked or missing API, an unreadable reply, a browser that refuses to keep the session, an
insecure (HTTP) connection, a session that expired or ended in another tab, and sign-out. Server and client share one
set of error `code`s (`server/server.ts` auth routes, `web/js/services/auth.js`, `web/js/ui/auth-gate.js`).

## Overview, Usage and Account

The management pages (`web/js/pages/home.js`, `usage.js`, `account.js`, helpers in `web/js/lib/manage.js`, styles in
`web/css/manage.css`) sit under a grouped sidebar (Workspace / Create / Knowledge / Manage).

* **Overview** - greeting, status (model, privacy mode), stat tiles with trend and sparkline, a 14-day activity chart, your latest
  conversations and shortcuts to the studios.
* **Usage** - 7/14/30/90-day range, prompts and replies per day (hover or focus a bar for the numbers), which of your models answered,
  everything you have stored, and **Export CSV**. Counts come from stored history (`GET /api/usage`, per user). Token and cost
  totals are *not* shown because nothing records them; the page says so.
* **Account** - rename, change password (current password required, attempts counted, signs your other devices out), the list
  of signed-in devices with "Sign out others", download all your data, sign out (`/api/account*`, `server/account/routes.ts`).

* **Models** - search, status filters (ready / attention / disabled), the active model on top, per-model cards with
  capabilities, replies in the last 30 days and a real **Test** (reports a measured response time or why it failed).
  Choosing, enabling and deleting update the page at once and roll back if the server refuses; add/edit dialogs are
  unchanged. A model shows *Not tested* until a test has actually run.
* **Settings** - theme, density and atmosphere (Classic / Blood Moon / Deep Water) with the active choice always
  visible, the active model, links to Account and Usage, and a reset of local preferences that keeps you signed in.

Smoothness: pages paint from a short-lived cache and refresh quietly (no blank screens, no replayed animations), data starts
loading when the pointer reaches a sidebar link, late responses for a page you already left are dropped, the sidebar is
built once and only moves its highlight, and every motion honours *reduce motion*.

## History, branching and model comparison

* **History** (`#/history`) - search your conversations by title *and* message text (with a snippet), organise them with tags and folders, pin the
  ones you need, filter by tag / folder / pinned. Everything is scoped to you on the server. Code: `server/conversation-library.ts`, `server/conversation-routes.ts`, `web/js/pages/history.js`.
* **Branch from here** - the branch icon under any saved chat message starts a new conversation with everything up to that message; the original is untouched.
* **Compare models** (`#/compare`) - one prompt, two or three of *your* configured models, answers side by side with status and latency. Each model is a separate call to
  its provider with your own key (so it is capped at 3 models, 8,000 characters, 6 comparisons a minute); nothing is saved to your history; cancel stops the provider requests.
  Code: `server/model-compare.ts`, `server/compare-routes.ts`, `web/js/pages/compare.js`.
* **Accessibility** - the whole UI was audited route by route (names, structure, keyboard, contrast in both themes, mobile); the findings and fixes are in `docs/IMPROVEMENT-LOG.md`.
  Planned and deferred product work: [docs/PRODUCT-PLAN.md](docs/PRODUCT-PLAN.md).

## Agent workflow, Models usage, System status and the Overview ask card

* **Agent workflow** (`#/agents`) - the agent's tools as a live map (which were used, which mostly fail) with runs per day, success rate, failed runs and average duration, and tables of tools and recent runs. Counted from runs made after this was added; goals and tool outputs are never stored.
* **Usage > Models** - one card per model: calls, *estimated* tokens, last used, a daily sparkline. Enter a price per 1M tokens to see an estimated cost (kept in your browser).
* **System status** (`#/system`) - service readiness, memory, uptime, whether API keys are encrypted at rest, a map of your own workspace and alerts. Scoped to your account.
* **Overview** - pick a focus or type a question: it opens a new chat and sends it; Recent / Pinned tabs.
* **API keys at rest** - set `PRIVACY_ENCRYPTION_KEY` to encrypt the model keys users save (see [DEPLOY.md](DEPLOY.md)). Status of every requirement of the long product directive: [docs/MASTER-DIRECTIVE-STATUS.md](docs/MASTER-DIRECTIVE-STATUS.md).

## Memory

`#/memory` - notes you choose to keep ("I prefer short answers", "my project uses Postgres"). They are sent to the model **only when relevant** to your question (or marked *Always use*), never saved automatically, private to your account, included in your data export and erased with the account. One switch turns memory off; each note can be paused; replies show which notes were used. Add notes on the page, or use **Remember this** on one of your messages. Code: `server/memory.ts`, `server/memory-routes.ts`, `web/js/pages/memory.js`.

## Account recovery

"Forgot password?" on the sign-in screen opens `/reset.html`. With a mail provider configured (`MAIL_PROVIDER`, see `.env.example`) it e-mails a single-use link (30 minutes); using it sets a new password and signs the account out on every device. Without one the page says so, and the operator can issue a one-time link or disable / enable an account from the host with `node scripts/admin.mjs` (there is deliberately no admin role in the app). Mail delivery has not been tested against a real provider: see [docs/OPERATIONS-VERIFICATION.md](docs/OPERATIONS-VERIFICATION.md). Code: `server/recovery.ts`, `server/recovery-routes.ts`, `server/mailer.ts`, `scripts/admin.mjs`, `web/public/reset.html`.

## Prompt Studio

`#/prompts` - your own prompt library: write prompts with `{{variables}}` (and `{{name|default}}`), start from a template, keep a version history with diffs and restore, test a prompt on one to three of your models (your own keys; one test at a time), compare two or three variations side by side, send a filled-in prompt to a new chat, and import / export your prompts as JSON. Code: `server/prompts.ts`, `server/prompts-routes.ts`, `web/js/pages/prompts.js`.

## Agent: plans, approvals and saved runs

`/agent.html` - the agent plans first, shows the plan and its progress, and **asks you before it changes anything** (today that is the `remember` tool, which saves one note to your memory; strict mode asks before every tool call). Every run is saved with a step-by-step history: pause it, close the tab and resume later, stop it, or delete it (kept 30 days). Tool outputs are not stored in the history. Code: `server/agent/*`.

## Project Studio

`#/builder` in the app. Five steps:

1. **Project** - pick one, upload files / a ZIP, import from GitHub, or just describe your idea.
2. **Deliverables & prompts** - report formats, presentation theme, illustrations, audience, tone, length, language.
   For the report, the presentation and the images you choose **"Darkness expert prompt"** or **"My own prompt"**
   (you can read and edit the inbuilt one first). You can also create **images from your own words**.
3. **Brief & recommendations** - what Darkness understood, a few questions that change the output, and concrete
   recommendations (for the project and for the documents). Tick what you want applied; add your own changes.
4. **Outline** - the report sections and slides. Ask for changes and Darkness revises the outline.
5. **Build** - live progress, then download each file or everything as one ZIP. `prompts-used.md` records exactly
   which prompts produced them.

**How the prompts work.** Each prompt has three layers: a fixed *contract* (output format and accuracy rules - no
invented facts, cite real files), an editable *guidance* layer (the writing / design style guide - this is what
"my own prompt" replaces) and *evidence* (a digest of your project, treated as data and never as instructions). A
custom prompt can change style and emphasis but cannot break the output or license invention.
See [`server/studio/prompts.ts`](server/studio/prompts.ts).

## Layout

```
index.html manifest.json sw.js site/   your original Darkness app (also what GitHub Pages serves)
web/            the new UI (Vite): js/ css/ src/ public/ (atmosphere engine, agent page, brand)
server/         API server (Express 5)
  studio/         Project Studio: prompts, dossier, pipeline, renderers, routes
  documents/      universal extract + export (docx, pdf, pptx, xlsx, ...)
  classic/        your original backend, ported (+ the /classic pages)
  copilot/        the ChatGPT-style assistant: prompt, streaming chat API, conversation storage
  agent/          working agent: loop, providers (with real streaming), tools, SSRF-safe fetch
  security/       strict mode, headers, rate limits, redaction, vault, Aiven mirror, export/erase
legacy/         your original server.js, package.json, render.yaml (kept for reference)
deploy/ scripts/ api/   Aiven (Terraform), Caddy, PowerShell + smoke test, Vercel proxy
```

`node server.js` still works (it starts the unified server), so old start commands keep functioning.

## Atmospheres

Click the orb at the bottom-right (or open any page with `?atmosphere=blood`). **Classic** is the interface exactly as
shipped. **Blood Moon**: crimson sky, a glowing moon whose light breathes, drifting fog, embers, blood dripping from
the top edge and droplets running down the screen. **Deep Water**: swaying light shafts, living caustics, bubbles,
click ripples, a blue that drifts between ink and teal. One canvas per layer, no dependencies, paused when hidden,
static under `prefers-reduced-motion`.

## Deploy

See [DEPLOY.md](DEPLOY.md): Vercel (UI + proxy) + Render (API) + Aiven (PostgreSQL mirror), or Docker on your own
server with a PowerShell SSH-key setup.
