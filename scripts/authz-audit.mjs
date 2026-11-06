#!/usr/bin/env node
/**
 * Authorization audit of EVERY state-changing route (POST / PUT / PATCH / DELETE), against the production build.
 *
 *   npm run build && node scripts/authz-audit.mjs [--out report.json] [--markdown report.md]
 *
 * How it works (a behavioural oracle, so it needs no per-route knowledge):
 *   1. The route list comes from the running server itself (scripts/route-dump-hook.mjs records every registration, including sub-routers and
 *      the original-app API), so nothing is missed because of how a route was written.
 *   2. Three accounts: A (owner), B (attacker), C (bystander). A and C own real data in every family (conversations, projects and their files,
 *      shared files, memory, prompts, models, Copilot, knowledge base, artifacts, assets, agent sessions, original-app records). Some of A's
 *      records are written straight into the database, so the running server never loaded them into memory.
 *   3. For each route, B sends a plausible state-changing request (a) with A's real ids, (b) with A's database-only ids, (c) with unknown ids.
 *      Routes without ids (for example "delete all my memories") are sent as B as well: that is where unscoped statements hide.
 *   4. After EVERY request the database rows that belong to anyone except B are compared with the snapshot taken before it. B's response
 *      must also contain none of A's markers, and must not be a 5xx. A request without credentials must be refused.
 *   5. At the end B erases his own account; A's and C's data must still be exactly as seeded.
 *
 * Exit code 0 = no violation. Nothing leaves this machine: the model provider is a local stand-in.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const PORT = Number(process.env.AUTHZ_PORT || 3866), STUB_PORT = PORT + 1, base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid0 = "00000000-0000-4000-8000-000000000000";
const PUBLIC = [/^\/api\/csp-report$/, /^\/api\/auth\/(login|signup|forgot|reset)$/, /^\/api\/auth\/logout$/, /^\/classic-api\/api\/(health|share\/)/];
const SELF_ONLY = [/^\/api\/auth\//, /^\/api\/account\/password$/, /^\/api\/account\/sessions\/revoke-others$/, /^\/api\/privacy\/erase$/]; // end B's own session/account: handled last
const isPublic = (p) => PUBLIC.some((re) => re.test(p));
const results = [], violations = [];
const violate = (route, what, extra) => { violations.push({ route, what, extra }); console.log("VIOLATION", route, "-", what, extra ? "-> " + String(extra).slice(0, 160) : ""); };

// ---- the stand-in model provider (nothing real is ever called) --------------------------------------------------------------------------------
const stubSeen = []; // Authorization header of every request the stand-in provider received
const stubKey = (u) => "stub-key-" + u.ids.marker;
const stub = http.createServer((req, res) => {
  stubSeen.push(String(req.headers.authorization || ""));
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => {
    let p = {}; try { p = JSON.parse(body); } catch { /* not json */ }
    if (p.stream === false || p.stream === undefined) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "stub answer" } }] })); }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "stub answer" } }] })}\n\n`); res.write("data: [DONE]\n\n"); res.end();
  });
});

// ---- helpers ------------------------------------------------------------------------------------------------------------------------------------
const J = { "content-type": "application/json" };
async function call(method, p, { token, body, form, timeout = 12000 } = {}) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeout);
  const headers = { ...(form ? {} : J), ...(token ? { authorization: "Bearer " + token } : {}) };
  try {
    const r = await fetch(base + p, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : form || (body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)), signal: ac.signal });
    const text = await r.text().catch(() => "");
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, text, json };
  } catch (e) { return { status: 0, text: String(e && e.message), json: null, aborted: true }; } finally { clearTimeout(t); }
}
const mkForm = (fields = {}, field = "files") => { const f = new FormData(); f.append(field, new Blob(["B-UPLOADED-CONTENT hello world. ".repeat(10)], { type: "text/plain" }), "b-upload.txt"); for (const [k, v] of Object.entries(fields)) f.append(k, String(v)); return f; };

let child = null, dataDir = null, dbFile = null;
async function start(env = {}) {
  child = spawn(process.execPath, ["dist/server.js"], { cwd: root, stdio: "ignore", env: { ...process.env, NODE_ENV: "production", PORT: String(PORT), DARKNESS_STORAGE_ROOT: dataDir, DARKNESS_DB_PATH: dbFile, RATE_LIMIT_AUTH_PER_15MIN: "100000", RATE_LIMIT_API_PER_MIN: "100000", RATE_LIMIT_AI_PER_MIN: "100000", ENABLE_RUN_ENGINE: "false", ...env } });
  for (let i = 0; i < 240; i++) { try { if ((await fetch(base + "/api/health")).ok) return; } catch { /* starting */ } await sleep(250); }
  throw new Error("server did not start");
}
const stop = async () => { if (child) { child.kill(); await sleep(500); child = null; } };

// ---- the route list (from the server itself) ------------------------------------------------------------------------------------------------
async function routeList() {
  if (arg("--routes")) return JSON.parse(fs.readFileSync(arg("--routes"), "utf8"));
  const dump = path.join(dataDir, "routes.json");
  const c = spawn(process.execPath, ["--import", "./scripts/route-dump-hook.mjs", "dist/server.js"], { cwd: root, stdio: "ignore", env: { ...process.env, NODE_ENV: "production", PORT: String(PORT + 5), DARKNESS_STORAGE_ROOT: path.join(dataDir, "dump"), ROUTE_DUMP: dump } });
  for (let i = 0; i < 240 && !fs.existsSync(dump); i++) await sleep(250);
  await sleep(300); c.kill(); await sleep(400);
  return JSON.parse(fs.readFileSync(dump, "utf8"));
}

// ---- database snapshot: only the rows that belong to the given users (the victims) -------------------------------------------------------------
function snapshot(owners) {
  const ph = owners.map(() => "?").join(",");
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const out = {};
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
    const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c);
    for (const t of tables) {
      let sql;
      if (t === "users") sql = `SELECT * FROM users WHERE id IN (${ph})`;
      else if (has(t, "user_id")) sql = `SELECT * FROM ${t} WHERE user_id IN (${ph})`;
      else if (t === "messages") sql = `SELECT m.* FROM messages m LEFT JOIN conversations c ON c.id = m.conversation_id WHERE c.user_id IN (${ph})`;
      else if (t === "copilot_messages") sql = `SELECT m.* FROM copilot_messages m LEFT JOIN copilot_conversations c ON c.id = m.conversation_id WHERE c.user_id IN (${ph})`;
      else if (has(t, "project_id")) sql = `SELECT x.* FROM ${t} x LEFT JOIN projects p ON p.id = x.project_id WHERE p.user_id IN (${ph})`;
      else continue; // shared tables with no owner are not anybody's private data
      const rows = db.prepare(sql).all(...owners).map((r) => JSON.stringify(r)).sort();
      out[t] = { n: rows.length, h: crypto.createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 16) };
    }
    return out;
  } finally { db.close(); }
}
const diff = (a, b) => Object.keys(b).filter((t) => !a[t] || a[t].h !== b[t].h).map((t) => `${t}(${a[t] ? a[t].n : 0}->${b[t].n})`);

// ---- seeding: an owner with data in every family --------------------------------------------------------------------------------------------
async function signup(name) {
  const email = `${name}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const r = await call("POST", "/api/auth/signup", { body: { email, password: "correct horse battery", name } });
  if (!r.json || !r.json.token) throw new Error("signup failed for " + name + ": " + r.text.slice(0, 120));
  return { name, email, token: r.json.token, id: r.json.user.id };
}
async function seed(u) {
  const T = u.name.toUpperCase() + "-SECRET-" + crypto.randomUUID().slice(0, 6); // marker that appears in every record of this user
  const ids = { marker: T }, missing = [];
  const tok = u.token, ok = (what, v) => { if (v) ids[what] = v; else missing.push(what); return v; };
  const g = (r, ...keys) => { for (const k of keys) { const v = k.split(".").reduce((o, p) => (o ? o[p] : undefined), r.json); if (v) return v; } return null; };
  // a stand-in model for this user
  const m = await call("POST", "/api/models", { token: tok, body: { id: u.name + "-model", name: T + " model", provider: "custom", modelName: "stub", baseUrl: `http://127.0.0.1:${STUB_PORT}/v1`, apiKey: "stub-key-" + T, capabilities: { text: true, streaming: true } } });
  ok("model", m.status < 300 ? u.name + "-model" : null);
  const c = await call("POST", "/api/conversations", { token: tok, body: { title: T + " conversation" } });
  ok("conv", g(c, "id", "conversation.id"));
  if (ids.conv) {
    await call("POST", `/api/conversations/${ids.conv}/messages`, { token: tok, body: { role: "user", content: T + " message one" } });
    const ms = await call("GET", `/api/conversations/${ids.conv}/messages`, { token: tok });
    const list = (ms.json && (ms.json.messages || ms.json)) || [];
    ok("msg", Array.isArray(list) && list[0] && list[0].id);
  }
  const p = await call("POST", "/api/projects", { token: tok, body: { name: T + " project", description: T, files: [{ path: "src/secret.js", content: `const ${T.replace(/-/g, "_")} = 1;` }] } });
  ok("project", g(p, "id", "project.id"));
  if (ids.project) {
    await call("POST", `/api/projects/${ids.project}/files`, { token: tok, body: { path: "notes.md", content: T + " notes" } });
    await call("POST", `/api/projects/${ids.project}/versions`, { token: tok, body: { message: T } });
    const rag = await call("POST", `/api/projects/${ids.project}/rag/upload`, { token: tok, form: mkForm({}, "files") });
    const rs = await call("GET", `/api/projects/${ids.project}/rag`, { token: tok });
    const docs = (rs.json && (rs.json.documents || [])) || [];
    ok("ragdoc", docs[0] && (docs[0].id || docs[0].name));
    void rag;
  }
  const f = await call("POST", "/api/files/shared", { token: tok, body: { filename: T + ".txt", content: T + " file content" } });
  ok("file", g(f, "id", "file.id"));
  const mem = await call("POST", "/api/memory", { token: tok, body: { content: T + " likes concise answers", category: "preference" } });
  ok("memory", g(mem, "id", "memory.id"));
  const pr = await call("POST", "/api/prompts", { token: tok, body: { title: T + " prompt", body: T + " write about {{topic}}" } });
  ok("prompt", g(pr, "id", "prompt.id"));
  if (ids.prompt) await call("PATCH", `/api/prompts/${ids.prompt}`, { token: tok, body: { body: T + " v2 {{topic}}" } });
  const cp = await call("POST", "/api/copilot/conversations", { token: tok, body: { title: T + " copilot" } });
  ok("copilot", g(cp, "id", "conversation.id"));
  const kb = await fetch(base + "/api/knowledge/rag/upload", { method: "POST", headers: { authorization: "Bearer " + tok }, body: mkForm({}, "files") }).then((r) => r.status).catch(() => 0);
  ok("knowledge", kb === 200 ? "yes" : null);
  const cc = await call("POST", "/classic-api/api/conversations", { token: tok, body: { conversation: { id: "classic-" + T, title: T, messages: [{ role: "user", content: T }] } } });
  ok("classicConv", cc.status < 300 ? "classic-" + T : null);
  const sh = await call("POST", "/classic-api/api/share", { token: tok, body: { conversation: { id: "classic-" + T, title: T, messages: [] } } });
  ok("share", g(sh, "id", "shareId", "share_id"));
  const wh = await call("POST", "/classic-api/api/webhooks", { token: tok, body: { url: "https://example.com/hook-" + T, events: ["x"] } });
  ok("webhook", g(wh, "id", "webhook.id"));
  // records written straight into the database: the running server never loaded them into memory
  const d = new DatabaseSync(dbFile); d.exec("PRAGMA busy_timeout = 5000");
  try {
    const now = Date.now();
    d.prepare("INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?)").run("dbonly-conv-" + T, u.id, T + " db-only conversation", now, now);
    d.prepare("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?,?,?,?,?)").run("dbonly-msg-" + T, "dbonly-conv-" + T, "user", T + " db-only message", now);
    d.prepare("INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (?,?,?,?,?)").run("dbonly-proj-" + T, u.id, T + " db-only project", now, now);
    d.prepare("INSERT INTO project_files (id, project_id, path, name, content, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run("dbonly-pf-" + T, "dbonly-proj-" + T, "db.txt", "db.txt", T + " db-only file", now, now);
    d.prepare("INSERT INTO workspace_files (id, user_id, filename, content, uploaded_at) VALUES (?,?,?,?,?)").run("dbonly-file-" + T, u.id, T + "-db.txt", T + " db-only shared file", now);
    if (ids.project) {
      d.prepare("INSERT INTO artifacts (id, project_id, name, content, created_at, updated_at) VALUES (?,?,?,?,?,?)").run("art-" + T, ids.project, T + ".txt", T + " artifact", now, now);
      d.prepare("INSERT INTO visual_assets (id, project_id, asset_type, mime_type, filename, content_base64, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run("asset-" + T, ids.project, "image", "image/png", T + ".png", "AAAA", now, now);
      ids.artifact = "art-" + T; ids.asset = "asset-" + T;
    }
    d.prepare("INSERT INTO agent_sessions (id, user_id, status, goal, options, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run("agent-" + T, u.id, "paused", T + " goal", "{}", now, now);
    ids.agent = "agent-" + T;
    ids.dbConv = "dbonly-conv-" + T; ids.dbProject = "dbonly-proj-" + T; ids.dbFile = "dbonly-file-" + T;
  } finally { d.close(); }
  return { ids, missing };
}

// ---- turning a route template into a request for a given set of ids ---------------------------------------------------------------------------
function fill(route, A, kind0) {
  const kind = kind0 === "bare" ? "unknown" : kind0; // "bare" = no ids anywhere: the caller's own default scope (where an unscoped statement hides)
  const ids = A.ids;
  const pick = (real, db) => (kind === "unknown" ? uuid0 : kind === "dbonly" ? db || real || uuid0 : real || uuid0);
  return route.path.replace(/:([A-Za-z_]+)\??/g, (_, name) => {
    const p = route.path;
    if (name === "pid") return pick(ids.project, ids.dbProject);
    if (name === "cid") return pick(ids.conv, ids.dbConv);
    if (name === "msg_id") return pick(ids.msg);
    if (name === "docId") return pick(ids.ragdoc);
    if (name === "n") return "1";
    if (name === "tid" || name === "run_id" || name === "port") return kind === "unknown" ? uuid0 : "1";
    if (name === "id") {
      if (p.startsWith("/api/agent/sessions")) return pick(ids.agent);
      if (p.startsWith("/api/artifacts")) return pick(ids.artifact);
      if (p.startsWith("/api/builder/jobs")) return pick(ids.job);
      if (p.startsWith("/api/copilot/conversations")) return pick(ids.copilot);
      if (p.startsWith("/api/files")) return pick(ids.file, ids.dbFile);
      if (p.startsWith("/api/memory")) return pick(ids.memory);
      if (p.startsWith("/api/models")) return pick(ids.model);
      if (p.startsWith("/api/prompts")) return pick(ids.prompt);
      if (p.includes("/assets/")) return pick(ids.asset);
      if (p.startsWith("/classic-api/api/conversations")) return pick(ids.classicConv);
      if (p.startsWith("/classic-api/api/share")) return pick(ids.share);
      if (p.startsWith("/classic-api/api/webhooks")) return pick(ids.webhook);
      return uuid0;
    }
    return uuid0;
  }).replace(/\*[A-Za-z]*/g, "x");
}
function bodyFor(route, A, kind) {
  if (kind === "bare") return {}; // an empty body: no id for the server to take, only what it defaults to for the caller
  const ids = A.ids;
  const proj = kind === "unknown" ? uuid0 : kind === "dbonly" ? ids.dbProject : ids.project;
  const conv = kind === "unknown" ? uuid0 : kind === "dbonly" ? ids.dbConv : ids.conv;
  const generic = {
    content: "B-WROTE-THIS", title: "B-WROTE-THIS", name: "B-WROTE-THIS", description: "B-WROTE-THIS", text: "B-WROTE-THIS", message: "B-WROTE-THIS summarise the attached file", query: "B-WROTE-THIS", prompt: "B-WROTE-THIS {{x}}", goal: "B-WROTE-THIS", body: "B-WROTE-THIS",
    path: "src/secret.js", file: "src/secret.js", filename: "b-wrote.txt", from: "src/secret.js", to: "b-renamed.js", before: "x", after: "B-WROTE-THIS", role: "user", category: "preference", enabled: false,
    projectId: proj, project_id: proj, conversationId: conv, conversation_id: conv, cid: conv, pid: proj, id: ids.file || uuid0, file_ids: [ids.file || uuid0], fileIds: [ids.file || uuid0], modelIds: [A.ids.model || "x", "y"], model_id: "y", fixes: [{ file: "src/secret.js", after: "B-WROTE-THIS" }], pinned: true, tags: ["b"], folder: "b", confirm: "ALL", settings: { enabled: false },
  };
  return generic;
}
const multipartRoute = (p) => /upload|import-docx|documents\/(convert|extract)/.test(p);

// ---- the audit ----------------------------------------------------------------------------------------------------------------------------------
async function main() {
  if (!fs.existsSync(path.join(root, "dist", "server.js"))) { console.error("dist/server.js is missing: run `npm run build` first"); process.exit(2); }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "darkness-authz-")); dbFile = path.join(dataDir, "audit.db");
  await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));
  const rawRoutes = await routeList();
  const routes = rawRoutes.filter((r) => ["POST", "PUT", "PATCH", "DELETE"].includes(r.method)).filter((r) => r.path.startsWith("/api/") || r.path.startsWith("/classic-api/"));
  const seen = new Set(); const list = [];
  for (const r of routes) { const k = r.method + " " + r.path; if (!seen.has(k)) { seen.add(k); list.push(r); } }
  console.log(`state-changing routes to audit: ${list.length} (registrations seen: ${rawRoutes.length}; USE/ALL handlers are reviewed by hand in docs/AUTHORIZATION-AUDIT.md)`);
  await start();
  try {
    const A = await signup("alice"), B = await signup("bob"), C = await signup("carol");
    for (const u of [A, B, C]) { const s = await seed(u); u.ids = s.ids; u.missing = s.missing; }
    console.log("seeded A:", Object.keys(A.ids).filter((k) => k !== "marker").join(","), "| NOT seeded:", A.missing.join(",") || "(none)");
    const victims = [A.id, C.id];
    const markers = [A.ids.marker, C.ids.marker, A.email, C.email, A.id, C.id];
    const keys = [stubKey(A), stubKey(C)];
    // answers that depend on what the operator configured (no model key, no browser engine, run engine off) are reported separately, never hidden
    const configAnswers = [];
    const isConfigAnswer = (res) => res.status >= 500 && /not configured|No image model is available|PDF_ENGINE_UNAVAILABLE|RUN_ENGINE_DISABLED|not available on this server/i.test(res.text);
    const apiState = async (u) => {
      const parts = []; parts.raw = {};
      for (const p of ["/api/conversations", `/api/conversations/${u.ids.conv}/messages`, "/api/projects", `/api/projects/${u.ids.project}/tree`, `/api/projects/${u.ids.project}/file?path=notes.md`, "/api/files/shared", "/api/memory", "/api/prompts", "/api/models", "/api/copilot/conversations", "/api/knowledge/rag", "/classic-api/api/conversations", "/classic-api/api/webhooks"]) {
        const r = await call("GET", p, { token: u.token });
        // volatile fields (request ids and every timestamp-like value) are removed so that only real content differences are reported
        const stable = r.text.replace(/"requestId":"[^"]*"/g, "").replace(/"[A-Za-z_]*([Aa]t|[Tt]ime|[Dd]ate|_ms|Ms|ago)":\s*("[^"]*"|\d+)/g, "").replace(/"(updated|created|last_used|uploaded)_?[a-zA-Z]*":\s*("[^"]*"|\d+)/g, "").replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "");
        parts.raw[p] = stable;
        parts.push(p + ":" + r.status + ":" + crypto.createHash("sha256").update(stable).digest("hex").slice(0, 10));
      }
      return parts;
    };
    // the baseline is taken AFTER the reads above: reading may touch data (for example loading a record into memory), and that is not the attacker's doing
    const apiBefore = { A: await apiState(A), C: await apiState(C) };
    const baseline = snapshot(victims);
    const attack = async (route, kind) => {
      const p = fill(route, A, kind);
      const snap0 = snapshot(victims);
      const opts = { token: B.token };
      if (multipartRoute(route.path)) opts.form = mkForm(kind === "bare" ? {} : { projectId: kind === "unknown" ? uuid0 : A.ids.project, project_id: kind === "unknown" ? uuid0 : A.ids.project, conversation_id: kind === "unknown" ? uuid0 : A.ids.conv });
      else opts.body = bodyFor(route, A, kind);
      const sent0 = stubSeen.length;
      const res = await call(route.method, p, opts);
      await sleep(20);
      const changed = diff(snap0, snapshot(victims));
      const leaked = markers.filter((m) => m && res.text.includes(m));
      const keyUsed = stubSeen.slice(sent0).some((h) => keys.some((k) => h.includes(k)));
      const rec = { kind, status: res.status, changed, leaked: leaked.length, config: false };
      const label = route.method + " " + route.path;
      if (res.status >= 500) { if (isConfigAnswer(res)) { rec.config = true; configAnswers.push(label + " (" + kind + ", HTTP " + res.status + ")"); } else violate(label, `HTTP ${res.status} (${kind} ids)`, res.text); }
      if (leaked.length) violate(label, `response to another user contains the owner's data (${kind} ids)`, leaked.join(","));
      if (changed.length) violate(label, `changed data that belongs to A or C: ${changed.join(", ")} (${kind} ids)`, "");
      if (keyUsed) violate(label, `another user's provider key was sent upstream on the attacker's request (${kind} ids)`, "");
      return rec;
    };

    const deferred = [];
    for (const route of list) {
      const label = route.method + " " + route.path;
      const rec = { route: label, file: route.file || "", public: isPublic(route.path), unauth: null, foreign: null, dbonly: null, unknown: null };
      // 1. no credentials: a refusal (a disabled feature may refuse with 403 before it asks who you are; it reveals nothing)
      const un = await call(route.method, fill(route, A, "real"), { body: multipartRoute(route.path) ? undefined : bodyFor(route, A, "real") });
      rec.unauth = un.status;
      const refused = un.status === 401 || (un.status === 403 && /RUN_ENGINE_DISABLED/.test(un.text));
      if (!rec.public && !refused) violate(label, `reachable without credentials (HTTP ${un.status})`, un.text);
      // 2. as B (the attacker)
      if (SELF_ONLY.some((re) => re.test(route.path))) { rec.note = "ends B's own session or account: run last"; deferred.push(route); results.push(rec); continue; }
      if (rec.public) { rec.note = "public by design (sign-in, sign-up, recovery, CSP reports): rate limited, reviewed by hand in docs/AUTHORIZATION-AUDIT.md"; results.push(rec); continue; }
      rec.foreign = await attack(route, "real");
      if (/:(pid|cid|id)\b/.test(route.path) && (A.ids.dbProject || A.ids.dbConv || A.ids.dbFile)) rec.dbonly = await attack(route, "dbonly");
      rec.unknown = await attack(route, "unknown");
      rec.bare = await attack(route, "bare"); // the caller's default scope, no ids at all (for example "delete all my documents")
      results.push(rec);
    }
    // 3. the routes that end B's own session or account, last (B erases his own account: A's and C's data must survive it)
    for (const route of deferred) {
      const rec = results.find((r) => r.route === route.method + " " + route.path);
      if (/\/auth\/logout|privacy\/erase|revoke-others|account\/password/.test(route.path)) rec.foreign = await attack(route, "real");
    }
    // 4. the final state of A and C: rows first (the API reads below may themselves touch data), then what they can read
    const finalDiff = diff(baseline, snapshot(victims));
    if (finalDiff.length) violate("(after all attacks)", "rows that belong to A or C changed", finalDiff.join(", "));
    const apiAfter = { A: await apiState(A), C: await apiState(C) };
    for (const name of ["A", "C"]) {
      for (const p of Object.keys(apiBefore[name].raw)) {
        const x = apiBefore[name].raw[p], y = apiAfter[name].raw[p];
        if (x === y) continue;
        let i = 0; while (i < x.length && x[i] === y[i]) i++;
        violate("(after all attacks)", `what ${name} can read through the API changed: ${p}`, `before ...${x.slice(Math.max(0, i - 60), i + 120)} | after ...${y.slice(Math.max(0, i - 60), i + 120)}`);
      }
    }
    results.configAnswers = configAnswers;
  } finally { await stop(); stub.close(); }
  const summary = { configDependentAnswers: (results.configAnswers || []).length, routes: list.length, audited: results.filter((r) => !r.public && r.foreign).length, publicByDesign: results.filter((r) => r.public).length, violations: violations.length };
  console.log(`\nroutes: ${summary.routes}, attacked as another user: ${summary.audited}, public by design: ${summary.publicByDesign}, violations: ${summary.violations}`);
  if ((results.configAnswers || []).length) console.log("configuration-dependent answers (not authorization issues; the feature needs a provider key, a browser engine or the run engine):\n  " + [...new Set(results.configAnswers.map((x) => x.replace(/ \((real|dbonly|unknown), /, " (")))].join("\n  "));
  const out = arg("--out"); if (out) fs.writeFileSync(out, JSON.stringify({ summary, violations, configAnswers: results.configAnswers || [], results }, null, 1));
  const md = arg("--markdown");
  if (md) {
    const cell = (x) => (x ? `${x.status}${x.changed.length ? " CHANGED" : ""}${x.leaked ? " LEAK" : ""}` : "-");
    const lines = ["| Route | File | No credentials | Another user, A's ids | A's database-only ids | Unknown ids | No ids at all |", "|---|---|---|---|---|---|---|"];
    for (const r of results) lines.push(`| \`${r.route}\` | ${r.file ? "`" + r.file + "`" : ""} | ${r.unauth} | ${r.note ? r.note : cell(r.foreign)} | ${cell(r.dbonly)} | ${cell(r.unknown)} | ${cell(r.bare)} |`);
    fs.writeFileSync(md, lines.join("\n") + "\n");
  }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(violations.length ? 1 : 0);
}
main().catch(async (e) => { console.error("audit crashed:", e); await stop(); process.exit(2); });
