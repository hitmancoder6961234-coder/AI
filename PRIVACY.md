# Privacy

This describes what the software does. If you operate a deployment, you are the data controller - publish
a policy that matches your configuration. The same facts are served machine-readably at
`GET /api/privacy/policy`.

## What is stored, and where

| Data | Location | Notes |
|---|---|---|
| Account (e-mail, name, scrypt password hash) | SQLite in `DARKNESS_STORAGE_ROOT` | passwords are never stored in plain text |
| Conversations, messages, files, projects, artifacts | same | scoped to the owning account |
| Model configurations incl. API keys you add | same | used server-side only; never returned to the browser |
| Session tokens | same (30 days) + `httpOnly` cookie | `SameSite=Lax`, `Secure` over HTTPS |
| Optional encrypted mirror | Aiven PostgreSQL | message bodies sealed with AES-256-GCM **before** leaving the server; user ids stored as keyed HMACs |
| Optional cloud sync | Supabase | original Darkness feature, off unless configured |

## What is sent to third parties

* The text you send is forwarded to the **AI provider you select**. Their terms apply to that traffic.
* Agent web tools contact the websites you ask about, from the server's IP address.
* Nothing else. There is **no analytics, telemetry, advertising identifier or tracking pixel**.

## Controls

* **Export** - `GET /api/privacy/export` returns everything stored about the signed-in user (credentials excluded).
* **Erase** - `DELETE /api/privacy/erase` with `{"confirm":"ERASE"}` removes the account, conversations, projects,
  files, models, sessions, in-memory caches and the Aiven mirror rows. It is immediate and irreversible.
* **Isolation** - there is no shared or anonymous account in strict mode; each API call is bound to the caller's session.

## Logs

Server logs pass through a redactor: e-mail addresses, bearer/session tokens, provider API keys, JWTs,
password fields and IPv4 addresses are replaced before they reach stdout. SQL error handlers no longer print
row contents. Chat and agent prompts and answers are not logged.

## Honest limits

* Data in the primary SQLite database is **not** encrypted at rest by the application - use disk/volume encryption
  on the host. Only the Aiven mirror is application-encrypted.
* Your AI provider sees your prompts. Choose a provider whose terms you accept, or self-host an OpenAI-compatible model
  and set `AGENT_BASE_URL`.
* Rate limits are in-memory (per instance).
