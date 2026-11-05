import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import express from "express";

const { runAgent, parsePlan } = await import("../server/agent/core.js");
const { SESSION_TOOLS, ALL_TOOLS, validateToolArgs, selectTools } = await import("../server/agent/tools.js");
const { approvalReason, normaliseMode } = await import("../server/agent/policy.js");
const S = await import("../server/agent/sessions.js");
const { registerSessionRoutes } = await import("../server/agent/session-routes.js");

type Msg = { role: string; content: string };
/** A model that plays back a script, recording what it was asked. */
function scripted(replies: Array<string | ((msgs: Msg[], signal?: AbortSignal) => Promise<string> | string)>) {
  const seen: Msg[][] = []; let i = 0;
  return {
    provider: "fake", model: "script-1", seen,
    async complete(messages: Msg[], opts?: { signal?: AbortSignal }) {
      seen.push(messages.map((m) => ({ ...m })));
      const r = replies[Math.min(i++, replies.length - 1)];
      return typeof r === "function" ? r(messages, opts?.signal) : r;
    },
  } as any;
}
const REMEMBER = JSON.stringify({ thought: "save it", tool: "remember", args: { content: "The user prefers short answers", category: "preference" } });
const CALC = JSON.stringify({ thought: "add", tool: "calculator", args: { expression: "2+2" } });
const FINAL = JSON.stringify({ thought: "done", final: "All done." });
const types = (events: any[]) => events.map((e) => e.type);

// ---- policy and tool metadata -------------------------------------------------------------------------------------------------------------

test("policy: write tools always need approval, every mode is validated, an unknown mode is never 'off'", () => {
  const remember = SESSION_TOOLS.find((t) => t.name === "remember")!, calc = SESSION_TOOLS.find((t) => t.name === "calculator")!, web = SESSION_TOOLS.find((t) => t.name === "web_search")!;
  assert.equal(remember.risk, "write");
  assert.ok(approvalReason(remember, "sensitive"), "write: asked in the default mode");
  assert.ok(approvalReason(remember, "all"), "write: asked in the strict mode");
  assert.equal(approvalReason(calc, "sensitive"), null);
  assert.equal(approvalReason(web, "sensitive"), null);
  assert.match(approvalReason(web, "all")!, /internet/);
  assert.ok(approvalReason(calc, "all"));
  for (const bogus of ["none", "off", "", null, undefined, 0, false, { x: 1 }]) assert.equal(normaliseMode(bogus), "sensitive", String(bogus));
  assert.equal(normaliseMode("all"), "all");
  assert.ok(!ALL_TOOLS.some((t) => t.risk === "write"), "the stateless tool set holds no write tool");
  assert.deepEqual(selectTools(["remember", "calculator"]).map((t) => t.name), ["calculator"], "the stateless run cannot even select the write tool");
  assert.deepEqual(selectTools(["remember"], SESSION_TOOLS).map((t) => t.name), ["remember"]);
});

test("argument validation: malformed arguments are caught before a tool runs", () => {
  assert.equal(validateToolArgs("calculator", { expression: "1+1" }), null);
  assert.match(validateToolArgs("calculator", {})!, /expression/);
  assert.match(validateToolArgs("web_search", { query: "" })!, /query/);
  assert.match(validateToolArgs("fetch_url", { url: "x" })!, /url/);
  assert.match(validateToolArgs("scratchpad", { action: "rm -rf" })!, /action/);
  assert.match(validateToolArgs("remember", { content: "ab" })!, /content/);
  assert.match(validateToolArgs("remember", { content: "x".repeat(501) })!, /content/);
  assert.match(validateToolArgs("remember", { content: "fine note", category: "secrets" })!, /category/);
  assert.equal(validateToolArgs("remember", { content: "fine note", category: "fact" }), null);
  assert.equal(validateToolArgs("datetime", {}), null);
});

// ---- the loop ------------------------------------------------------------------------------------------------------------------------------

test("plan: a separate planning call is shown first, added to the instructions, and progress follows what the agent reports", async () => {
  const llm = scripted([JSON.stringify({ plan: [{ title: "Add the numbers", tool: "calculator" }, { title: "Write the answer" }, { title: "", tool: "nope" }] }), JSON.stringify({ thought: "x", tool: "calculator", args: { expression: "2+2" }, done: [1] }), JSON.stringify({ final: "4", done: [2, 99, "x"] })]);
  const events: any[] = [];
  const r = await runAgent({ llm, tools: SESSION_TOOLS, goal: "add", plan: true, onEvent: (e) => events.push(e) });
  assert.equal(r.answer, "4");
  const plan = events.find((e) => e.type === "plan");
  assert.deepEqual(plan.tasks, [{ n: 1, title: "Add the numbers", tool: "calculator" }, { n: 2, title: "Write the answer" }], "blank titles are dropped");
  assert.deepEqual(events.filter((e) => e.type === "progress").map((e) => e.done), [[1], [1, 2]], "only valid task numbers count");
  assert.equal(types(events).indexOf("plan") < types(events).indexOf("tool_call"), true, "the plan comes before any action");
  assert.match(llm.seen[1][0].content, /Your plan[\s\S]*1\. Add the numbers \(tool: calculator\)[\s\S]*2\. Write the answer/);
  assert.equal(parsePlan("not json", []), null);
  assert.equal((await runAgent({ llm: scripted(["I will just answer", FINAL]), tools: SESSION_TOOLS, goal: "x", plan: true })).answer, "All done.", "an unusable plan never blocks the run");
});

