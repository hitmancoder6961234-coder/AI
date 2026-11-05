import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import express from "express";

const L = await import("../server/body-limits.js");

// ---- the route -> tier map -------------------------------------------------------------------------------------------------------------------

test("tiers: structured routes get the small default, model requests the middle tier, file / export routes the large one", () => {
  const defaults = ["/api/auth/login", "/api/auth/signup", "/api/auth/reset", "/api/account", "/api/memory", "/api/memory/abc", "/api/prompts", "/api/prompts/abc", "/api/models", "/api/models/abc", "/api/conversations", "/api/conversations/c1/meta", "/api/conversations/c1/title", "/api/conversations/c1/branch", "/api/copilot/conversations", "/api/projects/p1/folders", "/api/projects/p1/analyze", "/api/projects/p1/rag/search", "/api/agent-nothing", "/api/privacy/erase", "/api/csp-report", "/api/storage/limit", "/api/files/upload"];
  const ai = ["/api/chat", "/api/conversations/c1/chat", "/api/conversations/c1/messages", "/api/conversations/c1/regenerate", "/api/conversations/c1/messages/m1/edit", "/api/copilot/chat", "/api/studio/chat", "/api/studio/selection-edit", "/api/document/ai-generate", "/api/document/stream-generate", "/api/presentation/ai-generate", "/api/projects/p1/chat", "/api/projects/p1/advisor/apply-fix", "/api/projects/p1/diagnostics/ai-fix", "/api/builder/projects/p1/generate", "/api/knowledge/rag/ask", "/api/prompts/run", "/api/prompts/compare", "/api/prompts/import", "/api/memory/import", "/api/compare", "/api/agent/sessions", "/api/agent/sessions/s1/approve", "/api/models/test", "/classic-api/api/chat", "/classic-api/api/conversations"];
  const files = ["/api/files/shared", "/api/projects", "/api/projects/p1/files", "/api/projects/p1/apply-changes", "/api/projects/p1/artifacts", "/api/projects/p1/versions", "/api/artifacts/a1", "/api/document/export-docx", "/api/document/export-pdf", "/api/documents/export", "/api/presentation/export-pptx", "/api/diagrams/render-image"];
  for (const p of defaults) assert.equal(L.tierOf(p), "default", p);
  for (const p of ai) assert.equal(L.tierOf(p), "ai", p);
  for (const p of files) assert.equal(L.tierOf(p), "files", p);
  assert.deepEqual(L.DEFAULT_LIMITS, { default: 1 * L.MB, ai: 25 * L.MB, files: 100 * L.MB });
  assert.equal(L.limitFor("/api/memory"), 1 * L.MB); assert.equal(L.limitFor("/api/chat"), 25 * L.MB); assert.equal(L.limitFor("/api/files/shared"), 100 * L.MB);
  // the largest tier never exceeds the documented per-file maximum
  assert.ok(L.DEFAULT_LIMITS.files <= 100 * L.MB);
});

test("operator overrides: valid numbers are used, anything unusable keeps the safe default", () => {
  assert.deepEqual(L.bodyLimitsFromEnv({}), L.DEFAULT_LIMITS);
  assert.deepEqual(L.bodyLimitsFromEnv({ JSON_LIMIT_DEFAULT_MB: "2", JSON_LIMIT_AI_MB: "10", JSON_LIMIT_FILES_MB: "50" }), { default: 2 * L.MB, ai: 10 * L.MB, files: 50 * L.MB });
  assert.equal(L.bodyLimitsFromEnv({ JSON_LIMIT_DEFAULT_MB: "0.5" }).default, 0.5 * L.MB, "fractions are fine");
  for (const bad of ["", "abc", "-5", "0", "NaN", "Infinity", "5000", " "]) assert.deepEqual(L.bodyLimitsFromEnv({ JSON_LIMIT_DEFAULT_MB: bad, JSON_LIMIT_AI_MB: bad, JSON_LIMIT_FILES_MB: bad }), L.DEFAULT_LIMITS, JSON.stringify(bad));
});

test("the 413 answer names the limit of the route that was hit", () => {
  const p = L.tooLargePayload(1 * L.MB);
  assert.deepEqual([p.error, p.maxBytes, p.maxMB], ["PAYLOAD_TOO_LARGE", 1 * L.MB, 1]);
  assert.match(p.message, /1 MB/); assert.match(L.tooLargePayload(25 * L.MB).message, /25 MB/);
  assert.equal(L.tooLargePayload(undefined).maxBytes, L.DEFAULT_LIMITS.default, "an unknown limit falls back to the default, never to nothing");
});

// ---- a real HTTP server with tiny limits, so every boundary can be hit exactly ------------------------------------------------------------------

const LIMITS = { default: 1000, ai: 4000, files: 16000 };
const app = express();
app.use(L.bodyParsers(LIMITS));
const echo: express.RequestHandler = (req, res) => res.json({ ok: true, keys: Object.keys(req.body || {}).length, bytes: JSON.stringify(req.body || {}).length });
app.post("/api/memory", echo); app.post("/api/chat", echo); app.post("/api/files/shared", echo);
app.use(L.bodyTooLargeHandler);
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(err.status || 500).json({ error: "handled", type: err.type || null }));
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as any).port;
test.after(() => { server.closeAllConnections?.(); server.close(); });

