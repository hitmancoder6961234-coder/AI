import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before } from "node:test";
import type { AddressInfo, Socket } from "node:net";

/**
 * The REAL Gemini resilience layer and the REAL Google SDK, talking to a local stub (the SDK honours GOOGLE_GEMINI_BASE_URL).
 * This proves what a Promise.race timeout cannot: that a timeout or a user cancel actually closes the HTTP connection.
 */
let server: http.Server;
const hits: Record<string, number> = {};
const watched = new Set<Socket>();
const watch = (s: Socket) => { watched.add(s); s.once("close", () => watched.delete(s)); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = async (until: () => boolean, ms = 4000) => { const t0 = Date.now(); while (!until() && Date.now() - t0 < ms) await sleep(20); return until(); };
const KEY = "AIzaSyFAKE-KEY-for-tests-0123456789abcdef";
const okBody = (text: string) => ({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] });

process.env.PROVIDER_STREAM_IDLE_MS = "300";
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

before(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url || "/", "http://x");
    const scenario = req.headers["x-scenario"] as string | undefined; // the SDK forwards custom headers
    const model = decodeURIComponent((u.pathname.match(/models\/([^:/]+)/) || [])[1] || "m");
    const mode = model.replace(/^gemini-/, "");
    const key = `${mode}`;
    const n = (hits[key] = (hits[key] || 0) + 1);
    const stream = u.pathname.includes(":streamGenerateContent");
    const json = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    void scenario;
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (mode.startsWith("flaky")) return n <= 1 ? json(503, { error: { code: 503, message: "The model is overloaded. Please try again later.", status: "UNAVAILABLE" } }) : json(200, okBody("recovered"));
      if (mode.startsWith("always503")) return json(503, { error: { code: 503, message: "overloaded", status: "UNAVAILABLE" } });
      if (mode.startsWith("denied")) return json(403, { error: { code: 403, message: "Permission denied for this model", status: "PERMISSION_DENIED" } });
      if (mode.startsWith("hang")) { watch(req.socket); return; }
      if (mode.startsWith("stall")) {
        watch(req.socket);
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify(okBody("first part"))}\n\n`);
        return; // then silence
      }
      if (stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify(okBody("Hello "))}\n\n`);
        res.end(`data: ${JSON.stringify(okBody("world"))}\n\n`);
        return;
      }
      return json(200, okBody("generated"));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.GOOGLE_GEMINI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); server.closeAllConnections?.(); });

const { generateGeminiWithResilience, streamGeminiWithResilience } = await import("../server/gemini-resilience.js");
const gen = (model: string, extra: Record<string, unknown> = {}) => generateGeminiWithResilience({ apiKey: KEY, modelName: model, contents: "hi", timeoutMs: 1500, ...extra } as any);

test("a transient 503 is retried and the call then succeeds", async () => {
  const r = await gen("gemini-flaky-a");
  assert.equal(r.text, "recovered");
  assert.equal(hits["flaky-a"], 2, "one failure, one retry");
});

test("a non-retryable error (403) is not retried and keeps the provider's message", async () => {
  await assert.rejects(gen("gemini-denied-a"), (e: any) => {
    assert.match(String(e.message), /Permission denied/);
    assert.ok(!String(e.message).includes(KEY), "the API key must not appear in the error");
    return true;
  });
  assert.equal(hits["denied-a"], 1, "exactly one attempt");
});

test("a model that never answers times out, and every attempt really closes its connection", async () => {
  const t0 = Date.now();
  await assert.rejects(gen("gemini-hang-a", { timeoutMs: 250 }), (e: any) => /timed out/i.test(String(e.message)));
  assert.ok(Date.now() - t0 < 8000, "bounded");
  assert.equal(hits["hang-a"], 3, "three attempts, as before");
  assert.ok(await settle(() => watched.size === 0), "the timed-out requests were cancelled, not left running");
});

test("cancelling a generation stops it at once and closes the connection", async () => {
  const ctl = new AbortController();
  const t0 = Date.now();
  const p = gen("gemini-hang-b", { timeoutMs: 10_000, abortSignal: ctl.signal });
  setTimeout(() => ctl.abort(), 200);
  await assert.rejects(p, (e: any) => e.name === "AbortError" || /abort/i.test(String(e.message)));
  assert.ok(Date.now() - t0 < 1500, "returned promptly after the cancel");
  assert.equal(hits["hang-b"], 1, "no retry after a cancel");
  assert.ok(await settle(() => watched.size === 0), "the request was closed");
});

test("cancelling while waiting between retries wakes up immediately and makes no further attempt", async () => {
  const ctl = new AbortController();
  const t0 = Date.now();
  const p = gen("gemini-always503-a", { timeoutMs: 5000, abortSignal: ctl.signal });
  setTimeout(() => ctl.abort(), 250);
  await assert.rejects(p, (e: any) => e.name === "AbortError" || /abort|cancel/i.test(String(e.message)));
  assert.ok(Date.now() - t0 < 1200, `did not sleep through the backoff (${Date.now() - t0} ms)`);
  assert.equal(hits["always503-a"], 1);
});

test("streaming: a normal answer arrives in order", async () => {
  const got: string[] = [];
  const r = await streamGeminiWithResilience({ apiKey: KEY, modelName: "gemini-ok-a", contents: "hi", onChunk: (t) => got.push(t) });
  assert.equal(got.join(""), "Hello world");
  assert.equal(r.modelUsed.length > 0, true);
});

test("streaming: a model that goes silent mid-answer is cut off by the idle timeout; the text that arrived is kept; nothing is retried", async () => {
  const got: string[] = [];
  const t0 = Date.now();
  await assert.rejects(streamGeminiWithResilience({ apiKey: KEY, modelName: "gemini-stall-a", contents: "hi", initialTimeoutMs: 5000, onChunk: (t) => got.push(t) }), (e: any) => /idle timeout|stopped sending/i.test(String(e.message)));
  assert.deepEqual(got, ["first part"], "the partial answer was delivered before the failure");
  assert.ok(Date.now() - t0 < 4000);
  assert.equal(hits["stall-a"], 1, "a stream that had started is never retried (it would repeat or corrupt the answer)");
  assert.ok(await settle(() => watched.size === 0), "the stalled connection was released");
});

test("streaming: cancelling mid-answer stops the stream and closes the connection", async () => {
  const ctl = new AbortController();
  const got: string[] = [];
  const p = streamGeminiWithResilience({ apiKey: KEY, modelName: "gemini-stall-b", contents: "hi", initialTimeoutMs: 5000, abortSignal: ctl.signal, onChunk: (t) => got.push(t) });
  setTimeout(() => ctl.abort(), 120);
  await assert.rejects(p, (e: any) => e.name === "AbortError" || /abort/i.test(String(e.message)));
  assert.deepEqual(got, ["first part"]);
  assert.ok(await settle(() => watched.size === 0), "the connection was closed after the cancel");
});

test("streaming: a connection that never answers times out at the connection limit and is cancelled", async () => {
  await assert.rejects(streamGeminiWithResilience({ apiKey: KEY, modelName: "gemini-hang-c", contents: "hi", initialTimeoutMs: 250, onChunk: () => {} }), (e: any) => /timed out/i.test(String(e.message)));
  assert.ok(await settle(() => watched.size === 0), "every attempt's connection was closed");
});