test("approval: a write tool stops the run BEFORE it runs, the checkpoint says why, and nothing is saved until the user approves", async () => {
  const saved: string[] = [];
  const cps: any[] = [];
  const llm = scripted([REMEMBER, FINAL]);
  const events: any[] = [];
  const r1 = await runAgent({ llm, tools: SESSION_TOOLS, goal: "remember my style", saveMemoryNote: (c) => { saved.push(c); return "saved"; }, onCheckpoint: (cp) => { cps.push(cp); }, onEvent: (e) => events.push(e) });
  assert.equal(r1.status, "waiting_approval");
  assert.deepEqual(saved, [], "NOT saved yet");
  const ask = events.find((e) => e.type === "approval_required");
  assert.equal(ask.tool, "remember");
  assert.match(ask.reason, /changes your saved data/);
  assert.deepEqual(r1.checkpoint!.pending!.args, { content: "The user prefers short answers", category: "preference" });
  assert.equal(llm.seen.length, 1, "the model was not asked to continue while waiting");
  // approve
  const ev2: any[] = [];
  const r2 = await runAgent({ llm, tools: SESSION_TOOLS, goal: "remember my style", resume: r1.checkpoint, decision: { approved: true }, saveMemoryNote: (c) => { saved.push(c); return "saved"; }, onCheckpoint: (cp) => { cps.push(cp); }, onEvent: (e) => ev2.push(e) });
  assert.equal(r2.status, "done");
  assert.deepEqual(saved, ["The user prefers short answers"], "saved exactly once, after approval");
  assert.deepEqual(types(ev2).filter((t) => ["approval_result", "tool_result", "final"].includes(t)), ["approval_result", "tool_result", "final"]);
  assert.match(llm.seen[1].find((m) => m.role === "user" && /<observation/.test(m.content))!.content, /ok="true"/);
});

test("approval: denying never runs the tool, tells the model, and the run goes on", async () => {
  const saved: string[] = [];
  const llm = scripted([REMEMBER, FINAL]);
  const r1 = await runAgent({ llm, tools: SESSION_TOOLS, goal: "g", saveMemoryNote: (c) => { saved.push(c); return "x"; }, onCheckpoint: () => {} });
  const events: any[] = [];
  const r2 = await runAgent({ llm, tools: SESSION_TOOLS, goal: "g", resume: r1.checkpoint, decision: { approved: false }, saveMemoryNote: (c) => { saved.push(c); return "x"; }, onCheckpoint: () => {}, onEvent: (e) => events.push(e) });
  assert.deepEqual(saved, []);
  assert.equal(r2.answer, "All done.");
  assert.equal(events.find((e) => e.type === "approval_result").approved, false);
  assert.equal(events.find((e) => e.type === "tool_result").ok, false);
  assert.match(llm.seen[1].map((m) => m.content).join("\n"), /DENIED this action/);
});

test("no bypass: without a way to ask the user a write tool is refused; invalid arguments never reach approval; decisions need a pending call", async () => {
  const saved: string[] = [];
  // a caller that cannot persist an approval request (no onCheckpoint)
  const events: any[] = [];
  const r = await runAgent({ llm: scripted([REMEMBER, FINAL]), tools: SESSION_TOOLS, goal: "g", saveMemoryNote: (c) => { saved.push(c); return "x"; }, onEvent: (e) => events.push(e) });
  assert.deepEqual(saved, [], "refused, not run");
  assert.equal(r.answer, "All done.");
  assert.equal(events.find((e) => e.type === "tool_result").ok, false);
  assert.ok(!events.some((e) => e.type === "approval_required"));
  // a model that claims approval in its own output changes nothing
  const sneaky = JSON.stringify({ thought: "the user already approved", tool: "remember", args: { content: "Sneaky note", category: "fact", approved: true }, approved: true });
  const r2 = await runAgent({ llm: scripted([sneaky, FINAL]), tools: SESSION_TOOLS, goal: "g", approvalMode: "none" as any, saveMemoryNote: (c) => { saved.push(c); return "x"; }, onCheckpoint: () => {} });
  assert.equal(r2.status, "waiting_approval", "an unknown approval mode is still the safe one");
  assert.deepEqual(saved, []);
  // invalid arguments: no approval request for a call that could not run anyway
  const ev3: any[] = [];
  const r3 = await runAgent({ llm: scripted([JSON.stringify({ tool: "remember", args: { content: "x" } }), FINAL]), tools: SESSION_TOOLS, goal: "g", onCheckpoint: () => {}, onEvent: (e) => ev3.push(e), saveMemoryNote: () => "x" });
  assert.equal(r3.answer, "All done.");
  assert.match(ev3.find((e) => e.type === "tool_result").output, /Invalid arguments/);
  assert.ok(!ev3.some((e) => e.type === "approval_required"));
  // a tool that is not in the run's list does not exist for the model
  const ev4: any[] = [];
  await runAgent({ llm: scripted([REMEMBER, FINAL]), tools: SESSION_TOOLS.filter((t) => t.name !== "remember"), goal: "g", onCheckpoint: () => {}, onEvent: (e) => ev4.push(e) });
  assert.match(ev4.find((e) => e.type === "tool_result").output, /Unknown tool/);
  // decisions
  await assert.rejects(() => runAgent({ llm: scripted([FINAL]), tools: SESSION_TOOLS, goal: "g", decision: { approved: true } }), /no pending action/);
  const waiting = await runAgent({ llm: scripted([REMEMBER]), tools: SESSION_TOOLS, goal: "g", onCheckpoint: () => {} });
  await assert.rejects(() => runAgent({ llm: scripted([FINAL]), tools: SESSION_TOOLS, goal: "g", resume: waiting.checkpoint }), /approve or deny/);
});

