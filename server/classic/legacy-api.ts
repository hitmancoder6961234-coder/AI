/**
 * The original Darkness AI backend (legacy/server.original.js), folded into the unified server.
 *
 * Same endpoints and response shapes, mounted at /classic-api so the original single-page app (served at
 * /classic/) works unchanged:
 *
 *   POST /api/chat  /api/chat/stream  /api/upload  /api/image  /api/translate  /api/search  /api/code
 *   GET|POST /api/conversations   GET|DELETE /api/conversations/:id
 *   POST /api/share   GET /api/share/:id (public link)
 *   GET|POST /api/analytics   GET|POST|DELETE /api/webhooks   GET /api/health
 *
 * What is different from the original, deliberately:
 *   - identity comes from the signed-in session, not a `userEmail` query parameter anyone could forge;
 *   - every read/delete checks ownership (the original returned any conversation by id);
 *   - webhooks go through the SSRF-safe client and are HMAC-signed;
 *   - /api/code is disabled unless ENABLE_RUN_ENGINE=true, and then runs in a permission-restricted child process;
 *   - the model comes from the user's own configured model, or the server's keys (no vendor-locked SDK).
 */
import crypto from "crypto";
import { spawn } from "child_process";
import express, { type Express, type Request, type Response, type Router } from "express";
import multer from "multer";
import path from "path";
import type { DatabaseSync } from "node:sqlite";
import { searchWeb } from "../agent/tools.js";
import { safeFetch, validateUrl } from "../agent/safe-fetch.js";
import type { ChatMsg, LLM } from "../agent/providers.js";
import { uploaders, wrapUploadMiddleware } from "../upload-config.js";
import { RUN_ENGINE_ENABLED } from "../security/privacy.js";

export interface ClassicDeps {
  db: DatabaseSync;
  getUserId: (req: Request) => string | null;
  getLLM: (userId: string) => LLM;
  extractText: (filename: string, buf: Buffer) => Promise<{ text: string; error?: string }>;
  generateImage: (prompt: string, aspectRatio: "1:1" | "3:4" | "4:3" | "9:16" | "16:9") => Promise<{ mimeType: string; base64: string }>;
}

const MODE_PROMPTS: Record<string, string> = {
  fast: "Respond quickly and concisely. Direct answers, minimal preamble.",
  think: "Think through the problem step by step. Analyze, plan, then answer with code examples where helpful.",
  deep: "Use deep reasoning: understand the problem, decompose it, plan a solution, consider alternatives, verify your conclusions, then give a comprehensive answer. Show your high-level reasoning steps.",
  coding: "You are an expert software engineer. Generate clean, production-ready code with proper error handling. Explain key decisions briefly.",
  ppt: "You are a presentation designer. Create concise slide content with short bullet points, key statements, and clear structure.",
};
const DEFAULT_SYSTEM =
  "You are DARKNESS, a premium AI assistant that helps users build projects, write code, research topics, and create presentations. Respond in clear, well-structured Markdown. Use code blocks with language labels for code. Be concise but thorough.";

const MAX_MESSAGES = 60;
const MAX_CHARS_EACH = 60_000;
const MAX_CHARS_TOTAL = 300_000;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

const upload = uploaders.single;

function systemFor(mode: string, custom?: unknown): string {
  if (typeof custom === "string" && custom.trim()) return custom.slice(0, 20_000);
  return MODE_PROMPTS[mode] ? `${DEFAULT_SYSTEM}\n\n${MODE_PROMPTS[mode]}` : DEFAULT_SYSTEM;
}

function buildMessages(body: any): { messages: ChatMsg[]; mode: string } | { error: string } {
  const mode = typeof body?.mode === "string" ? body.mode : "auto";
  const raw = Array.isArray(body?.messages) ? body.messages : [];
  if (!raw.length) return { error: "messages array is required" };
  if (raw.length > MAX_MESSAGES * 3) return { error: "Too many messages" };
  const turns: ChatMsg[] = raw
    .slice(-MAX_MESSAGES)
    .filter((m: any) => m && typeof m.content === "string")
    .map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, MAX_CHARS_EACH) }) as ChatMsg);
  if (!turns.length) return { error: "messages array is required" };
  if (turns.reduce((n, m) => n + m.content.length, 0) > MAX_CHARS_TOTAL) return { error: "Conversation is too long" };
  // Providers require the first turn to be from the user.
  while (turns.length && turns[0].role !== "user") turns.shift();
  return { messages: [{ role: "system", content: systemFor(mode, body?.systemPrompt) }, ...turns], mode };
}