const jsonOfSize = (n: number) => { const head = '{"d":"', tail = '"}'; return head + "x".repeat(Math.max(0, n - head.length - tail.length)) + tail; };
const post = (path: string, body: string, type = "application/json") => fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": type }, body });

test("normal requests pass on every tier", async () => {
  for (const [p, n] of [["/api/memory", 200], ["/api/chat", 2000], ["/api/files/shared", 8000]] as const) {
    const r = await post(p, jsonOfSize(n)); assert.equal(r.status, 200, p); assert.equal((await r.json()).ok, true);
  }
});

test("a body of exactly the maximum passes, one byte more is refused with an accurate 413", async () => {
  for (const [p, limit] of [["/api/memory", LIMITS.default], ["/api/chat", LIMITS.ai], ["/api/files/shared", LIMITS.files]] as const) {
    const exact = jsonOfSize(limit); assert.equal(Buffer.byteLength(exact), limit);
    assert.equal((await post(p, exact)).status, 200, `${p}: exactly ${limit} bytes`);
    const over = await post(p, jsonOfSize(limit + 1));
    assert.equal(over.status, 413, `${p}: ${limit + 1} bytes`);
    const j = await over.json();
    assert.deepEqual([j.error, j.maxBytes], ["PAYLOAD_TOO_LARGE", limit], "the answer carries THIS route's limit");
    assert.equal((await post("/api/memory", jsonOfSize(100))).status, 200, "the server keeps serving after a refused body");
  }
});

test("the same body is accepted or refused depending on the route's tier", async () => {
  const body = jsonOfSize(3000);
  assert.equal((await post("/api/memory", body)).status, 413, "3 KB is over the default tier");
  assert.equal((await post("/api/chat", body)).status, 200, "...but fine for a model request");
  assert.equal((await post("/api/files/shared", body)).status, 200, "...and for file content");
  const big = jsonOfSize(10000);
  assert.equal((await post("/api/chat", big)).status, 413, "10 KB is over the model-request tier");
  assert.equal((await post("/api/files/shared", big)).status, 200, "...but fine for file content");
  assert.equal((await post("/api/files/shared", jsonOfSize(20000))).status, 413, "and 20 KB is over even the largest tier");
});

test("form bodies follow the same limits", async () => {
  const small = "a=" + "x".repeat(300), large = "a=" + "x".repeat(3000);
  assert.equal((await post("/api/memory", small, "application/x-www-form-urlencoded")).status, 200);
  assert.equal((await post("/api/memory", large, "application/x-www-form-urlencoded")).status, 413);
  assert.equal((await post("/api/chat", large, "application/x-www-form-urlencoded")).status, 200);
});

test("malformed JSON is a 400 (not a 500, not a crash) and an empty or non-JSON body passes through untouched", async () => {
  for (const bad of ['{"a":', "{'a':1}", "not json at all", '{"a":1}}', "[1,2", "\u0000\u0001"]) {
    const r = await post("/api/memory", bad); assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal((await r.json()).type, "entity.parse.failed");
  }
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/memory`, { method: "POST" })).status, 200, "no body at all");
  assert.equal((await post("/api/memory", "plain text", "text/plain")).status, 200, "a body that is not JSON is not parsed, so it cannot be 'too large' or 'malformed'");
  // after every refusal the server still answers the next request
  assert.equal((await post("/api/memory", jsonOfSize(100))).status, 200);
});

test("an oversized request is refused from its Content-Length header, before its body is sent", async () => {
  // the client announces 10 MB and then sends nothing: a server that waited for the body would hang until the timeout
  const t0 = Date.now();
  const answer = await new Promise<string>((resolve, reject) => {
    const s = net.connect(port, "127.0.0.1");
    let data = ""; const timer = setTimeout(() => { s.destroy(); reject(new Error("no answer: the server waited for the body")); }, 3000);
    s.on("data", (d) => { data += d.toString("utf8"); if (/\r\n\r\n/.test(data)) { clearTimeout(timer); s.destroy(); resolve(data); } });
    s.on("error", () => { /* the server may reset the connection after answering */ });
    s.write(`POST /api/memory HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${10 * 1024 * 1024}\r\n\r\n`);
  });
  assert.match(answer, /^HTTP\/1\.1 413/, answer.slice(0, 80));
  assert.ok(Date.now() - t0 < 1500, "answered immediately");
});

test("a chunked body (no Content-Length) is cut off as soon as it passes the limit", async () => {
  const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/api/memory", method: "POST", headers: { "content-type": "application/json", "transfer-encoding": "chunked" } }, (res) => {
      let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve({ status: res.statusCode || 0, body: b }));
    });
    req.on("error", (e) => reject(e));
    req.write('{"d":"');
    let sent = 0; const pump = () => { if (req.destroyed || sent > 200_000) return req.end('"}'); sent += 2000; req.write("x".repeat(2000), pump); };
    pump();
    setTimeout(() => reject(new Error("timeout")), 5000).unref();
  }).catch((e) => ({ status: -1, body: String(e && e.message) }));
  // either the 413 arrives, or the connection was closed while the client was still writing: both mean the body was not accepted
  assert.ok(result.status === 413 || result.status === -1, `status ${result.status} ${result.body.slice(0, 80)}`);
  assert.equal((await post("/api/memory", jsonOfSize(100))).status, 200, "the server is unaffected");
});