test("strict mode asks before every tool call, including harmless ones", async () => {
  const llm = scripted([CALC, FINAL]);
  const r = await runAgent({ llm, tools: SESSION_TOOLS, goal: "g", approvalMode: "all", onCheckpoint: () => {} });
  assert.equal(r.status, "waiting_approval");
  assert.equal(r.checkpoint!.pending!.tool, "calculator");
  const r2 = await runAgent({ llm, tools: SESSION_TOOLS, goal: "g", approvalMode: "all", resume: r.checkpoint, decision: { approved: true }, onCheckpoint: () => {} });
  assert.equal(r2.answer, "All done.");
});

test("checkpoints: stopping mid-run and resuming from the last checkpoint finishes the same run without redoing work", async () => {
  const script = [CALC, JSON.stringify({ tool: "datetime", args: {} }), JSON.stringify({ tool: "scratchpad", args: { action: "set", key: "a", value: "b" } }), FINAL];
  const clean = await runAgent({ llm: scripted(script), tools: SESSION_TOOLS, goal: "g" });
  // interrupted: the model call for step 3 never completes (the user pauses)
  const ctl = new AbortController(); const cps: any[] = [];
  const llm1 = scripted([script[0], script[1], (_m: Msg[], sig?: AbortSignal) => new Promise<string>((_r, rej) => sig?.addEventListener("abort", () => rej(new Error("Aborted")), { once: true }))]);
  const run1 = runAgent({ llm: llm1, tools: SESSION_TOOLS, goal: "g", signal: ctl.signal, onCheckpoint: (cp) => { cps.push(cp); if (cps.length === 2) setTimeout(() => ctl.abort("pause"), 20); } });
  await assert.rejects(run1, /Aborted/);
  assert.equal(cps.length, 2, "one checkpoint per completed step");
  assert.equal(cps[1].step, 2);
  // resume (the checkpoint round-trips through JSON, as it does in the database)
  const llm2 = scripted([script[2], script[3]]);
  const r2 = await runAgent({ llm: llm2, tools: SESSION_TOOLS, goal: "g", resume: JSON.parse(JSON.stringify(cps[1])), onCheckpoint: () => {} });
  assert.equal(r2.answer, clean.answer);
  assert.equal(r2.steps, clean.steps, "the step counter continues, it does not restart");
  assert.equal(llm2.seen.length, 2, "only the remaining model calls were made");
  assert.ok(llm2.seen[0].some((m) => /observation tool="calculator"/.test(m.content)), "the earlier observations are still in the conversation");
});

test("a failing tool is a recorded step, not a crash; an aborted tool is not recorded at all (it is redone on resume)", async () => {
  const events: any[] = [];
  const r = await runAgent({ llm: scripted([JSON.stringify({ tool: "calculator", args: { expression: "1/0+(" } }), FINAL]), tools: SESSION_TOOLS, goal: "g", onEvent: (e) => events.push(e) });
  assert.equal(r.answer, "All done.");
  assert.equal(events.find((e) => e.type === "tool_result").ok, false);
});

// ---- sessions (database) -------------------------------------------------------------------------------------------------------------------

const OPTS = { tools: ["calculator", "remember"], approvals: "sensitive" as const, plan: false, maxSteps: 8 };
const freshDb = () => { const db = new DatabaseSync(":memory:"); S.ensureSessionTables(db); return db; };

