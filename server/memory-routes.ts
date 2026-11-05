import type express from "express";
import type { DatabaseSync } from "node:sqlite";
import {
  CATEGORIES, createMemory, deleteAllMemories, deleteMemory, exportMemories, getMemory, importMemories, listMemories, MemoryError,
  memoryEnabled, selectRelevantMemories, setMemoryEnabled, updateMemory, MAX_LEN, MAX_PER_USER,
} from "./memory.js";

/**
 * HTTP surface of the memory feature. Every handler is scoped to the signed-in user; another user's memory id answers 404.
 *
 *   GET    /api/memory?category=&q=       { enabled, memories, categories, limits }
 *   POST   /api/memory                    { content, category?, always? }   -> 201 memory | 409 DUPLICATE | 400 LOOKS_SECRET ...
 *   PATCH  /api/memory/:id                { content?, category?, always?, enabled? }
 *   DELETE /api/memory/:id
 *   DELETE /api/memory?confirm=all        delete every memory of the caller
 *   GET    /api/memory/settings           { enabled }
 *   PUT    /api/memory/settings           { enabled }
 *   POST   /api/memory/preview            { query }  -> which memories WOULD be sent with that question (nothing is marked as used)
 *   GET    /api/memory/export             JSON download
 *   POST   /api/memory/import             { memories: [...] }
 *
 * Registered before nothing else shares the prefix, but "/api/memory/settings" etc. are declared before "/api/memory/:id".
 */
export function registerMemoryRoutes(app: express.Express, deps: { db: DatabaseSync; getUserKey: (req: express.Request) => Promise<string | null> }): void {
  const { db } = deps;
  const fail = (res: express.Response, e: unknown) => {
    if (e instanceof MemoryError) return res.status(e.status).json({ error: e.message, code: e.code, ...(e.extra || {}) });
    throw e;
  };
  const notFound = (res: express.Response) => res.status(404).json({ error: "Not found", type: "not_found" });
  const body = (req: express.Request): Record<string, unknown> => (req.body && typeof req.body === "object" ? req.body : {});
  const one = (v: unknown): string | undefined => (Array.isArray(v) ? String(v[0]) : typeof v === "string" ? v : undefined);

  app.get("/api/memory/settings", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    res.json({ enabled: memoryEnabled(db, uid) });
  });
  app.put("/api/memory/settings", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    if (typeof body(req).enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false.", code: "INVALID_FLAG" });
    res.json({ enabled: setMemoryEnabled(db, uid, body(req).enabled as boolean) });
  });
  app.post("/api/memory/preview", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const q = typeof body(req).query === "string" ? (body(req).query as string).slice(0, 4000) : "";
    const picked = selectRelevantMemories(db, uid, q, { touch: false }); // a preview is not a use: counters stay as they are
    res.json({ enabled: memoryEnabled(db, uid), memories: picked.memories.map((m) => ({ id: m.id, content: m.content, category: m.category, always: m.always })) });
  });
  app.get("/api/memory/export", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    res.setHeader("Content-Disposition", 'attachment; filename="darkness-memory.json"');
    res.setHeader("Cache-Control", "no-store");
    res.json(exportMemories(db, uid));
  });
  app.post("/api/memory/import", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    try { res.json(importMemories(db, uid, body(req).memories)); } catch (e) { fail(res, e); }
  });

  app.get("/api/memory", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    try {
      res.json({ enabled: memoryEnabled(db, uid), memories: listMemories(db, uid, { category: one(req.query.category), q: one(req.query.q) }), categories: CATEGORIES, limits: { maxLength: MAX_LEN, maxMemories: MAX_PER_USER } });
    } catch (e) { fail(res, e); }
  });
  app.post("/api/memory", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const b = body(req);
    try { res.status(201).json(createMemory(db, uid, { content: b.content, category: b.category, always: b.always, source: b.source === "chat" ? "chat" : "manual" })); } catch (e) { fail(res, e); }
  });
  app.patch("/api/memory/:id", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const b = body(req), patch: Record<string, unknown> = {};
    for (const k of ["content", "category", "always", "enabled"]) if (k in b) patch[k] = b[k];
    try { const m = updateMemory(db, uid, String(req.params.id), patch); if (!m) return notFound(res); res.json(m); } catch (e) { fail(res, e); }
  });
  app.delete("/api/memory/:id", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    if (!getMemory(db, uid, String(req.params.id))) return notFound(res);
    deleteMemory(db, uid, String(req.params.id));
    res.json({ ok: true });
  });
  app.delete("/api/memory", async (req, res) => {
    const uid = await deps.getUserKey(req); if (!uid) return res.status(401).json({ error: "Unauthorized" });
    if (one(req.query.confirm) !== "all") return res.status(400).json({ error: "Deleting every memory needs ?confirm=all.", code: "CONFIRM_REQUIRED" });
    res.json({ ok: true, deleted: deleteAllMemories(db, uid) });
  });
}
