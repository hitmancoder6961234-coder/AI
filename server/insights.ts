import type { DatabaseSync } from "node:sqlite";

/**
 * Numbers behind the Agent Workflow and Models pages. Everything is counted from stored data for ONE user; nothing here is invented:
 *  - agent runs are recorded when they finish (when, how long, how many steps, which tools, whether each tool call succeeded). The goal and the
 *    tool outputs are NOT stored, so this table holds no prompt content;
 *  - model usage is counted from the user's own stored messages. Providers' token counts are not recorded anywhere, so tokens are an
 *    ESTIMATE (characters / 4, assistant text only) and the API says so (`tokensAreEstimated`).
 */

const DAY = 86_400_000;
const num = (v: unknown) => Number(v) || 0;

export function ensureInsightsTables(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    steps INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    tool_calls TEXT NOT NULL DEFAULT '[]'
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_agent_runs_user_time ON agent_runs (user_id, started_at)");
}

export type RunStatus = "ok" | "error" | "cancelled";
export interface AgentRunRecord {
  id: string;
  userId: string;
  startedAt: number;
  durationMs: number;
  status: RunStatus;
  steps: number;
  model?: string;
  /** one entry per tool call: the tool's name and whether it succeeded */
  toolCalls: Array<{ tool: string; ok: boolean }>;
}