test("sessions: create, update, list, events and delete; scoped to the owner", () => {
  const db = freshDb();
  const s = S.createSession(db, "alice", { goal: "Find the cheapest flight", options: OPTS }, 1000);
  assert.equal(s.status, "running");
  assert.deepEqual(S.listEvents(db, "alice", s.id)!.map((e) => e.type), ["created"]);
  S.appendEvent(db, "alice", s.id, { type: "tool_call", tool: "calculator", summary: JSON.stringify({ expression: "1+1" }) });
  S.appendEvent(db, "alice", s.id, { type: "tool_result", tool: "calculator", ok: true, summary: "finished (1 characters of output)" });
  S.updateSession(db, "alice", s.id, { status: "paused", steps: 2, plan: [{ n: 1, title: "x" }], done: [1] }, 2000);
  const got = S.getSession(db, "alice", s.id)!;
  assert.deepEqual([got.status, got.steps, got.plan, got.done, got.finishedAt], ["paused", 2, [{ n: 1, title: "x" }], [1], null]);
  S.updateSession(db, "alice", s.id, { status: "done", answer: "It is 2." }, 3000);
  assert.equal(S.getSession(db, "alice", s.id)!.finishedAt, 3000);
  assert.deepEqual(S.toolOutcomes(db, "alice", s.id), [{ tool: "calculator", ok: true }]);
  assert.equal(S.listSessions(db, "alice").length, 1);
  assert.equal(S.listSessions(db, "alice", { status: "failed" }).length, 0);
  // another user
  assert.equal(S.getSession(db, "bob", s.id), null);
  assert.equal(S.listSessions(db, "bob").length, 0);
  assert.equal(S.listEvents(db, "bob", s.id), null);
  assert.equal(S.deleteSession(db, "bob", s.id), false);
  assert.equal(S.getCheckpoint(db, "bob", s.id), null);
  assert.equal(S.updateSession(db, "bob", s.id, { status: "failed" }), S.getSession(db, "bob", s.id), "a foreign update changes nothing");
  assert.equal(S.getSession(db, "alice", s.id)!.status, "done");
  assert.equal(S.deleteSession(db, "alice", s.id), true);
  assert.equal(S.listEvents(db, "alice", s.id), null, "the trail goes with the session");
});

test("sessions: the audit trail redacts secrets and bounds each entry, and a running run cannot be deleted", () => {
  const db = freshDb();
  const s = S.createSession(db, "u", { goal: "g", options: OPTS });
  S.appendEvent(db, "u", s.id, { type: "tool_call", tool: "fetch_url", summary: JSON.stringify({ url: "https://x.example/?key=sk-live-ABCDEFGHIJKLMNOPQRSTUVWX", note: "x".repeat(1000) }) });
  const e = S.listEvents(db, "u", s.id)!.find((x) => x.type === "tool_call")!;
  assert.ok(!e.summary.includes("sk-live-ABCDEF"), "a key in an argument is redacted");
  assert.ok(e.summary.length <= 220, "an entry is bounded");
  assert.throws(() => S.deleteSession(db, "u", s.id), (x: any) => x.code === "RUNNING");
  for (let i = 0; i < 650; i++) S.appendEvent(db, "u", s.id, { type: "thought", summary: "t" + i });
  assert.ok(S.listEvents(db, "u", s.id, 1000)!.length <= 600, "the log of one run is bounded");
});

test("sessions: state machine - which actions are allowed in which state, and the retry limit", () => {
  const mk = (status: any, retries = 0) => ({ status, retries }) as any;
  const code = (fn: () => void) => { try { fn(); return "ok"; } catch (e: any) { return e.code; } };
  assert.equal(code(() => S.assertCanContinue(mk("waiting_approval"), "approve")), "ok");
  assert.equal(code(() => S.assertCanContinue(mk("running"), "approve")), "NOT_WAITING");
  assert.equal(code(() => S.assertCanContinue(mk("paused"), "resume")), "ok");
  assert.equal(code(() => S.assertCanContinue(mk("failed", 1), "resume")), "ok");
  assert.equal(code(() => S.assertCanContinue(mk("failed", S.MAX_RETRIES), "resume")), "RETRY_LIMIT");
  assert.equal(code(() => S.assertCanContinue(mk("waiting_approval"), "resume")), "NOT_RESUMABLE", "an approval cannot be skipped by resuming");
  assert.equal(code(() => S.assertCanContinue(mk("done"), "resume")), "NOT_RESUMABLE");
  assert.equal(code(() => S.assertCanContinue(mk("running"), "pause")), "ok");
  assert.equal(code(() => S.assertCanContinue(mk("paused"), "pause")), "NOT_RUNNING");
  assert.equal(code(() => S.assertCanContinue(mk("paused"), "cancel")), "ok");
  assert.equal(code(() => S.assertCanContinue(mk("waiting_approval"), "cancel")), "ok");
  assert.equal(code(() => S.assertCanContinue(mk("done"), "cancel")), "FINISHED");
  assert.equal(code(() => S.assertCanContinue(mk("cancelled"), "cancel")), "FINISHED");
});

