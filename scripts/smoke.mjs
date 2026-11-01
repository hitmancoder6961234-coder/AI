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
    console.log(`  FAIL ${name}\n       ${String(e.message).split("\n")[0]}`);
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
    const msgs = JSON.parse(body).messages;
    const task = (msgs.find((m) => m.role === "user") || {}).content || "";
    let content;
    if (/produce a BRIEF/i.test(task)) content = JSON.stringify(BRIEF);
    else if (task.includes("Design the OUTLINE")) content = JSON.stringify(OUTLINE);
    else if (task.includes("WRITE THE SECTION")) content = "The `POST /api/orders` endpoint in `src/app.js` creates an order once the guard passes.\n\n| Part | Role |\n|---|---|\n| Express | HTTP |";
    else if (task.includes("Write the final content for every slide")) content = JSON.stringify(DECK);
    else if (task.includes("Turn each idea into an image-generator prompt")) content = JSON.stringify({ images: [] });
    else if (msgs[0].content.includes("professional translator")) content = "TRANSLATED";
    else if (msgs[0].content.includes("DARKNESS")) content = "Hello from the model.";
    else {
      const sawObservation = msgs.some((m) => m.role === "user" && m.content.includes("<observation"));
      content = sawObservation
        ? '{"thought":"I have the number","final":"The result is **9** (via calculator)."}'
        : '{"thought":"Use the calculator","tool":"calculator","args":{"expression":"(7+2)*1"}}';
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
  });
});
await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));

// --- boot the app ---------------------------------------------------------------------------------
const logs = [];
function boot(extraEnv = {}) {
  const child = spawn(process.execPath, ["dist/server.js"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(APP_PORT),
      DARKNESS_STORAGE_ROOT: dataDir,
      AGENT_PROVIDER: "openai",
      AGENT_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
      OPENAI_API_KEY: "test-key-not-real",
      RATE_LIMIT_AUTH_PER_15MIN: "12",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  return child;
}
const stopChild = (child) => new Promise((r) => { child.once("exit", r); child.kill(); });

// Phase 0 — simulate an existing install that ran in the old, open mode: it seeds the public
// demo account and "default_token" into the database. The strict boot below must purge both.
const legacy = boot({ PRIVACY_STRICT: "false" });
let server = legacy;

async function waitUp() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start:\n" + logs.join("").slice(-1500));
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
    assert.ok(r.headers.get("content-security-policy-report-only"));
    assert.ok(r.headers.get("strict-transport-security"));
    assert.equal(r.headers.get("x-powered-by"), null);
    assert.match(r.headers.get("cache-control") || "", /no-store/);
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
  await check("agent runs end-to-end over SSE (mock model → calculator → answer)", async () => {
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
  await check("login attempts are rate limited", async () => {
    let limited = false;
    for (let i = 0; i < 20 && !limited; i++) limited = (await post("/api/auth/login", { email: emailA, password: "wrong-password" })).status === 429;
    assert.ok(limited, "expected a 429 within 20 attempts");
  });

  console.log("\ndocuments (upload + export of every type)");
  const formData = (name, buf, field = "files") => { const fd = new FormData(); fd.append(field, new Blob([buf]), name); return fd; };
  const postJson = (p, body, token) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
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
    assert.ok(html.includes("darkness-api-url") && html.includes("/classic-api"), "backend url injected");
    assert.ok(html.length > 200_000, "the full original app is served");
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
  });
} finally {
  server.kill();
  legacy.kill();
  mock.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("failed:", failures.join(" | "));
  process.exit(1);
}
