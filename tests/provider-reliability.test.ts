import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before } from "node:test";
import type { AddressInfo, Socket } from "node:net";
import {
  ProviderError, abortableSleep, classifyError, classifyStatus, fetchWithPolicy, iterateWithIdleTimeout, parseRetryAfter, withIdleTimeout,
} from "../server/provider-http.js";

let server: http.Server;
let base = "";
const hits: Record<string, number> = {};
const open = new Set<Socket>(); // sockets of requests deliberately left unanswered (the keep-alive pool of earlier tests is not counted)
const watch = (s: Socket) => { open.add(s); s.once("close", () => open.delete(s)); };
const hit = (k: string) => (hits[k] = (hits[k] || 0) + 1);
const SECRET = "sk-test-SECRET-KEY-1234567890abcdef";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = async (until: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!until() && Date.now() - t0 < ms) await sleep(20); return until(); };
const FAST = { baseDelayMs: 5, maxDelayMs: 40, retryBudgetMs: 5000 };

before(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url || "/", "http://x");
    const key = u.pathname + (u.searchParams.get("id") || "");
    const n = hit(key);
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
    switch (u.pathname) {
      case "/ok": return json(200, { ok: true });
      case "/flaky": return n <= 2 ? json(503, { error: { message: "model overloaded" } }) : json(200, { ok: true, served: n });
      case "/always503": return json(503, { error: { message: "still overloaded" } });
      case "/rate": return n === 1 ? json(429, { error: { message: "slow down" } }, { "retry-after": "0" }) : json(200, { ok: true });
      case "/rate-long": return json(429, { error: { message: "daily quota" } }, { "retry-after": "3600" });
      case "/auth": return json(401, { error: { message: `Incorrect API key provided: ${SECRET}` } });
      case "/bad": return json(400, { error: { message: "max_tokens is too large" } });
      case "/missing": return json(404, { error: { message: "model not found" } });
      case "/hang": watch(req.socket); return void 0; // never answers
      case "/reset": if (n === 1) { req.socket.destroy(); return; } return json(200, { ok: true });
      case "/stream": watch(req.socket); res.writeHead(200, { "content-type": "text/event-stream" }); res.write("data: one\n\n"); return void 0; // then silence
      case "/stream-ok": res.writeHead(200, { "content-type": "text/event-stream" }); res.write("data: a\n\n"); res.end("data: b\n\n"); return;
      default: return json(404, {});
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); server.closeAllConnections?.(); });

test("a healthy call succeeds on the first attempt", async () => {
  const res = await fetchWithPolicy(`${base}/ok?id=a`, {}, { label: "stub" });
  assert.equal(res.status, 200);
  assert.equal(hits["/oka"], 1);
});

test("transient failures (503) are retried and then succeed", async () => {
  const res = await fetchWithPolicy(`${base}/flaky?id=b`, {}, { label: "stub", ...FAST });
  assert.equal(res.status, 200);
  assert.equal(hits["/flakyb"], 3, "two failures, then the successful third attempt");
});

test("retries are bounded: a provider that keeps failing is given up on, with a clear message", async () => {
  await assert.rejects(fetchWithPolicy(`${base}/always503?id=c`, {}, { label: "stub", maxAttempts: 3, ...FAST }), (e: any) => {
    assert.ok(e instanceof ProviderError);
    assert.equal(e.kind, "overloaded");
    assert.equal(e.status, 503);
    assert.equal(e.attempts, 3);
    assert.match(e.message, /HTTP 503: still overloaded/, "the provider's own message is kept");
    assert.match(e.message, /after 3 attempts/);
    return true;
  });
  assert.equal(hits["/always503c"], 3, "exactly three requests, not more");
});

test("rate limits honour Retry-After; a long Retry-After fails fast instead of hanging", async () => {
  const res = await fetchWithPolicy(`${base}/rate?id=d`, {}, { label: "stub", ...FAST });
  assert.equal(res.status, 200);
  assert.equal(hits["/rated"], 2);
  const t0 = Date.now();
  await assert.rejects(fetchWithPolicy(`${base}/rate-long?id=e`, {}, { label: "stub", ...FAST }), (e: any) => e.kind === "rate_limit" && /daily quota/.test(e.message) && /not retried/.test(e.message));
  assert.ok(Date.now() - t0 < 1000, "did not wait an hour");
  assert.equal(hits["/rate-longe"], 1, "and did not hammer the provider");
});

