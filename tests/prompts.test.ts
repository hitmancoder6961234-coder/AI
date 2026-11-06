import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import express from "express";

const P = await import("../server/prompts.js");
const { registerPromptRoutes } = await import("../server/prompts-routes.js");
const { ProviderError } = await import("../server/provider-http.js");

const fresh = () => { const db = new DatabaseSync(":memory:"); P.ensurePromptTables(db); return db; };
const fails = (fn: () => unknown, code: string) => assert.throws(fn, (e: any) => e instanceof P.PromptError && e.code === code, code);

test("variables: parsed in order, defaults supported, rendering fills them and names every missing one", () => {
  const body = "Write a {{tone|friendly}} note to {{ name }} about {{topic}}. Sign off as {{name}}. {{ tone }}";
  assert.deepEqual(P.parseVariables(body), [{ name: "tone", default: "friendly" }, { name: "name", default: null }, { name: "topic", default: null }]);
  assert.equal(P.renderPrompt(body, { name: "Asha", topic: "the exam" }), "Write a friendly note to Asha about the exam. Sign off as Asha. friendly");
  assert.equal(P.renderPrompt(body, { name: "Asha", topic: "x", tone: "formal" }), "Write a formal note to Asha about x. Sign off as Asha. formal");
  assert.throws(() => P.renderPrompt(body, {}), (e: any) => e.code === "MISSING_VARIABLES" && JSON.stringify(e.extra.missing) === JSON.stringify(["name", "topic"]));
  assert.throws(() => P.renderPrompt(body, { name: "   ", topic: "x" }), (e: any) => e.code === "MISSING_VARIABLES", "a blank value counts as missing");
  assert.equal(P.renderPrompt("no variables here"), "no variables here");
  assert.equal(P.renderPrompt("price {{ p }}", { p: 5 }), "price 5", "numbers are accepted");
  fails(() => P.renderPrompt("{{a}}", { a: "x".repeat(P.MAX_VAR_VALUE + 1) }), "VALUE_TOO_LONG");
  // a value that itself contains {{braces}} is inserted as text and never re-expanded
  assert.equal(P.renderPrompt("A: {{a}} B: {{b}}", { a: "{{b}}", b: "real" }), "A: {{b}} B: real");
  // names are limited to identifiers, so odd markup is left alone
  assert.deepEqual(P.parseVariables("{{ 1bad }} {{has space}} {{ok_1}}").map((v) => v.name), ["ok_1"]);
});

test("create, list, edit and delete a prompt; metadata edits do not create versions, content edits do", () => {
  const db = fresh();
  const p = P.createPrompt(db, "u1", { title: "  Summarize  ", body: "Summarize {{text}}", category: "writing", tags: ["Work", "work", "email"], description: "short" });
  assert.deepEqual([p.title, p.category, p.version, p.favorite], ["Summarize", "writing", 1, false]);
  assert.deepEqual(p.tags, ["work", "email"], "tags are lower-cased and de-duplicated");
  assert.deepEqual(p.variables, [{ name: "text", default: null }]);
  const meta = P.updatePrompt(db, "u1", p.id, { category: "analysis", favorite: true, tags: "a, b" })!;
  assert.deepEqual([meta.version, meta.category, meta.favorite, meta.tags], [1, "analysis", true, ["a", "b"]], "metadata only: still version 1");
  const edited = P.updatePrompt(db, "u1", p.id, { body: "Summarize {{text}} in {{n|3}} bullets", note: "added a count" })!;
  assert.equal(edited.version, 2);
  assert.deepEqual(edited.variables.map((v) => v.name), ["text", "n"]);
  const same = P.updatePrompt(db, "u1", p.id, { body: "Summarize {{text}} in {{n|3}} bullets" })!;
  assert.equal(same.version, 2, "saving identical text creates no version");
  assert.equal(P.deletePrompt(db, "u1", p.id), true);
  assert.equal(P.getPrompt(db, "u1", p.id), null);
  assert.equal(P.listVersions(db, "u1", p.id), null, "versions go with the prompt");
  assert.equal(P.deletePrompt(db, "u1", p.id), false);
});

