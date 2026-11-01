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

// --- mock model: replies with a tool call, then a final answer ------------------------------------
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const msgs = JSON.parse(body).messages;
    const sawObservation = msgs.some((m) => m.role === "user" && m.content.includes("<observation"));
    const content = sawObservation
      ? '{"thought":"I have the number","final":"The result is **9** (via calculator)."}'
      : '{"thought":"Use the calculator","tool":"calculator","args":{"expression":"(7+2)*1"}}';
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
  let tokA, tokB;

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
    tokB = (await j(b)).token;
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
    assert.equal(t.active, "openai");
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
