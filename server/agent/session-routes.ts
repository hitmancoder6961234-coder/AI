import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { runAgent, type AgentEvent } from "./core.js";
import { normaliseMode } from "./policy.js";
import type { LLM } from "./providers.js";
import {
  appendEvent, assertCanContinue, createSession, deleteSession, getCheckpoint, getSession, listEvents, listSessions, SessionError, toolOutcomes,
  updateSession, MAX_RETRIES, RETENTION_DAYS, type SessionItem, type SessionOptions,
} from "./sessions.js";
import { SESSION_TOOLS, selectTools } from "./tools.js";

/**
 * Durable agent sessions over HTTP. Every route is scoped to the signed-in user; another user's session id answers 404.
 *
 *   POST   /api/agent/sessions                       start a run (streams events as SSE; the first event is "session")
 *   GET    /api/agent/sessions                       the user's runs, newest first
 *   GET    /api/agent/sessions/:id                   one run with its plan, pending approval and audit trail
 *   POST   /api/agent/sessions/:id/approve           { decision: "approve" | "deny" }   continue after an approval request (streams)
 *   POST   /api/agent/sessions/:id/resume            continue a paused or failed run from its last checkpoint (streams)
 *   POST   /api/agent/sessions/:id/pause             stop at the next step boundary; the work is kept
 *   POST   /api/agent/sessions/:id/cancel            end the run (the audit trail stays)
 *   DELETE /api/agent/sessions/:id                   delete the run and its trail
 *
 * Closing the browser tab pauses a running session (it is never lost and never keeps running unseen). A tool that changes saved data cannot run
 * without an explicit approve: that rule lives in the agent loop (core.ts / policy.ts), not in the page, so it holds for any client.
 */

const MAX_GOAL = 8_000;
const MAX_CONCURRENT_PER_USER = 2;

export interface SessionRouteDeps {
  db: DatabaseSync;
  /** database key of the user (sessions are stored under it) */
  getUserKey: (req: Request) => Promise<string | null>;
  /** the account's own user id (provider keys are looked up by it) */
  getUserId: (req: Request) => Promise<string | null>;
  getLLM: (userId: string, provider?: string) => LLM;
  knowledgeSearch?: (userId: string, query: string) => Promise<string>;
  /** save one memory note for the user; throws if the note is invalid or a duplicate (the message is shown to the model and the user) */
  saveMemoryNote: (userKey: string, content: string, category?: string) => string;
  /** usage statistics, called once when a run reaches a final state */
  recordRun?: (r: { id: string; userId: string; startedAt: number; durationMs: number; status: "ok" | "error" | "cancelled"; steps: number; model?: string; toolCalls: Array<{ tool: string; ok: boolean }> }) => void;
  now?: () => number;
}