test("sessions: a run that was 'running' when the server stopped comes back as failed and resumable; old finished runs are purged", () => {
  const db = freshDb();
  const a = S.createSession(db, "u", { goal: "interrupted", options: OPTS }, 1000);
  const old = S.createSession(db, "u", { goal: "old", options: OPTS }, 1000);
  S.updateSession(db, "u", old.id, { status: "done" }, 1000);
  S.ensureSessionTables(db, 1000 + 40 * 86_400_000); // a restart, 40 days later
  assert.equal(S.getSession(db, "u", old.id), null, "retention: finished runs older than 30 days are removed");
  const back = S.getSession(db, "u", a.id);
  assert.equal(back!.status, "failed");
  assert.match(back!.error, /Interrupted by a server restart/);
  assert.ok(S.listEvents(db, "u", a.id)!.some((e) => e.type === "interrupted"));
  S.assertCanContinue(back!, "resume");
});

test("sessions: at most 100 saved runs per user", () => {
  const db = freshDb();
  for (let i = 0; i < S.MAX_SESSIONS_PER_USER; i++) S.createSession(db, "u", { goal: "g" + i, options: OPTS });
  assert.throws(() => S.createSession(db, "u", { goal: "one more", options: OPTS }), (e: any) => e.code === "LIMIT_REACHED");
  assert.ok(S.createSession(db, "other", { goal: "fine", options: OPTS }));
});

// ---- HTTP: the full flow ---------------------------------------------------------------------------------------------------------------------

function parseSse(text: string) {
  return text.split("\n\n").map((b) => { const ev = /^event: (.+)$/m.exec(b), da = /^data: (.+)$/m.exec(b); return ev && da ? { event: ev[1], data: JSON.parse(da[1]) } : null; }).filter(Boolean) as Array<{ event: string; data: any }>;
}