export function recordAgentRun(db: DatabaseSync, r: AgentRunRecord): void {
  const calls = r.toolCalls.slice(0, 200).map((c) => ({ tool: String(c.tool).slice(0, 60), ok: !!c.ok }));
  db.prepare("INSERT OR REPLACE INTO agent_runs (id, user_id, started_at, duration_ms, status, steps, model, tool_calls) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(r.id, r.userId, Math.round(r.startedAt), Math.max(0, Math.round(r.durationMs)), r.status, Math.max(0, Math.round(r.steps)), r.model ? String(r.model).slice(0, 80) : null, JSON.stringify(calls));
}

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
/** First instant of the oldest day in the window. Days are UTC days everywhere here (the SQL groups by UTC day too), so no day is lost or doubled by the server's time zone. */
function windowStart(days: number, now: number): number {
  return Math.floor((now - (days - 1) * DAY) / DAY) * DAY;
}
export const clampDays = (v: unknown) => Math.min(90, Math.max(7, Math.floor(Number(v) || 14)));

export interface AgentStats {
  days: number;
  totals: { runs: number; ok: number; failed: number; cancelled: number; successRate: number | null; errorRate: number | null; avgSteps: number | null; avgDurationMs: number | null };
  series: Array<{ day: string; runs: number; ok: number; failed: number; avgDurationMs: number | null }>;
  /** the tools the agent actually called in the window, busiest first */
  tools: Array<{ tool: string; calls: number; errors: number }>;
  recent: Array<{ id: string; startedAt: number; durationMs: number; status: RunStatus; steps: number; toolsUsed: string[] }>;
}

export function agentStats(db: DatabaseSync, userId: string, days: number, now = Date.now()): AgentStats {
  const since = windowStart(days, now);
  const rows = db.prepare("SELECT id, started_at, duration_ms, status, steps, tool_calls FROM agent_runs WHERE user_id = ? AND started_at >= ? ORDER BY started_at DESC").all(userId, since) as any[];
  const byDay = new Map<string, { runs: number; ok: number; failed: number; ms: number; msN: number }>();
  for (let i = 0; i < days; i++) byDay.set(dayKey(since + i * DAY), { runs: 0, ok: 0, failed: 0, ms: 0, msN: 0 });
  const tools = new Map<string, { calls: number; errors: number }>();
  let ok = 0, failed = 0, cancelled = 0, steps = 0, ms = 0;
  for (const r of rows) {
    const cell = byDay.get(dayKey(num(r.started_at)));
    if (r.status === "ok") ok++; else if (r.status === "cancelled") cancelled++; else failed++;
    steps += num(r.steps); ms += num(r.duration_ms);
    if (cell) {
      cell.runs++;
      if (r.status === "ok") cell.ok++; else if (r.status !== "cancelled") cell.failed++;
      cell.ms += num(r.duration_ms); cell.msN++;
    }
    let calls: Array<{ tool: string; ok: boolean }> = [];
    try { calls = JSON.parse(r.tool_calls || "[]"); } catch { /* a damaged row counts as having no tool calls */ }
    for (const c of calls) {
      const t = tools.get(c.tool) || { calls: 0, errors: 0 };
      t.calls++; if (!c.ok) t.errors++;
      tools.set(c.tool, t);
    }
  }
  const n = rows.length;
  const finished = ok + failed; // a cancelled run is neither a success nor a failure
  return {
    days,
    totals: {
      runs: n, ok, failed, cancelled,
      successRate: finished ? ok / finished : null,
      errorRate: finished ? failed / finished : null,
      avgSteps: n ? steps / n : null,
      avgDurationMs: n ? ms / n : null,
    },
    series: [...byDay.entries()].map(([day, c]) => ({ day, runs: c.runs, ok: c.ok, failed: c.failed, avgDurationMs: c.msN ? c.ms / c.msN : null })),
    tools: [...tools.entries()].map(([tool, c]) => ({ tool, ...c })).sort((a, b) => b.calls - a.calls).slice(0, 20),
    recent: rows.slice(0, 8).map((r) => {
      let used: string[] = [];
      try { used = [...new Set((JSON.parse(r.tool_calls || "[]") as Array<{ tool: string }>).map((c) => c.tool))].slice(0, 6); } catch { /* none */ }
      return { id: r.id, startedAt: num(r.started_at), durationMs: num(r.duration_ms), status: r.status, steps: num(r.steps), toolsUsed: used };
    }),
  };
}

export interface ModelUsage {
  days: number;
  tokensAreEstimated: true;
  tokenMethod: string;
  models: Array<{
    id: string; name: string; calls: number; estimatedTokens: number; lastUsedAt: number | null;
    /** calls per day over the window, oldest first */
    series: number[];
  }>;
  totals: { calls: number; estimatedTokens: number };
}

/** Per-model usage from the user's stored messages (main chat and Copilot). Tokens are estimated from text length. */
export function modelUsage(db: DatabaseSync, userId: string, days: number, now = Date.now()): ModelUsage {
  const since = windowStart(days, now);
  const labels = new Map<string, string>();
  for (const r of db.prepare("SELECT id, name FROM models WHERE user_id = ?").all(userId) as any[]) labels.set(String(r.id), String(r.name || r.id));
  const acc = new Map<string, { calls: number; chars: number; last: number; series: number[] }>();
  const slot = (id: string) => { let a = acc.get(id); if (!a) { a = { calls: 0, chars: 0, last: 0, series: new Array(days).fill(0) }; acc.set(id, a); } return a; };
  const add = (r: any, fallback: string) => {
    const id = String(r.model || fallback);
    const a = slot(id);
    a.calls += num(r.n); a.chars += num(r.chars); a.last = Math.max(a.last, num(r.last));
    const idx = Math.floor((Date.parse(String(r.day) + "T00:00:00Z") - Date.parse(dayKey(since) + "T00:00:00Z")) / DAY);
    if (idx >= 0 && idx < days) a.series[idx] += num(r.n);
  };
  for (const r of db.prepare(`SELECT COALESCE(NULLIF(m.model_id, ''), 'unknown') AS model, strftime('%Y-%m-%d', m.created_at / 1000, 'unixepoch') AS day,
        COUNT(*) AS n, SUM(LENGTH(m.content)) AS chars, MAX(m.created_at) AS last
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.user_id = ? AND m.role = 'assistant' AND m.created_at >= ? GROUP BY model, day`).all(userId, since) as any[]) add(r, "unknown");
  for (const r of db.prepare(`SELECT COALESCE(NULLIF(model, ''), 'copilot') AS model, strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day,
        COUNT(*) AS n, SUM(LENGTH(content)) AS chars, MAX(created_at) AS last
      FROM copilot_messages WHERE user_id = ? AND role = 'assistant' AND created_at >= ? GROUP BY model, day`).all(userId, since) as any[]) add(r, "copilot");
  const models = [...acc.entries()].map(([id, a]) => ({
    id, name: labels.get(id) || (id === "unknown" ? "Unknown model" : id),
    calls: a.calls, estimatedTokens: Math.round(a.chars / 4), lastUsedAt: a.last || null, series: a.series,
  })).sort((x, y) => y.calls - x.calls);
  return {
    days, tokensAreEstimated: true, tokenMethod: "characters / 4, assistant replies only (providers' own token counts are not recorded)",
    models, totals: { calls: models.reduce((s, m) => s + m.calls, 0), estimatedTokens: models.reduce((s, m) => s + m.estimatedTokens, 0) },
  };
}