function aspectFor(size: unknown): "1:1" | "3:4" | "4:3" | "9:16" | "16:9" {
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(String(size || ""));
  if (!m) return "1:1";
  const r = Number(m[1]) / Number(m[2]);
  if (r > 1.6) return "16:9";
  if (r > 1.15) return "4:3";
  if (r < 0.65) return "9:16";
  if (r < 0.9) return "3:4";
  return "1:1";
}

function fileTypeOf(name: string): string {
  const ext = path.extname(name).toLowerCase().replace(".", "");
  if (ext === "pdf") return "pdf";
  if (["docx", "doc", "odt", "rtf"].includes(ext)) return "docx";
  if (["xlsx", "xls", "ods", "csv", "tsv"].includes(ext)) return "spreadsheet";
  if (["pptx", "ppt", "odp"].includes(ext)) return "presentation";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return "image";
  if (ext === "zip") return "archive";
  return "text";
}

export function registerClassicApi(app: Express, deps: ClassicDeps): void {
  const { db } = deps;
  db.exec(`
    CREATE TABLE IF NOT EXISTS classic_conversations (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT 'New Chat',
      messages TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_classic_conv_user ON classic_conversations(user_id, updated_at);
    CREATE TABLE IF NOT EXISTS classic_shared (
      share_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, messages TEXT NOT NULL,
      created_at INTEGER NOT NULL, views INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS classic_analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, event TEXT NOT NULL, data TEXT, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_classic_an_user ON classic_analytics(user_id, event);
    CREATE TABLE IF NOT EXISTS classic_webhooks (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, url TEXT NOT NULL, events TEXT NOT NULL, secret TEXT,
      active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
    );
  `);

  const r: Router = express.Router();

  const uid = (req: Request, res: Response): string | null => {
    const id = deps.getUserId(req);
    if (!id) res.status(401).json({ success: false, error: "Authentication required", code: "AUTH_REQUIRED" });
    return id;
  };
  const fail = (res: Response, err: any, status = 500) => {
    const message = String(err?.message || err).slice(0, 400);
    const code = /No AI provider|No API key/i.test(message) ? 503 : status;
    res.status(code).json({ success: false, error: message });
  };

  // --- health (public) --------------------------------------------------------------------------
  r.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      sdk: "ready",
      features: ["chat", "streaming", "upload", "pdf-extraction", "image-generation", "translate", "conversations-db", "code-sandbox", "sharing", "analytics", "webhooks", "web-search"],
    });
  });

  // --- chat -------------------------------------------------------------------------------------
  r.post("/api/chat", async (req, res) => {
    const id = uid(req, res);
    if (!id) return;
    const built = buildMessages(req.body);
    if ("error" in built) return res.status(400).json({ success: false, error: built.error });
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    try {
      const response = await deps.getLLM(id).complete(built.messages, { signal: ac.signal, temperature: built.mode === "deep" ? 0.4 : 0.3, maxTokens: built.mode === "deep" ? 8192 : 4096 });
      res.json({ success: true, response, mode: built.mode, usage: null });
    } catch (err) {
      fail(res, err);
    }
  });

  r.post("/api/chat/stream", async (req, res) => {
    const id = uid(req, res);
    if (!id) return;
    const built = buildMessages(req.body);
    if ("error" in built) return res.status(400).json({ success: false, error: built.error });
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    res.write("event: start\ndata: {}\n\n");
    try {
      const full = await deps.getLLM(id).complete(built.messages, { signal: ac.signal, maxTokens: built.mode === "deep" ? 8192 : 4096 });
      for (let i = 0; i < full.length && !ac.signal.aborted; i += 24) {
        res.write(`data: ${JSON.stringify({ content: full.slice(i, i + 24) })}\n\n`);
        await new Promise((ok) => setTimeout(ok, 12));
      }
      res.write(`event: done\ndata: ${JSON.stringify({ fullResponse: full })}\n\n`);
    } catch (err: any) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: String(err?.message || err).slice(0, 300) })}\n\n`);
    }
    res.end();
  });

  // --- upload -----------------------------------------------------------------------------------
  r.post("/api/upload", wrapUploadMiddleware(upload.single("file"), "single"), async (req, res) => {
    if (!uid(req, res)) return;
    if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });
    try {
      const name = path.basename(req.file.originalname || "file");
      const out = await deps.extractText(name, req.file.buffer);
      let text = out.text || `[Could not read ${name}${out.error ? `: ${out.error}` : ""}]`;
      const maxChars = 50_000;
      const truncated = text.length > maxChars;
      if (truncated) text = `${text.slice(0, maxChars)}\n\n[... truncated ...]`;
      res.json({ success: true, filename: name, fileType: fileTypeOf(name), size: req.file.size, text, truncated });
    } catch (err) {
      fail(res, err);
    }
  });

  // --- image ------------------------------------------------------------------------------------
  r.post("/api/image", async (req, res) => {
    if (!uid(req, res)) return;
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim().slice(0, 2000) : "";
    if (!prompt) return res.status(400).json({ success: false, error: "prompt is required" });
    const size = ["1024x1024", "768x1344", "864x1152", "1344x768", "1152x864", "1440x720", "720x1440"].includes(req.body?.size) ? req.body.size : "1024x1024";
    try {
      const img = await deps.generateImage(prompt, aspectFor(size));
      res.json({ success: true, image: `data:${img.mimeType};base64,${img.base64}`, prompt, size });
    } catch (err) {
      fail(res, err);
    }
  });

  // --- translate --------------------------------------------------------------------------------
  r.post("/api/translate", async (req, res) => {
    const id = uid(req, res);
    if (!id) return;
    const text = typeof req.body?.text === "string" ? req.body.text.slice(0, MAX_CHARS_EACH) : "";
    const target = typeof req.body?.targetLanguage === "string" ? req.body.targetLanguage.replace(/[^\p{L}\p{N} ()-]/gu, "").slice(0, 40) : "";
    const source = typeof req.body?.sourceLanguage === "string" ? req.body.sourceLanguage.replace(/[^\p{L}\p{N} ()-]/gu, "").slice(0, 40) : "";
    if (!text || !target) return res.status(400).json({ success: false, error: "text and targetLanguage are required" });
    try {
      const system = `You are a professional translator. Translate the user's text into ${target}.${source ? ` The source language is ${source}.` : ""} Return ONLY the translation, no explanations, no quotes. Preserve formatting, code blocks, and markdown.`;
      const translation = await deps.getLLM(id).complete([{ role: "system", content: system }, { role: "user", content: text }], { temperature: 0.1 });
      res.json({ success: true, translation: translation.trim(), targetLanguage: target });
    } catch (err) {
      fail(res, err);
    }
  });

  // --- search -----------------------------------------------------------------------------------
  r.post("/api/search", async (req, res) => {
    if (!uid(req, res)) return;
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
    if (!query) return res.status(400).json({ success: false, error: "query is required" });
    const num = Math.min(Math.max(Number(req.body?.num) || 5, 1), 10);
    try {
      const results = (await searchWeb(query)).slice(0, num);
      res.json({ success: true, results, source: results[0]?.source?.toLowerCase() || "none" });
    } catch (err) {
      fail(res, err);
    }
  });

  // --- code sandbox (opt-in) --------------------------------------------------------------------
  r.post("/api/code", async (req, res) => {
    if (!uid(req, res)) return;
    if (!RUN_ENGINE_ENABLED) {
      return res.status(403).json({ success: false, error: "Server-side code execution is disabled on this deployment. Set ENABLE_RUN_ENGINE=true on a private instance to enable it.", code: "RUN_ENGINE_DISABLED" });
    }
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    const lang = String(req.body?.language || "javascript").toLowerCase();
    if (!code) return res.status(400).json({ success: false, error: "code is required" });
    if (code.length > 20_000) return res.status(413).json({ success: false, error: "code is too long" });
    if (lang !== "javascript" && lang !== "js") return res.status(400).json({ success: false, error: "Only JavaScript execution is supported" });
    const script = `(async()=>{try{const r=(0,eval)(${JSON.stringify(code)});const v=await r;if(v!==undefined)console.log("=> "+(typeof v==="object"?JSON.stringify(v,null,2):String(v)))}catch(e){console.error(String(e&&e.message||e));process.exitCode=1}})()`;
    const child = spawn(process.execPath, ["--experimental-permission", "--max-old-space-size=96", "-e", script], { env: {}, stdio: ["ignore", "pipe", "pipe"], timeout: 5000, killSignal: "SIGKILL" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { if (stdout.length < 64_000) stdout += d; });
    child.stderr.on("data", (d) => { if (stderr.length < 64_000) stderr += d; });
    child.on("close", () => res.json({ success: true, language: "javascript", stdout: stdout.trim(), stderr: stderr.replace(/\(node:\d+\)[^\n]*\n?/g, "").trim(), result: null }));
    child.on("error", (err) => fail(res, err));
  });

  // --- conversations ----------------------------------------------------------------------------
  r.get("/api/conversations", (req, res) => {
    const id = uid(req, res);
    if (!id) return;
    const rows = db.prepare("SELECT id, title, created_at, updated_at FROM classic_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 500").all(id);
    res.json({ success: true, conversations: rows });
  });

  r.post("/api/conversations", (req, res) => {
    const id = uid(req, res);
    if (!id) return;
    const c = req.body?.conversation;
    if (!c || !ID_RE.test(String(c.id || ""))) return res.status(400).json({ success: false, error: "conversation with a valid id is required" });
    const messages = JSON.stringify(Array.isArray(c.messages) ? c.messages : []);
    if (messages.length > 6_000_000) return res.status(413).json({ success: false, error: "conversation is too large" });
    const owner = db.prepare("SELECT user_id FROM classic_conversations WHERE id = ?").get(String(c.id)) as { user_id: string } | undefined;
    if (owner && owner.user_id !== id) return res.status(403).json({ success: false, error: "Not your conversation" });
    const now = Date.now();
    db.prepare(
      `INSERT INTO classic_conversations (id, user_id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, messages = excluded.messages, updated_at = excluded.updated_at`
    ).run(String(c.id), id, String(c.title || "New Chat").slice(0, 200), messages, now, now);
    res.json({ success: true, id: String(c.id) });
  });

  r.get("/api/conversations/:id", (req, res) => {
    const id = uid(req, res);
    if (!id) return;
    const row = db.prepare("SELECT * FROM classic_conversations WHERE id = ? AND user_id = ?").get(String(req.params.id), id) as any;
    if (!row) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, conversation: { ...row, messages: JSON.parse(row.messages) } });
  });

  r.delete("/api/conversations/:id", (req, res) => {
    const id = uid(req, res);
    if (!id) return;
    db.prepare("DELETE FROM classic_conversations WHERE id = ? AND user_id = ?").run(String(req.params.id), id);
    res.json({ success: true });
  });

  // --- sharing ----------------------------------------------------------------------------------
  r.post("/api/share", (req, res) => {
    const id = uid(req, res);
    if (!id) return;
    const c = req.body?.conversation;
    if (!c || !Array.isArray(c.messages)) return res.status(400).json({ success: false, error: "conversation is required" });
    const messages = JSON.stringify(c.messages);
    if (messages.length > 2_000_000) return res.status(413).json({ success: false, error: "conversation is too large to share" });
    const shareId = "share-" + crypto.randomBytes(12).toString("base64url");
    db.prepare("INSERT INTO classic_shared (share_id, user_id, title, messages, created_at) VALUES (?, ?, ?, ?, ?)").run(shareId, id, String(c.title || "Shared Chat").slice(0, 200), messages, Date.now());
    res.json({ success: true, shareId, shareUrl: `/share/${shareId}` });
  });

  // Public by design: possession of the unguessable link is the permission.
  r.get("/api/share/:id", (req, res) => {
    const row = db.prepare("SELECT * FROM classic_shared WHERE share_id = ?").get(String(req.params.id)) as any;
    if (!row) return res.status(404).json({ success: false, error: "Shared chat not found" });
    db.prepare("UPDATE classic_shared SET views = views + 1 WHERE share_id = ?").run(String(req.params.id));
    res.json({ success: true, conversation: { title: row.title, messages: JSON.parse(row.messages), views: row.views + 1, createdAt: row.created_at } });
  });

  // --- analytics + webhooks ---------------------------------------------------------------------
  async function fireWebhooks(userId: string, event: string, data: unknown) {
    const hooks = db.prepare("SELECT * FROM classic_webhooks WHERE user_id = ? AND active = 1").all(userId) as any[];
    for (const wh of hooks) {
      let events: string[] = [];
      try { events = JSON.parse(wh.events); } catch { /* ignore */ }
      if (!events.includes(event) && !events.includes("*")) continue;
      const body = JSON.stringify({ event, data, timestamp: Date.now() });
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (wh.secret) {
        headers["x-webhook-secret"] = wh.secret;
        headers["x-darkness-signature"] = "sha256=" + crypto.createHmac("sha256", wh.secret).update(body).digest("hex");
      }
      try {
        await safeFetch(wh.url, AbortSignal.timeout(8000), { method: "POST", headers, body });
      } catch (err: any) {
        console.warn(`[classic] webhook delivery failed: ${String(err?.message || err).slice(0, 120)}`);
      }
    }
  }

  r.post("/api/analytics", (req, res) => {
    const id = uid(req, res);
    if (!id) return;
    const event = typeof req.body?.event === "string" ? req.body.event.slice(0, 80) : "";
    if (!event) return res.status(400).json({ success: false, error: "event is required" });
    const data = JSON.stringify(req.body?.data ?? {}).slice(0, 4000);
    db.prepare("INSERT INTO classic_analytics (user_id, event, data, created_at) VALUES (?, ?, ?, ?)").run(id, event, data, Date.now());
    void fireWebhooks(id, event, req.body?.data ?? {});
    res.json({ success: true });
  });

  r.get("/api/analytics", (req, res) => {
    const id = uid(req, res);
    if (!id) return;
    const total = (db.prepare("SELECT COUNT(*) AS n FROM classic_analytics WHERE user_id = ?").get(id) as any).n;
    const byType = db.prepare("SELECT event, COUNT(*) AS count FROM classic_analytics WHERE user_id = ? GROUP BY event ORDER BY count DESC LIMIT 50").all(id);
    const recent = (db.prepare("SELECT event, data, created_at FROM classic_analytics WHERE user_id = ? ORDER BY created_at DESC LIMIT 20").all(id) as any[]).map((e) => {
      let data: unknown = {};
      try { data = JSON.parse(e.data); } catch { /* ignore */ }
      return { ...e, data };
    });
    res.json({ success: true, stats: { totalEvents: total, userEvents: total, eventsByType: byType, recentEvents: recent } });
  });

  r.post("/api/webhooks", (req, res) => {
    const id = uid(req, res);
    if (!id) return;
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    try { validateUrl(url); } catch (err: any) { return res.status(400).json({ success: false, error: `Invalid webhook URL: ${err.message}` }); }
    const count = (db.prepare("SELECT COUNT(*) AS n FROM classic_webhooks WHERE user_id = ?").get(id) as any).n;
    if (count >= 10) return res.status(400).json({ success: false, error: "Webhook limit reached (10)" });
    const events = (Array.isArray(req.body?.events) ? req.body.events : []).map((e: unknown) => String(e).slice(0, 60)).slice(0, 20);
    const hookId = "wh-" + crypto.randomBytes(6).toString("hex");
    db.prepare("INSERT INTO classic_webhooks (id, user_id, url, events, secret, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(hookId, id, url, JSON.stringify(events), String(req.body?.secret || "").slice(0, 200), Date.now());
    res.json({ success: true, id: hookId, url, events });
  });

  r.get("/api/webhooks", (req, res) => {
    const id = uid(req, res);
    if (!id) return;
    const rows = db.prepare("SELECT id, url, events, active, created_at FROM classic_webhooks WHERE user_id = ?").all(id) as any[];
    res.json({ success: true, webhooks: rows.map((w) => ({ ...w, events: JSON.parse(w.events) })) });
  });

  r.delete("/api/webhooks/:id", (req, res) => {
    const id = uid(req, res);
    if (!id) return;
    db.prepare("DELETE FROM classic_webhooks WHERE id = ? AND user_id = ?").run(String(req.params.id), id);
    res.json({ success: true });
  });

  app.use("/classic-api", r);
}

/** Erase a user's rows from the original-app tables (called by the account erase endpoint). */
export function eraseClassicUser(db: DatabaseSync, userId: string): Record<string, number> {
  const del = (sql: string) => Number((db.prepare(sql).run(userId) as any).changes || 0);
  return {
    classicConversations: del("DELETE FROM classic_conversations WHERE user_id = ?"),
    classicShares: del("DELETE FROM classic_shared WHERE user_id = ?"),
    classicAnalytics: del("DELETE FROM classic_analytics WHERE user_id = ?"),
    classicWebhooks: del("DELETE FROM classic_webhooks WHERE user_id = ?"),
  };
}