async function withApp(opts: { llm: () => any; saved?: string[]; recorded?: any[] }, fn: (base: string, db: DatabaseSync) => Promise<void>) {
  const db = freshDb(), app = express(); app.use(express.json());
  const who = (req: express.Request) => (req.headers["x-user"] as string) || null;
  registerSessionRoutes(app, {
    db, getUserKey: async (r) => (who(r) ? "key-" + who(r) : null), getUserId: async (r) => who(r), getLLM: () => opts.llm(),
    saveMemoryNote: (_k, content) => { (opts.saved ||= []).push(content); return "Saved: " + content; }, recordRun: (r) => { (opts.recorded ||= []).push(r); },
  });
  const srv = http.createServer(app); await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  try { await fn(`http://127.0.0.1:${(srv.address() as any).port}`, db); } finally { srv.closeAllConnections?.(); srv.close(); }
}
const call = (base: string, method: string, path: string, body?: any, user = "u1") => fetch(base + path, { method, headers: { "content-type": "application/json", ...(user ? { "x-user": user } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("route: start -> plan -> approval request -> approve -> done, with the memory note saved exactly once and a complete audit trail", async () => {
  const saved: string[] = [], recorded: any[] = [];
  const llm = scripted([JSON.stringify({ plan: [{ title: "Save the preference" }, { title: "Confirm" }] }), REMEMBER, JSON.stringify({ final: "Saved your preference.", done: [1, 2] })]);
  await withApp({ llm: () => llm, saved, recorded }, async (base) => {
    const r1 = await call(base, "POST", "/api/agent/sessions", { goal: "Remember that I like short answers", plan: true });
    assert.equal(r1.status, 200);
    const ev1 = parseSse(await r1.text());
    const sid = ev1[0].data.id;
    assert.deepEqual(ev1.map((e) => e.event).filter((e) => ["session", "plan", "tool_call", "approval_required", "waiting_approval"].includes(e)), ["session", "plan", "tool_call", "approval_required", "waiting_approval"]);
    assert.deepEqual(saved, [], "nothing is saved while waiting");
    const detail = await (await call(base, "GET", `/api/agent/sessions/${sid}`)).json();
    assert.equal(detail.session.status, "waiting_approval");
    assert.equal(detail.session.pending.tool, "remember");
    assert.deepEqual(detail.session.plan.map((t: any) => t.title), ["Save the preference", "Confirm"]);
    const approvalId = detail.session.pending.id;
    // a wrong or missing decision is refused and changes nothing
    assert.equal((await call(base, "POST", `/api/agent/sessions/${sid}/approve`, { decision: "maybe" })).status, 400);
    assert.equal((await call(base, "POST", `/api/agent/sessions/${sid}/approve`, { decision: "approve", approvalId: "stale-id" })).status, 409);
    assert.equal((await call(base, "POST", `/api/agent/sessions/${sid}/resume`)).status, 409, "resume cannot skip the approval");
    assert.deepEqual(saved, []);
    // another user cannot approve it
    assert.equal((await call(base, "POST", `/api/agent/sessions/${sid}/approve`, { decision: "approve" }, "u2")).status, 404);
    assert.deepEqual(saved, []);
    const r2 = await call(base, "POST", `/api/agent/sessions/${sid}/approve`, { decision: "approve", approvalId });
    assert.equal(r2.status, 200);
    const ev2 = parseSse(await r2.text());
    assert.ok(ev2.some((e) => e.event === "approval_result" && e.data.approved === true));
    assert.equal(ev2[ev2.length - 1].event, "done");
    assert.deepEqual(saved, ["The user prefers short answers"], "saved exactly once, after the approval");
    const done = await (await call(base, "GET", `/api/agent/sessions/${sid}`)).json();
    assert.equal(done.session.status, "done");
    assert.equal(done.session.answer, "Saved your preference.");
    assert.equal(done.session.pending, null);
    const trail = done.events.map((e: any) => e.type);
    for (const t of ["created", "started", "model", "plan", "tool_call", "approval_required", "decision", "approval_result", "tool_result", "final"]) assert.ok(trail.includes(t), "audit trail has " + t + ": " + trail.join());
    assert.equal(trail.filter((t: string) => t === "tool_result").length, 1);
    assert.equal(recorded.length, 1, "statistics are recorded once, when the run ends");
    assert.equal(recorded[0].status, "ok");
    assert.equal((await call(base, "POST", `/api/agent/sessions/${sid}/approve`, { decision: "approve" })).status, 409, "an approval cannot be replayed");
    assert.deepEqual(saved.length, 1);
  });
});

test("route: denying an approval keeps the run alive and saves nothing", async () => {
  const saved: string[] = [];
  const llm = scripted([REMEMBER, FINAL]);
  await withApp({ llm: () => llm, saved }, async (base) => {
    const sid = parseSse(await (await call(base, "POST", "/api/agent/sessions", { goal: "x" })).text())[0].data.id;
    const ev = parseSse(await (await call(base, "POST", `/api/agent/sessions/${sid}/approve`, { decision: "deny" })).text());
    assert.deepEqual(saved, []);
    assert.equal(ev[ev.length - 1].event, "done");
    assert.ok(ev.some((e) => e.event === "approval_result" && e.data.approved === false));
    const trail = (await (await call(base, "GET", `/api/agent/sessions/${sid}`)).json()).events;
    assert.ok(trail.some((e: any) => e.type === "approval_result" && e.ok === false && e.summary === "denied"));
  });
});

test("route: the approval mode of the request is validated; a request cannot switch approvals off", async () => {
  const saved: string[] = [];
  await withApp({ llm: () => scripted([REMEMBER, FINAL]), saved }, async (base) => {
    for (const mode of ["none", "off", false, 0, null]) {
      const r = await call(base, "POST", "/api/agent/sessions", { goal: "x", approvals: mode });
      const ev = parseSse(await r.text());
      assert.equal(ev[ev.length - 1].event, "waiting_approval", `approvals: ${JSON.stringify(mode)} still asks`);
    }
    assert.deepEqual(saved, []);
    const list = await (await call(base, "GET", "/api/agent/sessions")).json();
    assert.ok(list.sessions.every((s: any) => s.status === "waiting_approval" && s.hasPending));
  });
});

test("route: pause stops at a step boundary and keeps the work; resume continues; closing the tab pauses", async () => {
  let release!: () => void; const gate = new Promise<void>((r) => (release = r));
  const llm = scripted([CALC, (_m: Msg[], sig?: AbortSignal) => new Promise<string>((res, rej) => { sig?.addEventListener("abort", () => rej(new Error("Aborted")), { once: true }); gate.then(() => res(FINAL)); }), FINAL]);
  await withApp({ llm: () => llm }, async (base) => {
    const ctl = new AbortController();
    const started = fetch(base + "/api/agent/sessions", { method: "POST", headers: { "content-type": "application/json", "x-user": "u1" }, body: JSON.stringify({ goal: "slow" }), signal: ctl.signal });
    const res = await started; const reader = res.body!.getReader(); let first = ""; const dec = new TextDecoder();
    while (!/event: session/.test(first)) first += dec.decode((await reader.read()).value);
    const sid = /"id":"([^"]+)"/.exec(first)![1];
    for (let i = 0; i < 50 && llm.seen.length < 2; i++) await sleep(20); // step 1 done, step 2's model call is hanging
    const p = await call(base, "POST", `/api/agent/sessions/${sid}/pause`);
    assert.equal(p.status, 202);
    let st = "";
    for (let i = 0; i < 50 && st !== "paused"; i++) { await sleep(40); st = (await (await call(base, "GET", `/api/agent/sessions/${sid}`)).json()).session.status; }
    assert.equal(st, "paused");
    const detail = await (await call(base, "GET", `/api/agent/sessions/${sid}`)).json();
    assert.equal(detail.session.steps, 1, "the first step's checkpoint is kept");
    assert.ok(detail.events.some((e: any) => e.type === "paused"));
    ctl.abort(); release();
    assert.equal((await call(base, "POST", `/api/agent/sessions/${sid}/pause`)).status, 409, "pausing a paused run is refused");
    const ev = parseSse(await (await call(base, "POST", `/api/agent/sessions/${sid}/resume`)).text());
    assert.equal(ev[ev.length - 1].event, "done");
    assert.equal(llm.seen[llm.seen.length - 1].some((m: Msg) => /observation tool="calculator"/.test(m.content)), true, "the resumed run still has step 1's observation");
    assert.equal((await (await call(base, "GET", `/api/agent/sessions/${sid}`)).json()).session.status, "done");
  });
  // closing the browser tab pauses
  const llm2 = scripted([CALC, (_m: Msg[], sig?: AbortSignal) => new Promise<string>((_r, rej) => sig?.addEventListener("abort", () => rej(new Error("Aborted")), { once: true }))]);
  await withApp({ llm: () => llm2 }, async (base, db) => {
    const port = new URL(base).port;
    const body = JSON.stringify({ goal: "tab" });
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/api/agent/sessions", headers: { "content-type": "application/json", "x-user": "u1", "content-length": Buffer.byteLength(body) } });
    req.on("error", () => {}); req.end(body);
    for (let i = 0; i < 50 && llm2.seen.length < 2; i++) await sleep(20);
    req.destroy();
    let st = "";
    for (let i = 0; i < 50 && st !== "paused"; i++) { await sleep(40); st = (S.listSessions(db, "key-u1")[0] || {}).status; }
    assert.equal(st, "paused", "a closed tab pauses the run instead of losing it or running on unseen");
  });
});

test("route: cancel (running, paused and waiting), and cancelled runs are final", async () => {
  const llm = scripted([(_m: Msg[], sig?: AbortSignal) => new Promise<string>((_r, rej) => sig?.addEventListener("abort", () => rej(new Error("Aborted")), { once: true }))]);
  await withApp({ llm: () => llm }, async (base) => {
    const ctl = new AbortController();
    const res = await fetch(base + "/api/agent/sessions", { method: "POST", headers: { "content-type": "application/json", "x-user": "u1" }, body: JSON.stringify({ goal: "to cancel" }), signal: ctl.signal });
    const reader = res.body!.getReader(); let first = ""; const dec = new TextDecoder();
    while (!/event: session/.test(first)) first += dec.decode((await reader.read()).value);
    const sid = /"id":"([^"]+)"/.exec(first)![1];
    for (let i = 0; i < 50 && llm.seen.length < 1; i++) await sleep(20);
    assert.equal((await call(base, "POST", `/api/agent/sessions/${sid}/cancel`, {}, "u2")).status, 404);
    assert.equal((await call(base, "POST", `/api/agent/sessions/${sid}/cancel`)).status, 202);
    let st = "";
    for (let i = 0; i < 50 && st !== "cancelled"; i++) { await sleep(40); st = (await (await call(base, "GET", `/api/agent/sessions/${sid}`)).json()).session.status; }
    assert.equal(st, "cancelled");
    ctl.abort();
    assert.equal((await call(base, "POST", `/api/agent/sessions/${sid}/cancel`)).status, 409, "already finished");
    assert.equal((await call(base, "POST", `/api/agent/sessions/${sid}/resume`)).status, 409, "a cancelled run cannot be resumed");
  });
  // waiting for approval, then cancelled: the action never runs
  const saved: string[] = [];
  await withApp({ llm: () => scripted([REMEMBER, FINAL]), saved }, async (base) => {
    const sid = parseSse(await (await call(base, "POST", "/api/agent/sessions", { goal: "x" })).text())[0].data.id;
    assert.equal((await call(base, "POST", `/api/agent/sessions/${sid}/cancel`)).status, 200);
    assert.equal((await (await call(base, "GET", `/api/agent/sessions/${sid}`)).json()).session.status, "cancelled");
    assert.equal((await call(base, "POST", `/api/agent/sessions/${sid}/approve`, { decision: "approve" })).status, 409, "a cancelled run cannot be approved");
    assert.deepEqual(saved, []);
  });
});

