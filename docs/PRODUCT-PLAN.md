# Product expansion plan

Written **before** implementing (Task 6). It inventories what already exists, scopes what is built now, and states acceptance criteria so the
result can be judged against them. The status table at the end is updated as work lands; nothing is marked done without a test.

Ground rules: no paid or third-party service is introduced; nothing is sent anywhere new (search and tags are local SQLite; model comparison
only calls models the user already configured); every new route sits behind the existing auth gate and is owner-scoped; every feature has
a test that fails without it; privacy defaults do not weaken.

## 1. What exists today (inspected)

| Area asked for | Today | Gap |
|---|---|---|
| Model comparison | Models page (add, test, enable, set active); chat uses one active model | no side-by-side answers |
| Unified workspace | separate pages: Chat, Builder, Project, Document / Presentation Studio, Knowledge, Library | no single surface; a redesign, not an increment |
| Agent approvals / checkpoints | `/api/agent/run`: read-only tools (calculator, fetch_url, ...), step budget, SSE trace | nothing to approve: no write/exec tool exists, and the run engine is off by default. Approvals only matter once a mutating tool exists |
| Memory management | none (chat history only) | nothing stored about the user across chats, nothing to review or delete |
| Usage analytics | `/api/usage` + Usage page (requests, models, per-day) | token/cost columns are partial (provider-dependent) |
| Prompt studio | Project Studio has an inbuilt prompt catalogue with a fixed vs editable layer (`/api/builder/prompts`) | no general prompt library for chat |
| Document intelligence | RAG over uploads, universal document extract/export, Project Studio reports/decks | exists in several forms |
| Chat folders / tags / search / branching | list, open, rename, delete, edit-a-message, regenerate | **no search, no tags or folders, no pinning, no branching**; the History page is a plain list |
| Accessibility / mobile | responsive layout, keyboard focus styles, mobile suites exist | never audited systematically; unknown unlabeled controls |

## 2. Scope of this task

Chosen for value, low risk, no new dependencies, and testability. Each is implemented end to end (API, UI where it matters, tests).

### A. Conversation search, tags, folders and pinning  (History)
* **Plan**: `conversations` gets nullable `tags` (JSON array), `folder`, `pinned`; added by a guarded `ALTER TABLE` (idempotent, no data loss). `GET /api/conversations/search?q&tag&folder&pinned` searches the caller's own titles and message text (bounded `LIKE`, wildcards escaped, scan and result caps) and returns snippets; `PATCH /api/conversations/:cid/meta` sets tags/folder/pinned with strict validation. The History page gets a search box, tag/folder filters and a pin toggle.
* **Dependencies**: `db.ts` (schema), `server.ts` conversation list mapping, `web/js/pages/history.js`. No new package.
* **Risks**: LIKE scans are linear (bounded by per-user data and a cap; FTS5 is available in this SQLite but a missing FTS5 in some Node build would break startup, so it is not used); search text is user content: never logged (the logger already redacts `query`); owner scoping must hold (cross-user test).
* **Acceptance**: finds a word in a message or title (case-insensitive) and returns a snippet around it; `%` and `_` in the query are literal; another user never sees or tags my conversations (404 on the id, absent from results); tags/folder validated (count, length, characters); pinned first in the list; migration runs twice without error on an existing database; the page works by keyboard with labelled controls.

### B. Conversation branching
* **Plan**: `POST /api/conversations/:cid/branch { fromMessageId }` creates a new conversation containing the messages up to and including that one (ids regenerated, attachments references kept), titled "Branch of ...", same model, tags carried over; the original is untouched. A "Branch" action appears on messages in the chat and the History item shows its origin.
* **Dependencies**: A (tags), message tables, `chat.js` message actions.
* **Risks**: copying large histories (capped at 500 messages); must not copy other users' data (owner check on the source); the chat UI is a 3.7k-line module, so the UI change is one action added next to existing ones.
* **Acceptance**: branch contains exactly the messages up to the chosen one, in order, with new ids; editing the branch does not change the source; foreign conversation or message id -> 404; branching from the last message equals a copy.