test("errors that retrying cannot fix are NOT retried, keep their message, and never leak the key", async () => {
  for (const [path, kind, status, text] of [["/auth", "auth", 401, /Incorrect API key/], ["/bad", "bad_request", 400, /max_tokens is too large/], ["/missing", "not_found", 404, /model not found/]] as const) {
    await assert.rejects(
      fetchWithPolicy(`${base}${path}?id=f`, { method: "POST", headers: { authorization: `Bearer ${SECRET}` }, body: "{}" }, { label: "stub", ...FAST }),
      (e: any) => {
        assert.equal(e.kind, kind, path);
        assert.equal(e.status, status);
        assert.equal(e.retryable, false);
        assert.match(e.message, text);
        assert.ok(!e.message.includes(SECRET), `the API key must not appear in the error: ${e.message}`);
        return true;
      },
    );
    assert.equal(hits[`${path}f`], 1, `${path} was tried exactly once`);
  }
});

test("a call that never answers times out (and every attempt really cancels its connection)", async () => {
  const t0 = Date.now();
  await assert.rejects(fetchWithPolicy(`${base}/hang?id=g`, {}, { label: "stub", timeoutMs: 150, maxAttempts: 2, ...FAST }), (e: any) => {
    assert.equal(e.kind, "timeout");
    assert.match(e.message, /timed out/);
    assert.equal(e.attempts, 2);
    return true;
  });
  assert.ok(Date.now() - t0 < 2000, "bounded, not hanging");
  assert.equal(hits["/hangg"], 2, "one request per attempt");
  assert.ok(await settle(() => open.size === 0), "the abandoned connections were closed, not leaked");
});

test("a connection reset before any answer is retried", async () => {
  const res = await fetchWithPolicy(`${base}/reset?id=h`, {}, { label: "stub", ...FAST });
  assert.equal(res.status, 200);
  assert.equal(hits["/reseth"], 2);
});

test("cancelling during a request stops it at once, makes no further attempts and releases the connection", async () => {
  const ctl = new AbortController();
  const t0 = Date.now();
  const p = fetchWithPolicy(`${base}/hang?id=i`, {}, { label: "stub", timeoutMs: 10_000, maxAttempts: 3, signal: ctl.signal, ...FAST });
  setTimeout(() => ctl.abort(), 120);
  await assert.rejects(p, (e: any) => e.kind === "cancelled" && e.name === "AbortError");
  assert.ok(Date.now() - t0 < 1000, "returned promptly after the abort");
  assert.equal(hits["/hangi"], 1, "no retry after a cancel");
  assert.ok(await settle(() => open.size === 0), "the in-flight connection was closed");
});

test("cancelling while waiting between retries interrupts the wait immediately", async () => {
  const ctl = new AbortController();
  const t0 = Date.now();
  const p = fetchWithPolicy(`${base}/always503?id=j`, {}, { label: "stub", maxAttempts: 5, baseDelayMs: 4000, maxDelayMs: 8000, retryBudgetMs: 60_000, signal: ctl.signal });
  setTimeout(() => ctl.abort(), 200);
  await assert.rejects(p, (e: any) => e.kind === "cancelled");
  assert.ok(Date.now() - t0 < 1500, `woke up at once instead of sleeping the full backoff (${Date.now() - t0} ms)`);
  assert.equal(hits["/always503j"], 1, "and made no further attempt");
  // an already-cancelled request never reaches the provider
  const done = new AbortController(); done.abort();
  await assert.rejects(fetchWithPolicy(`${base}/ok?id=k`, {}, { signal: done.signal }), (e: any) => e.kind === "cancelled");
  assert.equal(hits["/okk"] || 0, 0);
  await assert.rejects(abortableSleep(5000, done.signal), (e: any) => e.kind === "cancelled");
});