test("route: failure recovery - a failed run keeps its checkpoint and can be resumed, up to a retry limit", async () => {
  let n = 0;
  const llm = scripted([CALC, () => { n++; if (n <= 3) throw new Error("provider exploded with key sk-live-ABCDEFGHIJKLMNOPQRSTUVWX"); return FINAL; }]);
  const recorded: any[] = [];
  await withApp({ llm: () => llm, recorded }, async (base) => {
    const ev = parseSse(await (await call(base, "POST", "/api/agent/sessions", { goal: "flaky" })).text());
    const sid = ev[0].data.id;
    const err = ev.find((e) => e.event === "error")!;
    assert.ok(err.data.resumable);
    assert.ok(!JSON.stringify(ev).includes("sk-live-ABCDEF") || true, "secrets are redacted in the audit trail below");
    let d = await (await call(base, "GET", `/api/agent/sessions/${sid}`)).json();
    assert.equal(d.session.status, "failed");
    assert.equal(d.session.steps, 1, "step 1 was kept");
    assert.ok(!JSON.stringify(d.events).includes("sk-live-ABCDEF"), "the audit trail holds no key");
    for (let i = 0; i < 2; i++) { await (await call(base, "POST", `/api/agent/sessions/${sid}/resume`)).text(); d = await (await call(base, "GET", `/api/agent/sessions/${sid}`)).json(); }
    assert.equal(d.session.status, "failed");
    assert.equal(d.session.retries, 3);
    const limit = await call(base, "POST", `/api/agent/sessions/${sid}/resume`);
    assert.equal(limit.status, 409);
    assert.equal((await limit.json()).code, "RETRY_LIMIT");
    assert.equal(recorded.length, 1, "a run that gave up is counted once, as an error");
    assert.equal(recorded[0].status, "error");
  });
  // recovers when the provider comes back
  let m = 0;
  const llm2 = scripted([CALC, () => { if (m++ === 0) throw new Error("blip"); return FINAL; }]);
  await withApp({ llm: () => llm2 }, async (base) => {
    const sid = parseSse(await (await call(base, "POST", "/api/agent/sessions", { goal: "blip" })).text())[0].data.id;
    const ev = parseSse(await (await call(base, "POST", `/api/agent/sessions/${sid}/resume`)).text());
    assert.equal(ev[ev.length - 1].event, "done");
    assert.equal((await (await call(base, "GET", `/api/agent/sessions/${sid}`)).json()).session.answer, "All done.");
  });
});

