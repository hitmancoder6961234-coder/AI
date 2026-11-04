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
npm test                    # 65 unit tests
npm run build && npm run smoke   # 49 end-to-end checks against the real server
```

## Copilot

Open **Copilot** in the sidebar, press **Ctrl+/** anywhere, or go to `/copilot.html`.

* **Streaming** - real provider streaming (OpenAI-compatible, Anthropic, Gemini), not a typewriter effect.
* **Conversations** - saved per user, auto-titled, renameable, deletable; **Stop**, **Regenerate** and **Edit** a message.
* **Context, only when you ask** - *Search the web* adds numbered results the model cites as [1]; *Project* adds excerpts from one of **your** projects (ownership-checked).
* **Behaviour** - the prompt in [`server/copilot/prompts.ts`](server/copilot/prompts.ts): answer first, clean Markdown, complete code, honest about uncertainty, never claims to browse or see files unless context was supplied.
* **Focus (answers only about what you choose)** - set **Focus** above the message box to *One topic* (type it) or *My project*. The Copilot then answers only questions about that topic or project and politely declines everything else, whatever the chat says afterwards. In project mode it answers only from the project's files and says "I can't see that in the project's files" instead of guessing. The setting is remembered per conversation. Operators can lock all chats to one topic with `COPILOT_LOCK_TOPIC`.
* **GPT directly** - set `OPENAI_API_KEY` (an OpenAI API key; a ChatGPT subscription has none) and optionally `COPILOT_MODEL` (default `gpt-4o-mini`; `gpt-4o`, `gpt-5` and the o-series work too). *Auto* then uses GPT; if you also configured a model of your own, a **Model** picker appears (Auto / GPT / My model). Without an OpenAI key it uses your own model from the Model page or any other server provider key.

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
