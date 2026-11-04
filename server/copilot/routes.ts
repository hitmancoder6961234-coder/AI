/**
 * Darkness Copilot API (signed-in users only):
 *
 *   GET    /api/copilot/status
 *   GET    /api/copilot/conversations            list
 *   POST   /api/copilot/conversations            create
 *   GET    /api/copilot/conversations/:id        messages
 *   PATCH  /api/copilot/conversations/:id        rename
 *   DELETE /api/copilot/conversations/:id        delete one
 *   DELETE /api/copilot/conversations            delete all
 *   POST   /api/copilot/chat                     stream an answer (Server-Sent Events)
 *
 * chat body: { conversationId?, message, regenerate?, editMessageId?, projectId?, webSearch?, page? }
 * events:    meta {conversationId, userMessageId, assistantMessageId, title}
 *            sources [{title,url}]   notice {text}   token {t}   done {messageId, title}   error {message}
 */
import crypto from "crypto";
import type { Express, Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { type ChatMsg, type LLM, streamText } from "../agent/providers.js";
import { searchWeb } from "../agent/tools.js";
import { buildMessages, titleFrom } from "./prompts.js";

export interface CopilotDeps {
  db: DatabaseSync;
  getUserId: (req: Request) => string | null;
  /** null when no model is configured for this user or on the server. */
  getLLM: (userId: string) => LLM | null;
  /** Owner-checked project excerpts for a question; null when the project is not the user's. */
  projectContext: (userId: string, projectId: string, query: string) => Promise<{ name: string; text: string } | null>;
}

const MAX_MESSAGE = 20_000;
const MAX_STREAMS_PER_USER = 3;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const streams = new Map<string, number>();

const newId = (p: string) => `${p}_${crypto.randomBytes(9).toString("base64url")}`;

export function initCopilotTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS copilot_conversations (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT 'New chat',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_copilot_conv_user ON copilot_conversations(user_id, updated_at);
    CREATE TABLE IF NOT EXISTS copilot_messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, sources TEXT, model TEXT, created_at INTEGER NOT NULL, seq INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_copilot_msg_conv ON copilot_messages(conversation_id, seq);
  `);
}

export function eraseCopilotUser(db: DatabaseSync, userId: string): Record<string, number> {
  const del = (sql: string) => Number((db.prepare(sql).run(userId) as any).changes || 0);
  return { copilotMessages: del("DELETE FROM copilot_messages WHERE user_id = ?"), copilotConversations: del("DELETE FROM copilot_conversations WHERE user_id = ?") };
}

export function registerCopilotRoutes(app: Express, deps: CopilotDeps): void {
  const { db } = deps;
  initCopilotTables(db);

  const need = (req: Request, res: Response): string | null => {
    const uid = deps.getUserId(req);
    if (!uid) res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    return uid;
  };
  const ownConv = (id: string, uid: string) => db.prepare("SELECT * FROM copilot_conversations WHERE id = ? AND user_id = ?").get(id, uid) as any;
  const messagesOf = (id: string) =>
    (db.prepare("SELECT id, role, content, sources, model, created_at, seq FROM copilot_messages WHERE conversation_id = ? ORDER BY seq").all(id) as any[]).map((m) => ({
      id: m.id, role: m.role, content: m.content, model: m.model, createdAt: m.created_at, sources: m.sources ? JSON.parse(m.sources) : undefined,
    }));
  const nextSeq = (id: string) => Number((db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM copilot_messages WHERE conversation_id = ?").get(id) as any).n);
  const addMessage = (convId: string, uid: string, role: string, content: string, extra: { id?: string; sources?: unknown; model?: string } = {}) => {
    const id = extra.id || newId("m");
    db.prepare("INSERT INTO copilot_messages (id, conversation_id, user_id, role, content, sources, model, created_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, convId, uid, role, content, extra.sources ? JSON.stringify(extra.sources) : null, extra.model || null, Date.now(), nextSeq(convId));
    db.prepare("UPDATE copilot_conversations SET updated_at = ? WHERE id = ?").run(Date.now(), convId);
    return id;
  };

  app.get("/api/copilot/status", (req, res) => {
    const uid = need(req, res);
    if (!uid) return;
    const llm = deps.getLLM(uid);
    res.json({ model: llm ? `${llm.provider} / ${llm.model}` : null, streaming: Boolean(llm?.stream), webSearch: true });
  });

  app.get("/api/copilot/conversations", (req, res) => {
    const uid = need(req, res);
    if (!uid) return;
    const rows = db.prepare("SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM copilot_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 300").all(uid);
    res.json({ conversations: rows });
  });

  app.post("/api/copilot/conversations", (req, res) => {
    const uid = need(req, res);
    if (!uid) return;
    const id = newId("c");
    const now = Date.now();
    db.prepare("INSERT INTO copilot_conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, uid, String(req.body?.title || "New chat").slice(0, 120), now, now);
    res.status(201).json({ id });
  });

  app.get("/api/copilot/conversations/:id", (req, res) => {
    const uid = need(req, res);
    if (!uid) return;
    const c = ownConv(req.params.id, uid);
    if (!c) return res.status(404).json({ error: "Conversation not found" });
    res.json({ conversation: { id: c.id, title: c.title, createdAt: c.created_at, updatedAt: c.updated_at }, messages: messagesOf(c.id) });
  });

  app.patch("/api/copilot/conversations/:id", (req, res) => {
    const uid = need(req, res);
    if (!uid) return;
    const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 120) : "";
    if (!title) return res.status(400).json({ error: "title is required" });
    const r = db.prepare("UPDATE copilot_conversations SET title = ? WHERE id = ? AND user_id = ?").run(title, req.params.id, uid) as any;
    if (!r.changes) return res.status(404).json({ error: "Conversation not found" });
    res.json({ ok: true });
  });

  app.delete("/api/copilot/conversations/:id", (req, res) => {
    const uid = need(req, res);
    if (!uid) return;
    if (!ownConv(req.params.id, uid)) return res.status(404).json({ error: "Conversation not found" });
    db.prepare("DELETE FROM copilot_messages WHERE conversation_id = ? AND user_id = ?").run(req.params.id, uid);
    db.prepare("DELETE FROM copilot_conversations WHERE id = ? AND user_id = ?").run(req.params.id, uid);
    res.json({ ok: true });
  });

  app.delete("/api/copilot/conversations", (req, res) => {
    const uid = need(req, res);
    if (!uid) return;
    res.json({ ok: true, removed: eraseCopilotUser(db, uid) });
  });

  // ---- the chat ------------------------------------------------------------------------------
  app.post("/api/copilot/chat", async (req: Request, res: Response) => {
    const uid = need(req, res);
    if (!uid) return;

    const body = req.body || {};
    const regenerate = body.regenerate === true;
    const editId = typeof body.editMessageId === "string" && ID_RE.test(body.editMessageId) ? body.editMessageId : null;
    const text = typeof body.message === "string" ? body.message.trim() : "";
    if (!regenerate && !text) return res.status(400).json({ error: "message is required" });
    if (text.length > MAX_MESSAGE) return res.status(413).json({ error: `Messages are limited to ${MAX_MESSAGE} characters` });

    const llm = deps.getLLM(uid);
    if (!llm) return res.status(503).json({ error: "No AI model is configured. Add one in the Model page, or set a provider key (for example GEMINI_API_KEY) on the server.", code: "NO_MODEL" });
    if ((streams.get(uid) || 0) >= MAX_STREAMS_PER_USER) return res.status(429).json({ error: "Too many answers are being written at once. Wait a moment.", code: "COPILOT_BUSY" });

    // conversation
    let conv: any;
    if (typeof body.conversationId === "string" && body.conversationId) {
      if (!ID_RE.test(body.conversationId) || !(conv = ownConv(body.conversationId, uid))) return res.status(404).json({ error: "Conversation not found" });
    } else {
      if (regenerate || editId) return res.status(400).json({ error: "conversationId is required" });
      const id = newId("c");
      const now = Date.now();
      db.prepare("INSERT INTO copilot_conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, 'New chat', ?, ?)").run(id, uid, now, now);
      conv = ownConv(id, uid);
    }

    // edit / regenerate rewrite the tail of the conversation
    let userText = text;
    if (editId) {
      const target = db.prepare("SELECT seq, role FROM copilot_messages WHERE id = ? AND conversation_id = ?").get(editId, conv.id) as any;
      if (!target || target.role !== "user") return res.status(404).json({ error: "Message not found" });
      db.prepare("DELETE FROM copilot_messages WHERE conversation_id = ? AND seq >= ?").run(conv.id, target.seq);
    } else if (regenerate) {
      const all = messagesOf(conv.id);
      let lastUser = -1;
      for (let i = all.length - 1; i >= 0; i--) if (all[i].role === "user") { lastUser = i; break; }
      if (lastUser < 0) return res.status(400).json({ error: "Nothing to regenerate" });
      userText = all[lastUser].content;
      const seq = (db.prepare("SELECT seq FROM copilot_messages WHERE id = ?").get(all[lastUser].id) as any).seq;
      db.prepare("DELETE FROM copilot_messages WHERE conversation_id = ? AND seq > ?").run(conv.id, seq);
    }
    const userMessageId = regenerate
      ? (db.prepare("SELECT id FROM copilot_messages WHERE conversation_id = ? AND role = 'user' ORDER BY seq DESC LIMIT 1").get(conv.id) as any).id
      : addMessage(conv.id, uid, "user", userText);

    let title: string = conv.title;
    const isFirst = (db.prepare("SELECT COUNT(*) AS n FROM copilot_messages WHERE conversation_id = ?").get(conv.id) as any).n <= 1;
    if (title === "New chat" && isFirst) {
      title = titleFrom(userText);
      db.prepare("UPDATE copilot_conversations SET title = ? WHERE id = ?").run(title, conv.id);
    }

    // stream
    const assistantMessageId = newId("m");
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    streams.set(uid, (streams.get(uid) || 0) + 1);
    res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const send = (event: string, data: unknown) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    send("meta", { conversationId: conv.id, userMessageId, assistantMessageId, title });

    let answer = "";
    let sources: Array<{ title: string; url: string }> | undefined;
    try {
      // optional context: the user's own project, and/or the public web
      let projectName: string | undefined;
      let projectContext: string | undefined;
      if (typeof body.projectId === "string" && body.projectId) {
        const pc = await deps.projectContext(uid, body.projectId, userText).catch(() => null);
        if (pc) { projectName = pc.name; projectContext = pc.text; } else send("notice", { text: "That project could not be used as context." });
      }
      let webResults: Array<{ title: string; url: string; snippet: string }> | undefined;
      if (body.webSearch === true) {
        try {
          webResults = (await searchWeb(userText, ac.signal)).slice(0, 5).map((r) => ({ title: r.title, url: r.url, snippet: r.snippet }));
          sources = webResults.map((r) => ({ title: r.title, url: r.url }));
          send("sources", sources);
        } catch {
          webResults = [];
          send("notice", { text: "Web search was unavailable, so this answer does not use it." });
        }
      }

      const history: ChatMsg[] = messagesOf(conv.id).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
      const messages = buildMessages(history, { today: new Date().toISOString().slice(0, 10), page: typeof body.page === "string" ? body.page.slice(0, 60) : undefined, projectName, projectContext, webResults });
      for await (const piece of streamText(llm, messages, { signal: ac.signal, temperature: 0.7, maxTokens: 4096 })) {
        answer += piece;
        send("token", { t: piece });
      }
      addMessage(conv.id, uid, "assistant", answer || "(no answer)", { id: assistantMessageId, sources, model: `${llm.provider} / ${llm.model}` });
      send("done", { messageId: assistantMessageId, title });
    } catch (err: any) {
      if (ac.signal.aborted) {
        // the user pressed Stop: keep what they saw
        if (answer.trim()) addMessage(conv.id, uid, "assistant", answer, { id: assistantMessageId, sources, model: `${llm.provider} / ${llm.model}` });
      } else {
        send("error", { message: String(err?.message || err).slice(0, 300) });
      }
    } finally {
      const n = (streams.get(uid) || 1) - 1;
      if (n <= 0) streams.delete(uid);
      else streams.set(uid, n);
      res.end();
    }
  });
}
