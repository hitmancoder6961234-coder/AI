import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { DatabaseSync } from "node:sqlite";
import test, { after, before } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";

process.env.LOG_FORMAT = "json";
process.env.LOG_LEVEL = "debug";
process.env.LOG_ACCESS = "true";

const { logger, setLogSink, scrubFields, isSensitiveKey, installConsoleRequestId, log } = await import("../server/observability/logger.js");
const { requestContext, rebindRequestContext, jsonErrorHandler, pickRequestId, newRequestId } = await import("../server/observability/request-context.js");
const { livenessHandler, readinessHandler, runCheck, evaluateReadiness, markDraining } = await import("../server/observability/health.js");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = async (until: () => boolean, ms = 2000) => { const t0 = Date.now(); while (!until() && Date.now() - t0 < ms) await sleep(15); return until(); };

const logs: any[] = [];
setLogSink((line) => { logs.push(JSON.parse(line)); });
const consoleSeen: unknown[][] = [];
const realLog = console.log;
console.log = (...a: unknown[]) => { consoleSeen.push(a); }; // installConsoleRequestId() wraps whatever is here
installConsoleRequestId();

let server: http.Server;
let base = "";

before(async () => {
  const app = express();
  app.use(requestContext());
  app.use(express.json());
  app.use(rebindRequestContext());
  app.get("/ok", (_req, res) => res.json({ ok: true }));
  app.get("/arr", (_req, res) => res.status(400).json([1, 2]));
  app.get("/err400", (_req, res) => res.status(400).json({ error: "bad input", code: "BAD" }));
  app.get("/err-has-id", (_req, res) => res.status(400).json({ error: "x", requestId: "mine-123456" }));
  app.get("/server-error", (_req, res) => res.status(500).json({ error: "kaput" }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/query", (_req, res) => res.json({ ok: true }));
  app.post("/echo", async (req, res) => {
    await sleep(20);
    logger.info("route_after_await", { step: "after-body-parse-and-await", prompt: req.body?.prompt });
    res.json({ ok: true });
  });
  app.get("/slow/:n", async (req, res) => {
    await sleep(Number(req.params.n));
    logger.info("slow_route", { n: Number(req.params.n) });
    res.json({ n: Number(req.params.n) });
  });
  app.get("/console", (_req, res) => { console.log("hello from the route", { a: 1 }); res.json({ ok: true }); });
  app.get("/boom", () => { throw new Error("secret internal detail: C:\\srv\\app\\db.sqlite and sk-abcdefghijklmnopqrstuvwxyz0123456789"); });
  app.get("/teapot", (_req, _res, next) => next(Object.assign(new Error("I am a teapot"), { status: 418 })));
  app.get("/hang", () => { /* never answers */ });
  app.use(jsonErrorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { console.log = realLog; setLogSink(); server.close(); server.closeAllConnections?.(); });

const since = (n: number) => logs.slice(n);

// ======================================================================================== request ids

test("every request gets a unique, well-formed id, returned in X-Request-Id", async () => {
  const ids = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const r = await fetch(`${base}/ok`);
    const id = r.headers.get("x-request-id")!;
    assert.match(id, /^req_[A-Za-z0-9_-]{12}$/);
    ids.add(id);
  }
  assert.equal(ids.size, 100, "no collisions");
  assert.match(newRequestId(), /^req_/);
});

test("a well-formed incoming id is kept (so a proxy's trace can be followed); anything else is replaced", async () => {
  for (const good of ["trace-1234567890", "abc.DEF_123-xyz", "a".repeat(64)]) {
    assert.equal((await fetch(`${base}/ok`, { headers: { "x-request-id": good } })).headers.get("x-request-id"), good);
  }
  for (const bad of ["short", "has spaces in it", "a".repeat(65), "semi;colon=bad", "<script>alert(1)</script>", "ünïcode-ídentifier"]) {
    const r = await fetch(`${base}/ok`, { headers: { "x-request-id": bad } });
    const id = r.headers.get("x-request-id")!;
    assert.notEqual(id, bad, `rejected: ${bad}`);
    assert.match(id, /^req_/);
  }
  assert.match(pickRequestId(undefined), /^req_/);
  assert.equal(pickRequestId(["array-id-123456", "second"]), "array-id-123456");
});

test("JSON error bodies carry the request id; successful bodies and arrays are untouched; an existing field is not overwritten", async () => {
  const ok = await fetch(`${base}/ok`);
  assert.deepEqual(await ok.json(), { ok: true }, "success responses are unchanged");

  const e = await fetch(`${base}/err400`);
  const body = await e.json();
  assert.equal(e.status, 400);
  assert.equal(body.requestId, e.headers.get("x-request-id"), "the body id matches the header");
  assert.equal(body.error, "bad input", "existing fields are preserved");
  assert.equal(body.code, "BAD");

  assert.deepEqual(await (await fetch(`${base}/arr`)).json(), [1, 2], "array bodies are never modified");
  assert.equal((await (await fetch(`${base}/err-has-id`)).json()).requestId, "mine-123456");
  assert.equal((await (await fetch(`${base}/server-error`)).json()).requestId.startsWith("req_"), true);
});

test("the id follows the request through body parsing and async work, and concurrent requests never mix", async () => {
  const mark = logs.length;
  const r = await fetch(`${base}/echo`, { method: "POST", headers: { "content-type": "application/json", "x-request-id": "echo-request-001" }, body: JSON.stringify({ prompt: "MY PRIVATE PROMPT TEXT" }) });
  assert.equal(r.status, 200);
  const line = since(mark).find((l) => l.event === "route_after_await");
  assert.ok(line, "the route's log line was written");
  assert.equal(line.requestId, "echo-request-001", "id survived JSON body parsing and an await");
  assert.equal(line.prompt, "[redacted]", "and the private prompt never reached the log");

  const mark2 = logs.length;
  const results = await Promise.all([300, 10, 150, 40, 220, 5].map((n, i) => fetch(`${base}/slow/${n}`, { headers: { "x-request-id": `concurrent-${i}-abcdef` } }).then(async (res) => ({ n, id: res.headers.get("x-request-id"), body: await res.json() }))));
  const slow = since(mark2).filter((l) => l.event === "slow_route");
  assert.equal(slow.length, 6);
  for (const r of results) {
    const entry = slow.find((l) => l.n === r.n)!;
    assert.equal(entry.requestId, r.id, `request for ${r.n} ms logged under its own id`);
  }
});

test("console output written while serving a request is prefixed with its id", async () => {
  consoleSeen.length = 0;
  const r = await fetch(`${base}/console`, { headers: { "x-request-id": "console-trace-9999" } });
  assert.equal(r.status, 200);
  assert.deepEqual(consoleSeen[0], ["[console-trace-9999] hello from the route", { a: 1 }]);
});

test("one access-log entry per request: status, duration and level by outcome; never the query string or any body", async () => {
  const mark = logs.length;
  await fetch(`${base}/query?token=SUPER-SECRET-TOKEN&q=my+private+question`, { headers: { "x-request-id": "access-log-0001" } });
  await fetch(`${base}/err400`, { headers: { "x-request-id": "access-log-0002" } });
  await fetch(`${base}/server-error`, { headers: { "x-request-id": "access-log-0003" } });
  await fetch(`${base}/api/health`);
  await settle(() => since(mark).filter((l) => l.event === "http_request").length >= 3);
  const access = since(mark).filter((l) => l.event === "http_request");
  assert.equal(access.length, 3, "health checks are not logged (noise)");
  const [a, b, c] = ["access-log-0001", "access-log-0002", "access-log-0003"].map((id) => access.find((l) => l.requestId === id));
  assert.equal(a.status, 200); assert.equal(a.level, "info"); assert.equal(a.route, "/query"); assert.equal(a.method, "GET");
  assert.equal(b.status, 400); assert.equal(b.level, "warn");
  assert.equal(c.status, 500); assert.equal(c.level, "error");
  assert.equal(typeof a.durationMs, "number");
  const text = JSON.stringify(since(mark));
  assert.ok(!text.includes("SUPER-SECRET-TOKEN") && !text.includes("private+question"), "the query string is never logged");
});

test("a client that disconnects mid-request is logged as aborted", async () => {
  const mark = logs.length;
  const sock = net.connect(Number(new URL(base).port), "127.0.0.1");
  await new Promise<void>((r) => sock.on("connect", () => r()));
  sock.write("GET /hang HTTP/1.1\r\nHost: x\r\nX-Request-Id: abort-trace-0001\r\n\r\n");
  await sleep(100);
  sock.destroy();
  assert.ok(await settle(() => since(mark).some((l) => l.event === "http_request_aborted")));
  assert.equal(since(mark).find((l) => l.event === "http_request_aborted").requestId, "abort-trace-0001");
});

test("unhandled errors answer with JSON and the request id; internals and stack traces never leave the server", async () => {
  const mark = logs.length;
  const r = await fetch(`${base}/boom`, { headers: { "x-request-id": "boom-trace-00001" } });
  const body = await r.json();
  assert.equal(r.status, 500);
  assert.deepEqual(Object.keys(body).sort(), ["code", "error", "requestId"]);
  assert.equal(body.error, "Internal server error");
  assert.equal(body.requestId, "boom-trace-00001");
  const text = JSON.stringify(body);
  assert.ok(!/secret internal|srv|sqlite|sk-abc|at .*\(/i.test(text), "no message, path, key or stack in the response: " + text);

  const entry = since(mark).find((l) => l.event === "request_error");
  assert.equal(entry.requestId, "boom-trace-00001");
  assert.equal(entry.level, "error");
  assert.ok(!JSON.stringify(entry).includes("sk-abcdefghijklmnopqrstuvwxyz0123456789"), "the key inside the error message is redacted in the log");
  assert.ok(!("stack" in entry.err), "no stack in the log either");

  const t = await fetch(`${base}/teapot`);
  const tb = await t.json();
  assert.equal(t.status, 418);
  assert.equal(tb.error, "I am a teapot", "client-error messages are safe and kept");
  assert.ok(tb.requestId);

  const bad = await fetch(`${base}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
  assert.equal(bad.status, 400, "malformed JSON is a 400, not a crash");
  assert.ok((await bad.json()).requestId);
});

// ======================================================================================== logging hygiene

test("sensitive fields are redacted by NAME; counters and identifiers are kept", () => {
  for (const k of ["password", "Authorization", "cookie", "set-cookie", "apiKey", "api_key", "accessToken", "refresh_token", "secret", "clientSecret", "prompt", "content", "message", "messages", "text", "body", "query", "email", "history", "systemInstruction", "headers"]) {
    assert.equal(isSensitiveKey(k), true, k);
  }
  for (const k of ["requestId", "status", "durationMs", "inputTokens", "outputTokens", "maxTokens", "model", "provider", "attempt", "kind", "route", "bytes"]) {
    assert.equal(isSensitiveKey(k), false, k);
  }
  const out = scrubFields({
    prompt: "my diary", content: "file text", message: "hello", authorization: "Bearer abc", apiKey: "k", accessToken: "t", password: "p",
    inputTokens: 123, outputTokens: 45, model: "gemini-x", status: 200,
    nested: { password: "p2", ok: 1, deep: { token: "t2", n: 2 } }, list: [{ content: "c" }, { id: 7 }],
  }) as any;
  for (const k of ["prompt", "content", "message", "authorization", "apiKey", "accessToken", "password"]) assert.equal(out[k], "[redacted]", k);
  assert.deepEqual([out.inputTokens, out.outputTokens, out.model, out.status], [123, 45, "gemini-x", 200]);
  assert.equal(out.nested.password, "[redacted]");
  assert.equal(out.nested.ok, 1);
  assert.equal(out.nested.deep.token, "[redacted]");
  assert.equal(out.list[0].content, "[redacted]");
  assert.equal(out.list[1].id, 7);
});

test("secrets inside ordinary string values are scrubbed too, and long values are truncated", () => {
  const out = scrubFields({
    note: "key AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz012345 and sk-proj-abcdefghijklmnopqrstu and Bearer abcdefghijklmnopqrstuvwx; user ann@example.com from 203.0.113.7; session sess_1700000000000_0123456789abcdef0123",
    long: "x".repeat(2000),
  }) as any;
  assert.ok(!/AIza|sk-proj|abcdefghijklmnopqrstuvwx|ann@example|203\.0\.113|sess_17/.test(out.note), out.note);
  assert.match(out.note, /\[api-key\]/);
  assert.ok(out.long.length <= 301);
});

test("errors are described (name, message, code), never dumped with stack or payload", () => {
  const mark = logs.length;
  const err: any = Object.assign(new Error("failed for ann@example.com with sk-abcdefghijklmnopqrstuvwx1234"), { code: "E_TEST", status: 502, payload: { secret: "x" } });
  logger.error("provider_failed", { err, provider: "gemini" });
  const e = logs[mark].err;
  assert.equal(logs[mark].event, "provider_failed");
  assert.equal(logs[mark].provider, "gemini");
  assert.deepEqual(Object.keys(e).sort(), ["code", "message", "name", "status"], "only a description of the error: no stack, no payload, no `kind` when there is none");
  assert.ok(!/ann@example|sk-abc/.test(e.message));
  assert.equal(e.code, "E_TEST");
});

test("JSON lines are valid and complete; the level threshold filters", () => {
  const mark = logs.length;
  log("debug", "dbg_event", { a: 1 });
  assert.equal(logs[mark].level, "debug");
  assert.match(logs[mark].ts, /^\d{4}-\d\d-\d\dT/);
  process.env.LOG_LEVEL = "warn";
  const m2 = logs.length;
  logger.info("hidden_info");
  logger.warn("shown_warn");
  assert.deepEqual(logs.slice(m2).map((l) => l.event), ["shown_warn"]);
  process.env.LOG_LEVEL = "debug";
});

// ======================================================================================== health & readiness

async function serve(app: express.Express) {
  const s = http.createServer(app);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  return { url, close: () => { s.close(); s.closeAllConnections?.(); } };
}

test("liveness: always 200 and tiny, never touches dependencies, never reveals configuration (no key lengths)", async () => {
  const app = express();
  app.get("/health", livenessHandler("darkness", Date.now() - 5000));
  const s = await serve(app);
  const r = await fetch(`${s.url}/health`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const j = await r.json();
  assert.deepEqual(Object.keys(j).sort(), ["service", "status", "uptimeSec"]);
  assert.equal(j.status, "ok");
  assert.ok(j.uptimeSec >= 4);
  s.close();
});

test("readiness: 200 ready when every required check passes", async () => {
  const app = express();
  app.use(requestContext({ accessLog: false }));
  app.get("/ready", readinessHandler({ service: "darkness", isDraining: () => false, checks: [
    { name: "database", required: true, run: () => {} },
    { name: "storage", required: true, run: () => "812 MB free" },
  ] }));
  const s = await serve(app);
  const r = await fetch(`${s.url}/ready`);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.status, "ready");
  assert.equal(j.checks.database.status, "ok");
  assert.equal(j.checks.storage.note, "812 MB free");
  s.close();
});

test("readiness: a REAL unavailable database makes the instance not ready (503), then it recovers", async () => {
  // a genuinely closed SQLite handle: the same query the server runs fails exactly as it would with a dead database
  const db = new DatabaseSync(":memory:");
  let usable = false;
  const live = new DatabaseSync(":memory:");
  const app = express();
  app.use(requestContext({ accessLog: false }));
  app.get("/ready", readinessHandler({ service: "darkness", isDraining: () => false, checks: [
    { name: "database", required: true, run: () => { (usable ? live : db).prepare("SELECT 1 FROM sqlite_master LIMIT 1").get(); } },
    { name: "uploads", required: true, run: () => {} },
  ] }));
  const s = await serve(app);

  db.close(); // the database goes away
  const mark = logs.length;
  const down = await fetch(`${s.url}/ready`, { headers: { "x-request-id": "ready-trace-0001" } });
  const dj = await down.json();
  assert.equal(down.status, 503);
  assert.equal(dj.status, "not_ready");
  assert.equal(dj.checks.database.status, "fail");
  assert.equal(dj.checks.database.error, "unavailable");
  assert.equal(dj.checks.uploads.status, "ok", "the other checks still report");
  assert.equal(dj.requestId, "ready-trace-0001", "the 503 carries the request id");
  assert.ok(!/not open|sqlite|database is not/i.test(JSON.stringify(dj)), "no driver message in the response: " + JSON.stringify(dj));
  const failLog = since(mark).find((l) => l.event === "readiness_check_failed");
  assert.ok(failLog && failLog.check === "database" && failLog.requestId === "ready-trace-0001", "the detail is in the log, with the request id");

  usable = true; // the database comes back
  const up = await fetch(`${s.url}/ready`);
  assert.equal(up.status, 200);
  assert.equal((await up.json()).status, "ready");
  s.close();
  live.close();
});

test("readiness: a check that hangs counts as failed (timeout) instead of hanging the probe", async () => {
  const t0 = Date.now();
  const r = await runCheck({ name: "slow", required: true, timeoutMs: 80, run: () => new Promise(() => {}) });
  assert.equal(r.status, "fail");
  assert.equal(r.error, "timeout");
  assert.ok(Date.now() - t0 < 1000);
  const res = await evaluateReadiness([{ name: "slow", required: true, timeoutMs: 50, run: () => new Promise(() => {}) }], false);
  assert.equal(res.state, "not_ready");
});

test("readiness: an optional service being down only degrades (still 200); results of slow optional checks are cached", async () => {
  let calls = 0;
  const checks = [
    { name: "database", required: true, run: () => {} },
    { name: "supabase", required: false, cacheMs: 60_000, run: () => { calls++; throw new Error("cloud unreachable"); } },
  ];
  const app = express();
  app.get("/ready", readinessHandler({ service: "darkness", isDraining: () => false, checks }));
  const s = await serve(app);
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${s.url}/ready`);
    assert.equal(r.status, 200, "an optional failure does not take the instance out of rotation");
    const j = await r.json();
    assert.equal(j.status, "degraded");
    assert.equal(j.checks.supabase.status, "fail");
    assert.equal(j.checks.supabase.required, false);
  }
  assert.equal(calls, 1, "the optional check ran once and was cached");
  s.close();
});

test("readiness: while shutting down it reports draining (503 + Retry-After) so traffic is moved away", async () => {
  const app = express();
  let draining = false;
  app.get("/ready", readinessHandler({ service: "darkness", isDraining: () => draining, checks: [{ name: "database", required: true, run: () => {} }] }));
  const s = await serve(app);
  assert.equal((await fetch(`${s.url}/ready`)).status, 200);
  draining = true;
  const r = await fetch(`${s.url}/ready`);
  assert.equal(r.status, 503);
  assert.equal(r.headers.get("retry-after"), "5");
  assert.equal((await r.json()).status, "draining");
  markDraining(false);
  s.close();
});