test("validation: title, body, description, category, tags; credentials are refused but e-mail addresses are fine", () => {
  const db = fresh();
  fails(() => P.createPrompt(db, "u", { title: " ", body: "x" }), "TITLE_REQUIRED");
  fails(() => P.createPrompt(db, "u", { title: "t".repeat(P.MAX_TITLE + 1), body: "x" }), "TITLE_TOO_LONG");
  fails(() => P.createPrompt(db, "u", { title: "t", body: "  " }), "BODY_REQUIRED");
  fails(() => P.createPrompt(db, "u", { title: "t", body: "x".repeat(P.MAX_BODY + 1) }), "BODY_TOO_LONG");
  fails(() => P.createPrompt(db, "u", { title: "t", body: "x", category: "nope" }), "INVALID_CATEGORY");
  fails(() => P.createPrompt(db, "u", { title: "t", body: "x", tags: ["<script>"] }), "INVALID_TAGS");
  fails(() => P.createPrompt(db, "u", { title: "t", body: "x", tags: new Array(9).fill(0).map((_, i) => "t" + i) }), "TOO_MANY_TAGS");
  fails(() => P.createPrompt(db, "u", { title: "t", body: "x", description: "d".repeat(P.MAX_DESC + 1) }), "DESCRIPTION_TOO_LONG");
  fails(() => P.createPrompt(db, "u", { title: "t", body: "use key sk-live-ABCDEFGHIJKLMNOPQRSTUVWX please" }), "LOOKS_SECRET");
  fails(() => P.createPrompt(db, "u", { title: "t", body: "Authorization: Bearer abcdef1234567890abcdef" }), "LOOKS_SECRET");
  assert.ok(P.createPrompt(db, "u", { title: "email", body: "Write to john.doe@example.com about {{topic}}" }), "an e-mail address in a prompt is normal");
  assert.equal(P.listPrompts(db, "u").length, 1, "nothing half-saved");
});

test("version history: numbered, newest first, restore creates a new version, and only the last 50 are kept", () => {
  const db = fresh();
  const p = P.createPrompt(db, "u", { title: "Draft", body: "v1 text" });
  P.updatePrompt(db, "u", p.id, { body: "v2 text", note: "second" });
  P.updatePrompt(db, "u", p.id, { title: "Draft renamed", body: "v3 text" });
  const v = P.listVersions(db, "u", p.id)!;
  assert.deepEqual(v.map((x) => x.version), [3, 2, 1]);
  assert.equal(v[1].note, "second");
  assert.equal(v[2].body, "v1 text");
  const back = P.restoreVersion(db, "u", p.id, 1)!;
  assert.deepEqual([back.body, back.title, back.version], ["v1 text", "Draft", 4], "restoring never rewrites history: it adds version 4");
  assert.equal(P.listVersions(db, "u", p.id)![0].note, "Restored version 1");
  fails(() => P.restoreVersion(db, "u", p.id, 99), "VERSION_NOT_FOUND");
  assert.equal(P.restoreVersion(db, "u", p.id, 4)!.version, 4, "restoring the current text changes nothing");
  for (let i = 0; i < 60; i++) P.updatePrompt(db, "u", p.id, { body: "edit number " + i });
  const kept = P.listVersions(db, "u", p.id)!;
  assert.equal(kept.length, P.MAX_VERSIONS);
  assert.equal(kept[0].version, 64);
  assert.equal(kept[kept.length - 1].version, 15, "the oldest versions were dropped");
});

test("ownership: another user can never read, edit, delete, list, version, restore or export a prompt", () => {
  const db = fresh();
  const p = P.createPrompt(db, "alice", { title: "Alice private", body: "Alice's secret technique {{x}}" });
  assert.equal(P.getPrompt(db, "bob", p.id), null);
  assert.equal(P.updatePrompt(db, "bob", p.id, { body: "hijacked" }), null);
  assert.equal(P.deletePrompt(db, "bob", p.id), false);
  assert.equal(P.listVersions(db, "bob", p.id), null);
  assert.equal(P.restoreVersion(db, "bob", p.id, 1), null);
  assert.equal(P.listPrompts(db, "bob").length, 0);
  assert.equal(P.exportPrompts(db, "bob").prompts.length, 0);
  assert.equal(P.getPrompt(db, "alice", p.id)!.body, "Alice's secret technique {{x}}");
  assert.equal(P.listVersions(db, "alice", p.id)!.length, 1, "Bob's failed delete left Alice's versions alone");
});

