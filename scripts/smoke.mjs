#!/usr/bin/env node
/**
 * End-to-end smoke test. Boots the production bundle (dist/server.js) with a throw-away data
 * directory and a mock OpenAI-compatible model server, then exercises privacy and the agent over HTTP.
 *
 *   npm run build && node scripts/smoke.mjs
 */
import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";

const APP_PORT = 3100 + Math.floor(Math.random() * 400);
const MOCK_PORT = APP_PORT + 500;
const base = `http://127.0.0.1:${APP_PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "darkness-smoke-"));

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${String(e.message).split("\n").slice(0, 8).join(" | ")}`);
  }
}

// --- mock model: agent protocol + Project Studio prompts --------------------------------------------
const BRIEF = { title: "Shop API", oneLiner: "An API for local sellers.", summary: "An Express API for orders.", problem: "Sellers lack simple tooling.", solution: "A small, authenticated order API.", keyFeatures: [{ name: "Orders", what: "Create and list orders", evidence: ["src/app.js"] }], architecture: "Express server with a data layer.", techStack: [{ layer: "Backend", technology: "Express", why: "HTTP routing" }], strengths: ["Small and focused"], risksOrGaps: ["Authentication is a stub"], questions: [{ id: "q1", question: "Is a template required?", why: "Format", options: ["No", "Yes"], default: "No" }], recommendations: [{ id: "r1", type: "improve-project", text: "Implement real authentication", impact: "high" }] };
const OUTLINE = { report: { title: "Shop API Report", subtitle: "Project report", sections: [{ id: "abstract", kind: "abstract", title: "Abstract", purpose: "Summarise", keyPoints: ["scope"], visual: "none" }, { id: "arch", kind: "architecture", title: "Architecture", purpose: "Explain", keyPoints: ["Express"], visual: "image", imageIdea: "a shop connected to a server" }, { id: "conc", kind: "conclusion", title: "Conclusion", purpose: "Close", keyPoints: [], visual: "none" }] }, deck: { title: "Shop API", subtitle: "Demo", slides: [{ id: "title", title: "Shop API", message: "m", visual: { kind: "none" } }, { id: "s2", title: "Orders flow through one guarded endpoint", message: "m", visual: { kind: "none" } }, { id: "thanks", title: "Questions", message: "Thank you", visual: { kind: "none" } }] }, recommendations: [{ id: "r9", type: "add-visual", text: "Add a sequence diagram", impact: "medium" }] };
const DECK = { slides: [{ id: "title", title: "Shop API", bullets: [], visual: { kind: "none" }, notes: "" }, { id: "s2", title: "Orders flow through one guarded endpoint", bullets: ["POST /api/orders", "Auth guard first"], visual: { kind: "none" }, notes: "Explain the order path. Q: Is auth real? A: A stub today." }, { id: "thanks", title: "Questions", bullets: [], visual: { kind: "none" }, notes: "" }] };
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body);
    const msgs = parsed.messages;
    const task = (msgs.find((m) => m.role === "user") || {}).content || "";
    let content;
    if (/produce a BRIEF/i.test(task)) content = JSON.stringify(BRIEF);
    else if (task.includes("Design the OUTLINE")) content = JSON.stringify(OUTLINE);
    else if (task.includes("WRITE THE SECTION")) content = "The `POST /api/orders` endpoint in `src/app.js` creates an order once the guard passes.\n\n| Part | Role |\n|---|---|\n| Express | HTTP |";
    else if (task.includes("Write the final content for every slide")) content = JSON.stringify(DECK);
    else if (task.includes("Turn each idea into an image-generator prompt")) content = JSON.stringify({ images: [] });
    else if (msgs[0].content.includes("professional translator")) content = "TRANSLATED";
    else if (msgs[0].content.includes("DARKNESS")) content = "Hello from the model.";
    else if (msgs[0].content.includes("Darkness Copilot")) {
      const sys = msgs[0].content;
      content = "Hello **world** from Copilot." + (sys.includes("<project_context name=") ? " [project-context-seen]" : "") + (/Focus topic: "([^"]+)"/.exec(sys) ? ` [topic:${/Focus topic: "([^"]+)"/.exec(sys)[1]}]` : "") + (sys.includes("Focus: the user's project") ? " [scope-project]" : "") + (parsed.model === "gpt-test-model" ? " [gpt]" : "");
    }
    else {
      const sawObservation = msgs.some((m) => m.role === "user" && m.content.includes("<observation"));
      content = sawObservation
        ? '{"thought":"I have the number","final":"The result is **9** (via calculator)."}'
        : '{"thought":"Use the calculator","tool":"calculator","args":{"expression":"(7+2)*1"}}';
    }
    if (parsed.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const piece of content.match(/.{1,6}/gs) || []) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
  });
});
await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));

// --- a misbehaving provider: used by the "provider stability" checks through the REAL chat route ----------------
const STUB_PORT = MOCK_PORT + 1;
const stubHits = {};
const stubOpen = new Set(); // sockets of requests the stub deliberately leaves hanging; they must be closed by the server
const sseTokens = (res, text) => { for (const piece of text.match(/.{1,5}/gs) || []) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}` + "\n\n"); };
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed = {};
    try { parsed = JSON.parse(body); } catch {}
    const mode = parsed.model || "";
    const n = (stubHits[mode] = (stubHits[mode] || 0) + 1);
    const watch = () => { stubOpen.add(req.socket); req.socket.once("close", () => stubOpen.delete(req.socket)); };
    const stream = () => res.writeHead(200, { "content-type": "text/event-stream" });
    if (mode === "stub-agent") {
      const msgs = parsed.messages || [], lastMsg = String((msgs[msgs.length - 1] || {}).content || "");
      const isPlanner = /You are a planner/.test(String((msgs[0] || {}).content || ""));
      res.writeHead(200, { "content-type": "application/json" });
      const out = isPlanner ? { plan: [{ title: "Save the preference", tool: "remember" }, { title: "Confirm" }] }
        : /<observation tool="remember"/.test(lastMsg) ? { thought: "done", final: "Saved.", done: [1, 2] }
        : { thought: "save it", tool: "remember", args: { content: "SMOKE-AGENT I prefer examples in Python", category: "preference" }, done: [1] };
      return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }));
    }
    if (mode === "stub-ok" && parsed.stream === false) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Plain answer from the stub provider." } }] })); }
    if (mode === "stub-ok") { stream(); sseTokens(res, "Hello from the stub provider."); res.write("data: [DONE]" + "\n\n"); return res.end(); }
    if (mode === "stub-flaky") {
      if (n === 1) { res.writeHead(503, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: "model is overloaded" } })); }
      stream(); sseTokens(res, "Recovered after a retry."); res.write("data: [DONE]" + "\n\n"); return res.end();
    }
    if (mode === "stub-denied") { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: "Invalid API key provided: " + (req.headers.authorization || "") } })); }
    if (mode === "stub-hang") { watch(); return; }
    if (mode === "stub-stall") { watch(); stream(); sseTokens(res, "Partial answer. "); return; }
    if (mode === "stub-endless") {
      watch(); stream();
      const t = setInterval(() => res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "tick " } }] })}` + "\n\n"), 80);
      res.on("close", () => clearInterval(t));
      return;
    }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));

// --- boot the app ---------------------------------------------------------------------------------
const logs = [];
function boot(extraEnv = {}) {
  const child = spawn(process.execPath, ["dist/server.js"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(APP_PORT),
      DARKNESS_STORAGE_ROOT: dataDir,
      DARKNESS_DB_PATH: path.join(dataDir, "smoke.db"), // known path: the artifact-access check inserts a row directly
      DARKNESS_UPLOAD_TMP: path.join(dataDir, "upload-tmp"),
      AGENT_PROVIDER: "openai",
      AGENT_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
      OPENAI_API_KEY: "test-key-not-real",
      COPILOT_MODEL: "gpt-test-model",
      RATE_LIMIT_AUTH_PER_15MIN: "60",
      RATE_LIMIT_AI_PER_MIN: "300", // the run sends well over 40 chat-type requests in a minute from one address (the default limit is not what these checks test)
      PROVIDER_HEADERS_TIMEOUT_MS: "800",
      PROVIDER_STREAM_IDLE_MS: "700",
      PROVIDER_RETRY_BASE_MS: "20",
      PROVIDER_RETRY_MAX_MS: "100",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  return child;
}
const stopChild = (child) => new Promise((r) => { child.once("exit", r); child.kill(); });

// Phase 0 â€” simulate an existing install that ran in the old, open mode: it seeds the public
// demo account and "default_token" into the database. The strict boot below must purge both.
const legacy = boot({ PRIVACY_STRICT: "false" });
let server = legacy;

async function waitUp() {
  for (let i = 0; i < 360; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start within 90 s (port " + APP_PORT + "):\n" + logs.join("").slice(-1500));
}

const j = async (res) => res.json().catch(() => ({}));
const post = (p, body, token) =>
  fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const get = (p, token) => fetch(base + p, { headers: token ? { authorization: `Bearer ${token}` } : {} });

try {
  await waitUp();
  console.log("upgrade path");
  await check("old open mode really seeded the demo account (precondition)", async () => {
    assert.equal((await get("/api/conversations", "default_token")).status, 200);
    assert.equal((await post("/api/auth/login", { email: "user@darkness.local", password: "password123" })).status, 200);
  });
  await stopChild(legacy);
  server = boot();
  await waitUp();
  console.log(`strict server up on :${APP_PORT}\n`);
  await check("strict boot purged the public demo account and token", async () => {
    assert.equal((await get("/api/conversations", "default_token")).status, 401);
    assert.notEqual((await post("/api/auth/login", { email: "user@darkness.local", password: "password123" })).status, 200);
  });
  const pw = "correct horse battery";
  const emailA = `alice-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const emailB = `bob-${crypto.randomUUID().slice(0, 6)}@example.com`;
  let tokA, tokB, tokC;
  let cookieB = "";

  console.log("hardening");
  await check("security headers present, no X-Powered-By", async () => {
    const r = await get("/api/health");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
    assert.ok(r.headers.get("content-security-policy"), "the Content-Security-Policy is enforced by default");
    assert.equal(r.headers.get("content-security-policy-report-only"), null, "...not merely reported");
    assert.ok(r.headers.get("strict-transport-security"));
    assert.equal(r.headers.get("x-powered-by"), null);
    assert.match(r.headers.get("cache-control") || "", /no-store/);
  });
  await check("CSP: enforced on the app and on /classic (with Google Sign-In only there), no inline script/eval, reports collected", async () => {
    const dir = (policy, name) => (policy.split("; ").find((d) => d.startsWith(name + " ")) || "").split(" ").slice(1);
    const app = (await get("/")).headers.get("content-security-policy") || "";
    assert.deepEqual(dir(app, "script-src").filter((v) => v !== "'report-sample'"), ["'self'"]);
    assert.deepEqual(dir(app, "script-src-attr"), ["'none'"]);
    assert.ok(!/unsafe-eval/.test(app) && !app.includes("accounts.google.com") && !/\shttps:(\s|;|$)/.test(app));
    assert.ok(dir(app, "report-uri").includes("/api/csp-report"));
    const classic = (await fetch(base + "/classic/", { redirect: "manual" })).headers.get("content-security-policy") || "";
    assert.ok(dir(classic, "script-src").includes("https://accounts.google.com/gsi/client") && !/unsafe-eval/.test(classic));
    // reports: public (browsers send them without credentials), tiny, always 204, nothing echoed, GET refused
    const rep = await fetch(base + "/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report" }, body: JSON.stringify({ "csp-report": { "document-uri": base + "/?t=SMOKE_SECRET", "effective-directive": "script-src-elem", "blocked-uri": "inline" } }) });
    assert.equal(rep.status, 204);
    assert.equal((await fetch(base + "/api/csp-report", { method: "POST", headers: { "content-type": "application/json" }, body: "{broken" })).status, 204);
    assert.equal((await fetch(base + "/api/csp-report")).status, 405);
    assert.equal((await fetch(base + "/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report" }, body: "x".repeat(40_000) })).status, 413);
  });
  await check("the UI's own pages and vendored assets are served from this origin", async () => {
    const html = await (await get("/")).text();
    assert.ok(!/https?:\/\/(cdn\.jsdelivr|cdnjs\.cloudflare|fonts\.googleapis|fonts\.gstatic|unpkg)/.test(html), "no CDN reference in the main page");
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>\s*\S/i.test(html) && !/<style[\s>]/i.test(html), "no inline script/style in the main page");
    for (const f of ["/vendor/mermaid/mermaid.min.js", "/vendor/html2pdf/html2pdf.bundle.min.js", "/vendor/fonts/inter/inter.css", "/boot-sidebar.js", "/copilot-launcher.css", "/copilot-page.js", "/copilot-page.css", "/agent-page.js", "/agent-page.css"]) {
      const r = await get(f);
      assert.equal(r.status, 200, f);
      assert.ok(!(r.headers.get("content-type") || "").includes("text/html"), f + " must not fall back to the SPA page");
    }
    // the PDF-export stylesheet is bundled into the main CSS (it used to be an injected <style>); every rule is scoped to the export host
    const bundle = (html.match(/href="(\/assets\/[^"]+\.css)"/) || [])[1];
    assert.ok(bundle, "main stylesheet link found");
    assert.ok((await (await get(bundle)).text()).includes("#darkness-pdf-export-host"), "PDF export styles are part of the stylesheet bundle");
    for (const f of ["/copilot.html", "/agent.html"]) {
      const t = await (await get(f)).text();
      assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>\s*\S/i.test(t) && !/<style[\s>]/i.test(t), f + " has no inline script/style");
    }
  });
  await check("debug route list is closed", async () => assert.equal((await get("/api/debug/routes")).status, 404));
  await check("code execution (terminals / run / preview proxy) is disabled by default", async () => {
    for (const [m, p] of [["POST", "/api/projects/p1/terminals"], ["POST", "/api/terminals/t1/input"], ["POST", "/api/projects/p1/run"], ["GET", "/api/preview/3000/"]]) {
      const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json" }, body: m === "POST" ? "{}" : undefined });
      assert.equal(r.status, 403, `${m} ${p}`);
      assert.equal((await r.json()).code, "RUN_ENGINE_DISABLED");
    }
  });
  await check("static UI + agent page + atmosphere assets are served", async () => {
    const home = await (await get("/")).text();
    assert.match(home, /<title>Darkness AI<\/title>/);
    assert.match(home, /atmosphere\.js/);
    assert.equal((await get("/agent.html")).status, 200);
    assert.equal((await get("/atmosphere/atmosphere.js")).status, 200);
    assert.equal((await get("/atmosphere/atmosphere.css")).status, 200);
    assert.equal((await get("/manifest.json")).status, 200);
  });

  console.log("\nanonymous visitors");
  await check("/api/auth/me gives anonymous visitors no identity and no cookie", async () => {
    const r = await get("/api/auth/me");
    assert.equal((await j(r)).user, null);
    assert.equal(r.headers.get("set-cookie"), null);
  });
  await check("data routes answer 401 without a session", async () => {
    for (const p of ["/api/conversations", "/api/projects", "/api/models", "/api/privacy/export", "/api/agent/tools"]) {
      assert.equal((await get(p)).status, 401, p);
    }
  });
  await check("the legacy default_token no longer works", async () => assert.equal((await get("/api/conversations", "default_token")).status, 401));
  await check("a forged token is rejected", async () => assert.equal((await get("/api/conversations", "sess_1_deadbeefdeadbeefdeadbeef")).status, 401));

  console.log("\naccounts and isolation");
  await check("weak passwords are rejected, strong ones accepted", async () => {
    assert.equal((await post("/api/auth/signup", { email: emailA, password: "short" })).status, 400);
    const a = await post("/api/auth/signup", { email: emailA, password: pw, name: "Alice" });
    assert.equal(a.status, 201);
    tokA = (await j(a)).token;
    const b = await post("/api/auth/signup", { email: emailB, password: pw, name: "Bob" });
    cookieB = (b.headers.get("set-cookie") || "").split(";")[0];
    tokB = (await j(b)).token;
    const cc = await post("/api/auth/signup", { email: `carol-${crypto.randomUUID().slice(0, 6)}@example.com`, password: pw, name: "Carol" });
    tokC = (await j(cc)).token;
    assert.ok(tokA && tokB && tokA !== tokB);
  });
  console.log("\nsign-in errors (every failure has a code the screen can act on)");
  const codeOf = async (r) => (await j(r));
  await check("validation errors are structured: code + the field to highlight", async () => {
    for (const [body, field] of [[{}, "email"], [{ email: "   ", password: "x" }, "email"], [{ email: "not-an-email", password: "x" }, "email"], [{ email: { $ne: 1 }, password: "x" }, "email"], [{ email: "a@b.co", password: "" }, "password"], [{ email: "a@b.co", password: 12345 }, "password"], [{ email: "a@b.co", password: "x".repeat(2000) }, "password"], [{ email: "a..b@c.co", password: "x" }, "email"]]) {
      const r = await post("/api/auth/login", body);
      const d = await codeOf(r);
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60));
      assert.equal(d.code, "VALIDATION_ERROR"); assert.equal(d.field, field, JSON.stringify(body).slice(0, 60));
    }
    const weak = await post("/api/auth/signup", { email: "weak-user@example.com", password: "password123" });
    assert.equal(weak.status, 400); assert.equal((await codeOf(weak)).code, "WEAK_PASSWORD");
    const dup = await post("/api/auth/signup", { email: emailA, password: pw });
    assert.equal(dup.status, 409); const dd = await codeOf(dup); assert.equal(dd.code, "EMAIL_TAKEN"); assert.equal(dd.field, "email");
    const nm = await post("/api/auth/signup", { email: `name-${crypto.randomUUID().slice(0, 6)}@example.com`, password: pw, name: "<b>Zed</b>\u0001" });
    assert.equal(nm.status, 201); assert.equal((await codeOf(nm)).user.name, "bZed/b", "markup and control characters are stripped from names");
  });
  await check("wrong passwords count down, then the account pauses with Retry-After; a right password resets the count", async () => {
    const email = `guard-${crypto.randomUUID().slice(0, 6)}@example.com`;
    assert.equal((await post("/api/auth/signup", { email, password: pw, name: "Guard" })).status, 201);
    const wrong = async () => post("/api/auth/login", { email, password: "definitely-wrong" });
    let r = await wrong(); let d = await codeOf(r);
    assert.equal(r.status, 401); assert.equal(d.code, "INVALID_CREDENTIALS"); assert.equal(d.attemptsLeft, 4);
    d = await codeOf(await wrong()); assert.equal(d.attemptsLeft, 3);
    assert.equal((await post("/api/auth/login", { email, password: pw })).status, 200, "the right password still works and resets the count");
    d = await codeOf(await wrong()); assert.equal(d.attemptsLeft, 4, "count restarted after a successful sign-in");
    for (let i = 0; i < 3; i++) assert.equal((await wrong()).status, 401);
    r = await wrong(); d = await codeOf(r);
    assert.equal(r.status, 429); assert.equal(d.code, "ACCOUNT_LOCKED"); assert.ok(d.retryAfter > 0 && d.retryAfter <= 60, "first lock is about a minute: " + d.retryAfter);
    assert.ok(Number(r.headers.get("retry-after")) > 0);
    const during = await post("/api/auth/login", { email, password: pw });
    assert.equal(during.status, 429, "even the right password is refused while the account is paused");
    assert.equal((await codeOf(during)).code, "ACCOUNT_LOCKED");
    // someone else on the same address is not blocked by this account's pause
    assert.equal((await post("/api/auth/login", { email: emailB, password: pw })).status, 200);
  });
  await check("an unknown e-mail and a wrong password look identical (no account enumeration)", async () => {
    const ghost = await post("/api/auth/login", { email: "nobody-here@example.com", password: "whatever-pass" });
    const real = await post("/api/auth/login", { email: emailB, password: "not-his-password" });
    assert.equal(ghost.status, 401); assert.equal(real.status, 401);
    const a = await codeOf(ghost), b = await codeOf(real);
    assert.equal(a.error, b.error); assert.equal(a.code, b.code);
  });
  await check("signed-in users see themselves", async () => {
    const me = await j(await get("/api/auth/me", tokA));
    assert.equal(me.user.email, emailA);
  });
  let convId;
  await check("a user's conversation is invisible to another user", async () => {
    const c = await j(await post("/api/conversations", { title: "alice-secret-plan" }, tokA));
    convId = c.id || c.conversation?.id;
    const listA = JSON.stringify(await j(await get("/api/conversations", tokA)));
    const listB = JSON.stringify(await j(await get("/api/conversations", tokB)));
    assert.ok(listA.includes("alice-secret-plan"), "owner should see it");
    assert.ok(!listB.includes("alice-secret-plan"), "other user must not");
    if (convId) assert.notEqual((await get(`/api/conversations/${convId}`, tokB)).status, 200);
  });

  const patchJson = (p, body, token) => fetch(base + p, { method: "PATCH", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  console.log("\nprivacy controls");
  await check("policy is public and machine-readable", async () => {
    const p = await j(await get("/api/privacy/policy"));
    assert.equal(p.strictMode, true);
    assert.ok(p.stored.length > 0);
  });
  await check("export returns the user's own data only", async () => {
    const r = await get("/api/privacy/export", tokA);
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.ok(text.includes(emailA) && text.includes("alice-secret-plan"));
    assert.ok(!text.includes(emailB));
    assert.ok(!/password|apiKey/i.test(text.replace(/hasApiKey/g, "")), "no credential fields in export");
  });

  console.log("\nagent");
  await check("tool catalogue lists tools and the active provider", async () => {
    const t = await j(await get("/api/agent/tools", tokA));
    assert.ok(t.tools.some((x) => x.name === "calculator"));
    assert.match(t.active, /^openai/);
  });
  await check("agent runs end-to-end over SSE (mock model â†’ calculator â†’ answer)", async () => {
    const r = await post("/api/agent/run", { goal: "What is (7+2)*1?" }, tokA);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/event-stream/);
    const text = await r.text();
    const types = [...text.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(types, ["start", "thought", "tool_call", "tool_result", "thought", "final"]);
    assert.match(text, /"output":"9"/);
    assert.match(text, /The result is \*\*9\*\*/);
  });
  await check("agent JSON mode returns the trace", async () => {
    const r = await j(await post("/api/agent/run?stream=0", { goal: "again" }, tokA));
    assert.match(r.answer, /9/);
    assert.equal(r.steps, 2);
  });
  await check("agent input is validated", async () => {
    assert.equal((await post("/api/agent/run", { goal: "" }, tokA)).status, 400);
    assert.equal((await post("/api/agent/run", { goal: "x".repeat(9000) }, tokA)).status, 413);
    assert.equal((await post("/api/agent/run", { goal: "hi" })).status, 401);
  });

  console.log("\nabuse resistance");
  await check("login attempts from one address are rate limited (different accounts, so only the IP limiter can trip)", async () => {
    let limited = null;
    for (let i = 0; i < 90 && !limited; i++) {
      const r = await post("/api/auth/login", { email: `flood-${i}@example.com`, password: "wrong-password" });
      if (r.status === 429) limited = r;
    }
    assert.ok(limited, "expected a 429 within 90 attempts");
    assert.equal((await j(limited)).code, "RATE_LIMITED");
    assert.ok(Number(limited.headers.get("retry-after")) > 0, "Retry-After tells the client how long to wait");
  });

  console.log("\ndocuments (upload + export of every type)");
  const formData = (name, buf, field = "files") => { const fd = new FormData(); fd.append(field, new Blob([buf]), name); return fd; };
  const postJson = (p, body, token) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  await check("DOCX export applies the chosen margins, embeds pictures with a real type, and cannot be made to embed server files", async () => {
    const { default: AdmZip } = await import("adm-zip");
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const exportDocx = async (body) => {
      const r = await postJson("/api/document/export-docx", { title: "T", ...body }, tokB);
      assert.equal(r.status, 200, await r.clone().text());
      return new AdmZip(Buffer.from(await r.arrayBuffer()));
    };
    const pictures = (z) => z.getEntries().filter((e) => e.entryName.startsWith("word/media/") && e.header.size > 0).map((e) => e.entryName);
    // `margins` was passed to docx, which only knows `margin`: the choice never applied
    assert.match((await exportDocx({ marginSize: "wide", contentHtml: "<p>hello</p>" })).readAsText("word/document.xml"), /w:top="2000"/);
    assert.match((await exportDocx({ marginSize: "narrow", contentHtml: "<p>hello</p>" })).readAsText("word/document.xml"), /w:top="800"/);
    // a data: picture is embedded with its real type (without it docx stores "....undefined", which Word cannot open)
    const withPicture = await exportDocx({ contentHtml: `<p>x</p><img src="data:image/png;base64,${png}">` });
    assert.deepEqual(pictures(withPicture).map((n) => n.split(".").pop()), ["png"]);
    // the src comes from the caller: it may not reach outside web/public/uploads, and non-images are not embedded
    const hostile = await exportDocx({ contentHtml: '<p>y</p><img src="uploads/../../../package.json"><img src="/uploads/../../../../package.json"><img src="data:image/png;base64,' + Buffer.from("this is not an image").toString("base64") + '">' });
    assert.deepEqual(pictures(hostile), []);
    assert.ok(!hostile.getEntries().some((e) => /darkness-ai|"scripts"/.test(e.getData().toString("latin1"))), "no server file content in the document");
  });
  await check("export one document to every format", async () => {
    const md = "# Report\n\n## Intro\nHello **world**.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    const magic = { docx: "PK", xlsx: "PK", pptx: "PK", odt: "PK", pdf: "%PDF-", rtf: "{\\rtf1" };
    for (const f of ["docx", "pdf", "pptx", "xlsx", "odt", "rtf", "html", "md", "txt", "csv", "json"]) {
      const r = await postJson("/api/documents/export", { title: "Report", markdown: md, format: f }, tokB);
      assert.equal(r.status, 200, f);
      const buf = Buffer.from(await r.arrayBuffer());
      if (magic[f]) assert.equal(buf.subarray(0, magic[f].length).toString("latin1"), magic[f], f);
      assert.ok(buf.length > 10, f);
    }
  });
  await check("several formats at once come back as a ZIP; bad input is rejected", async () => {
    const r = await postJson("/api/documents/export", { title: "Pack", markdown: "# T\nx", formats: ["docx", "pdf", "md"] }, tokB);
    assert.match(r.headers.get("content-type"), /zip/);
    assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 2).toString(), "PK");
    assert.equal((await postJson("/api/documents/export", { title: "x", markdown: "# t", format: "exe" }, tokB)).status, 400);
    assert.equal((await postJson("/api/documents/export", { title: "x", markdown: "# t", format: "docx" })).status, 401);
  });
  await check("uploading a PowerPoint and a CSV returns their text; convert changes the file type", async () => {
    const pptx = Buffer.from(await (await postJson("/api/documents/export", { title: "Deck Title", markdown: "# Deck Title\n## Slide One\n- point alpha\n- point beta", format: "pptx" }, tokB)).arrayBuffer());
    const ex = await (await fetch(base + "/api/documents/extract", { method: "POST", headers: { authorization: `Bearer ${tokB}` }, body: formData("deck.pptx", pptx) })).json();
    assert.ok(ex.files[0].text.includes("point alpha"), "pptx text");
    const csv = await (await fetch(base + "/api/documents/extract", { method: "POST", headers: { authorization: `Bearer ${tokB}` }, body: formData("t.csv", Buffer.from("name,qty\nbolt,4\n")) })).json();
    assert.ok(csv.files[0].text.includes("bolt"));
    const conv = await fetch(base + "/api/documents/convert?to=pdf", { method: "POST", headers: { authorization: `Bearer ${tokB}` }, body: formData("notes.md", Buffer.from("# Notes\nSome text here."), "file") });
    assert.equal(conv.status, 200);
    assert.equal(Buffer.from(await conv.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
    assert.equal((await fetch(base + "/api/documents/extract", { method: "POST", body: formData("a.txt", Buffer.from("x")) })).status, 401);
  });
  await check("uploads are checked by their real content: a fake PDF, a disguised program and binary-in-text are refused; real files work", async () => {
    const auth = { authorization: `Bearer ${tokB}` };
    const up = (name, body, route = "/api/documents/extract", field = "files") => fetch(base + route, { method: "POST", headers: auth, body: formData(name, body, field) });
    const pe = Buffer.alloc(256); pe.write("MZ", 0); pe.writeUInt32LE(0x80, 0x3c); pe.write("PE\0\0", 0x80, "latin1");
    const refused = [
      ["fake.pdf", Buffer.from("<html>not a pdf</html>"), "INVALID_FILE_SIGNATURE"],
      ["photo.png", pe, "EXECUTABLE_CONTENT"],
      ["setup.exe", pe, "EXECUTABLE_CONTENT"],
      ["notes.txt", Buffer.concat([Buffer.from("text"), Buffer.from([0, 1, 2, 0])]), "BINARY_IN_TEXT_FILE"],
    ];
    for (const [name, body, code] of refused) {
      const r = await up(name, body);
      assert.equal(r.status, 415, name);
      assert.equal((await r.json()).error, code, name);
    }
    assert.equal((await up("fake.docx", Buffer.from("plain text"), "/classic-api/api/upload", "file")).status, 415, "the original app's upload is checked too");
    const pdf = Buffer.from(await (await postJson("/api/documents/export", { title: "Real", markdown: "# Real\ntext", format: "pdf" }, tokB)).arrayBuffer());
    assert.equal((await up("real.pdf", pdf)).status, 200, "a real PDF is accepted");
    // no temp file is left behind by any of the above
    const tmp = path.join(dataDir, "upload-tmp", "req");
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(fs.existsSync(tmp) ? fs.readdirSync(tmp) : [], [], "upload temp folder is empty");
  });
  await check("chunked ZIP upload works end to end; a malicious uploadId and out-of-range chunks are refused; nothing is left on disk", async () => {
    const zip = Buffer.from(await (await postJson("/api/documents/export", { title: "Deck", markdown: "# Deck\n## One\n- a\n- b", format: "pptx" }, tokB)).arrayBuffer()); // a pptx is a ZIP
    const half = Math.ceil(zip.length / 2);
    const chunk = (id, i, total, body, token = tokB) => {
      const fd = new FormData();
      fd.append("file", new Blob([body]), "deck.zip");
      fd.append("chunkIndex", String(i)); fd.append("totalChunks", String(total)); fd.append("uploadId", id); fd.append("name", "Chunked project");
      return fetch(base + "/api/projects/upload-zip/chunk", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: fd });
    };
    assert.equal((await chunk("up_1700000000099_smoke0001", 0, 2, zip, null)).status, 401, "needs a session");
    for (const bad of ["../../evil", "..\\..\\evil", "a/b", "short"]) {
      const r = await chunk(bad, 0, 2, zip.subarray(0, half));
      assert.equal(r.status, 400, bad);
      assert.equal((await r.json()).error, "INVALID_UPLOAD_ID");
    }
    assert.equal((await chunk("up_1700000000099_smoke0002", 5, 2, zip.subarray(0, half))).status, 400, "chunk index out of range");
    const id = "up_1700000000099_smoke0003";
    const first = await chunk(id, 0, 2, zip.subarray(0, half));
    assert.equal(first.status, 200);
    assert.equal((await first.json()).status, "uploading");
    const last = await chunk(id, 1, 2, zip.subarray(half));
    const done = await last.json();
    assert.equal(last.status, 200, JSON.stringify(done).slice(0, 200));
    assert.notEqual(done.status, "uploading", "the last chunk completes the upload");
    const left = path.join(dataDir, "upload-tmp");
    await new Promise((r) => setTimeout(r, 300));
    const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
    assert.deepEqual(walk(left), [], "no upload files remain after a completed chunked upload");
  });

  console.log("\nthe original Darkness app, now inside the unified server");
  await check("original API: health is public; everything else needs a session", async () => {
    assert.equal((await get("/classic-api/api/health")).status, 200);
    for (const [m, p] of [["POST", "/classic-api/api/chat"], ["GET", "/classic-api/api/conversations"], ["POST", "/classic-api/api/translate"], ["GET", "/classic-api/api/analytics"]]) {
      const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json" }, body: m === "POST" ? "{}" : undefined });
      assert.equal(r.status, 401, p);
    }
  });
  await check("original API: chat, translate, upload and conversations work for the signed-in user", async () => {
    const chat = await j(await postJson("/classic-api/api/chat", { messages: [{ role: "user", content: "hi" }], mode: "fast" }, tokB));
    assert.equal(chat.success, true); assert.ok(chat.response);
    const tr = await j(await postJson("/classic-api/api/translate", { text: "hello", targetLanguage: "French" }, tokB));
    assert.equal(tr.translation, "TRANSLATED");
    const up = await j(await fetch(base + "/classic-api/api/upload", { method: "POST", headers: { authorization: `Bearer ${tokB}` }, body: formData("n.md", Buffer.from("# hi\nsome notes"), "file") }));
    assert.equal(up.success, true); assert.ok(up.text.includes("some notes"));
    const saved = await j(await postJson("/classic-api/api/conversations", { conversation: { id: "bob-conv-1", title: "Bob only", messages: [{ role: "user", content: "secret" }] } }, tokB));
    assert.equal(saved.success, true);
    assert.equal((await get("/classic-api/api/conversations/bob-conv-1", tokB)).status, 200);
  });
  await check("original API: another user cannot read, overwrite or delete a conversation (the original had no such check)", async () => {
    assert.ok(tokC, "Carol is signed up");
    assert.equal((await get("/classic-api/api/conversations/bob-conv-1", tokC)).status, 404);
    assert.equal((await postJson("/classic-api/api/conversations", { conversation: { id: "bob-conv-1", title: "hijack", messages: [] } }, tokC)).status, 403);
    await fetch(base + "/classic-api/api/conversations/bob-conv-1", { method: "DELETE", headers: { authorization: `Bearer ${tokC}` } });
    assert.equal((await get("/classic-api/api/conversations/bob-conv-1", tokB)).status, 200, "still there");
    assert.ok(!JSON.stringify(await j(await get("/classic-api/api/conversations", tokC))).includes("Bob only"));
  });
  await check("original API: share links are public by design; webhooks to private addresses are refused; code execution is off", async () => {
    const sh = await j(await postJson("/classic-api/api/share", { conversation: { id: "x", title: "Shared", messages: [{ role: "user", content: "public hello" }] } }, tokB));
    const anon = await j(await get(`/classic-api/api/share/${sh.shareId}`));
    assert.equal(anon.conversation.messages[0].content, "public hello");
    for (const url of ["http://127.0.0.1/hook", "http://169.254.169.254/latest", "http://localhost:8080/x"]) {
      assert.equal((await postJson("/classic-api/api/webhooks", { url, events: ["*"] }, tokB)).status, 400, url);
    }
    assert.equal((await postJson("/classic-api/api/code", { code: "1+1" }, tokB)).status, 403);
  });
  await check("/classic/ serves the original app (signed-in only) with a patched service worker", async () => {
    const anon = await fetch(base + "/classic/", { redirect: "manual" });
    assert.equal(anon.status, 302);
    const page = await fetch(base + "/classic/", { headers: { authorization: `Bearer ${tokB}`, cookie: cookieB } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html) && !/<style[\s>]/i.test(html), "no inline script or style (the CSP forbids them)");
    assert.ok(html.includes('src="boot.js"') && html.includes('src="app.js"') && html.includes('href="app.css"'), "page references its script/style files");
    const boot = await fetch(base + "/classic/boot.js");
    assert.equal(boot.status, 200);
    assert.match(boot.headers.get("content-type") || "", /javascript/);
    const bootText = await boot.text();
    assert.ok(bootText.includes("darkness-api-url") && bootText.includes("/classic-api"), "backend url set by boot.js");
    const appJs = await fetch(base + "/classic/app.js");
    assert.equal(appJs.status, 200);
    assert.ok((await appJs.text()).length > 100_000, "the full original app script is served");
    const appCss = await fetch(base + "/classic/app.css");
    assert.equal(appCss.status, 200);
    assert.match(appCss.headers.get("content-type") || "", /text\/css/);
    assert.ok((await appCss.text()).length > 50_000);
    assert.equal((await fetch(base + "/classic/app-9.js")).status, 404, "unknown asset names are not served");
    assert.ok(!(await (await fetch(base + "/classic/..%2fpackage.json")).text()).includes('"dependencies"'), "no path traversal out of /classic");
    const sw = await (await fetch(base + "/classic/sw.js")).text();
    assert.ok(sw.includes("includes('/api/')") && !sw.includes("startsWith('/api/')"), "service worker no longer caches API responses");
  });

  console.log("\nownership of projects, across users");
  let pidB;
  await check("user B creates a project; user C cannot see it, export it, add files to it, or build from it", async () => {
    const pr = await j(await postJson("/api/projects", { name: "Bob's Shop API" }, tokB));
    pidB = pr.id;
    assert.ok(pidB);
    assert.ok((await postJson(`/api/projects/${pidB}/files`, { path: "src/app.js", content: 'import express from "express";\nconst app = express();\napp.get("/api/orders", (req,res)=>res.json([]));\napp.listen(3000);\n' }, tokB)).status < 300);
    assert.ok((await postJson(`/api/projects/${pidB}/files`, { path: "README.md", content: "# Shop\nAn order API for local sellers." }, tokB)).status < 300);
    assert.equal((await get(`/api/projects/${pidB}/export/docx`, tokC)).status, 404);
    const fd = new FormData(); fd.append("files", new Blob(["x"]), "evil.txt"); fd.append("projectId", pidB);
    assert.equal((await fetch(base + "/api/projects/upload-files", { method: "POST", headers: { authorization: `Bearer ${tokC}` }, body: fd })).status, 403);
    assert.equal((await postJson(`/api/builder/projects/${pidB}/brief`, {}, tokC)).status, 404);
    assert.ok(!JSON.stringify(await j(await get("/api/builder/projects", tokC))).includes(pidB));
  });

  await check("generated artifacts and images belong to their project's owner (read, download, rename, delete; not by id alone)", async () => {
    // Artifacts are produced by model calls; to test access rules without one, put a row in the server's own database file.
    const { DatabaseSync } = await import("node:sqlite");
    const sdb = new DatabaseSync(path.join(dataDir, "smoke.db"));
    sdb.exec("PRAGMA busy_timeout = 5000");
    const now = Date.now();
    sdb.prepare("INSERT INTO artifacts (id, project_id, name, mime_type, artifact_type, version, content, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("art_smoke_bob_1", pidB, "bobs-report.txt", "text/plain", "document", 1, "BOB-SECRET-REPORT", now, now);
    sdb.prepare("INSERT INTO visual_assets (id, project_id, asset_type, mime_type, filename, content_base64, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("vis_smoke_bob_1", pidB, "diagram", "image/png", "bob.png", Buffer.from("BOB-PNG").toString("base64"), now, now);
    sdb.close();
    // the owner can use them
    const mine = await get("/api/artifacts/art_smoke_bob_1", tokB);
    assert.equal(mine.status, 200);
    assert.equal((await get("/api/artifacts/art_smoke_bob_1/download", tokB)).status, 200);
    const img = await get("/api/visual-assets/vis_smoke_bob_1", tokB);
    assert.equal(img.status, 200);
    assert.match(img.headers.get("cache-control") || "", /private/, "user images are not cacheable by shared caches");
    // another signed-in user gets "not found" for every verb, and cannot learn that the id exists
    assert.equal((await get("/api/artifacts/art_smoke_bob_1", tokC)).status, 404);
    const dl = await get("/api/artifacts/art_smoke_bob_1/download", tokC);
    assert.equal(dl.status, 404);
    assert.ok(!(await dl.text()).includes("BOB-SECRET-REPORT"));
    assert.equal((await patchJson("/api/artifacts/art_smoke_bob_1", { filename: "hijacked.txt" }, tokC)).status, 404);
    assert.equal((await fetch(base + "/api/artifacts/art_smoke_bob_1", { method: "DELETE", headers: { authorization: `Bearer ${tokC}` } })).status, 404);
    assert.equal((await get("/api/visual-assets/vis_smoke_bob_1", tokC)).status, 404);
    // bulk download by id list (the ids are in the body, so the path guard cannot see them)
    const zipReq = (tok) => postJson("/api/artifacts/download-zip", { artifactIds: ["art_smoke_bob_1"], zipName: "x.zip" }, tok);
    const ownZip = await zipReq(tokB);
    assert.equal(ownZip.status, 200);
    assert.ok((await ownZip.arrayBuffer()).byteLength > 100, "the owner gets the archive");
    const foreignZip = await zipReq(tokC);
    assert.equal(foreignZip.status, 404, "another user's id is skipped like an unknown one, so there is nothing to download");
    assert.ok(!(await foreignZip.text()).includes("BOB-SECRET-REPORT"));
    // ...and nothing changed for the owner
    const after = await j(await get("/api/artifacts/art_smoke_bob_1", tokB));
    assert.equal(after.artifact.filename, "bobs-report.txt");
    assert.equal((await get("/api/artifacts/art_smoke_bob_1/download", tokB)).status, 200, "still there");
    // an unknown id still just says not found, and no session means no access
    assert.equal((await get("/api/artifacts/art_does_not_exist", tokC)).status, 404);
    assert.equal((await get("/api/artifacts/art_smoke_bob_1", undefined)).status, 401);
  });

  await check("project diagnostics report real problems (project-wide was always empty) and the single-file route no longer throws", async () => {
    const bad = '{ "name": "x", ';
    assert.ok((await postJson(`/api/projects/${pidB}/files`, { path: "config/bad.json", content: bad }, tokB)).status < 300);
    const all = await j(await postJson(`/api/projects/${pidB}/diagnostics/project`, {}, tokB));
    assert.ok(Array.isArray(all.issues) && all.issues.length >= 1, "the broken JSON is reported: " + JSON.stringify(all).slice(0, 200));
    assert.ok(all.summary.errors + all.summary.warnings >= 1);
    const one = await postJson(`/api/projects/${pidB}/diagnostics`, { path: "config/bad.json", content: bad }, tokB);
    assert.equal(one.status, 200, "was a TypeError (issues.forEach on a Promise)");
    const oj = await j(one);
    assert.ok(oj.issues.length >= 1 && oj.summary.errors + oj.summary.warnings >= 1);
    assert.equal((await postJson(`/api/projects/${pidB}/diagnostics`, { path: "config/bad.json", content: bad }, tokC)).status, 404, "another user's project is still off limits");
  });
  await check("knowledge: project upload works (was always a 500), single-document reindex finds the file (was always 404), search honours topK", async () => {
    const NL = String.fromCharCode(10);
    const long = Array.from({ length: 40 }, (_, i) => "## Section " + i + NL + NL + "The orders service validates the cart, charges the customer and stores order " + i + ". " + "Payment retries use exponential backoff. ".repeat(12)).join(NL + NL);
    const up = await fetch(base + `/api/projects/${pidB}/rag/upload`, { method: "POST", headers: { authorization: `Bearer ${tokB}` }, body: formData("orders.md", Buffer.from(long)) });
    assert.equal(up.status, 200, await up.clone().text());
    const upj = await j(up);
    assert.ok(upj.success && upj.files[0].path === "docs/orders.md" && upj.files[0].fileType === "Markdown");
    const kup = await fetch(base + "/api/knowledge/rag/upload", { method: "POST", headers: { authorization: `Bearer ${tokB}` }, body: formData("kb.md", Buffer.from(long)) });
    assert.equal(kup.status, 200);
    const re = await postJson("/api/knowledge/rag/reindex", { docPath: "docs/kb.md" }, tokB);
    assert.equal(re.status, 200, await re.clone().text());
    assert.ok((await j(re)).chunksIndexed > 0);
    assert.equal((await postJson("/api/knowledge/rag/reindex", { docPath: "docs/nope.md" }, tokB)).status, 404);
    for (const k of [1, 3]) {
      const found = await j(await postJson("/api/knowledge/rag/search", { query: "orders service validates the cart", topK: k }, tokB));
      assert.equal(found.allHits.length, k, "topK " + k);
    }
  });

  console.log("\nProject Studio (brief -> outline -> report + deck)");
  let briefOut, outlineOut, jobId;
  await check("prompt catalogue exposes the inbuilt prompts and the fixed-vs-editable layers", async () => {
    const c = await j(await get("/api/builder/prompts", tokB));
    assert.ok(c.inbuilt.report.includes("DEPTH OF UNDERSTANDING") && c.inbuilt.deck.length > 200 && c.inbuilt.image.length > 100);
    assert.equal(c.layers.filter((l) => l.editable).length, 1);
    assert.ok(c.themes.length === 4 && c.reportFormats.some((f) => f.id === "pdf"));
    assert.equal((await get("/api/builder/prompts")).status, 401);
  });
  await check("brief: the model analyses the project and asks questions + gives recommendations", async () => {
    briefOut = await j(await postJson(`/api/builder/projects/${pidB}/brief`, { options: { audience: "examiners" } }, tokB));
    assert.equal(briefOut.mode, "ai");
    assert.equal(briefOut.brief.title, "Shop API");
    assert.ok(briefOut.brief.questions.length >= 1 && briefOut.brief.recommendations.length >= 1);
  });
  await check("outline: answers, accepted recommendations and a custom prompt are accepted; revisions work", async () => {
    const body = { options: { guidance: { report: { mode: "custom", text: "Write like a friendly mentor with concrete examples." } } }, brief: briefOut.brief, answers: { q1: "No" }, acceptedRecommendations: ["Implement real authentication"], feedback: "Add more about security" };
    outlineOut = await j(await postJson(`/api/builder/projects/${pidB}/outline`, body, tokB));
    assert.equal(outlineOut.outline.report.sections.length, 3);
    assert.equal(outlineOut.recommendations[0].text, "Add a sequence diagram");
    const rev = await j(await postJson(`/api/builder/projects/${pidB}/outline`, { ...body, previous: outlineOut.outline, feedback: "Merge two sections" }, tokB));
    assert.ok(rev.outline.report.sections.length >= 1);
  });
  await check("generate: a job runs to completion and produces report, deck, zip and the prompts used", async () => {
    const r = await postJson(`/api/builder/projects/${pidB}/generate`, { options: { author: "Bob", guidance: { report: { mode: "custom", text: "Write like a friendly mentor with concrete examples." } } }, brief: briefOut.brief, outline: outlineOut.outline, build: { theme: "crimson", reportFormats: ["docx", "pdf", "md"], deck: true, images: true, bundle: true, extraImages: [{ words: "a glowing blood moon" }] } }, tokB);
    assert.equal(r.status, 202);
    jobId = (await j(r)).jobId;
    assert.equal((await get(`/api/builder/jobs/${jobId}`, tokC)).status, 404, "other users cannot see the job");
    let job;
    for (let i = 0; i < 160; i++) {
      job = await j(await get(`/api/builder/jobs/${jobId}`, tokB));
      if (job.state !== "running") break;
      await new Promise((ok) => setTimeout(ok, 250));
    }
    assert.equal(job.state, "done", JSON.stringify(job).slice(0, 300));
    const names = job.files.map((f) => f.name);
    for (const ext of ["_report.docx", "_report.pdf", "_report.md", "_presentation.pptx", "_package.zip", "prompts-used.md"]) assert.ok(names.some((n) => n.endsWith(ext)), `${ext} in ${names}`);
    assert.ok(job.warnings.some((w) => /image model|No image/i.test(w)), "a missing image provider is reported honestly, not faked: " + job.warnings.join(" | "));
    assert.equal(job.stats.mode, "ai");
  });
  await check("downloads: files are real documents; the report has the model's text; the deck has slides and notes", async () => {
    const job = await j(await get(`/api/builder/jobs/${jobId}`, tokB));
    const dl = async (name, token = tokB) => Buffer.from(await (await get(`/api/builder/jobs/${jobId}/file?name=${encodeURIComponent(name)}`, token)).arrayBuffer());
    const name = (suffix) => job.files.find((f) => f.name.endsWith(suffix)).name;
    assert.equal((await dl(name("_report.docx"))).subarray(0, 2).toString(), "PK");
    assert.equal((await dl(name("_report.pdf"))).subarray(0, 5).toString(), "%PDF-");
    const md = (await dl(name("_report.md"))).toString("utf8");
    assert.ok(md.includes("`POST /api/orders` endpoint in `src/app.js`"));
    const notes = (await dl("prompts-used.md")).toString("utf8");
    assert.ok(notes.includes("your own prompt") && notes.includes("Deck guidance used"), "records which prompt was used");
    const ex = await j(await fetch(base + "/api/documents/extract", { method: "POST", headers: { authorization: `Bearer ${tokB}` }, body: formData("deck.pptx", await dl(name(".pptx"))) }));
    assert.ok(ex.files[0].text.includes("Orders flow through one guarded endpoint") && ex.files[0].text.includes("Is auth real?"));
    assert.equal((await get(`/api/builder/jobs/${jobId}/file?name=${encodeURIComponent(name(".pptx"))}`, tokC)).status, 404);
    assert.equal((await get(`/api/builder/jobs/${jobId}/file?name=..%2F..%2Fetc%2Fpasswd`, tokB)).status, 404);
  });
  await check("image from words: a clear error (not a fake picture) when no image model is configured", async () => {
    const r = await postJson("/api/builder/image", { words: "a lighthouse in a storm" }, tokB);
    assert.equal(r.status, 502);
    assert.match((await j(r)).error, /image model/i);
    assert.equal((await postJson("/api/builder/image", { words: "ab" }, tokB)).status, 400);
  });

  console.log("\nCopilot (streaming chat)");
  const sseEvents = async (res) => {
    const text = await res.text();
    return [...text.split("\n\n")].map((f) => ({ ev: /^event: (.+)$/m.exec(f)?.[1], data: /^data: (.+)$/m.exec(f)?.[1] })).filter((x) => x.ev).map((x) => ({ ev: x.ev, d: JSON.parse(x.data) }));
  };
  let cpConv, cpUserMsg;
  await check("Copilot needs a session; status reports the model and streaming", async () => {
    assert.equal((await get("/api/copilot/status")).status, 401);
    assert.equal((await postJson("/api/copilot/chat", { message: "hi" })).status, 401);
    const st = await j(await get("/api/copilot/status", tokB));
    assert.match(st.model, /^openai/); assert.equal(st.streaming, true);
  });
  await check("an answer streams token by token and is saved with an automatic title", async () => {
    const res = await postJson("/api/copilot/chat", { message: "Hello there, who are you?" }, tokB);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /event-stream/);
    const ev = await sseEvents(res);
    assert.equal(ev[0].ev, "meta");
    const tokens = ev.filter((e) => e.ev === "token").map((e) => e.d.t);
    assert.ok(tokens.length >= 3, "several separate token events, not one blob: " + tokens.length);
    assert.equal(tokens.join(""), "Hello **world** from Copilot. [gpt]"); // Auto uses GPT when the server has an OpenAI key
    assert.equal(ev.at(-1).ev, "done");
    cpConv = ev[0].d.conversationId; cpUserMsg = ev[0].d.userMessageId;
    assert.equal(ev[0].d.title, "Hello there, who are you?");
    const full = await j(await get(`/api/copilot/conversations/${cpConv}`, tokB));
    assert.deepEqual(full.messages.map((m) => m.role), ["user", "assistant"]);
    assert.equal(full.messages[1].content, "Hello **world** from Copilot. [gpt]");
    assert.ok(JSON.stringify(await j(await get("/api/copilot/conversations", tokB))).includes(cpConv));
  });
  await check("regenerate replaces the last answer; edit rewrites the conversation from that message", async () => {
    await (await postJson("/api/copilot/chat", { conversationId: cpConv, regenerate: true }, tokB)).text();
    let full = await j(await get(`/api/copilot/conversations/${cpConv}`, tokB));
    assert.equal(full.messages.length, 2, "still one exchange after regenerate");
    const ev = await sseEvents(await postJson("/api/copilot/chat", { conversationId: cpConv, editMessageId: cpUserMsg, message: "Edited question" }, tokB));
    assert.equal(ev.at(-1).ev, "done");
    full = await j(await get(`/api/copilot/conversations/${cpConv}`, tokB));
    assert.equal(full.messages.length, 2);
    assert.equal(full.messages[0].content, "Edited question");
  });
  await check("a project can ground the answer, but only the owner's project", async () => {
    const own = await sseEvents(await postJson("/api/copilot/chat", { message: "What does my project do?", projectId: pidB }, tokB));
    const ownText = own.filter((e) => e.ev === "token").map((e) => e.d.t).join("");
    assert.ok(ownText.includes("project-context-seen"), "the owner's project excerpts reached the model: " + ownText);
    assert.ok(!own.some((e) => e.ev === "notice"));
    const other = await sseEvents(await postJson("/api/copilot/chat", { message: "What does it do?", projectId: pidB }, tokC));
    assert.ok(other.some((e) => e.ev === "notice"), "another user's project is refused");
    assert.ok(!other.filter((e) => e.ev === "token").map((e) => e.d.t).join("").includes("project-context-seen"));
  });
  await check("Focus: a topic scope reaches the model as binding rules and is remembered with the conversation", async () => {
    const ev = await sseEvents(await postJson("/api/copilot/chat", { message: "Tell me about cooking pasta", scope: { mode: "topic", topic: 'Python "programming"' } }, tokB));
    const text = ev.filter((e) => e.ev === "token").map((e) => e.d.t).join("");
    assert.ok(text.includes("[topic:Python programming]"), "the (sanitised) topic is in the system prompt: " + text);
    assert.ok(ev.some((e) => e.ev === "scope" && e.d.mode === "topic"));
    const conv = await j(await get(`/api/copilot/conversations/${ev[0].d.conversationId}`, tokB));
    assert.equal(conv.conversation.scope.mode, "topic");
    assert.equal(conv.conversation.scope.topic, "Python programming");
    const open = (await sseEvents(await postJson("/api/copilot/chat", { message: "hi" }, tokB))).filter((e) => e.ev === "token").map((e) => e.d.t).join("");
    assert.ok(!open.includes("[topic:") && !open.includes("[scope-project]"), "open mode adds no restriction");
  });
  await check("Focus: a project scope needs a project the user owns, otherwise nothing is answered", async () => {
    const ok = (await sseEvents(await postJson("/api/copilot/chat", { message: "How does it work?", scope: { mode: "project" }, projectId: pidB }, tokB))).filter((e) => e.ev === "token").map((e) => e.d.t).join("");
    assert.ok(ok.includes("[scope-project]") && ok.includes("[project-context-seen]"), ok);
    const other = await sseEvents(await postJson("/api/copilot/chat", { message: "How does it work?", scope: { mode: "project" }, projectId: pidB }, tokC));
    assert.ok(other.some((e) => e.ev === "error"), "someone else's project is refused");
    assert.equal(other.filter((e) => e.ev === "token").length, 0, "and no ungrounded answer is produced");
    assert.equal((await postJson("/api/copilot/chat", { message: "x", scope: { mode: "project" } }, tokB)).status, 400);
    assert.equal((await postJson("/api/copilot/chat", { message: "x", scope: { mode: "topic", topic: "ab" } }, tokB)).status, 400);
  });
  await check("GPT can be chosen directly; asking for a model the user has not set up is a clear error", async () => {
    const st = await j(await get("/api/copilot/status", tokB));
    assert.equal(st.choices.gpt, true); assert.equal(st.choices.mine, false);
    const gpt = (await sseEvents(await postJson("/api/copilot/chat", { message: "hi", model: "gpt" }, tokB))).filter((e) => e.ev === "token").map((e) => e.d.t).join("");
    assert.ok(gpt.includes("[gpt]"), "request went out for the GPT model: " + gpt);
    const mine = await postJson("/api/copilot/chat", { message: "hi", model: "mine" }, tokB);
    assert.equal(mine.status, 503); assert.equal((await j(mine)).code, "NO_MODEL");
  });
  await check("conversations are private; input is validated", async () => {
    assert.equal((await get(`/api/copilot/conversations/${cpConv}`, tokC)).status, 404);
    assert.equal((await fetch(`${base}/api/copilot/conversations/${cpConv}`, { method: "DELETE", headers: { authorization: `Bearer ${tokC}` } })).status, 404);
    assert.equal((await postJson("/api/copilot/chat", { conversationId: cpConv, message: "hijack" }, tokC)).status, 404);
    assert.equal((await postJson("/api/copilot/chat", { message: "   " }, tokB)).status, 400);
    assert.equal((await postJson("/api/copilot/chat", { message: "x".repeat(20001) }, tokB)).status, 413);
    assert.equal((await postJson("/api/copilot/chat", { conversationId: "../../x", message: "hi" }, tokB)).status, 404);
  });
  await check("rename, delete one, and clear all work", async () => {
    const ren = await fetch(`${base}/api/copilot/conversations/${cpConv}`, { method: "PATCH", headers: { authorization: `Bearer ${tokB}`, "content-type": "application/json" }, body: JSON.stringify({ title: "Renamed" }) });
    assert.equal(ren.status, 200);
    assert.ok(JSON.stringify(await j(await get("/api/copilot/conversations", tokB))).includes("Renamed"));
    assert.equal((await fetch(`${base}/api/copilot/conversations/${cpConv}`, { method: "DELETE", headers: { authorization: `Bearer ${tokB}` } })).status, 200);
    assert.equal((await get(`/api/copilot/conversations/${cpConv}`, tokB)).status, 404);
    await fetch(`${base}/api/copilot/conversations`, { method: "DELETE", headers: { authorization: `Bearer ${tokB}` } });
    assert.equal((await j(await get("/api/copilot/conversations", tokB))).conversations.length, 0);
  });
  await check("the privacy export includes Copilot chats and original-app chats (and only the user's own)", async () => {
    await (await postJson("/api/copilot/chat", { message: "Export-me question" }, tokB)).text();
    const exp = await (await get("/api/privacy/export", tokB)).text();
    assert.ok(exp.includes("Export-me question") && exp.includes("Hello **world** from Copilot."), "Copilot messages exported");
    assert.ok(exp.includes("Bob only"), "original-app conversation exported");
    assert.ok(!(await (await get("/api/privacy/export", tokC)).text()).includes("Export-me question"), "another user's export is clean");
  });
  await check("the Copilot page and launcher are served", async () => {
    assert.equal((await get("/copilot.html")).status, 200);
    assert.equal((await get("/copilot-launcher.js")).status, 200);
    assert.match(await (await get("/")).text(), /copilot-launcher\.js/);
  });

  console.log("\nerasure");
  await check("erase requires explicit confirmation", async () => {
    const r = await fetch(`${base}/api/privacy/erase`, { method: "DELETE", headers: { authorization: `Bearer ${tokA}`, "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 400);
  });
  await check("erase deletes the account, its data and its sessions", async () => {
    const r = await fetch(`${base}/api/privacy/erase`, { method: "DELETE", headers: { authorization: `Bearer ${tokA}`, "content-type": "application/json" }, body: JSON.stringify({ confirm: "ERASE" }) });
    assert.equal(r.status, 200);
    const out = await j(r);
    assert.ok(out.removed.account >= 1 && out.removed.conversations >= 1);
    assert.equal((await get("/api/conversations", tokA)).status, 401, "old token must die");
    assert.equal((await get("/api/auth/me", tokB)).status, 200, "other users unaffected");
  });

  console.log("\nlogs");
  await check("server logs contain no e-mail addresses or tokens", async () => {
    const all = logs.join("");
    assert.ok(!all.includes(emailA) && !all.includes(emailB), "e-mail leaked into logs");
    assert.ok(!all.includes(tokA) && !all.includes(tokB), "session token leaked into logs");
    assert.ok(!all.includes("test-key-not-real"), "API key leaked into logs");
    assert.ok(!all.includes("SMOKE_SECRET"), "CSP report query strings must be stripped before logging");
  });
} finally {
  server.kill();
  legacy.kill();
  // Both fake providers must be closed, with their connections: a listening server keeps the process alive after the last check,
  // so the run used to print its result and then hang until an outer timeout killed it (a CI job would have timed out).
  for (const s of [mock, stub]) { s.close(); s.closeAllConnections?.(); }
  for (const sock of stubOpen) sock.destroy();
  // let the server release its database file before deleting the temp directory (Windows locks open files)
  await new Promise((done) => { server.once("exit", done); setTimeout(done, 3000); });
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch { /* temp dir cleanup is best effort */ }
}

if (process.env.SMOKE_LOG_LEVELS) {
  // SMOKE_LOG_LEVELS=error,warn node scripts/smoke.mjs  ->  prints those server log lines in full (production log review)
  for (const line of logs.join("").split("\n")) { try { const j = JSON.parse(line); if (process.env.SMOKE_LOG_LEVELS.split(",").includes(j.level)) console.log("LOGLINE " + line.slice(0, 400)); } catch { /* not JSON */ } }
}
if (process.env.SMOKE_LOG_SUMMARY) {
  // Production log review aid: SMOKE_LOG_SUMMARY=1 node scripts/smoke.mjs  ->  how many log lines of each level/event the server wrote
  const counts = {};
  for (const line of logs.join("").split("\n")) {
    try { const j = JSON.parse(line); const k = `${j.level} ${j.event || j.msg || "(no event)"}`; counts[k] = (counts[k] || 0) + 1; } catch { const k = "unstructured " + line.slice(0, 60); if (line.trim()) counts[k] = (counts[k] || 0) + 1; }
  }
  console.log("\nserver log summary:\n" + Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${String(n).padStart(5)}  ${k}`).join("\n"));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("failed:", failures.join(" | "));
  process.exit(1);
}
// Exit explicitly: a stray handle must never turn a green run into a hang.
process.exit(0);
