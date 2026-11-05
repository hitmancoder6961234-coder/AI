import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { redact } from "../security/redact.js";
import type { AgentCheckpoint, PlanTask } from "./core.js";

/**
 * Durable agent sessions: what makes pause, resume, approvals, failure recovery and an execution history possible.
 *
 * A session stores the goal, the run's options, the plan, the latest CHECKPOINT (the model conversation and loop counters, written after every
 * completed step), any pending approval, the outcome, and an append-only EVENT log (the audit trail). Everything is scoped to the owner.
 *
 * What is stored, and what is not: the goal and the conversation live in the session so a run can continue; tool OUTPUTS are not written to
 * the event log (only whether each call succeeded and how long its output was), and tool arguments are redacted and truncated there. The user
 * can delete a session at any time; sessions older than RETENTION_DAYS are removed at start-up; the privacy export includes them and the
 * account erase deletes them.
 */

export type SessionStatus = "running" | "waiting_approval" | "paused" | "done" | "failed" | "cancelled";
export const RETENTION_DAYS = 30;
export const MAX_RETRIES = 3;
export const MAX_SESSIONS_PER_USER = 100;

export class SessionError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}

export interface SessionOptions { tools: string[]; approvals: "sensitive" | "all"; plan: boolean; maxSteps: number; provider?: string }

export interface SessionItem {
  id: string; status: SessionStatus; goal: string; options: SessionOptions; plan: PlanTask[] | null; done: number[];
  pending: { id: string; tool: string; args: unknown; reason: string; step: number } | null;
  answer: string; error: string; steps: number; retries: number; model: string | null; createdAt: number; updatedAt: number; finishedAt: number | null;
}
export interface SessionEvent { seq: number; ts: number; type: string; tool: string | null; summary: string; ok: boolean | null }