test("search and organisation: category, tag, favourite, text (wildcards are literal); favourites sort first", () => {
  const db = fresh();
  P.createPrompt(db, "u", { title: "Code review", body: "Review {{code}}", category: "coding", tags: ["dev"] });
  P.createPrompt(db, "u", { title: "Essay outline", body: "Outline an essay on {{topic}}", category: "writing", tags: ["school", "dev"] });
  const fav = P.createPrompt(db, "u", { title: "Daily standup", body: "Write my standup", category: "business", description: "100% useful" });
  P.updatePrompt(db, "u", fav.id, { favorite: true });
  assert.equal(P.listPrompts(db, "u")[0].id, fav.id, "favourites first");
  assert.equal(P.listPrompts(db, "u", { category: "coding" }).length, 1);
  assert.equal(P.listPrompts(db, "u", { tag: "dev" }).length, 2);
  assert.equal(P.listPrompts(db, "u", { favorite: true }).length, 1);
  assert.equal(P.listPrompts(db, "u", { q: "essay" })[0].title, "Essay outline");
  assert.equal(P.listPrompts(db, "u", { q: "100%" }).length, 1);
  assert.equal(P.listPrompts(db, "u", { q: "%%" }).length, 0);
  fails(() => P.listPrompts(db, "u", { category: "bogus" }), "INVALID_CATEGORY");
});

test("export and import round-trip; duplicates, bad rows and oversized imports are reported, never half-saved", () => {
  const db = fresh();
  P.createPrompt(db, "a", { title: "One", body: "Body one {{x}}", category: "learning", tags: ["t1"], description: "d" });
  P.createPrompt(db, "a", { title: "Two", body: "Body two" });
  const exp = P.exportPrompts(db, "a");
  assert.equal(exp.format, "darkness-prompts");
  assert.equal(exp.prompts.length, 2);
  const other = fresh();
  assert.deepEqual(P.importPrompts(other, "b", exp), { added: 2, skipped: [] });
  assert.equal(P.listPrompts(other, "b").find((p) => p.title === "One")!.category, "learning");
  const again = P.importPrompts(other, "b", exp);
  assert.deepEqual([again.added, again.skipped.map((s) => s.code)], [0, ["DUPLICATE", "DUPLICATE"]]);
  const mixed = P.importPrompts(other, "b", [{ title: "Three", body: "ok body" }, { title: "", body: "x" }, "nope", { title: "Four", body: "sk-live-ABCDEFGHIJKLMNOPQRSTUVWX" }]);
  assert.equal(mixed.added, 1);
  assert.deepEqual(mixed.skipped.map((s) => s.code), ["TITLE_REQUIRED", "INVALID_ROW", "LOOKS_SECRET"]);
  fails(() => P.importPrompts(other, "b", { hello: "world" }), "INVALID_IMPORT");
  fails(() => P.importPrompts(other, "b", new Array(P.MAX_IMPORT + 1).fill({ title: "t", body: "b" })), "IMPORT_TOO_LARGE");
  assert.equal(P.exportPrompts(db, "a", [P.listPrompts(db, "a")[0].id]).prompts.length, 1, "export can be limited to chosen prompts");
});

