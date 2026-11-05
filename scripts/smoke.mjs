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

  console.log("\nusage + account (management pages)");
  const patchJson = (p, body, token) => fetch(base + p, { method: "PATCH", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  await check("usage needs a sign-in and only counts the caller's own activity", async () => {
    assert.equal((await get("/api/usage")).status, 401);
    const a = await j(await get("/api/usage?days=14", tokA));
    assert.equal(a.series.length, 14); assert.equal(a.tokensMetered, false);
    assert.ok(a.totals.conversations >= 1, "alice has a conversation");
    assert.ok(a.recent.some((c) => c.title === "alice-secret-plan"));
    const b = await j(await get("/api/usage?days=14", tokB));
    assert.ok(!JSON.stringify(b).includes("alice-secret-plan"), "bob must not see alice's titles");
    assert.equal((await j(await get("/api/usage?days=9999", tokA))).days, 90, "range is clamped");
    assert.equal((await j(await get("/api/usage?days=abc", tokA))).days, 14);
  });
  await check("account: profile, rename (cleaned), and validation", async () => {
    assert.equal((await get("/api/account")).status, 401);
    const me = await j(await get("/api/account", tokA));
    assert.equal(me.user.email, emailA); assert.equal(me.passwordMinLength, 8);
    assert.ok(me.session && me.session.expiresAt > Date.now(), "this device's session is listed");
    assert.equal((await patchJson("/api/account", { name: "   " }, tokA)).status, 400);
    assert.equal((await patchJson("/api/account", { name: 42 }, tokA)).status, 400);
    const ok = await j(await patchJson("/api/account", { name: "  <b>Alice</b>\u0001  Smith " }, tokA));
    assert.equal(ok.name, "bAlice/b Smith");
    assert.equal((await j(await get("/api/auth/me", tokA))).user.name, "bAlice/b Smith", "rename is visible everywhere");
  });
  await check("password change: wrong current keeps you signed in, weak is refused, success signs other devices out", async () => {
    const email = `acct-${crypto.randomUUID().slice(0, 6)}@example.com`;
    const t1 = (await j(await post("/api/auth/signup", { email, password: pw, name: "Acct" }))).token;
    const t2 = (await j(await post("/api/auth/login", { email, password: pw }))).token;
    assert.notEqual(t1, t2);
    let r = await post("/api/account/password", { current: "not-the-password", next: "Fresh-pass-9876" }, t1);
    let d = await j(r);
    assert.equal(r.status, 403, "403, not 401: a 401 would make the web app think the session expired");
    assert.equal(d.code, "INVALID_CREDENTIALS"); assert.equal(d.field, "current"); assert.equal(d.attemptsLeft, 4);
    assert.equal((await get("/api/account", t1)).status, 200, "still signed in after a wrong current password");
    for (const [next, code] of [["short", "WEAK_PASSWORD"], ["password123", "WEAK_PASSWORD"], [pw, "VALIDATION_ERROR"]]) {
      r = await post("/api/account/password", { current: pw, next }, t1); d = await j(r);
      assert.equal(r.status, 400, next); assert.equal(d.code, code, next); assert.equal(d.field, "next");
    }
    r = await post("/api/account/password", { current: pw, next: "Fresh-pass-9876" }, t1); d = await j(r);
    assert.equal(r.status, 200); assert.equal(d.revokedSessions, 1);
    assert.equal((await get("/api/account", t1)).status, 200, "this device stays signed in");
    assert.equal((await get("/api/account", t2)).status, 401, "the other device was signed out");
    assert.equal((await post("/api/auth/login", { email, password: pw })).status, 401, "the old password no longer works");
    assert.equal((await post("/api/auth/login", { email, password: "Fresh-pass-9876" })).status, 200);
    // five wrong attempts pause further changes, with Retry-After
    let last;
    for (let i = 0; i < 5; i++) last = await post("/api/account/password", { current: "wrong-wrong-1", next: "Another-pass-5555" }, t1);
    assert.equal(last.status, 429); assert.equal((await j(last)).code, "ACCOUNT_LOCKED"); assert.ok(Number(last.headers.get("retry-after")) > 0);
  });
  await check("devices: listed without tokens; 'sign out others' keeps this one", async () => {
    const email = `dev-${crypto.randomUUID().slice(0, 6)}@example.com`;
    await post("/api/auth/signup", { email, password: pw, name: "Dev" });
    const t3 = (await j(await post("/api/auth/login", { email, password: pw }))).token;
    const t4 = (await j(await post("/api/auth/login", { email, password: pw }))).token;
    const list = await j(await get("/api/account/sessions", t3));
    assert.ok(list.sessions.length >= 3); assert.equal(list.sessions.filter((s) => s.current).length, 1);
    assert.ok(!JSON.stringify(list).includes(t3) && !JSON.stringify(list).includes(t4), "tokens are never exposed");
    const rv = await j(await post("/api/account/sessions/revoke-others", {}, t3));
    assert.ok(rv.revoked >= 2);
    assert.equal((await get("/api/account", t3)).status, 200); assert.equal((await get("/api/account", t4)).status, 401);
  });
  await check("models: disabling one sticks after the list is reloaded, and it can be re-enabled", async () => {
    const email = `mod-${crypto.randomUUID().slice(0, 6)}@example.com`;
    const tok = (await j(await post("/api/auth/signup", { email, password: pw, name: "Mod" }))).token;
    const made = await post("/api/models", { id: "m-one", name: "One", provider: "openai", modelName: "gpt-x", baseUrl: "http://127.0.0.1:1/v1", apiKey: "k", capabilities: { text: true } }, tok);
    assert.ok(made.status === 200 || made.status === 201, "model created");
    const find = async () => (await j(await get("/api/models", tok))).models.find((m) => m.id === "m-one");
    assert.equal((await find()).enabled, true);
    assert.equal((await post("/api/models/m-one/enable", { enabled: false }, tok)).status, 200);
    assert.equal((await find()).enabled, false, "still disabled after reloading the list");
    assert.equal((await find()).enabled, false, "and after a second reload");
    assert.equal((await post("/api/models/m-one/enable", { enabled: true }, tok)).status, 200);
    assert.equal((await find()).enabled, true);
  });
  await check("CSRF: a cookie-only state change from another site is blocked; same site and Bearer callers still work", async () => {
    const email = `csrf-${crypto.randomUUID().slice(0, 6)}@example.com`;
    const su = await post("/api/auth/signup", { email, password: pw, name: "Csrf" });
    const cookie = (su.headers.get("set-cookie") || "").split(";")[0];
    assert.ok(cookie.startsWith("darkness_session="), "signup sets the session cookie");
    const tok = (await j(su)).token;
    const patch = (headers) => fetch(base + "/api/account", { method: "PATCH", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ name: "Csrf Test" }) });
    const evil = await patch({ cookie, origin: "https://evil.example" });
    assert.equal(evil.status, 403);
    assert.equal((await evil.json()).code, "CROSS_ORIGIN_BLOCKED");
    assert.equal((await patch({ cookie, origin: base })).status, 200, "this site is accepted");
    assert.equal((await patch({ authorization: `Bearer ${tok}`, origin: "https://evil.example" })).status, 200, "Bearer callers do not rely on the cookie");
    // the HttpOnly cookie on its own carries the session for the whole API (it used to be ignored behind the auth gate)
    for (const p of ["/api/account", "/api/usage", "/api/models", "/api/auth/me"]) {
      assert.equal((await fetch(base + p, { headers: { cookie } })).status, 200, `cookie alone authenticates ${p}`);
    }
    assert.equal((await fetch(base + "/api/account", { headers: { cookie: "darkness_session=sess_forged_value" } })).status, 401, "a forged cookie does not");
    const out = await fetch(base + "/api/auth/logout", { method: "POST", headers: { cookie, origin: base } });
    assert.ok(out.status === 200 || out.status === 204, "logout with the cookie works: " + out.status);
    assert.equal((await fetch(base + "/api/account", { headers: { cookie } })).status, 401, "after logout the cookie no longer works");
  });

  console.log("\nreliability: request ids, health, readiness");
  await check("health is a cheap liveness probe (no secrets); readiness runs the real checks; both answer with a request id", async () => {
    const h = await fetch(base + "/api/health");
    const hj = await h.json();
    assert.equal(h.status, 200);
    assert.deepEqual(Object.keys(hj).sort(), ["service", "status", "uptimeSec"], "no key lengths or provider details");
    assert.match(h.headers.get("x-request-id") || "", /^req_/);
    const r = await fetch(base + "/api/ready", { headers: { "x-request-id": "smoke-trace-000001" } });
    const rj = await r.json();
    assert.equal(r.status, 200);
    assert.equal(rj.status, "ready");
    for (const c of ["database", "storage", "uploads"]) assert.equal(rj.checks[c].status, "ok", c);
    assert.equal(r.headers.get("x-request-id"), "smoke-trace-000001", "a well-formed incoming id is kept");
    assert.match((await fetch(base + "/api/ready", { headers: { "x-request-id": "bad id!" } })).headers.get("x-request-id"), /^req_/, "a malformed one is replaced");
  });
  await check("error responses carry the request id (header and body match); success bodies are unchanged", async () => {
    const r = await fetch(base + "/api/projects");
    const j = await r.json();
    assert.equal(r.status, 401);
    assert.equal(j.code, "AUTH_REQUIRED");
    assert.equal(j.requestId, r.headers.get("x-request-id"));
    const bad = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    const bj = await bad.json();
    assert.equal(bad.status, 400);
    assert.ok(bj.requestId && !/node_modules|at \S+ \(.*:\d+:\d+\)/.test(JSON.stringify(bj)), "a JSON 400 with an id and no stack");
  });

  console.log("\nprovider stability through the real chat route (stub provider: 503s, 401s, hangs, stalls, disconnects)");
  const KEY = "stub-secret-key-123456";
  let chatTok, modelsReady = false;
  const chat = async (modelId, opts = {}) => {
    const ctl = new AbortController();
    const r = await fetch(base + `/api/conversations/conv-${modelId}-${crypto.randomUUID().slice(0, 6)}/chat`, { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", authorization: `Bearer ${chatTok}`, ...(opts.headers || {}) }, body: JSON.stringify({ message: opts.message || "hello-private-marker-xyz", model_id: modelId }) });
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "", text = "", error = "", first = false;
    const t0 = Date.now();
    for (;;) {
      let chunk;
      try { chunk = await reader.read(); } catch { break; }
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2);
        const m = /^data: (.*)$/m.exec(frame);
        if (!m) continue;
        try { const ev = JSON.parse(m[1]); if (ev.content) { text += ev.content; first = true; } if (ev.error) error += (ev.error.message || ev.error); } catch {}
      }
      if (opts.abortAfterFirst && first) { ctl.abort(); break; }
    }
    return { status: r.status, text, error, ms: Date.now() - t0, requestId: r.headers.get("x-request-id") };
  };
  const settleSockets = async () => { for (let i = 0; i < 40 && stubOpen.size > 0; i++) await new Promise((r) => setTimeout(r, 100)); return stubOpen.size; };

  await check("set up a user and five models that point at the misbehaving provider", async () => {
    const email = `chat-${crypto.randomUUID().slice(0, 6)}@example.com`;
    chatTok = (await j(await post("/api/auth/signup", { email, password: pw, name: "Chat" }))).token;
    for (const m of ["stub-ok", "stub-flaky", "stub-denied", "stub-hang", "stub-stall", "stub-endless", "stub-agent"]) {
      const r = await post("/api/models", { id: m, name: m, provider: "custom", modelName: m, baseUrl: `http://127.0.0.1:${STUB_PORT}/v1`, apiKey: KEY, capabilities: { text: true, streaming: true } }, chatTok);
      assert.ok(r.status === 200 || r.status === 201, m + " " + r.status);
    }
    modelsReady = true;
  });
  await check("a healthy provider streams its answer through the chat route", async () => {
    assert.ok(modelsReady);
    const r = await chat("stub-ok");
    assert.equal(r.status, 200);
    assert.match(r.text, /Hello from the stub provider/);
    assert.equal(r.error, "");
    assert.equal(stubHits["stub-ok"], 1);
  });
  await check("verified arithmetic is answered by the solver without calling the model; ordinary text still reaches the model", async () => {
    // AgentRuntime read `.success` / `.canonicalMarkdown` from a string, so this branch never ran and every sum went to the model.
    const before = stubHits["stub-ok"];
    const math = await chat("stub-ok", { message: "solve 2x + 3 = 7" });
    assert.equal(math.status, 200);
    assert.match(math.text, /x\s*=\s*2/, math.text.slice(0, 200));
    assert.doesNotMatch(math.text, /Hello from the stub provider/);
    assert.equal(stubHits["stub-ok"], before, "the model was not called");
    const plain = await chat("stub-ok", { message: "tell me about your day" });
    assert.match(plain.text, /Hello from the stub provider/);
    assert.equal(stubHits["stub-ok"], before + 1);
  });
  await check("the chat stream opens at once, even while the model is silent (a hosting front door needs the first byte within 25 s)", async () => {
    const ctl = new AbortController();
    const t0 = Date.now();
    const r = await fetch(base + `/api/conversations/conv-open-${crypto.randomUUID().slice(0, 6)}/chat`, { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", authorization: `Bearer ${chatTok}` }, body: JSON.stringify({ message: "hello", model_id: "stub-hang" }) });
    const headersAfter = Date.now() - t0;
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") || "", /event-stream/);
    assert.ok(headersAfter < 1500, `headers took ${headersAfter} ms while the provider said nothing`);
    const first = await r.body.getReader().read();
    assert.match(new TextDecoder().decode(first.value), /^: stream open/, "an SSE comment goes out immediately");
    ctl.abort(); // the visitor leaves; the server must cancel the upstream call (checked in detail below)
    await settleSockets();
  });
  await check("a transient 503 is retried transparently: the user still gets an answer", async () => {
    const r = await chat("stub-flaky");
    assert.match(r.text, /Recovered after a retry/, JSON.stringify(r));
    assert.equal(stubHits["stub-flaky"], 2, "one failure, one retry");
  });
  await check("a 401 is NOT retried, its message reaches the user, and the API key is never echoed back", async () => {
    const r = await chat("stub-denied");
    assert.equal(stubHits["stub-denied"], 1, "exactly one attempt");
    assert.match(r.error, /Invalid API key/i, "the provider's message is preserved: " + r.error);
    assert.ok(!r.error.includes(KEY) && !r.text.includes(KEY), "the key must not be reflected to the user");
  });
  await check("a provider that never answers is cut off by the timeout (not left hanging) and its connections are closed", async () => {
    const r = await chat("stub-hang");
    assert.ok(r.ms < 12000, `ended in ${r.ms} ms`);
    assert.match(r.error, /timed out|did not respond/i, "the user is told what happened: " + JSON.stringify(r));
    assert.ok(stubHits["stub-hang"] >= 2, "it was retried before giving up: " + stubHits["stub-hang"]);
    assert.equal(await settleSockets(), 0, "every abandoned upstream connection was closed");
  });
  await check("a provider that goes silent mid-answer: the partial text is kept, the stall is reported, nothing is retried", async () => {
    const r = await chat("stub-stall");
    assert.match(r.text, /Partial answer/);
    assert.match(r.error, /idle timeout|stopped sending/i, JSON.stringify(r));
    assert.equal(stubHits["stub-stall"], 1, "a stream that started is never retried");
    assert.ok(r.ms < 8000);
    assert.equal(await settleSockets(), 0);
  });
  await check("closing the browser tab mid-answer cancels the upstream request and frees its connection", async () => {
    const r = await chat("stub-endless", { abortAfterFirst: true });
    assert.match(r.text, /tick/);
    assert.equal(await settleSockets(), 0, "the provider connection was closed after the client went away");
  });
  await check("logs: one structured entry per request with its id; no API key, token or private prompt anywhere", async () => {
    await new Promise((r) => setTimeout(r, 300));
    const all = logs.join("");
    const lines = all.split("\n").filter((l) => l.startsWith("{") && l.includes('"event":"http_request"'));
    assert.ok(lines.length > 5, "structured access logs are written: " + lines.length);
    const parsed = lines.map((l) => JSON.parse(l));
    assert.ok(parsed.some((e) => e.route && e.route.includes("/chat") && e.requestId.startsWith("req_") && typeof e.durationMs === "number"), "chat requests are logged with an id");
    assert.ok(!all.includes(KEY), "the provider API key never appears in the server log");
    assert.ok(!all.includes(chatTok), "the session token never appears in the server log");
    assert.ok(!all.includes("hello-private-marker-xyz"), "the user's prompt never appears in the server log");
  });

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

  console.log("\nconversation library: search, tags, folders, pinning, branching");
  await check("search finds text in titles and messages, tags/folders/pinning show in the list, branching copies up to a message, and nothing crosses between users", async () => {
    const make = async (tok, title, msgs) => {
      const c = await j(await postJson("/api/conversations", { title }, tok));
      const id = c.id || (c.conversation && c.conversation.id);
      assert.ok(id, JSON.stringify(c).slice(0, 120));
      const ids = [];
      for (const [role, content] of msgs) ids.push((await j(await postJson(`/api/conversations/${id}/messages`, { role, content }, tok))).id);
      return { id, ids };
    };
    const trip = await make(tokB, "Trip planning", [["user", "Plan five days in Lisbon with a budget of 800 euros"], ["assistant", "Day one: Alfama. Day two: Belem."]]);
    const dbc = await make(tokB, "Database tuning", [["user", "Why is my SQL query slow? 100% CPU on _prod_"]]);
    const secret = await make(tokC, "Carol's private notes", [["user", "Lisbon is where the secret meeting is"]]);
    const search = async (qs, tok = tokB) => j(await get("/api/conversations/search?" + qs, tok));
    const ids = (r) => r.results.map((x) => x.id);
    // text search, snippet, literal wildcards
    const r = await search("q=lisbon");
    assert.deepEqual(ids(r), [trip.id]);
    assert.match(r.results[0].snippet, /Lisbon/i);
    assert.deepEqual(ids(await search("q=" + encodeURIComponent("100%"))), [dbc.id]);
    assert.equal((await search("q=" + encodeURIComponent("%%"))).total, 0, "'%%' is not 'match everything'");
    // isolation and validation
    assert.deepEqual((await search("q=secret")).results, [], "Carol's text is invisible to Bob");
    assert.deepEqual(ids(await search("q=lisbon", tokC)), [secret.id]);
    assert.equal((await get("/api/conversations/search?q=a", tokB)).status, 400);
    assert.equal((await get("/api/conversations/search?q=lisbon")).status, 401, "no session, no search");
    // tags, folder, pinned
    const patch = (id, body, tok = tokB) => patchJson(`/api/conversations/${id}/meta`, body, tok);
    assert.deepEqual((await j(await patch(trip.id, { tags: ["Travel", "2026"], folder: "Plans", pinned: true }))).tags, ["travel", "2026"]);
    assert.equal((await patch(trip.id, { tags: ["<script>"] })).status, 400);
    assert.equal((await patch(trip.id, {})).status, 400);
    assert.equal((await patch(secret.id, { tags: ["mine"] })).status, 404, "Bob cannot tag Carol's conversation");
    assert.equal((await patch("00000000-0000-4000-8000-000000000000", { pinned: true })).status, 404);
    const list = await j(await get("/api/conversations", tokB));
    assert.equal(list.conversations[0].id, trip.id, "pinned conversations lead the list");
    assert.deepEqual(list.conversations[0].tags, ["travel", "2026"]);
    assert.equal(list.conversations[0].folder, "Plans");
    assert.deepEqual(ids(await search("tag=travel")), [trip.id]);
    assert.deepEqual(ids(await search("folder=Plans")), [trip.id]);
    assert.deepEqual((await search("tag=travel", tokC)).results, []);
    assert.deepEqual((await j(await get("/api/conversations/facets", tokB))).tags.map((t) => t.name).sort(), ["2026", "travel"]);
    // branching
    const br = await postJson(`/api/conversations/${trip.id}/branch`, { fromMessageId: trip.ids[0] }, tokB);
    assert.equal(br.status, 201);
    const branch = await j(br);
    assert.equal(branch.copied, 1);
    assert.equal((await postJson(`/api/conversations/${trip.id}/branch`, { fromMessageId: trip.ids[0] }, tokC)).status, 404, "Carol cannot branch Bob's conversation");
    assert.equal((await postJson(`/api/conversations/${secret.id}/branch`, { fromMessageId: secret.ids[0] }, tokB)).status, 404);
    assert.equal((await postJson(`/api/conversations/${trip.id}/branch`, { fromMessageId: dbc.ids[0] }, tokB)).status, 404, "a message of another conversation");
    assert.equal((await postJson(`/api/conversations/${trip.id}/branch`, {}, tokB)).status, 400);
    const bm = await j(await get(`/api/conversations/${branch.id}/messages`, tokB));
    assert.equal(bm.messages.length, 1);
    assert.match(bm.messages[0].content, /Lisbon/);
    assert.equal((await j(await get(`/api/conversations/${trip.id}/messages`, tokB))).messages.length, 2, "the source keeps both messages");
    assert.deepEqual(ids(await search("q=lisbon")).sort(), [branch.id, trip.id].sort(), "the branch is searchable too");
    assert.ok((await get(`/api/conversations/${branch.id}/messages`, tokC)).status >= 400, "Carol cannot read Bob's branch");
  });

  console.log("\nmodel comparison");
  await check("compare runs one prompt on two of your models, isolates a failing one, never leaks a key, refuses foreign models, and a disconnect stops the upstream call", async () => {
    assert.ok(modelsReady);
    const cmp = (body, tok = chatTok, signal) => fetch(base + "/api/compare", { method: "POST", signal, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify(body) });
    // one healthy model, one the provider rejects (its 401 message echoes the Authorization header, which must be scrubbed)
    const r = await cmp({ prompt: "Say something", modelIds: ["stub-ok", "stub-denied"] });
    assert.equal(r.status, 200);
    const text = await r.text();
    const out = JSON.parse(text);
    assert.deepEqual(out.results.map((x) => [x.modelId, x.finish]), [["stub-ok", "done"], ["stub-denied", "error"]]);
    assert.match(out.results[0].text, /Plain answer from the stub provider/);
    assert.match(out.results[1].error, /401|Invalid API key/i);
    assert.ok(!text.includes(KEY), "the model's key is not in the response");
    assert.ok(!logs.join("").includes(KEY), "nor in the server logs");
    // validation and ownership
    assert.equal((await cmp({ prompt: "x", modelIds: ["stub-ok"] })).status, 400);
    assert.equal((await cmp({ prompt: "x", modelIds: ["stub-ok", "stub-flaky", "stub-denied", "stub-hang"] })).status, 400);
    assert.equal((await cmp({ prompt: "x".repeat(9000), modelIds: ["stub-ok", "stub-denied"] })).status, 413);
    assert.equal((await cmp({ prompt: "x", modelIds: ["stub-ok", "stub-denied"] }, tokB)).status, 404, "Bob has no such models: another user's model reads as not found");
    assert.equal((await post("/api/compare", { prompt: "x", modelIds: ["stub-ok", "stub-denied"] })).status, 401, "no session, no comparison");
    // disconnect: the hanging provider socket must be closed by the server
    const ctl = new AbortController();
    const hung = cmp({ prompt: "slow", modelIds: ["stub-ok", "stub-hang"] }, chatTok, ctl.signal).catch(() => null);
    for (let i = 0; i < 50 && stubOpen.size === 0; i++) await new Promise((r2) => setTimeout(r2, 100));
    assert.ok(stubOpen.size > 0, "the hanging upstream request was opened");
    ctl.abort();
    await hung;
    assert.equal(await settleSockets(), 0, "cancelling the browser request closed the upstream connection");
  });

  console.log("\nfinal audit regressions");
  await check("studio instruction routes reject a missing studioType with a 400 instead of throwing (the route sweep found a 500 with an internal message)", async () => {
    const r1 = await postJson("/api/studio/execute-instruction", { prompt: "make it blue" }, tokB);
    assert.equal(r1.status, 400);
    assert.match((await j(r1)).error, /studioType/);
    const r2 = await postJson("/api/studio/execute-instruction", { prompt: "x", studioType: { a: 1 } }, tokB);
    assert.equal(r2.status, 400);
  });

  await check("a client-chosen conversation id can never take over someone else's conversation (it used to replace the owner and hand over the messages)", async () => {
    const mine = await j(await postJson("/api/conversations", { title: "Bob's private thread" }, tokB));
    assert.ok(mine.id);
    await postJson(`/api/conversations/${mine.id}/messages`, { role: "user", content: "BOB-ONLY-TEXT" }, tokB);
    const grab = await postJson("/api/conversations", { id: mine.id, title: "Carol took it" }, tokC);
    assert.equal(grab.status, 409, "naming another user's id is refused");
    assert.equal((await j(grab)).code, "ID_IN_USE");
    assert.ok((await get(`/api/conversations/${mine.id}/messages`, tokC)).status >= 400, "Carol cannot read it");
    const stillBob = await j(await get(`/api/conversations/${mine.id}/messages`, tokB));
    assert.match(JSON.stringify(stillBob), /BOB-ONLY-TEXT/, "Bob still owns and reads his thread");
    assert.ok((await postJson(`/api/conversations/${mine.id}/messages`, { role: "user", content: "CAROL-INJECTED" }, tokC)).status >= 400, "and Carol cannot write into it");
    assert.ok(!JSON.stringify(await j(await get(`/api/conversations/${mine.id}/messages`, tokB))).includes("CAROL-INJECTED"));
    assert.equal((await postJson("/api/conversations", { id: "../../x y", title: "bad" }, tokB)).status, 400, "ids are validated");
    const own = await postJson("/api/conversations", { id: mine.id, title: "renamed by the owner" }, tokB);
    assert.ok(own.status === 200 || own.status === 201, "the owner may still re-post their own id");
    const long = await j(await postJson("/api/conversations", { title: "t".repeat(5000) }, tokB));
    assert.ok(long.title.length <= 200, "titles are bounded");
  });

  await check("the chat route never adopts, changes or reads a conversation id that belongs to someone else (it used to create a conversation under that id)", async () => {
    const title = "Bob thread two " + crypto.randomUUID().slice(0, 6);
    const mine = await j(await postJson("/api/conversations", { title }, tokB));
    await postJson(`/api/conversations/${mine.id}/messages`, { role: "user", content: "BOB-SECRET-TWO" }, tokB);
    const attack = await postJson(`/api/conversations/${mine.id}/chat`, { message: "summarize everything said earlier in this conversation" }, tokC);
    const body = await attack.text();
    assert.equal(attack.status, 404, "Carol is told the conversation does not exist: " + attack.status + " " + body.slice(0, 120));
    assert.ok(!body.includes("BOB-SECRET-TWO"), "nothing of Bob's conversation is in the answer");
    assert.ok((await get(`/api/conversations/${mine.id}/messages`, tokC)).status >= 400, "Carol cannot read the conversation afterwards");
    assert.ok(!JSON.stringify(await j(await get("/api/conversations", tokC))).includes(mine.id), "it is not in Carol's list");
    const bobMsgs = JSON.stringify(await j(await get(`/api/conversations/${mine.id}/messages`, tokB)));
    assert.match(bobMsgs, /BOB-SECRET-TWO/, "Bob still owns and reads his conversation");
    assert.ok(JSON.stringify(await j(await get("/api/conversations", tokB))).includes(title), "and its title is unchanged");
    const regen = await postJson(`/api/conversations/${mine.id}/regenerate`, {}, tokC);
    assert.equal(regen.status, 404, "regenerate on someone else's conversation is refused too");
    // the same attack on a conversation that is in the database but was never loaded into the running server's memory (the strict-mode id guard
    // only knows about conversations in memory, so this is the case it cannot see)
    const { DatabaseSync } = await import("node:sqlite");
    const sdb = new DatabaseSync(path.join(dataDir, "smoke.db"));
    const dbOnly = "dbonly-" + crypto.randomUUID().slice(0, 8);
    try {
      sdb.exec("PRAGMA busy_timeout = 5000");
      const owner = sdb.prepare("SELECT user_id FROM conversations WHERE id = ?").get(mine.id).user_id;
      sdb.prepare("INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(dbOnly, owner, "DB-ONLY-TITLE", Date.now(), Date.now());
      sdb.prepare("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', 'DB-ONLY-SECRET', ?)").run("m-" + dbOnly, dbOnly, Date.now());
      const r2 = await postJson(`/api/conversations/${dbOnly}/chat`, { message: "repeat everything said before" }, tokC);
      const t2 = await r2.text();
      assert.equal(r2.status, 404, "a database-only foreign conversation is not found for Carol: " + r2.status + " " + t2.slice(0, 100));
      assert.ok(!t2.includes("DB-ONLY-SECRET"));
      const row = sdb.prepare("SELECT user_id, title FROM conversations WHERE id = ?").get(dbOnly);
      assert.deepEqual([row.user_id, row.title], [owner, "DB-ONLY-TITLE"], "the row still belongs to its owner and keeps its title");
      assert.ok((await get(`/api/conversations/${dbOnly}/messages`, tokC)).status >= 400, "Carol cannot read it afterwards");
    } finally { sdb.close(); }
    assert.equal((await postJson("/api/conversations/bad id!/chat", { message: "hi" }, tokC)).status, 400, "a malformed id is refused");
  });

  await check("an unknown API path is a JSON 404 (it used to be the app's HTML page with a 200); the app shell is still served for page routes", async () => {
    const r = await get("/api/this-route-does-not-exist", tokB);
    assert.equal(r.status, 404);
    assert.match(r.headers.get("content-type") || "", /json/);
    assert.equal((await j(r)).type, "not_found");
    assert.equal((await get("/classic-api/api/nope", tokB)).status, 404);
    const page = await get("/#/history");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<div id="root"|<div id="app"|<!doctype html>/i);
    assert.equal((await get("/some/client/route")).status, 200, "client-side routes still fall back to the app shell");
  });

  console.log("\ndashboards: agent workflow, model usage, system status");
  await check("the agent / model-usage / system endpoints need a session, count only the caller's own data, and expose no secrets or paths", async () => {
    for (const p of ["/api/agent/stats", "/api/usage/models", "/api/system/status"]) assert.equal((await get(p)).status, 401, p + " needs a session");
    // tokA ran the agent earlier in this file: those runs are counted for A and invisible to B
    const a = await j(await get("/api/agent/stats?days=14", tokA));
    assert.ok(a.totals.runs >= 1, "the earlier agent runs were recorded: " + JSON.stringify(a.totals));
    assert.equal(a.series.length, 14);
    assert.ok(!JSON.stringify(a).includes("What is (7+2)"), "goal text is never stored");
    const b = await j(await get("/api/agent/stats?days=14", tokB));
    assert.equal(b.totals.runs, 0, "Bob sees none of Alice's runs");
    assert.equal((await j(await get("/api/agent/stats?days=9999", tokA))).days, 90, "the range is clamped");
    const mu = await j(await get("/api/usage/models", tokB));
    assert.equal(mu.tokensAreEstimated, true);
    assert.ok(Array.isArray(mu.models));
    const sys = await j(await get("/api/system/status", tokB));
    assert.ok(["ready", "degraded"].includes(sys.state), sys.state);
    assert.ok(sys.checks.some((c) => c.name === "database" && c.status === "ok"));
    assert.equal(typeof sys.process.uptimeSec, "number");
    const text = JSON.stringify(sys);
    assert.ok(!/[A-Za-z]:\\|\/tmp\/|\.db\b|api_key|sk-/.test(text), "no paths or keys in the system status: " + text.slice(0, 200));
    assert.ok(Array.isArray(sys.alerts));
  });

  console.log("\nthrough the hosted front door (the real api/proxy.js, as Vercel runs it, in front of this server)");
  const doorMod = await import("../api/proxy.js");
  process.env.BACKEND_URL = `https://127.0.0.1:${APP_PORT}`; // the proxy insists on https; the stub below speaks http to the local server
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (u, init) => nativeFetch(String(u).replace(/^https:\/\/127\.0\.0\.1/, "http://127.0.0.1"), init);
  const FRONT = "https://app.example.test";
  // the same shape vercel.json's rewrite produces: /api/:path* -> /api/proxy?path=:path*
  // A browser reaches Vercel from its own address; Vercel puts it in x-forwarded-for (so the backend's per-IP limits see the visitor, not the proxy).
  const door = (p, init = {}) => doorMod.default(new Request(`${FRONT}/api/proxy?path=${p}`, { ...init, headers: { "x-forwarded-for": "203.0.113.7", ...(init.headers || {}) } }));
  try {
    await check("front door: sign-up sets a first-party session cookie with the right flags; reload, CSRF, logout and expiry behave", async () => {
      const email = `door-${crypto.randomUUID().slice(0, 6)}@example.com`;
      const jsonHdr = (extra = {}) => ({ "content-type": "application/json", origin: FRONT, ...extra });
      const su = await door("auth/signup", { method: "POST", headers: jsonHdr(), body: JSON.stringify({ email, password: pw, name: "Door" }) });
      assert.ok(su.status === 200 || su.status === 201, "sign-up " + su.status + " " + (await su.clone().text()).slice(0, 120));
      const sc = su.headers.getSetCookie().find((c) => c.startsWith("darkness_session="));
      assert.ok(sc, "the session cookie is set through the proxy");
      for (const flag of [/;\s*HttpOnly/i, /;\s*Secure/i, /;\s*SameSite=Lax/i, /;\s*Path=\//i]) assert.match(sc, flag, sc);
      assert.ok(!/;\s*Domain=/i.test(sc), "host-only: no Domain attribute, so it is first-party to the front door");
      const cookie = sc.split(";")[0];
      assert.ok(su.headers.get("x-request-id"), "request ids survive the proxy");
      assert.ok(![...su.headers.values()].some((v) => v.includes(`127.0.0.1:${APP_PORT}`)), "the backend address is not exposed in any response header");
      // a page reload: the cookie alone identifies the user
      const me = await (await door("auth/me", { headers: { cookie } })).json();
      assert.equal(me.user?.email, email);
      // CSRF: a state-changing call that rides on the cookie must come from the front door's own origin
      const evil = await door("account", { method: "PATCH", headers: jsonHdr({ cookie, origin: "https://evil.example" }), body: JSON.stringify({ name: "Hacked" }) });
      assert.equal(evil.status, 403);
      const good = await door("account", { method: "PATCH", headers: jsonHdr({ cookie }), body: JSON.stringify({ name: "Door User" }) });
      assert.equal(good.status, 200);
      // streaming chat reaches the browser chunk by chunk, authenticated by the cookie alone
      const chatRes = await door("copilot/chat", { method: "POST", headers: jsonHdr({ cookie }), body: JSON.stringify({ message: "Hello there, who are you?" }) });
      assert.equal(chatRes.status, 200);
      assert.match(chatRes.headers.get("content-type") || "", /event-stream/);
      const reader = chatRes.body.getReader();
      let chunks = 0, text = "";
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks++; text += new TextDecoder().decode(value); }
      assert.ok(chunks >= 2 && /event: token/.test(text), `streamed in ${chunks} chunks`);
      // logout clears the cookie, and the old cookie no longer works
      const out = await door("auth/logout", { method: "POST", headers: jsonHdr({ cookie }), body: "{}" });
      assert.equal(out.status, 200);
      const cleared = out.headers.getSetCookie().find((c) => c.startsWith("darkness_session="));
      assert.ok(cleared && /(Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(cleared), "logout expires the cookie: " + cleared);
      assert.equal((await (await door("auth/me", { headers: { cookie } })).json()).user, null, "the old cookie is dead");
      assert.equal((await door("conversations", { headers: { cookie } })).status, 401);
    });
    await check("sessions expire and can be revoked on the server, even while the process stays up (an in-memory cache must not outlive the database row)", async () => {
      const email = `exp-${crypto.randomUUID().slice(0, 6)}@example.com`;
      const hdr = { "content-type": "application/json", origin: FRONT };
      const su = await door("auth/signup", { method: "POST", headers: hdr, body: JSON.stringify({ email, password: pw, name: "Expiry" }) });
      const cookie = su.headers.getSetCookie().find((c) => c.startsWith("darkness_session=")).split(";")[0];
      const token = cookie.split("=")[1];
      assert.equal((await (await door("auth/me", { headers: { cookie } })).json()).user?.email, email, "valid while the row is live");
      const { DatabaseSync } = await import("node:sqlite");
      const sdb = new DatabaseSync(path.join(dataDir, "smoke.db"));
      sdb.exec("PRAGMA busy_timeout = 5000");
      // 1) the 30 days run out
      sdb.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?").run(Date.now() - 1000, token);
      assert.equal((await (await door("auth/me", { headers: { cookie } })).json()).user, null, "an expired session is not accepted");
      assert.equal((await door("conversations", { headers: { cookie } })).status, 401);
      // 2) an operator (or another instance) revokes it by deleting the row
      const su2 = await door("auth/signup", { method: "POST", headers: hdr, body: JSON.stringify({ email: `rev-${crypto.randomUUID().slice(0, 6)}@example.com`, password: pw, name: "Revoked" }) });
      const cookie2 = su2.headers.getSetCookie().find((c) => c.startsWith("darkness_session=")).split(";")[0];
      assert.equal((await door("conversations", { headers: { cookie: cookie2 } })).status, 200);
      sdb.prepare("DELETE FROM sessions WHERE token = ?").run(cookie2.split("=")[1]);
      sdb.close();
      assert.equal((await door("conversations", { headers: { cookie: cookie2 } })).status, 401, "a revoked session stops working immediately");
    });
    await check("front door: only /api/* and /classic-api/* are forwarded; everything the browser sends first-party is passed on, nothing it should not", async () => {
      assert.equal((await door("../secret", {})).status, 400);
      const noBackend = process.env.BACKEND_URL; process.env.BACKEND_URL = "http://insecure.example";
      assert.equal((await door("health", {})).status, 500, "a non-https BACKEND_URL is refused rather than used");
      process.env.BACKEND_URL = noBackend;
      assert.equal((await door("health", {})).status, 200);
    });
  } finally {
    globalThis.fetch = nativeFetch;
  }

  console.log("\nmemory");
  await check("memory: notes are the user's own (ownership, duplicates, secrets, the switch), included in the privacy export, and erased with the account", async () => {
    for (const p of ["/api/memory", "/api/memory/settings", "/api/memory/export"]) assert.equal((await get(p)).status, 401, p + " needs a session");
    const mk = await postJson("/api/memory", { content: "SMOKE-MEM I prefer concise answers with examples", category: "preference" }, tokA);
    assert.equal(mk.status, 201);
    const mem = await j(mk);
    const dup = await postJson("/api/memory", { content: "smoke-mem i prefer concise answers with examples!" }, tokA);
    assert.equal(dup.status, 409);
    assert.equal((await j(dup)).code, "DUPLICATE");
    assert.equal((await postJson("/api/memory", { content: "key sk-live-ABCDEFGHIJKLMNOPQRSTUVWX" }, tokA)).status, 400, "secrets are refused");
    assert.equal((await get("/api/memory", tokB).then(j)).memories.length, 0, "Bob sees none of Alice's notes");
    assert.equal((await patchJson("/api/memory/" + mem.id, { content: "hijack attempt text" }, tokB)).status, 404, "Bob cannot edit it");
    assert.equal((await fetch(base + "/api/memory/" + mem.id, { method: "DELETE", headers: { authorization: "Bearer " + tokB } })).status, 404, "Bob cannot delete it");
    assert.equal((await fetch(base + "/api/memory?confirm=all", { method: "DELETE", headers: { authorization: "Bearer " + tokA } })).status, 200);
    assert.equal((await get("/api/memory", tokA).then(j)).memories.length, 0, "delete-all works for the owner");
    const again = await j(await postJson("/api/memory", { content: "SMOKE-MEM I prefer concise answers with examples", category: "preference" }, tokA));
    assert.ok(again.id);
    const pv = await j(await postJson("/api/memory/preview", { query: "give me concise answers with examples" }, tokA));
    assert.equal(pv.memories.length, 1, "relevant note is previewed");
    const setEnabled = (enabled) => fetch(base + "/api/memory/settings", { method: "PUT", headers: { "content-type": "application/json", authorization: "Bearer " + tokA }, body: JSON.stringify({ enabled }) });
    assert.equal((await j(await setEnabled(false))).enabled, false);
    assert.equal((await j(await postJson("/api/memory/preview", { query: "give me concise answers with examples" }, tokA))).memories.length, 0, "switched off: nothing would be sent");
    await setEnabled(true);
    const exp = JSON.stringify(await j(await get("/api/privacy/export", tokA)));
    assert.ok(exp.includes("SMOKE-MEM"), "the privacy export includes the memory");
    assert.ok(!JSON.stringify(await j(await get("/api/privacy/export", tokB))).includes("SMOKE-MEM"), "and Bob's export does not");
  });

  console.log("\nagent sessions");
  await check("agent sessions: a write tool never runs unapproved (whatever the request says), approval is per call and per owner, runs are saved with an audit trail, and delete removes them", async () => {
    for (const p of ["/api/agent/sessions", "/api/agent/sessions/x"]) assert.equal((await get(p)).status, 401, p + " needs a session");
    await postJson("/api/models/set-active", { model_id: "stub-agent" }, chatTok);
    const sse = async (r) => (await r.text()).split("\n\n").map((blk) => { const ev = /^event: (.+)$/m.exec(blk), da = /^data: (.+)$/m.exec(blk); return ev && da ? { event: ev[1], data: JSON.parse(da[1]) } : null; }).filter(Boolean);
    const notes = async () => (await j(await get("/api/memory", chatTok))).memories.filter((m) => /SMOKE-AGENT/.test(m.content));
    const ev1 = await sse(await postJson("/api/agent/sessions", { goal: "Remember that I prefer examples in Python", plan: true, approvals: "off" }, chatTok));
    const sid = ev1[0].data.id;
    assert.ok(ev1.some((e) => e.event === "plan"), "a plan was made: " + ev1.map((e) => e.event));
    assert.equal(ev1[ev1.length - 1].event, "waiting_approval", "the run stops and asks, even though the request said approvals: off: " + ev1.map((e) => e.event));
    assert.equal((await notes()).length, 0, "nothing saved while waiting");
    assert.equal((await postJson("/api/agent/sessions/" + sid + "/approve", { decision: "approve" }, tokB)).status, 404, "Bob cannot approve Alice's action");
    assert.equal((await postJson("/api/agent/sessions/" + sid + "/approve", { decision: "maybe" }, chatTok)).status, 400);
    assert.equal((await postJson("/api/agent/sessions/" + sid + "/resume", {}, chatTok)).status, 409, "resume cannot skip the approval");
    assert.equal((await notes()).length, 0);
    const ev2 = await sse(await postJson("/api/agent/sessions/" + sid + "/approve", { decision: "approve" }, chatTok));
    assert.equal(ev2[ev2.length - 1].event, "done");
    const saved = await notes();
    assert.equal(saved.length, 1, "saved exactly once, after approval");
    assert.equal(saved[0].source, "agent");
    const d = await j(await get("/api/agent/sessions/" + sid, chatTok));
    assert.equal(d.session.status, "done");
    for (const t of ["created", "plan", "approval_required", "decision", "approval_result", "tool_result", "final"]) assert.ok(d.events.some((e) => e.type === t), "trail has " + t);
    assert.equal((await postJson("/api/agent/sessions/" + sid + "/approve", { decision: "approve" }, chatTok)).status, 409, "an approval cannot be replayed");
    assert.equal((await j(await get("/api/agent/sessions", tokB))).sessions.length, 0, "Bob's history is empty");
    assert.equal((await get("/api/agent/sessions/" + sid, tokB)).status, 404);
    assert.ok(JSON.stringify(await j(await get("/api/privacy/export", chatTok))).includes("examples in Python"), "the privacy export includes the run");
    assert.equal((await fetch(base + "/api/agent/sessions/" + sid, { method: "DELETE", headers: { authorization: "Bearer " + chatTok } })).status, 200);
    assert.equal((await get("/api/agent/sessions/" + sid, chatTok)).status, 404);
    // the stateless run cannot reach the write tool at all
    const before = (await notes()).length;
    await postJson("/api/agent/run?stream=0", { goal: "Remember that I prefer examples in Python", tools: ["remember"] }, chatTok);
    assert.equal((await notes()).length, before, "the stateless /api/agent/run never saves a note");
  });

  console.log("\ncross-user access by id");
  await check("no user can read, list, delete or write into another user's files and projects by choosing an id (shared files list / content / raw / delete, the advisor and apply-fix on unknown or foreign project ids)", async () => {
    const tag = crypto.randomUUID().slice(0, 6), MARK = "BOB-FILE-" + tag, PMARK = "BOB-PROJECT-" + tag;
    // Bob (tokB) owns a shared file and a project; the chat user is the attacker
    const sf = await j(await postJson("/api/files/shared", { filename: "bob-private-" + tag + ".txt", content: MARK }, tokB));
    assert.ok(sf.id, "Bob's file was created");
    const bobProj = await j(await postJson("/api/projects", { name: "Bob private project " + tag }, tokB));
    await postJson(`/api/projects/${bobProj.id}/files`, { path: "private.js", content: `const ${PMARK} = 1;` }, tokB);
    for (const p of ["/api/files/shared", "/api/files"]) {
      const t = await (await get(p, chatTok)).text();
      assert.ok(!t.includes(MARK) && !t.includes("bob-private-" + tag), p + " lists another user's file");
      assert.ok((await (await get(p, tokB)).text()).includes(MARK), p + " still lists it for its owner");
    }
    assert.equal((await get(`/api/files/${sf.id}/content`, chatTok)).status, 404, "content of someone else's file");
    assert.equal((await get(`/api/files/${sf.id}/raw`, chatTok)).status, 404, "raw download of someone else's file");
    const del = await fetch(base + `/api/files/${sf.id}`, { method: "DELETE", headers: { authorization: "Bearer " + chatTok } });
    assert.equal(del.status, 404, "deleting someone else's file");
    assert.ok((await (await get(`/api/files/${sf.id}/content`, tokB)).text()).includes(MARK), "the owner still has the file after the attempts");
    // an unknown project id must not fall back to "the first project on the server"
    assert.equal((await j(await get("/api/projects/does-not-exist-" + tag + "/advisor", chatTok))).advisor, null, "advisor of an unknown id");
    assert.equal((await postJson("/api/projects/does-not-exist-" + tag + "/advisor/apply-fix", { file: "pwned.txt", after: "X" }, chatTok)).status, 404, "apply-fix on an unknown id");
    assert.equal((await postJson("/api/projects/does-not-exist-" + tag + "/advisor/apply-all-fixes", { fixes: [{ file: "pwned.txt", after: "X" }] }, chatTok)).status, 404, "apply-all on an unknown id");
    assert.equal((await postJson(`/api/projects/${bobProj.id}/advisor/apply-fix`, { file: "private.js", after: "PWNED" }, chatTok)).status, 404, "apply-fix on Bob's project");
    const stillBob = await (await get(`/api/projects/${bobProj.id}/file?path=private.js`, tokB)).text();
    assert.ok(stillBob.includes(PMARK) && !stillBob.includes("PWNED"), "Bob's project file is untouched");
  });

  await check("the knowledge base is per user: 'delete all' by one user erases only their own documents (it used to wipe every user's), nobody deletes in a space that is not theirs, and the knowledge Q&A cannot write into someone else's conversation", async () => {
    const tag = crypto.randomUUID().slice(0, 6);
    const idOf = async (tok) => { const a = await j(await get("/api/account", tok)); return a.id || (a.user && a.user.id) || (a.account && a.account.id); };
    const upload = async (tok, name, text) => { const fd = new FormData(); fd.append("files", new Blob([text], { type: "text/plain" }), name); return fetch(base + "/api/knowledge/rag/upload", { method: "POST", headers: { authorization: "Bearer " + tok }, body: fd }); };
    const docs = async (tok) => (await j(await get("/api/knowledge/rag", tok))).totalDocuments;
    const bobId = await idOf(tokB);
    assert.ok(bobId, "the account endpoint returns the user's id");
    assert.equal((await upload(tokB, "bob-kb-" + tag + ".txt", ("BOB-KNOWLEDGE-" + tag + " is a private note. ").repeat(20))).status, 200);
    await upload(tokC, "carol-kb-" + tag + ".txt", ("CAROL-KNOWLEDGE-" + tag + " is another note. ").repeat(20));
    const bobBefore = await docs(tokB);
    assert.ok(bobBefore >= 1, "Bob has a knowledge document");
    assert.ok(!JSON.stringify(await j(await get("/api/knowledge/rag", tokC))).includes("bob-kb-" + tag), "Carol does not see Bob's document");
    // naming Bob's knowledge space is refused outright
    const del = await fetch(base + "/api/knowledge/rag/documents", { method: "DELETE", headers: { "content-type": "application/json", authorization: "Bearer " + tokC }, body: JSON.stringify({ projectId: "knowledge_" + bobId, path: "bob-kb-" + tag + ".txt" }) });
    assert.equal(del.status, 403, "deleting in someone else's knowledge space");
    const clearOther = await fetch(base + "/api/knowledge/rag/documents/clear-all", { method: "DELETE", headers: { "content-type": "application/json", authorization: "Bearer " + tokC }, body: JSON.stringify({ projectId: "knowledge_" + bobId }) });
    assert.equal(clearOther.status, 403, "clear-all on someone else's knowledge space");
    // clear-all for her OWN space only affects hers
    const clearOwn = await fetch(base + "/api/knowledge/rag/documents/clear-all", { method: "DELETE", headers: { "content-type": "application/json", authorization: "Bearer " + tokC }, body: "{}" });
    assert.equal(clearOwn.status, 200);
    assert.equal(await docs(tokC), 0, "Carol's own documents are gone");
    assert.equal(await docs(tokB), bobBefore, "Bob's documents are untouched by Carol's 'delete all'");
    // the knowledge Q&A writes the question into the conversation it is given: it must be the caller's own
    const mine = await j(await postJson("/api/conversations", { title: "Bob's thread " + tag }, tokB));
    await postJson(`/api/conversations/${mine.id}/messages`, { role: "user", content: "BOB-ORIGINAL-" + tag }, tokB);
    const ask = await postJson("/api/knowledge/rag/ask", { query: "CAROL-INJECTED-" + tag, conversation_id: mine.id }, tokC);
    await ask.text();
    const thread = JSON.stringify(await j(await get(`/api/conversations/${mine.id}/messages`, tokB)));
    assert.ok(thread.includes("BOB-ORIGINAL-" + tag) && !thread.includes("CAROL-INJECTED-" + tag), "nothing was written into Bob's conversation");
  });

  console.log("\nprompt studio");
  await check("prompt studio: a private library with versions, variables filled before any model call, guarded test runs, and nothing crossing between users", async () => {
    for (const p of ["/api/prompts", "/api/prompts/templates", "/api/prompts/export"]) assert.equal((await get(p)).status, 401, p + " needs a session");
    assert.ok((await j(await get("/api/prompts/templates", tokB))).templates.length >= 10);
    const mk = await postJson("/api/prompts", { title: "SMOKE-PS Explainer", body: "Explain {{topic}} to {{audience|a beginner}}", category: "learning", tags: ["smoke"] }, chatTok);
    assert.equal(mk.status, 201);
    const p = await j(mk);
    assert.equal(p.version, 1);
    assert.equal((await postJson("/api/prompts", { title: "bad", body: "key sk-live-ABCDEFGHIJKLMNOPQRSTUVWX" }, chatTok)).status, 400, "credentials are refused");
    const edit = await j(await patchJson("/api/prompts/" + p.id, { body: "Explain {{topic}} to {{audience|a beginner}} with an example", note: "example" }, chatTok));
    assert.equal(edit.version, 2);
    assert.equal((await j(await get("/api/prompts/" + p.id + "/versions", chatTok))).versions.length, 2);
    assert.equal((await j(await postJson("/api/prompts/" + p.id + "/versions/1/restore", {}, chatTok))).version, 3, "restore adds a version");
    assert.equal((await get("/api/prompts/" + p.id, tokB)).status, 404, "Bob cannot read it");
    assert.equal((await patchJson("/api/prompts/" + p.id, { title: "hijack" }, tokB)).status, 404);
    assert.equal((await postJson("/api/prompts/render", { promptId: p.id, values: {} }, chatTok)).status, 400, "a missing variable is refused");
    assert.equal((await j(await postJson("/api/prompts/render", { promptId: p.id, values: { topic: "DNS" } }, chatTok))).rendered, "Explain DNS to a beginner");
    // a test run goes through the real provider layer with the user's own models; one fails, one answers, no key leaks
    const run = await postJson("/api/prompts/run", { promptId: p.id, values: { topic: "DNS" }, modelIds: ["stub-ok", "stub-denied"] }, chatTok);
    assert.equal(run.status, 200);
    const text = await run.text(), out = JSON.parse(text);
    assert.deepEqual(out.results.map((x) => [x.modelId, x.finish]), [["stub-ok", "done"], ["stub-denied", "error"]]);
    assert.ok(!text.includes(KEY), "the model's key is not in the response");
    assert.equal((await postJson("/api/prompts/run", { body: "hi", modelIds: ["stub-ok"] }, tokB)).status, 404, "Bob cannot use Alice's model");
    assert.equal((await postJson("/api/prompts/compare", { variants: [{ body: "one" }], modelId: "stub-ok" }, chatTok)).status, 400);
    const cmp = await j(await postJson("/api/prompts/compare", { variants: [{ label: "A", body: "Say {{x}}" }, { label: "B", body: "Shout {{x}}" }], values: { x: "hi" }, modelId: "stub-ok" }, chatTok));
    assert.deepEqual(cmp.results.map((x) => x.variant), ["A", "B"]);
    const ex = await j(await get("/api/prompts/export", chatTok));
    assert.equal(ex.format, "darkness-prompts");
    assert.equal((await j(await postJson("/api/prompts/import", ex, tokB))).added, 1, "an export imports into another account");
    assert.ok(JSON.stringify(await j(await get("/api/privacy/export", chatTok))).includes("SMOKE-PS"), "the privacy export includes prompts");
    assert.equal((await fetch(base + "/api/prompts/" + p.id, { method: "DELETE", headers: { authorization: "Bearer " + chatTok } })).status, 200);
    assert.equal((await get("/api/prompts/" + p.id, chatTok)).status, 404);
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
    const { DatabaseSync } = await import("node:sqlite");
    const sdb = new DatabaseSync(path.join(dataDir, "smoke.db"), { readOnly: true });
    assert.equal(sdb.prepare("SELECT COUNT(*) AS n FROM memories WHERE content LIKE 'SMOKE-MEM%'").get().n, 0, "the erased user's memories are gone from the database");
    assert.ok(out.removed.memories >= 1, "erase reports the memories it removed: " + JSON.stringify(out.removed));
    sdb.close();
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