export function registerSessionRoutes(app: Express, deps: SessionRouteDeps): void {
  const { db } = deps, now = deps.now ?? Date.now;
  const active = new Map<string, AbortController>();
  const running = new Map<string, number>();

  const notFound = (res: Response) => res.status(404).json({ error: "Not found", type: "not_found" });
  const fail = (res: Response, e: unknown) => { if (e instanceof SessionError) return res.status(e.status).json({ error: e.message, code: e.code }); throw e; };
  const scrub = (m: unknown) => String((m as any)?.message ?? m ?? "Run failed").replace(/\s+/g, " ").slice(0, 300);

  function parseOptions(body: any, all: string[]): SessionOptions {
    const tools = Array.isArray(body?.tools) ? body.tools.map(String).filter((n: string) => all.includes(n)) : all;
    const maxSteps = Math.min(12, Math.max(1, Math.floor(Number(body?.maxSteps) || 8)));
    return { tools: tools.length ? tools : all, approvals: normaliseMode(body?.approvals), plan: body?.plan === true, maxSteps, ...(typeof body?.provider === "string" ? { provider: body.provider.slice(0, 40) } : {}) };
  }

  /** Run (or continue) a session and stream its events. The session row is the source of truth; the stream is just a view of it. */
  async function drive(req: Request, res: Response, uid: string, rawId: string, session: SessionItem, how: "start" | "resume" | "approve", decision?: { approved: boolean }) {
    if ((running.get(uid) || 0) >= MAX_CONCURRENT_PER_USER) return res.status(429).json({ error: "Too many agent runs in progress", code: "AGENT_BUSY" });
    if (active.has(session.id)) return res.status(409).json({ error: "This run is already running.", code: "ALREADY_RUNNING" });
    let llm: LLM;
    try { llm = deps.getLLM(rawId, session.options.provider); } catch (err: any) { return res.status(503).json({ error: scrub(err), code: "NO_PROVIDER" }); }
    const tools = selectTools(session.options.tools, SESSION_TOOLS);
    const checkpoint = how === "start" ? null : getCheckpoint(db, uid, session.id);

    const ctl = new AbortController();
    active.set(session.id, ctl);
    running.set(uid, (running.get(uid) || 0) + 1);
    const started = now();
    updateSession(db, uid, session.id, { status: "running", error: "", ...(how === "approve" ? { pending: null } : {}) }, started);
    appendEvent(db, uid, session.id, { type: how === "start" ? "started" : how === "resume" ? "resumed" : "decision", summary: how === "approve" ? (decision?.approved ? "The user approved the action." : "The user denied the action.") : how === "resume" ? "Continuing from the last checkpoint." : "" }, started);

    res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const send = (event: string, data: unknown) => { if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    send("session", { id: session.id, status: "running" });
    // a closed tab pauses the run: its checkpoint is kept and it can be resumed, instead of working unseen
    res.on("close", () => { if (!res.writableEnded && !ctl.signal.aborted) ctl.abort("pause"); });

    const audit = (e: AgentEvent) => {
      switch (e.type) {
        case "start": updateSession(db, uid, session.id, { model: `${e.provider} / ${e.model}` }); appendEvent(db, uid, session.id, { type: "model", summary: `${e.provider} / ${e.model}` }); break;
        case "plan": appendEvent(db, uid, session.id, { type: "plan", summary: e.tasks.map((t) => `${t.n}. ${t.title}`).join(" · ") }); break;
        case "progress": updateSession(db, uid, session.id, { done: e.done }); appendEvent(db, uid, session.id, { type: "progress", summary: `${e.done.length} of ${e.total} planned tasks reported done` }); break;
        case "thought": appendEvent(db, uid, session.id, { type: "thought", summary: e.text }); break;
        case "tool_call": appendEvent(db, uid, session.id, { type: "tool_call", tool: e.tool, summary: JSON.stringify(e.args) }); break;
        case "tool_result": appendEvent(db, uid, session.id, { type: "tool_result", tool: e.tool, ok: e.ok, summary: e.ok ? `finished (${e.output.length} characters of output)` : "failed" }); break;
        case "approval_required": appendEvent(db, uid, session.id, { type: "approval_required", tool: e.tool, summary: `${e.reason} ${JSON.stringify(e.args)}` }); break;
        case "approval_result": appendEvent(db, uid, session.id, { type: "approval_result", tool: e.tool, ok: e.approved, summary: e.approved ? "approved" : "denied" }); break;
        case "final": appendEvent(db, uid, session.id, { type: "final", summary: `Finished after ${e.steps} step${e.steps === 1 ? "" : "s"}` }); break;
      }
    };
    const finish = (status: "ok" | "error" | "cancelled", steps: number) => {
      try { deps.recordRun?.({ id: session.id, userId: uid, startedAt: session.createdAt, durationMs: now() - session.createdAt, status, steps, model: getSession(db, uid, session.id)?.model || undefined, toolCalls: toolOutcomes(db, uid, session.id) }); } catch { /* statistics never break a run */ }
    };

    try {
      const result = await runAgent({
        llm, tools, goal: session.goal, maxSteps: session.options.maxSteps, signal: ctl.signal, plan: session.options.plan && how === "start", approvalMode: session.options.approvals,
        resume: checkpoint || undefined, decision, knowledgeSearch: deps.knowledgeSearch ? (q) => deps.knowledgeSearch!(rawId, q) : undefined,
        saveMemoryNote: (content, category) => deps.saveMemoryNote(uid, content, category), newId: () => crypto.randomUUID(),
        onEvent: (e) => { audit(e); send(e.type, e); },
        onCheckpoint: (cp) => { updateSession(db, uid, session.id, { checkpoint: cp, plan: cp.plan ?? null, done: cp.done ?? [], steps: cp.step, pending: cp.pending ?? null, status: cp.pending ? "waiting_approval" : "running" }); },
      });
      if (result.status === "waiting_approval") {
        send("waiting_approval", { id: session.id, pending: getSession(db, uid, session.id)?.pending });
      } else {
        updateSession(db, uid, session.id, { status: "done", answer: result.answer, steps: result.steps, pending: null, checkpoint: null });
        send("done", { id: session.id });
        finish("ok", result.steps);
      }
    } catch (err: any) {
      const reason = ctl.signal.aborted ? String(ctl.signal.reason) : "";
      const cur = getSession(db, uid, session.id);
      if (reason === "cancel") {
        updateSession(db, uid, session.id, { status: "cancelled", pending: null });
        appendEvent(db, uid, session.id, { type: "cancelled", summary: "The user cancelled the run." });
        send("cancelled", { id: session.id }); finish("cancelled", cur?.steps || 0);
      } else if (reason === "pause" || ctl.signal.aborted) {
        updateSession(db, uid, session.id, { status: "paused" });
        appendEvent(db, uid, session.id, { type: "paused", summary: "Paused. The work so far is saved." });
        send("paused", { id: session.id });
      } else {
        const message = scrub(err);
        updateSession(db, uid, session.id, { status: "failed", error: message, retries: (cur?.retries || 0) + 1 });
        appendEvent(db, uid, session.id, { type: "error", ok: false, summary: message });
        send("error", { type: "error", message, resumable: (cur?.retries || 0) + 1 < MAX_RETRIES });
        if ((cur?.retries || 0) + 1 >= MAX_RETRIES) finish("error", cur?.steps || 0);
      }
    } finally {
      active.delete(session.id);
      const n = (running.get(uid) || 1) - 1;
      if (n <= 0) running.delete(uid); else running.set(uid, n);
      if (!res.writableEnded) res.end();
    }
  }

  app.post("/api/agent/sessions", async (req, res) => {
    const uid = await deps.getUserKey(req), rawId = await deps.getUserId(req);
    if (!uid || !rawId) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
    if (!goal) return res.status(400).json({ error: "goal is required" });
    if (goal.length > MAX_GOAL) return res.status(413).json({ error: `goal is limited to ${MAX_GOAL} characters` });
    try {
      const options = parseOptions(req.body, SESSION_TOOLS.map((t) => t.name));
      const session = createSession(db, uid, { goal, options }, now());
      await drive(req, res, uid, rawId, session, "start");
    } catch (e) { if (!res.headersSent) return fail(res, e); throw e; }
  });

  app.get("/api/agent/sessions", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    const list = listSessions(db, uid, { status: typeof req.query.status === "string" ? req.query.status : undefined, limit: Number(req.query.limit) || undefined });
    res.json({ sessions: list.map((s) => ({ id: s.id, status: s.status, goalPreview: s.goal.slice(0, 140), steps: s.steps, model: s.model, hasPending: !!s.pending, createdAt: s.createdAt, updatedAt: s.updatedAt, finishedAt: s.finishedAt })), retentionDays: RETENTION_DAYS });
  });

  app.get("/api/agent/sessions/:id", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    const s = getSession(db, uid, String(req.params.id)); if (!s) return notFound(res);
    res.json({ session: s, events: listEvents(db, uid, s.id) || [], live: active.has(s.id), maxRetries: MAX_RETRIES });
  });

  const control = (action: "approve" | "resume") => async (req: Request, res: Response) => {
    const uid = await deps.getUserKey(req), rawId = await deps.getUserId(req);
    if (!uid || !rawId) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    const s = getSession(db, uid, String(req.params.id)); if (!s) return notFound(res);
    let decision: { approved: boolean } | undefined;
    try {
      assertCanContinue(s, action);
      if (action === "approve") {
        const d = req.body?.decision;
        if (d !== "approve" && d !== "deny") return res.status(400).json({ error: 'decision must be "approve" or "deny".', code: "INVALID_DECISION" });
        if (typeof req.body?.approvalId === "string" && s.pending && req.body.approvalId !== s.pending.id) return res.status(409).json({ error: "That approval request is no longer current.", code: "STALE_APPROVAL" });
        decision = { approved: d === "approve" };
      }
    } catch (e) { return fail(res, e); }
    await drive(req, res, uid, rawId, s, action, decision);
  };
  app.post("/api/agent/sessions/:id/approve", control("approve"));
  app.post("/api/agent/sessions/:id/resume", control("resume"));

  app.post("/api/agent/sessions/:id/pause", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    const s = getSession(db, uid, String(req.params.id)); if (!s) return notFound(res);
    try { assertCanContinue(s, "pause"); } catch (e) { return fail(res, e); }
    const ctl = active.get(s.id);
    if (!ctl) return res.status(409).json({ error: "This run is not running on this server.", code: "NOT_ACTIVE" });
    ctl.abort("pause");
    res.status(202).json({ ok: true, status: "pausing" });
  });

  app.post("/api/agent/sessions/:id/cancel", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    const s = getSession(db, uid, String(req.params.id)); if (!s) return notFound(res);
    try { assertCanContinue(s, "cancel"); } catch (e) { return fail(res, e); }
    const ctl = active.get(s.id);
    if (ctl) { ctl.abort("cancel"); return res.status(202).json({ ok: true, status: "cancelling" }); }
    updateSession(db, uid, s.id, { status: "cancelled", pending: null }, now());
    appendEvent(db, uid, s.id, { type: "cancelled", summary: "The user cancelled the run." }, now());
    try { deps.recordRun?.({ id: s.id, userId: uid, startedAt: s.createdAt, durationMs: now() - s.createdAt, status: "cancelled", steps: s.steps, model: s.model || undefined, toolCalls: toolOutcomes(db, uid, s.id) }); } catch { /* ignore */ }
    res.json({ ok: true, status: "cancelled" });
  });

  app.delete("/api/agent/sessions/:id", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    try { if (!deleteSession(db, uid, String(req.params.id))) return notFound(res); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });
}