test("every built-in template is valid: its variables parse, it renders once filled, and no template holds a credential", () => {
  assert.ok(P.TEMPLATES.length >= 10);
  const ids = new Set<string>();
  for (const t of P.TEMPLATES) {
    assert.ok(!ids.has(t.id), "unique id " + t.id); ids.add(t.id);
    assert.ok((P.CATEGORIES as readonly string[]).includes(t.category), t.id + " category");
    const vars = P.parseVariables(t.body);
    assert.ok(vars.length > 0, t.id + " has variables");
    const values = Object.fromEntries(vars.filter((v) => v.default == null).map((v) => [v.name, "sample " + v.name]));
    const out = P.renderPrompt(t.body, values);
    assert.ok(!/\{\{/.test(out), t.id + " leaves no placeholder");
    assert.doesNotThrow(() => P.cleanBody(t.body), t.id + " is storable");
  }
  assert.equal(P.getTemplate("summarize")!.title, "Summarize a text");
  assert.equal(P.getTemplate("nope"), null);
});

// ---- HTTP surface ------------------------------------------------------------------------------------------------------------------------

const KEY = "sk-test-AAAAAAAAAAAAAAAAAAAAAAAA";
const MODELS: Record<string, any> = { "u1:m-a": { id: "m-a", name: "Alpha", provider: "openai", apiKey: KEY }, "u1:m-b": { id: "m-b", name: "Beta", provider: "groq", apiKey: KEY + "B" }, "u1:m-off": { id: "m-off", name: "Off", enabled: false }, "u2:m-z": { id: "m-z", name: "Foreign" } };

async function withApp(opts: { call?: any; now?: () => number }, fn: (base: string, db: DatabaseSync) => Promise<void>) {
  const db = fresh(), app = express(); app.use(express.json());
  // the library key and the account id are different strings on purpose, as in the real server
  const who = (req: express.Request) => (req.headers["x-user"] as string) || null;
  registerPromptRoutes(app, { db, getUserKey: async (r) => (who(r) ? "key-" + who(r) : null), getUserId: async (r) => who(r), getModel: (u, id) => MODELS[`${u}:${id}`] || null, call: opts.call || (async (m: any) => `answer from ${m.name}`), now: opts.now, timeoutMs: 2000 });
  const srv = http.createServer(app); await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  try { await fn(`http://127.0.0.1:${(srv.address() as any).port}`, db); } finally { srv.closeAllConnections?.(); srv.close(); }
}
const call = (base: string, method: string, path: string, body?: any, user = "u1") => fetch(base + path, { method, headers: { "content-type": "application/json", ...(user ? { "x-user": user } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

test("route: library CRUD, versions, restore, render and templates; foreign ids are 404; signed out is 401", async () => {
  await withApp({}, async (base) => {
    for (const [m, p] of [["GET", "/api/prompts"], ["GET", "/api/prompts/templates"], ["POST", "/api/prompts/run"], ["GET", "/api/prompts/export"]] as const) assert.equal((await call(base, m, p, m === "POST" ? {} : undefined, "")).status, 401, p);
    const c = await call(base, "POST", "/api/prompts", { title: "Greeter", body: "Say hi to {{name}}", category: "writing", tags: ["a"] });
    assert.equal(c.status, 201);
    const p = await c.json();
    assert.equal((await call(base, "POST", "/api/prompts", { title: "", body: "x" })).status, 400);
    assert.equal((await call(base, "POST", "/api/prompts", { title: "k", body: "sk-live-ABCDEFGHIJKLMNOPQRSTUVWX" })).status, 400);
    assert.equal((await (await call(base, "GET", "/api/prompts")).json()).prompts.length, 1);
    assert.equal((await call(base, "PATCH", `/api/prompts/${p.id}`, { body: "Say hello to {{name}}", note: "friendlier" }).then((r) => r.json())).version, 2);
    assert.equal((await call(base, "PATCH", `/api/prompts/${p.id}`, {})).status, 400);
    const vs = await (await call(base, "GET", `/api/prompts/${p.id}/versions`)).json();
    assert.deepEqual(vs.versions.map((v: any) => v.version), [2, 1]);
    const rs = await call(base, "POST", `/api/prompts/${p.id}/versions/1/restore`);
    assert.equal((await rs.json()).body, "Say hi to {{name}}");
    assert.equal((await call(base, "POST", `/api/prompts/${p.id}/versions/9/restore`)).status, 404);
    const r = await (await call(base, "POST", "/api/prompts/render", { promptId: p.id, values: { name: "Ravi" } })).json();
    assert.equal(r.rendered, "Say hi to Ravi");
    assert.equal((await call(base, "POST", "/api/prompts/render", { promptId: p.id, values: {} })).status, 400);
    const t = await (await call(base, "GET", "/api/prompts/templates")).json();
    assert.ok(t.templates.length >= 10 && t.templates[0].variables.length > 0);
    // another user
    for (const [m, path, b] of [["GET", `/api/prompts/${p.id}`], ["PATCH", `/api/prompts/${p.id}`, { title: "x" }], ["DELETE", `/api/prompts/${p.id}`], ["GET", `/api/prompts/${p.id}/versions`], ["POST", `/api/prompts/${p.id}/versions/1/restore`]] as any[]) assert.equal((await call(base, m, path, b, "u2")).status, 404, `${m} ${path} as another user`);
    assert.equal((await call(base, "POST", "/api/prompts/render", { promptId: p.id, values: { name: "x" } }, "u2")).status, 404);
    assert.equal((await (await call(base, "GET", "/api/prompts", undefined, "u2")).json()).prompts.length, 0);
    assert.equal((await call(base, "DELETE", `/api/prompts/${p.id}`)).status, 200);
  });
});

test("route: import / export", async () => {
  await withApp({}, async (base) => {
    await call(base, "POST", "/api/prompts", { title: "Exported", body: "Body {{x}}" });
    const ex = await (await call(base, "GET", "/api/prompts/export")).json();
    assert.equal(ex.format, "darkness-prompts");
    const imp = await (await call(base, "POST", "/api/prompts/import", ex, "u2")).json();
    assert.equal(imp.added, 1);
    assert.equal((await call(base, "POST", "/api/prompts/import", { nope: 1 })).status, 400);
  });
});

test("route: run a prompt on 1-3 models; variables are filled; errors stay per model and keys stay out", async () => {
  const seen: string[] = [];
  await withApp({ call: async (m: any, prompt: string) => { seen.push(prompt); if (m.id === "m-b") throw new Error(`HTTP 401 for ${m.apiKey}`); return "ok from " + m.name; } }, async (base) => {
    const r = await call(base, "POST", "/api/prompts/run", { body: "Explain {{topic}} simply", values: { topic: "DNS" }, modelIds: ["m-a", "m-b"] });
    assert.equal(r.status, 200);
    const text = await r.text(), j = JSON.parse(text);
    assert.deepEqual(j.results.map((x: any) => [x.modelId, x.finish]), [["m-a", "done"], ["m-b", "error"]]);
    assert.ok(seen.every((p) => p === "Explain DNS simply"), "the model received the filled-in prompt");
    assert.ok(!text.includes(KEY), "no key in the response");
    assert.equal((await call(base, "POST", "/api/prompts/run", { body: "Explain {{topic}}", modelIds: ["m-a"] })).status, 400, "a missing variable is refused before any model is called");
    assert.equal(seen.length, 2);
    assert.equal((await call(base, "POST", "/api/prompts/run", { body: "hi", modelIds: ["m-a"] })).status, 200, "a single model is allowed");
    assert.equal((await call(base, "POST", "/api/prompts/run", { body: "hi", modelIds: ["m-a", "m-b", "m-off", "m-a"] })).status, 400);
    assert.equal((await call(base, "POST", "/api/prompts/run", { body: "hi", modelIds: ["m-z"] })).status, 404, "another user's model reads as not found");
    assert.equal((await call(base, "POST", "/api/prompts/run", { body: "hi", modelIds: ["m-off"] })).status, 409);
    assert.equal((await call(base, "POST", "/api/prompts/run", { body: "x".repeat(8001), modelIds: ["m-a"] })).status, 413);
    assert.equal((await call(base, "POST", "/api/prompts/run", { modelIds: ["m-a"] })).status, 400, "no prompt");
    assert.equal((await call(base, "POST", "/api/prompts/run", { promptId: "nope", modelIds: ["m-a"] })).status, 404);
  });
});

test("route: compare 2-3 prompt variations on one model, matched back by label", async () => {
  await withApp({ call: async (_m: any, prompt: string) => "reply to: " + prompt }, async (base) => {
    const r = await (await call(base, "POST", "/api/prompts/compare", { variants: [{ label: "Short", body: "Explain {{t}} briefly" }, { label: "Long", body: "Explain {{t}} in detail" }], values: { t: "TCP" }, modelId: "m-a" })).json();
    assert.deepEqual(r.results.map((x: any) => [x.variant, x.text]), [["Short", "reply to: Explain TCP briefly"], ["Long", "reply to: Explain TCP in detail"]]);
    assert.equal((await call(base, "POST", "/api/prompts/compare", { variants: [{ body: "only one" }], modelId: "m-a" })).status, 400);
    assert.equal((await call(base, "POST", "/api/prompts/compare", { variants: [{ label: "A", body: "x" }, { label: "A", body: "y" }], modelId: "m-a" })).status, 400, "labels must differ");
    assert.equal((await call(base, "POST", "/api/prompts/compare", { variants: [{ body: "x" }, { body: "" }], modelId: "m-a" })).status, 400);
    assert.equal((await call(base, "POST", "/api/prompts/compare", { variants: [{ body: "x" }, { body: "y" }], modelId: "m-z" })).status, 404);
    const auto = await (await call(base, "POST", "/api/prompts/compare", { variants: [{ body: "x" }, { body: "y" }, { body: "z" }], modelId: "m-a" })).json();
    assert.deepEqual(auto.results.map((x: any) => x.variant), ["A", "B", "C"], "unnamed variations are lettered");
  });
});

test("route: one test run at a time per user, a per-minute limit, and a browser disconnect aborts every model call", async () => {
  let release!: () => void; const gate = new Promise<void>((r) => (release = r));
  await withApp({ call: async () => { await gate; return "x"; } }, async (base) => {
    const first = call(base, "POST", "/api/prompts/run", { body: "hi", modelIds: ["m-a"] });
    await new Promise((r) => setTimeout(r, 100));
    const second = await call(base, "POST", "/api/prompts/run", { body: "hi", modelIds: ["m-a"] });
    assert.equal(second.status, 429); assert.equal((await second.json()).code, "RUN_BUSY");
    release(); assert.equal((await first).status, 200);
  });
  let t = 5_000_000;
  await withApp({ now: () => t }, async (base) => {
    for (let i = 0; i < 6; i++) assert.equal((await call(base, "POST", "/api/prompts/run", { body: "hi", modelIds: ["m-a"] })).status, 200);
    const over = await call(base, "POST", "/api/prompts/run", { body: "hi", modelIds: ["m-a"] });
    assert.equal(over.status, 429); assert.ok(Number(over.headers.get("retry-after")) >= 1);
    t += 61_000;
    assert.equal((await call(base, "POST", "/api/prompts/run", { body: "hi", modelIds: ["m-a"] })).status, 200);
  });
  const sigs: AbortSignal[] = [];
  const db = fresh(), app = express(); app.use(express.json());
  registerPromptRoutes(app, { db, getUserKey: async () => "k", getUserId: async () => "u1", getModel: (_u, id) => MODELS[`u1:${id}`] || null, call: (_m: any, _p: string, o: any) => new Promise<string>((_r, rej) => { sigs.push(o.signal); o.signal.addEventListener("abort", () => rej(new ProviderError("cancelled", { kind: "cancelled", retryable: false })), { once: true }); }) });
  const srv = http.createServer(app); await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const port = (srv.address() as any).port, payload = JSON.stringify({ body: "hi", modelIds: ["m-a", "m-b"] });
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/api/prompts/run", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } });
    req.on("error", () => {}); req.end(payload);
    for (let i = 0; i < 50 && sigs.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(sigs.length, 2); req.destroy();
    for (let i = 0; i < 50 && !sigs.every((s) => s.aborted); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(sigs.every((s) => s.aborted), "both upstream calls were aborted");
  } finally { srv.closeAllConnections?.(); srv.close(); }
});