test("streaming: a provider that goes silent mid-answer is cut off by the idle timeout, and nothing is retried or leaked", async () => {
  const res = await fetchWithPolicy(`${base}/stream?id=l`, {}, { label: "stub", stream: true, headersTimeoutMs: 1000, ...FAST });
  const got: string[] = [];
  const t0 = Date.now();
  await assert.rejects(async () => {
    for await (const chunk of iterateWithIdleTimeout(res.body!, { idleMs: 200, label: "stub" })) got.push(Buffer.from(chunk).toString());
  }, (e: any) => e.kind === "idle_timeout" && /idle timeout/.test(e.message));
  assert.match(got.join(""), /data: one/, "the text that did arrive was delivered");
  assert.ok(Date.now() - t0 < 1500);
  assert.equal(hits["/streaml"], 1, "no retry once the answer had started");
  assert.ok(await settle(() => open.size === 0), "the stream connection was released");
});

test("streaming: cancelling mid-stream stops reading and closes the upstream connection", async () => {
  const ctl = new AbortController();
  const res = await fetchWithPolicy(`${base}/stream?id=m`, {}, { label: "stub", stream: true, signal: ctl.signal, ...FAST });
  setTimeout(() => ctl.abort(), 150);
  await assert.rejects(async () => { for await (const _ of iterateWithIdleTimeout(res.body!, { idleMs: 5000, signal: ctl.signal })) { /* drain */ } }, (e: any) => e.kind === "cancelled");
  assert.ok(await settle(() => open.size === 0), "the connection was closed");
});

test("streaming: a normal stream is read to the end", async () => {
  const res = await fetchWithPolicy(`${base}/stream-ok?id=n`, {}, { label: "stub", stream: true });
  let text = "";
  for await (const chunk of iterateWithIdleTimeout(res.body!, { idleMs: 1000 })) text += Buffer.from(chunk).toString();
  assert.match(text, /data: a[\s\S]*data: b/);
});

test("withIdleTimeout protects SDK iterators too (it aborts the request and releases the iterator)", async () => {
  let returned = false;
  let aborted = false;
  const silent: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { next: () => (i++ === 0 ? Promise.resolve({ done: false, value: "first" }) : new Promise(() => {})), return: () => { returned = true; return Promise.resolve({ done: true, value: undefined }); } } as AsyncIterator<string>;
    },
  };
  const seen: string[] = [];
  await assert.rejects(async () => { for await (const v of withIdleTimeout(silent, 150, () => { aborted = true; }, "gemini")) seen.push(v); }, (e: any) => e.kind === "idle_timeout");
  assert.deepEqual(seen, ["first"]);
  assert.ok(aborted && returned, "onIdle aborted the request and the iterator was closed");
});

test("classification: which failures are worth retrying", () => {
  const table: Array<[number, string, boolean]> = [[429, "rate_limit", true], [503, "overloaded", true], [529, "overloaded", true], [500, "server", true], [502, "server", true], [504, "server", true], [408, "timeout", true],
    [400, "bad_request", false], [401, "auth", false], [403, "auth", false], [404, "not_found", false], [413, "bad_request", false], [422, "bad_request", false]];
  for (const [status, kind, retryable] of table) assert.deepEqual(classifyStatus(status), { kind, retryable }, String(status));
  assert.equal(classifyError(new Error("fetch failed")).retryable, true);
  assert.equal(classifyError(Object.assign(new Error("boom"), { status: 429 })).kind, "rate_limit");
  assert.equal(classifyError(new Error("Request timed out after 5000ms")).kind, "timeout");
  assert.equal(classifyError(Object.assign(new Error("x"), { name: "AbortError" })).kind, "cancelled");
  assert.equal(classifyError(new Error("something else entirely")).retryable, false);
  assert.equal(parseRetryAfter("2"), 2000);
  assert.equal(parseRetryAfter(new Date(Date.now() + 5000).toUTCString())! > 3000, true);
  assert.equal(parseRetryAfter(undefined), undefined);
});