### C. Model comparison
* **Plan**: `POST /api/compare { prompt, modelIds: [2..3] }` runs the same prompt against models the user already configured, in parallel, each with its own timeout and cancellation (client disconnect aborts all), through the existing provider layer (`provider-http`: retries, timeouts, key scrubbing). Returns per-model text, latency, finish state or a clear error; one model failing never fails the others. A Compare page shows answers side by side.
* **Dependencies**: model resolution, provider layer. No history is written unless the user asks to continue one answer in a chat.
* **Risks**: cost (N provider calls for one prompt: capped at 3 models and a prompt length limit, and the UI says so); keys must never appear in responses or logs; a slow model must not hold the others.
* **Acceptance**: two healthy models both answer; one failing returns an error for it and the other's answer; never more than 3 models or an over-long prompt; unknown or another user's model id is refused; cancelling stops all upstream calls; no API key in any response or log.

### D. Accessibility pass (desktop and mobile)
* **Plan**: automated audit of every route in Chrome using the accessibility tree and DOM checks (accessible names for buttons and inputs, landmarks, headings order, `aria-live` for toasts, focus visibility, tap-target size on mobile, contrast of text tokens in both themes), then fix what the audit finds, then keep the checks as a regression suite.
* **Risks**: touching shared components; each fix is attribute-level (labels, roles) or CSS-token level, never structural.
* **Acceptance**: zero unlabeled interactive controls on the audited routes; landmarks present; the new pages pass the same audit; mobile tap targets at least 40 px where we control the styling; findings and fixes are listed, not claimed.

## 3. Deferred (with reasons)

| Item | Why it is not in this task |
|---|---|
| Memory management | the privacy design comes first: what is remembered, explicit consent, per-item review and deletion, export/erase coverage, and injection into prompts (prompt-injection risk from remembered text). Building storage without that design would create a data-retention risk |
| Agent approvals / checkpoints | no mutating agent tool exists, so there is nothing to approve yet. It becomes necessary with the first write/exec tool; the design hook is the existing step trace |
| Unified workspace | a navigation and layout redesign across 8 pages, not an increment; it needs design decisions from the product owner |
| Prompt studio for chat | overlaps the Project Studio catalogue; a second prompt system should wait for a decision on one shared model of "prompt layers" |
| Token / cost analytics | provider usage data is inconsistent (some providers return none); accurate cost needs per-model price tables that must be maintained |
| Document intelligence expansion | RAG, extraction and export already exist; new work should come from user feedback, not guesses |

## 4. Status

Updated at the end of Task 6. A feature is "done" only with the evidence named here.

| Feature | Status | Evidence |
|---|---|---|
| A. Search, tags, folders, pinning | **done** | 10 unit tests, smoke check, browser suite 22 / 22 |
| B. Branching | **done** | unit tests, smoke check, browser suite 9 / 9 |
| C. Model comparison | **done** (against a local stand-in provider; not run against a real third-party provider) | 16 unit tests with mutation proof, smoke check, browser suite 27 / 27 |
| D. Accessibility pass | **done for the audited checks** (names, structure, focus, contrast, mobile overflow); screen-reader output not verified | audit 0 findings after 31 fixed, 8 regression unit tests |
| Memory management | deferred | needs the privacy and consent design first |
| Agent approvals / checkpoints | deferred | no mutating agent tool exists yet |
| Unified workspace | deferred | product redesign, not an increment |
| Prompt studio for chat | deferred | overlaps Project Studio |
| Token / cost analytics | deferred | inconsistent provider usage data |
| Document intelligence expansion | deferred | needs user feedback |

Follow-ups noticed while building: "continue one comparison answer in a chat" (the plan allowed it; not built, so the comparison stays strictly read-only); History could show the branch's origin conversation (needs a stored parent id).
