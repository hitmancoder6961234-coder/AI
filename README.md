# Darkness AI

A private, multi-model AI workspace: chat with citations, a knowledge base (RAG), projects, document and
slide studios, diagrams, exports, and a **working tool-using agent**. Built on the Clarity engine, hardened
for public deployment, with dynamic backgrounds.

| | |
|---|---|
| **Chat & knowledge** | Streaming chat, multi-document RAG, multilingual answers, math/diagram/code rendering |
| **Studios** | Word, slide, project and artifact generation (DOCX, PPTX, PDF, XLSX exports) |
| **Agent** | `/agent.html` - reasons step by step, calls tools, streams its work (see [Agent](#agent)) |
| **Privacy** | Strict identity mode, per-user isolation, export/erase, log redaction, encrypted mirror ([PRIVACY.md](PRIVACY.md)) |
| **Atmospheres** | Classic - Blood Moon - Deep Water, switchable from the orb in the corner ([Atmospheres](#atmospheres)) |
| **Deploy** | Vercel (UI) + Render (API) + Aiven (PostgreSQL), or Docker on your own server ([DEPLOY.md](DEPLOY.md)) |

## Quick start

Requires **Node 22.13+** (uses the built-in `node:sqlite`).

```bash
cd clarity-ai
cp .env.example .env        # add at least one provider key, e.g. GEMINI_API_KEY
npm install
npm run dev                 # http://localhost:3000
```

`PRIVACY_STRICT` is on by default, so you sign up with an e-mail and a password of 8+ characters on first
run. There is no demo account. Set `PRIVACY_STRICT=false` only for throw-away local experiments.

```bash
npm test                    # unit tests (vault, redaction, calculator, SSRF guard, agent loop, rate limiter)
npm run build && node scripts/smoke.mjs   # end-to-end: boots the real server and checks privacy + agent over HTTP
```

## Atmospheres

Click the orb at the bottom-right (or open any page with `?atmosphere=blood`).

* **Classic** - the interface exactly as shipped. Nothing is drawn.
* **Blood Moon** - crimson sky, a glowing blood moon whose light breathes, drifting fog, rising embers, blood
  that drips from the top edge and droplets that stop, start and run down the screen like rain on glass.
* **Deep Water** - swaying light shafts, living caustics, bubbles and plankton, click ripples, a blue that slowly
  drifts between ink and teal.

One `<canvas>` (two in Blood Moon), no dependencies, paused when the tab is hidden, static under
`prefers-reduced-motion`, lighter on phones. Files: `public/atmosphere/atmosphere.{js,css}`.

## Agent

`public/agent.html` talks to `POST /api/agent/run` (Server-Sent Events).

* **Loop** - ReAct-style, provider-agnostic JSON protocol (`agent/core.ts`). Max 12 steps, repeat-call cut-off, a
  forced final answer when the budget runs out.
* **Providers** - Gemini, Anthropic, OpenAI, OpenRouter, Groq, Together, Mistral (`agent/providers.ts`). Keys stay
  on the server.
* **Tools** - `calculator` (a real parser, no `eval`), `datetime`, `web_search`, `fetch_url`, `scratchpad`,
  `knowledge_search` (the signed-in user's own documents only).
* **Safety** - tool output is wrapped as untrusted data; `fetch_url` blocks private/loopback/link-local/metadata
  addresses at **connect time** (no DNS-rebinding window), re-validates every redirect, caps size and time;
  per-user concurrency limit; goals and answers are never logged.

## Layout

```
agent/        working agent: core loop, providers, tools, SSRF-safe fetch, routes
security/     privacy layer: strict mode, headers, rate limits, redaction, vault, Aiven mirror, export/erase
public/       static assets: atmosphere engine, agent page, brand, icons
js/ css/ src/ the web UI (vanilla modules + React islands, built with Vite)
server.ts     API server (Express 5) - db.ts, supabase.ts, rag-engine.ts, ... are the Clarity engine
deploy/       Aiven (Terraform), Caddy example     scripts/  PowerShell + smoke test
```

## What was changed from upstream Clarity

Clarity's own behaviour is unchanged unless noted here. The privacy hardening (strict mode, closed
diagnostics, code-execution gate, CORS allow-list, SameSite=Lax cookies, no argument dumps in SQL error
logs) is documented in [SECURITY.md](SECURITY.md).