export function ensureSessionTables(db: DatabaseSync, now = Date.now()): void {
  db.exec(`CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    goal TEXT NOT NULL,
    options TEXT NOT NULL,
    plan TEXT,
    done TEXT NOT NULL DEFAULT '[]',
    checkpoint TEXT,
    pending TEXT,
    answer TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    steps INTEGER NOT NULL DEFAULT 0,
    retries INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    finished_at INTEGER
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_updated ON agent_sessions (user_id, updated_at)");
  db.exec(`CREATE TABLE IF NOT EXISTS agent_events (
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    tool TEXT,
    summary TEXT NOT NULL DEFAULT '',
    ok INTEGER,
    PRIMARY KEY (session_id, seq)
  )`);
  // A run that was "running" when the process stopped cannot still be running: mark it interrupted so the user can resume it from its checkpoint.
  const orphans = db.prepare("SELECT id, user_id FROM agent_sessions WHERE status = 'running'").all() as any[];
  for (const o of orphans) {
    db.prepare("UPDATE agent_sessions SET status = 'failed', error = 'Interrupted by a server restart. Resume to continue from the last checkpoint.', updated_at = ? WHERE id = ?").run(now, o.id);
    appendEvent(db, o.user_id, o.id, { type: "interrupted", summary: "The server restarted while this run was in progress." }, now);
  }
  purgeOldSessions(db, RETENTION_DAYS, now);
}

export function purgeOldSessions(db: DatabaseSync, days: number, now = Date.now()): number {
  const cutoff = now - days * 86_400_000;
  const ids = (db.prepare("SELECT id FROM agent_sessions WHERE updated_at < ? AND status NOT IN ('running')").all(cutoff) as any[]).map((r) => r.id);
  for (const id of ids) { db.prepare("DELETE FROM agent_events WHERE session_id = ?").run(id); db.prepare("DELETE FROM agent_sessions WHERE id = ?").run(id); }
  return ids.length;
}

const safeJson = <T>(s: unknown, fallback: T): T => { try { return s ? (JSON.parse(String(s)) as T) : fallback; } catch { return fallback; } };

function toItem(r: any): SessionItem {
  const pending = safeJson<any>(r.pending, null);
  return {
    id: String(r.id), status: r.status, goal: String(r.goal), options: safeJson<SessionOptions>(r.options, { tools: [], approvals: "sensitive", plan: false, maxSteps: 8 }),
    plan: safeJson<PlanTask[] | null>(r.plan, null), done: safeJson<number[]>(r.done, []),
    pending: pending ? { id: pending.id, tool: pending.tool, args: pending.args, reason: pending.reason, step: pending.step } : null,
    answer: String(r.answer || ""), error: String(r.error || ""), steps: Number(r.steps) || 0, retries: Number(r.retries) || 0, model: r.model || null,
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), finishedAt: r.finished_at == null ? null : Number(r.finished_at),
  };
}

export function createSession(db: DatabaseSync, userId: string, input: { goal: string; options: SessionOptions }, now = Date.now()): SessionItem {
  const count = Number((db.prepare("SELECT COUNT(*) AS n FROM agent_sessions WHERE user_id = ?").get(userId) as any).n);
  if (count >= MAX_SESSIONS_PER_USER) throw new SessionError("LIMIT_REACHED", `You can keep up to ${MAX_SESSIONS_PER_USER} saved runs. Delete some you no longer need.`);
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO agent_sessions (id, user_id, status, goal, options, created_at, updated_at) VALUES (?, ?, 'running', ?, ?, ?, ?)").run(id, userId, input.goal, JSON.stringify(input.options), now, now);
  appendEvent(db, userId, id, { type: "created", summary: `Run started (${input.options.approvals === "all" ? "asks before every tool call" : "asks before actions that change your data"}${input.options.plan ? ", with a plan" : ""})` }, now);
  return getSession(db, userId, id)!;
}

export function getSession(db: DatabaseSync, userId: string, id: string): SessionItem | null {
  const r = db.prepare("SELECT * FROM agent_sessions WHERE id = ? AND user_id = ?").get(String(id), userId) as any;
  return r ? toItem(r) : null;
}
export function getCheckpoint(db: DatabaseSync, userId: string, id: string): AgentCheckpoint | null {
  const r = db.prepare("SELECT checkpoint FROM agent_sessions WHERE id = ? AND user_id = ?").get(String(id), userId) as any;
  return r ? safeJson<AgentCheckpoint | null>(r.checkpoint, null) : null;
}

export function listSessions(db: DatabaseSync, userId: string, opts: { status?: string; limit?: number } = {}): SessionItem[] {
  const limit = Math.min(100, Math.max(1, Math.floor(Number(opts.limit) || 30)));
  const rows = opts.status
    ? db.prepare("SELECT * FROM agent_sessions WHERE user_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?").all(userId, opts.status, limit)
    : db.prepare("SELECT * FROM agent_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?").all(userId, limit);
  return (rows as any[]).map(toItem);
}

export interface SessionPatch {
  status?: SessionStatus; plan?: PlanTask[] | null; done?: number[]; checkpoint?: AgentCheckpoint | null; pending?: SessionItem["pending"] | (NonNullable<AgentCheckpoint["pending"]>) | null;
  answer?: string; error?: string; steps?: number; retries?: number; model?: string | null;
}
export function updateSession(db: DatabaseSync, userId: string, id: string, patch: SessionPatch, now = Date.now()): SessionItem | null {
  const sets: string[] = [], args: any[] = [];
  const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); args.push(v); };
  if (patch.status !== undefined) { set("status", patch.status); if (["done", "failed", "cancelled"].includes(patch.status)) set("finished_at", now); else set("finished_at", null); }
  if (patch.plan !== undefined) set("plan", patch.plan ? JSON.stringify(patch.plan) : null);
  if (patch.done !== undefined) set("done", JSON.stringify(patch.done));
  if (patch.checkpoint !== undefined) set("checkpoint", patch.checkpoint ? JSON.stringify(patch.checkpoint) : null);
  if (patch.pending !== undefined) set("pending", patch.pending ? JSON.stringify({ id: patch.pending.id, tool: patch.pending.tool, args: patch.pending.args, reason: patch.pending.reason, step: patch.pending.step }) : null);
  if (patch.answer !== undefined) set("answer", patch.answer.slice(0, 60_000));
  if (patch.error !== undefined) set("error", patch.error.slice(0, 400));
  if (patch.steps !== undefined) set("steps", patch.steps);
  if (patch.retries !== undefined) set("retries", patch.retries);
  if (patch.model !== undefined) set("model", patch.model);
  set("updated_at", now);
  db.prepare(`UPDATE agent_sessions SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...args, String(id), userId);
  return getSession(db, userId, id);
}

