# Privacy

This describes what the software does. If you operate a deployment, you are the data controller - publish a policy
that matches your configuration. The same facts are served machine-readably at `GET /api/privacy/policy`.

## What is stored, and where

| Data | Location | Notes |
|---|---|---|
| Account (e-mail, name, scrypt password hash) | SQLite in `DARKNESS_STORAGE_ROOT` | passwords are never stored in plain text |
| Conversations, messages, files, projects, artifacts | same | scoped to the owning account |
| Copilot conversations and messages | same | scoped to the owning account; deletable one by one or all at once |
| Studio builds (generated reports, decks, images) | server memory, one hour | owner-scoped; not written to disk |
| Original-app data (`/classic-api`): chats, shares, analytics, webhooks | same SQLite | scoped to the account (share links are public by design) |
| Model configurations incl. API keys you add | same | used server-side only; never returned to the browser |
| Session tokens | same (30 days) + `httpOnly` cookie | `SameSite=Lax`, `Secure` over HTTPS |
| Optional encrypted mirror | Aiven PostgreSQL | message bodies sealed with AES-256-GCM **before** leaving the server; user ids stored as keyed HMACs |
| Optional cloud sync | Supabase | off unless configured |

## What is sent to third parties

* The text you send - chat and Copilot messages, and the **digest of your project plus your instructions** when you use the Studio -
  is forwarded to the **AI provider you select**. Their terms apply. Secrets found in files are scrubbed first.
* Image prompts go to the configured image model (Gemini) on the server; with `IMAGE_ALLOW_THIRD_PARTY=true` they may go
  to a free third-party generator instead. Off by default.
* Agent web tools and webhooks contact the sites you point them at, from the server's IP. Private addresses are blocked.
* Nothing else. There is **no analytics, telemetry, advertising identifier or tracking pixel**.

## Controls

* **Export** - `GET /api/privacy/export` returns everything stored about the signed-in user (credentials excluded).
* **Erase** - `DELETE /api/privacy/erase` with `{"confirm":"ERASE"}` removes the account, conversations, projects, files,
  models, sessions, original-app data, Copilot chats, Studio builds, in-memory caches and the Aiven mirror rows. Immediate and irreversible.
* **Isolation** - no shared or anonymous account in strict mode; every API call is bound to the caller's session and
  every project / conversation / build id is ownership-checked.

## Logs

Server logs pass through a redactor: e-mail addresses, bearer/session tokens, provider API keys, JWTs, password fields
and IPv4 addresses are replaced before they reach stdout. SQL error handlers no longer print row contents, and chat,
studio, image and agent prompts and answers are not logged (only their length).

## Honest limits

* The primary SQLite database is **not** encrypted at rest by the application - use disk/volume encryption on the host.
  Only the Aiven mirror is application-encrypted.
* Your AI provider sees your prompts. Choose one whose terms you accept, or self-host an OpenAI-compatible model and set
  `AGENT_BASE_URL`.
* Documents you export contain what you put in them; the Studio removes detected secrets from the evidence it sends to a
  model, but cannot recognise every kind of personal data in your files.
* Rate limits are in-memory (per instance).
