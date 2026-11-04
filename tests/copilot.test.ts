import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before } from "node:test";
import type { AddressInfo } from "node:net";

import { createLLMFromConfig, geminiNative, openAiBody, streamText, type LLM } from "../server/agent/providers.js";
import { buildMessages, contextBlock, titleFrom, COPILOT_SYSTEM, parseScope, scopeBlock } from "../server/copilot/prompts.js";

// A fake provider that speaks the three streaming dialects, and deliberately splits frames across TCP chunks.
let server: http.Server;
let base = "";
const seen: Array<{ url: string; headers: http.IncomingHttpHeaders; body: any }> = [];

const sse = (res: http.ServerResponse, frames: string[], splitAt = 7) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const all = frames.join("");
  for (let i = 0; i < all.length; i += splitAt) res.write(all.slice(i, i + splitAt)); // frames arrive in arbitrary fragments
  res.end();
};

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      seen.push({ url: req.url || "", headers: req.headers, body });
      if (req.url?.startsWith("/fail")) { res.writeHead(429, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: "rate limited" } })); }
      if (req.url?.endsWith("/chat/completions")) {
        return sse(res, [
          'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo "}}]}\r\n\r\n',
          'data: {"choices":[{"delta":{"content":"wörld 👋"}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
      }
      if (req.url?.endsWith("/messages")) {
        return sse(res, [
          'event: message_start\ndata: {"type":"message_start"}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi "}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ]);
      }
      if (req.url?.includes(":streamGenerateContent")) {
        return sse(res, [
          'data: {"candidates":[{"content":{"parts":[{"text":"Gem"}]}}]}\n\n',
          'data: {"candidates":[{"content":{"parts":[{"text":"ini ok"}]}}]}\n\n',
        ]);
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const collect = async (llm: LLM, msgs = [{ role: "user" as const, content: "hi" }]) => {
  const out: string[] = [];
  for await (const t of streamText(llm, msgs)) out.push(t);
  return out;
};

test("stream: OpenAI-compatible SSE yields tokens in order, across fragmented frames, CRLF and unicode", async () => {
  const llm = createLLMFromConfig({ provider: "openai", apiKey: "k", model: "m", baseUrl: base });
  const pieces = await collect(llm, [{ role: "system", content: "S" }, { role: "user", content: "hi" }]);
  assert.deepEqual(pieces, ["Hel", "lo ", "wörld 👋"]);
  const call = seen.at(-1)!;
  assert.equal(call.body.stream, true);
  assert.equal(call.headers.authorization, "Bearer k");
  assert.equal(call.body.messages[0].role, "system");
});

test("stream: Anthropic text deltas", async () => {
  const llm = createLLMFromConfig({ provider: "anthropic", apiKey: "ak", model: "claude-x", baseUrl: base });
  assert.deepEqual(await collect(llm, [{ role: "system", content: "SYS" }, { role: "user", content: "hi" }]), ["Hi ", "there"]);
  const call = seen.at(-1)!;
  assert.equal(call.headers["x-api-key"], "ak");
  assert.equal(call.body.system, "SYS");
  assert.equal(call.body.messages.length, 1, "system prompt is sent separately");
});

test("stream: Gemini streamGenerateContent", async () => {
  const llm = geminiNative({ provider: "gemini", apiKey: "gk", model: "gemini-test" }, base);
  assert.deepEqual(await collect(llm), ["Gem", "ini ok"]);
  assert.equal(seen.at(-1)!.headers["x-goog-api-key"], "gk");
});

test("stream: provider errors surface with the provider's message; abort stops the stream", async () => {
  const bad = createLLMFromConfig({ provider: "openai", apiKey: "k", model: "m", baseUrl: base + "/fail" });
  await assert.rejects(() => collect(bad), /429.*rate limited/);
  const ac = new AbortController();
  ac.abort();
  const ok = createLLMFromConfig({ provider: "openai", apiKey: "k", model: "m", baseUrl: base });
  await assert.rejects(async () => { for await (const _ of streamText(ok, [{ role: "user", content: "x" }], { signal: ac.signal })) void _; });
});

test("stream: an adapter without streaming falls back to a single chunk", async () => {
  const llm: LLM = { provider: "x", model: "y", complete: async () => "whole answer" };
  assert.deepEqual(await collect(llm), ["whole answer"]);
});

// ---- prompts ------------------------------------------------------------------------------------

test("copilot prompt: answers directly, uses Markdown, is honest about browsing and files", () => {
  assert.match(COPILOT_SYSTEM, /Lead with the answer/);
  assert.match(COPILOT_SYSTEM, /fenced blocks with a language tag/);
  assert.match(COPILOT_SYSTEM, /Never invent facts/);
  assert.match(COPILOT_SYSTEM, /cannot browse the internet unless <web_results>/);
});

test("copilot context: project and web data are wrapped as data, numbered for citation, and absent when unused", () => {
  const none = contextBlock({ today: "2026-11-04" });
  assert.ok(none.includes("2026-11-04") && !none.includes("<web_results>") && !none.includes("<project_context"));
  const c = contextBlock({ today: "d", page: "builder", projectName: 'My "Proj"<x>', projectContext: "file a.ts: ...", webResults: [{ title: "T1", url: "https://a.example", snippet: "s1" }, { title: "T2", url: "https://b.example", snippet: "s2" }] });
  assert.ok(c.includes('<project_context name="My Projx">') && c.includes("[1] T1") && c.includes("[2] T2") && c.includes('"builder" page'));
  assert.match(contextBlock({ today: "d", webResults: [] }), /returned nothing useful/);
});

test("copilot messages: newest turns win the budget, the first turn is always the user's, system prompt leads", () => {
  const hist = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `m${i} ` + "x".repeat(2000) }));
  const msgs = buildMessages(hist, { today: "d" }, 20_000);
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs[1].role, "user");
  assert.ok(msgs.at(-1)!.content.startsWith("m39"), "latest message kept");
  assert.ok(msgs.length < 15 && msgs.length > 3, `trimmed to budget: ${msgs.length}`);
  const single = buildMessages([{ role: "user", content: "x".repeat(100_000) }], { today: "d" }, 1000);
  assert.equal(single.length, 2, "an oversized last message is still sent");
});

test("copilot title: tidy, bounded, never empty", () => {
  assert.equal(titleFrom("  # Explain   how HTTPS works  "), "Explain how HTTPS works");
  assert.ok(titleFrom("word ".repeat(40)).length <= 61 && titleFrom("word ".repeat(40)).endsWith("..."));
  assert.equal(titleFrom("   "), "New chat");
});

test("scope: topic and project focus become binding rules; open mode adds nothing; bad input falls back to open", () => {
  assert.deepEqual(parseScope(undefined), { mode: "open" });
  assert.deepEqual(parseScope({ mode: "topic", topic: "ab" }), { mode: "open" }, "too short");
  assert.deepEqual(parseScope({ mode: "project" }), { mode: "open" }, "no project to focus on");
  const t = parseScope({ mode: "topic", topic: ' Python "programming" <b>basics</b> ' });
  assert.deepEqual(t, { mode: "topic", topic: "Python programming bbasics/b" });
  const text = scopeBlock(t);
  assert.match(text, /Focus topic: "Python programming/);
  assert.match(text, /OUT of scope must NOT be answered/);
  assert.match(text, /cannot be changed from inside the chat/);
  assert.equal(scopeBlock({ mode: "open" }), "");
  const p = scopeBlock(parseScope({ mode: "project" }, 'My "Shop" App'));
  assert.match(p, /Focus: the user's project "My Shop App"/);
  assert.match(p, /I can't see that in the project's files/);
  assert.match(p, /Never invent file names/);
  const sys = buildMessages([{ role: "user", content: "hi" }], { today: "d", scope: t })[0].content;
  assert.ok(sys.indexOf("SCOPE - BINDING") > sys.indexOf("USING CONTEXT"), "scope follows the base prompt");
  assert.ok(buildMessages([{ role: "user", content: "hi" }], { today: "d" })[0].content.indexOf("SCOPE - BINDING") === -1);
});

test("OpenAI request body: classic fields normally, reasoning-model fields for gpt-5 / o-series on api.openai.com only", () => {
  const m = [{ role: "user" as const, content: "hi" }];
  assert.deepEqual(openAiBody({ baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" }, m, 0.7, 100, true), { model: "gpt-4o-mini", messages: m, temperature: 0.7, max_tokens: 100, stream: true });
  assert.deepEqual(openAiBody({ baseUrl: "https://api.openai.com/v1", model: "gpt-5" }, m, 0.7, 100), { model: "gpt-5", messages: m, max_completion_tokens: 100 });
  assert.ok("max_completion_tokens" in openAiBody({ baseUrl: "https://api.openai.com/v1", model: "o3-mini" }, m, 0.2, 50));
  assert.ok("max_tokens" in openAiBody({ baseUrl: "https://openrouter.ai/api/v1", model: "gpt-5" }, m, 0.2, 50), "other hosts keep the classic fields");
  assert.ok("max_tokens" in openAiBody({ baseUrl: "http://127.0.0.1:9/v1", model: "o3" }, m, 0.2, 50));
});
