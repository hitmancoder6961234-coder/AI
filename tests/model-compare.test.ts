import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";

const { runComparison, validateCompareRequest, safeError, extractCompletionText, createModelCaller, CompareError, MAX_PROMPT_CHARS, MAX_ANSWER_CHARS } = await import("../server/model-compare.js");
const { registerCompareRoutes, COMPARE_PER_MINUTE } = await import("../server/compare-routes.js");
const { ProviderError } = await import("../server/provider-http.js");

const KEY_A = "sk-test-AAAAAAAAAAAAAAAAAAAAAAAA";
const KEY_B = "sk-test-BBBBBBBBBBBBBBBBBBBBBBBB";
const models = [
  { id: "m-a", name: "Alpha", provider: "openai", modelName: "alpha-1", apiKey: KEY_A },
  { id: "m-b", name: "Beta", provider: "groq", modelName: "beta-1", apiKey: KEY_B },
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("validation: needs a prompt and 2-3 distinct models, and the prompt is bounded", () => {
  const bad = (body: any, code: string) => assert.throws(() => validateCompareRequest(body), (e: any) => e instanceof CompareError && e.code === code, code);
  bad({ modelIds: ["a", "b"] }, "EMPTY_PROMPT");
  bad({ prompt: "   ", modelIds: ["a", "b"] }, "EMPTY_PROMPT");
  bad({ prompt: "x".repeat(MAX_PROMPT_CHARS + 1), modelIds: ["a", "b"] }, "PROMPT_TOO_LONG");
  bad({ prompt: "hi" }, "MODELS_REQUIRED");
  bad({ prompt: "hi", modelIds: "a" }, "MODELS_REQUIRED");
  bad({ prompt: "hi", modelIds: ["a"] }, "TOO_FEW_MODELS");
  bad({ prompt: "hi", modelIds: ["a", "a"] }, "INVALID_MODELS");
  bad({ prompt: "hi", modelIds: ["a", 5] }, "INVALID_MODELS");
  bad({ prompt: "hi", modelIds: ["a", "b", "c", "d"] }, "TOO_MANY_MODELS");
  bad(null, "EMPTY_PROMPT");
  assert.deepEqual(validateCompareRequest({ prompt: "  hi  ", modelIds: ["a", "b", "c"] }), { prompt: "hi", modelIds: ["a", "b", "c"] });
});

test("both models answer, in the order requested, in parallel", async () => {
  const started: string[] = [];
  // Parallelism is proven by counting calls that are in flight at the same moment, not by a wall-clock threshold (a timing bound passed for
  // sequential execution too, 90 ms against a 150 ms limit, and failed on a busy machine).
  let active = 0, peak = 0;
  const call = async (m: any) => { started.push(m.id); active++; peak = Math.max(peak, active); await sleep(m.id === "m-a" ? 80 : 10); active--; return `answer from ${m.id}`; };
  const r = await runComparison({ models, prompt: "hi", call });
  assert.deepEqual(r.map((x) => [x.modelId, x.finish, x.text]), [["m-a", "done", "answer from m-a"], ["m-b", "done", "answer from m-b"]]);
  assert.deepEqual(started.sort(), ["m-a", "m-b"], "both calls started before either finished");
  assert.equal(peak, 2, "both calls were in flight at the same time (parallel, not one after the other)");
  assert.ok(r.every((x) => x.latencyMs >= 0 && x.label && x.provider));
});

test("one failing model does not fail or delay the other", async () => {
  const call = async (m: any) => { if (m.id === "m-a") throw new Error("HTTP 500: upstream exploded"); return "fine"; };
  const r = await runComparison({ models, prompt: "hi", call });
  assert.equal(r[0].finish, "error");
  assert.match(r[0].error!, /upstream exploded/);
  assert.equal(r[1].finish, "done");
  assert.equal(r[1].text, "fine");
});

test("a slow model times out on its own while the other still answers", async () => {
  // the "slow" provider ignores the abort signal entirely: the comparison must not wait for it
  const call = async (m: any) => { if (m.id === "m-a") { await sleep(2000); return "late"; } return "quick"; };
  const t0 = Date.now();
  const r = await runComparison({ models, prompt: "hi", call, timeoutMs: 100 });
  assert.equal(r[0].finish, "timeout");
  assert.match(r[0].error!, /No answer within/);
  assert.equal(r[1].finish, "done");
  assert.ok(Date.now() - t0 < 1000, "returned long before the slow provider finished");
});

test("cancelling aborts every upstream call", async () => {
  const seen: AbortSignal[] = [];
  const call = (_m: any, _p: string, o: { signal: AbortSignal }) => new Promise<string>((_res, rej) => { seen.push(o.signal); o.signal.addEventListener("abort", () => rej(new ProviderError("cancelled", { kind: "cancelled", retryable: false })), { once: true }); });
  const ctl = new AbortController();
  const p = runComparison({ models, prompt: "hi", call, signal: ctl.signal });
  await sleep(30);
  assert.equal(seen.length, 2);
  assert.ok(seen.every((s) => !s.aborted));
  ctl.abort();
  const r = await p;
  assert.deepEqual(r.map((x) => x.finish), ["cancelled", "cancelled"]);
  assert.ok(seen.every((s) => s.aborted), "both upstream signals were aborted");
});

test("already cancelled: no provider call is made at all", async () => {
  let calls = 0;
  const ctl = new AbortController(); ctl.abort();
  const r = await runComparison({ models, prompt: "hi", call: async () => { calls++; return "x"; }, signal: ctl.signal });
  assert.equal(calls, 0);
  assert.deepEqual(r.map((x) => x.finish), ["cancelled", "cancelled"]);
});

test("errors never carry the model's key or anything key-shaped", async () => {
  const call = async (m: any) => { throw new Error(`HTTP 401: invalid key ${m.apiKey} (Authorization: Bearer ${m.apiKey}) also sk-live-ZZZZZZZZZZZZZZZZZZZZZZZZ`); };
  const r = await runComparison({ models, prompt: "hi", call });
  const all = JSON.stringify(r);
  assert.ok(!all.includes(KEY_A) && !all.includes(KEY_B), "own keys are removed");
  assert.ok(!all.includes("ZZZZZZZZZZZZ"), "key-shaped strings are removed");
  assert.match(r[0].error!, /invalid key/);
  assert.ok(safeError(new Error("x".repeat(1000)), models[0]).length <= 301, "error text is bounded");
});

test("an empty answer is an error and a huge answer is cut", async () => {
  const r = await runComparison({ models, prompt: "hi", call: async (m: any) => (m.id === "m-a" ? "   " : "y".repeat(MAX_ANSWER_CHARS + 500)) });
  assert.equal(r[0].finish, "error");
  assert.match(r[0].error!, /empty answer/);
  assert.equal(r[1].finish, "done");
  assert.equal(r[1].text!.length, MAX_ANSWER_CHARS);
  assert.equal(r[1].truncated, true);
});

test("completion parsing: string, parts array, legacy text, nothing", () => {
  assert.equal(extractCompletionText({ choices: [{ message: { content: "a" } }] }), "a");
  assert.equal(extractCompletionText({ choices: [{ message: { content: [{ text: "a" }, { type: "x" }, { text: "b" }] } }] }), "ab");
  assert.equal(extractCompletionText({ choices: [{ text: "legacy" }] }), "legacy");
  assert.equal(extractCompletionText({}), "");
  assert.equal(extractCompletionText(null), "");
});

test("the real caller: asks the OpenAI-compatible endpoint, and refuses a missing key before any request", async () => {
  const seen: any[] = [];
  const upstream = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => { seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) }); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content: "pong" } }] })); });
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(upstream.address() as any).port}/v1`;
  try {
    const call = createModelCaller({ resolveBaseUrl: (m) => m.baseUrl || "" });
    const sig = new AbortController().signal;
    const text = await call({ id: "x", provider: "custom", modelName: "mini", baseUrl: base, apiKey: KEY_A }, "ping", { signal: sig, maxTokens: 50, timeoutMs: 5000 });
    assert.equal(text, "pong");
    assert.equal(seen[0].url, "/v1/chat/completions");
    assert.equal(seen[0].auth, `Bearer ${KEY_A}`);
    assert.equal(seen[0].body.model, "mini");
    assert.equal(seen[0].body.stream, false);
    assert.equal(seen[0].body.max_tokens, 50);
    await assert.rejects(() => call({ id: "x", provider: "custom", baseUrl: base, apiKey: "" }, "ping", { signal: sig, maxTokens: 5, timeoutMs: 1000 }), /No API key/);
    await assert.rejects(() => call({ id: "x", provider: "custom", baseUrl: base, apiKey: "••••••••" }, "ping", { signal: sig, maxTokens: 5, timeoutMs: 1000 }), /No API key/);
    await assert.rejects(() => call({ id: "x", provider: "custom", apiKey: KEY_A }, "ping", { signal: sig, maxTokens: 5, timeoutMs: 1000 }), /base URL/);
    assert.equal(seen.length, 1, "the refused calls never reached the provider");
    // a local model (ollama) needs no key
    assert.equal(await call({ id: "o", provider: "ollama", modelName: "llama", baseUrl: base }, "ping", { signal: sig, maxTokens: 5, timeoutMs: 1000 }), "pong");
  } finally { upstream.close(); }
});

// ---- HTTP surface --------------------------------------------------------------------------------------------------

async function withApp(opts: { call: any; now?: () => number; userId?: string | null }, fn: (base: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  const owned: Record<string, any> = { "u1:m-a": models[0], "u1:m-b": models[1], "u1:m-c": { id: "m-c", name: "Gamma", provider: "x", apiKey: "k".repeat(12) }, "u1:m-off": { id: "m-off", name: "Off", enabled: false }, "u2:m-z": { id: "m-z", name: "Foreign", apiKey: "sk-foreign-123456789012" } };
  registerCompareRoutes(app, { getUserId: async (req) => (opts.userId === undefined ? (req.headers["x-user"] as string) || null : opts.userId), getModel: (u, id) => owned[`${u}:${id}`] || null, call: opts.call, now: opts.now, timeoutMs: 2000 });
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  try { await fn(`http://127.0.0.1:${(srv.address() as any).port}`); } finally { srv.closeAllConnections?.(); srv.close(); }
}
const post = (base: string, body: any, user = "u1") => fetch(`${base}/api/compare`, { method: "POST", headers: { "content-type": "application/json", ...(user ? { "x-user": user } : {}) }, body: JSON.stringify(body) });