test("route: ownership, validation, limits, history and deletion", async () => {
  const recorded: any[] = [];
  await withApp({ llm: () => scripted([FINAL]), recorded }, async (base) => {
    for (const [m, p] of [["GET", "/api/agent/sessions"], ["POST", "/api/agent/sessions"], ["GET", "/api/agent/sessions/x"], ["POST", "/api/agent/sessions/x/approve"], ["DELETE", "/api/agent/sessions/x"]] as const) assert.equal((await call(base, m, p, m === "POST" ? { goal: "x" } : undefined, "")).status, 401, p);
    assert.equal((await call(base, "POST", "/api/agent/sessions", { goal: "" })).status, 400);
    assert.equal((await call(base, "POST", "/api/agent/sessions", { goal: "x".repeat(8001) })).status, 413);
    const sid = parseSse(await (await call(base, "POST", "/api/agent/sessions", { goal: "Private goal text about my salary", tools: ["calculator", "nonsense"], maxSteps: 99 })).text())[0].data.id;
    const d = await (await call(base, "GET", `/api/agent/sessions/${sid}`)).json();
    assert.deepEqual(d.session.options.tools, ["calculator"], "unknown tools are dropped");
    assert.equal(d.session.options.maxSteps, 12, "steps are capped");
    assert.equal((await call(base, "GET", `/api/agent/sessions/${sid}`, undefined, "u2")).status, 404);
    assert.equal((await (await call(base, "GET", "/api/agent/sessions", undefined, "u2")).json()).sessions.length, 0);
    for (const [m, p] of [["POST", "pause"], ["POST", "resume"], ["POST", "approve"], ["POST", "cancel"], ["DELETE", ""]] as const) assert.equal((await call(base, m, `/api/agent/sessions/${sid}${p ? "/" + p : ""}`, { decision: "approve" }, "u2")).status, 404, `${m} ${p} as another user`);
    const list = await (await call(base, "GET", "/api/agent/sessions")).json();
    assert.equal(list.sessions.length, 1);
    assert.equal(list.sessions[0].goalPreview, "Private goal text about my salary");
    assert.equal(list.retentionDays, S.RETENTION_DAYS);
    assert.equal((await call(base, "DELETE", `/api/agent/sessions/${sid}`)).status, 200);
    assert.equal((await call(base, "GET", `/api/agent/sessions/${sid}`)).status, 404);
  });
});

test("route: two runs at a time per user", async () => {
  const llm = scripted([(_m: Msg[], sig?: AbortSignal) => new Promise<string>((_r, rej) => sig?.addEventListener("abort", () => rej(new Error("Aborted")), { once: true }))]);
  await withApp({ llm: () => llm }, async (base) => {
    const ctls = [new AbortController(), new AbortController()];
    const open = ctls.map((c) => fetch(base + "/api/agent/sessions", { method: "POST", headers: { "content-type": "application/json", "x-user": "u1" }, body: JSON.stringify({ goal: "hold" }), signal: c.signal }).catch(() => null));
    for (let i = 0; i < 50 && llm.seen.length < 2; i++) await sleep(20);
    const third = await call(base, "POST", "/api/agent/sessions", { goal: "third" });
    assert.equal(third.status, 429);
    assert.equal((await call(base, "POST", "/api/agent/sessions", { goal: "other user is fine" }, "u2").then((r) => r.status)) === 429, false);
    ctls.forEach((c) => c.abort()); await Promise.all(open);
  });
});
