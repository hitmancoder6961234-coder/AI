import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const { ensureInsightsTables, recordAgentRun, agentStats, modelUsage, clampDays } = await import("../server/insights.js");

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 5, 12, 0, 0); // 5 Nov 2026 12:00 UTC

function makeDb() {
  const db = new DatabaseSync(":memory:");
  ensureInsightsTables(db);
  db.exec(`CREATE TABLE conversations (id TEXT PRIMARY KEY, user_id TEXT);
    CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT, model_id TEXT, created_at INTEGER);
    CREATE TABLE copilot_messages (id TEXT PRIMARY KEY, user_id TEXT, role TEXT, content TEXT, model TEXT, created_at INTEGER);
    CREATE TABLE models (id TEXT, user_id TEXT, name TEXT)`);
  return db;
}
const run = (db: DatabaseSync, o: Partial<Parameters<typeof recordAgentRun>[1]> & { id: string }) =>
  recordAgentRun(db, { userId: "u1", startedAt: NOW - 1000, durationMs: 2000, status: "ok", steps: 3, toolCalls: [], ...o });

test("clampDays keeps the window between 7 and 90 days", () => {
  assert.equal(clampDays(undefined), 14);
  assert.equal(clampDays("3"), 7);
  assert.equal(clampDays(500), 90);
  assert.equal(clampDays("30"), 30);
});

test("agent stats: counts, rates, averages, per-day series and tools come from recorded runs only", () => {
  const db = makeDb();
  run(db, { id: "a", toolCalls: [{ tool: "web_search", ok: true }, { tool: "read_file", ok: false }], steps: 4, durationMs: 4000 });
  run(db, { id: "b", status: "error", steps: 1, durationMs: 1000, startedAt: NOW - DAY, toolCalls: [{ tool: "web_search", ok: false }] });
  run(db, { id: "c", status: "cancelled", steps: 2, durationMs: 3000, startedAt: NOW - 2 * DAY });
  run(db, { id: "d", steps: 2, durationMs: 2000, startedAt: NOW - 3 * DAY });
  run(db, { id: "old", startedAt: NOW - 40 * DAY }); // outside a 14-day window
  const s = agentStats(db, "u1", 14, NOW);
  assert.equal(s.totals.runs, 4);
  assert.deepEqual([s.totals.ok, s.totals.failed, s.totals.cancelled], [2, 1, 1]);
  assert.ok(Math.abs(s.totals.successRate! - 2 / 3) < 1e-9, "a cancelled run is neither a success nor a failure");
  assert.ok(Math.abs(s.totals.errorRate! - 1 / 3) < 1e-9);
  assert.equal(s.totals.avgSteps, (4 + 1 + 2 + 2) / 4);
  assert.equal(s.totals.avgDurationMs, (4000 + 1000 + 3000 + 2000) / 4);
  assert.equal(s.series.length, 14);
  assert.equal(s.series.reduce((x, d) => x + d.runs, 0), 4);
  assert.deepEqual(s.tools, [{ tool: "web_search", calls: 2, errors: 1 }, { tool: "read_file", calls: 1, errors: 1 }]);
  assert.equal(s.recent[0].id, "a", "newest first");
  assert.deepEqual(s.recent[0].toolsUsed.sort(), ["read_file", "web_search"]);
});

test("agent stats: no runs means null rates (not zero and not made up), and users never see each other's runs", () => {
  const db = makeDb();
  const empty = agentStats(db, "u1", 14, NOW);
  assert.equal(empty.totals.runs, 0);
  assert.equal(empty.totals.successRate, null);
  assert.equal(empty.totals.avgDurationMs, null);
  assert.deepEqual(empty.tools, []);
  run(db, { id: "x", userId: "u2" });
  assert.equal(agentStats(db, "u1", 14, NOW).totals.runs, 0);
  assert.equal(agentStats(db, "u2", 14, NOW).totals.runs, 1);
});

test("a damaged tool_calls value does not break the statistics", () => {
  const db = makeDb();
  run(db, { id: "ok1" });
  db.prepare("UPDATE agent_runs SET tool_calls = 'not json' WHERE id = 'ok1'").run();
  const s = agentStats(db, "u1", 14, NOW);
  assert.equal(s.totals.runs, 1);
  assert.deepEqual(s.tools, []);
});

test("the run record holds no prompt content: only ids, times, counts, model and tool names", () => {
  const db = makeDb();
  run(db, { id: "r", model: "gemini-x", toolCalls: [{ tool: "web_search", ok: true }] });
  const row = db.prepare("SELECT * FROM agent_runs WHERE id = 'r'").get() as any;
  assert.deepEqual(Object.keys(row).sort(), ["duration_ms", "id", "model", "started_at", "status", "steps", "tool_calls", "user_id"]);
});

test("model usage: calls, estimated tokens, last used and a per-day series per model; labels from the user's own models; isolated per user", () => {
  const db = makeDb();
  db.exec("INSERT INTO conversations VALUES ('c1','u1'), ('c2','u2')");
  db.prepare("INSERT INTO models VALUES ('m1','u1','Fast model')").run();
  const msg = (id: string, conv: string, role: string, content: string, model: string, t: number) => db.prepare("INSERT INTO messages VALUES (?,?,?,?,?,?)").run(id, conv, role, content, model, t);
  msg("1", "c1", "assistant", "x".repeat(400), "m1", NOW - 1000);
  msg("2", "c1", "assistant", "y".repeat(200), "m1", NOW - DAY);
  msg("3", "c1", "user", "z".repeat(5000), "m1", NOW - 1000); // a prompt is not a model call
  msg("4", "c1", "assistant", "q".repeat(40), "", NOW - 2 * DAY); // unknown model
  msg("5", "c2", "assistant", "other user", "m1", NOW - 1000);
  db.prepare("INSERT INTO copilot_messages VALUES ('k1','u1','assistant','abcd','openai / gpt',?)").run(NOW - 1000);
  msg("old", "c1", "assistant", "old", "m1", NOW - 60 * DAY);
  const u = modelUsage(db, "u1", 14, NOW);
  assert.equal(u.tokensAreEstimated, true);
  assert.match(u.tokenMethod, /not recorded/);
  const m1 = u.models.find((m) => m.id === "m1")!;
  assert.equal(m1.name, "Fast model");
  assert.equal(m1.calls, 2);
  assert.equal(m1.estimatedTokens, 150, "(400 + 200) / 4: replies only");
  assert.equal(m1.lastUsedAt, NOW - 1000);
  assert.equal(m1.series.length, 14);
  assert.equal(m1.series.reduce((a, b) => a + b, 0), 2);
  assert.equal(u.models.find((m) => m.id === "unknown")!.name, "Unknown model");
  assert.equal(u.models.find((m) => m.id === "openai / gpt")!.calls, 1, "Copilot replies count too");
  assert.equal(u.totals.calls, 4);
  assert.deepEqual(u.models.map((m) => m.calls), [...u.models.map((m) => m.calls)].sort((a, b) => b - a), "busiest first");
  assert.equal(modelUsage(db, "nobody", 14, NOW).models.length, 0);
});