test("route: happy path returns both answers and no key anywhere", async () => {
  await withApp({ call: async (m: any) => `hello from ${m.name}` }, async (base) => {
    const r = await post(base, { prompt: "hi", modelIds: ["m-a", "m-b"] });
    assert.equal(r.status, 200);
    const text = await r.text();
    const j = JSON.parse(text);
    assert.deepEqual(j.results.map((x: any) => [x.modelId, x.finish, x.text]), [["m-a", "done", "hello from Alpha"], ["m-b", "done", "hello from Beta"]]);
    assert.ok(!text.includes(KEY_A) && !text.includes(KEY_B) && !/apiKey/i.test(text), "no credential in the response");
  });
});

test("route: signed out, bad bodies, unknown / foreign / disabled models", async () => {
  await withApp({ call: async () => "x" }, async (base) => {
    assert.equal((await post(base, { prompt: "hi", modelIds: ["m-a", "m-b"] }, "")).status, 401);
    assert.equal((await post(base, { prompt: "hi", modelIds: ["m-a"] })).status, 400);
    assert.equal((await post(base, { prompt: "hi", modelIds: ["m-a", "m-b", "m-c", "m-a"] })).status, 400);
    assert.equal((await post(base, { prompt: "x".repeat(MAX_PROMPT_CHARS + 1), modelIds: ["m-a", "m-b"] })).status, 413);
    const foreign = await post(base, { prompt: "hi", modelIds: ["m-a", "m-z"] });
    assert.equal(foreign.status, 404, "another user's model reads as not found");
    assert.equal((await foreign.json()).code, "MODEL_NOT_FOUND");
    assert.equal((await post(base, { prompt: "hi", modelIds: ["m-a", "nope"] })).status, 404, "unknown reads the same as foreign");
    const off = await post(base, { prompt: "hi", modelIds: ["m-a", "m-off"] });
    assert.equal(off.status, 409);
    assert.equal((await off.json()).code, "MODEL_DISABLED");
  });
});