export function deleteSession(db: DatabaseSync, userId: string, id: string): boolean {
  const s = getSession(db, userId, id);
  if (!s) return false;
  if (s.status === "running") throw new SessionError("RUNNING", "Stop the run before deleting it.");
  db.prepare("DELETE FROM agent_events WHERE session_id = ? AND user_id = ?").run(s.id, userId);
  return Number((db.prepare("DELETE FROM agent_sessions WHERE id = ? AND user_id = ?").run(s.id, userId) as any).changes) > 0;
}

// ---- state machine -----------------------------------------------------------------------------------------------------------------------

/** Which actions the user may take in which state. */
export function assertCanContinue(s: SessionItem, action: "approve" | "resume" | "pause" | "cancel"): void {
  const bad = (code: string, msg: string) => { throw new SessionError(code, msg); };
  switch (action) {
    case "approve": if (s.status !== "waiting_approval") bad("NOT_WAITING", "This run is not waiting for an approval."); break;
    case "resume":
      if (s.status === "failed" && s.retries >= MAX_RETRIES) bad("RETRY_LIMIT", `This run has failed ${MAX_RETRIES} times. Start a new run instead.`);
      if (s.status !== "paused" && s.status !== "failed") bad("NOT_RESUMABLE", s.status === "waiting_approval" ? "Approve or deny the pending action first." : "Only a paused or failed run can be resumed.");
      break;
    case "pause": if (s.status !== "running") bad("NOT_RUNNING", "Only a running run can be paused."); break;
    case "cancel": if (s.status === "done" || s.status === "cancelled") bad("FINISHED", "This run has already finished."); break;
  }
}

// ---- audit trail -------------------------------------------------------------------------------------------------------------------------

const clean = (s: string, n: number) => redact(String(s)).replace(/\s+/g, " ").trim().slice(0, n);

export function appendEvent(db: DatabaseSync, userId: string, sessionId: string, e: { type: string; tool?: string; summary?: string; ok?: boolean }, now = Date.now()): void {
  const next = Number((db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM agent_events WHERE session_id = ?").get(sessionId) as any).n);
  db.prepare("INSERT INTO agent_events (session_id, user_id, seq, ts, type, tool, summary, ok) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(sessionId, userId, next, now, e.type.slice(0, 40), e.tool ? e.tool.slice(0, 60) : null, clean(e.summary || "", 220), e.ok == null ? null : e.ok ? 1 : 0);
  db.prepare("DELETE FROM agent_events WHERE session_id = ? AND seq <= ?").run(sessionId, next - 600); // bound the log of one run
}
export function listEvents(db: DatabaseSync, userId: string, sessionId: string, limit = 300): SessionEvent[] | null {
  if (!getSession(db, userId, sessionId)) return null;
  return (db.prepare("SELECT seq, ts, type, tool, summary, ok FROM agent_events WHERE session_id = ? AND user_id = ? ORDER BY seq ASC LIMIT ?").all(sessionId, userId, Math.min(600, limit)) as any[])
    .map((r) => ({ seq: Number(r.seq), ts: Number(r.ts), type: String(r.type), tool: r.tool || null, summary: String(r.summary || ""), ok: r.ok == null ? null : Number(r.ok) === 1 }));
}
/** Tool calls of a session with their outcome (for the usage statistics recorded when a run ends). */
export function toolOutcomes(db: DatabaseSync, userId: string, sessionId: string): Array<{ tool: string; ok: boolean }> {
  return (db.prepare("SELECT tool, ok FROM agent_events WHERE session_id = ? AND user_id = ? AND type = 'tool_result'").all(sessionId, userId) as any[]).map((r) => ({ tool: String(r.tool), ok: Number(r.ok) === 1 }));
}