test("route: a failing model is reported per model with a 200, and its key stays out", async () => {
  await withApp({ call: async (m: any) => { if (m.id === "m-b") throw new Error(`HTTP 401 for ${m.apiKey}`); return "ok"; } }, async (base) => {
    const r = await post(base, { prompt: "hi", modelIds: ["m-a", "m-b"] });
    assert.equal(r.status, 200);
    const text = await r.text();
    const j = JSON.parse(text);
    assert.equal(j.results[0].finish, "done");
    assert.equal(j.results[1].finish, "error");
    assert.ok(!text.includes(KEY_B));
  });
});

test("route: one comparison at a time per user, others unaffected", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await withApp({ call: async () => { await gate; return "x"; } }, async (base) => {
    const first = post(base, { prompt: "hi", modelIds: ["m-a", "m-b"] });
    await sleep(100);
    const second = await post(base, { prompt: "hi", modelIds: ["m-a", "m-b"] });
    assert.equal(second.status, 429);
    assert.equal((await second.json()).code, "COMPARE_BUSY");
    release();
    assert.equal((await first).status, 200);
    assert.equal((await post(base, { prompt: "hi", modelIds: ["m-a", "m-b"] })).status, 200, "free again once finished");
  });
});

test("route: per-minute limit with Retry-After, which clears as time passes", async () => {
  let t = 1_000_000;
  await withApp({ call: async () => "x", now: () => t }, async (base) => {
    for (let i = 0; i < COMPARE_PER_MINUTE; i++) assert.equal((await post(base, { prompt: "hi", modelIds: ["m-a", "m-b"] })).status, 200);
    const over = await post(base, { prompt: "hi", modelIds: ["m-a", "m-b"] });
    assert.equal(over.status, 429);
    assert.equal((await over.json()).code, "COMPARE_RATE_LIMIT");
    assert.ok(Number(over.headers.get("retry-after")) >= 1);
    t += 61_000;
    assert.equal((await post(base, { prompt: "hi", modelIds: ["m-a", "m-b"] })).status, 200);
  });
});

test("route: the browser disconnecting aborts every upstream call", async () => {
  // open the request on a raw socket, then destroy it: the browser going away
  const sigs: AbortSignal[] = [];
  const app = express(); app.use(express.json());
  registerCompareRoutes(app, { getUserId: async () => "u1", getModel: (_u, id) => (models.find((m) => m.id === id) as any) || null, call: (_m: any, _p: string, o: any) => new Promise<string>((_r, rej) => { sigs.push(o.signal); o.signal.addEventListener("abort", () => rej(new ProviderError("cancelled", { kind: "cancelled", retryable: false })), { once: true }); }) });
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const port = (srv.address() as any).port;
    const body = JSON.stringify({ prompt: "hi", modelIds: ["m-a", "m-b"] });
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/api/compare", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } });
    req.on("error", () => {});
    req.end(body);
    for (let i = 0; i < 50 && sigs.length < 2; i++) await sleep(20);
    assert.equal(sigs.length, 2, "both upstream calls started");
    req.destroy(); // the browser goes away
    for (let i = 0; i < 50 && !sigs.every((s) => s.aborted); i++) await sleep(20);
    assert.ok(sigs.every((s) => s.aborted), "both upstream calls were aborted");
  } finally { srv.closeAllConnections?.(); srv.close(); }
});
