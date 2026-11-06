import crypto from "node:crypto";
import type express from "express";
import type { DatabaseSync } from "node:sqlite";
import { branchConversation, conversationFacets, LibraryError, searchConversations, setConversationMeta } from "./conversation-library.js";

/**
 * HTTP surface of the conversation library (search, tags / folders / pinning, branching). Thin on purpose: every rule lives in
 * conversation-library.ts. Must be registered BEFORE `/api/conversations/:cid`, or "search" would be read as a conversation id.
 *
 *   GET   /api/conversations/search?q=&tag=&folder=&pinned=true
 *   GET   /api/conversations/facets
 *   PATCH /api/conversations/:cid/meta        { tags?, folder?, pinned? }
 *   POST  /api/conversations/:cid/branch      { fromMessageId }
 *
 * Auth is applied by the global gate; the handlers additionally scope every query to the caller, so a conversation id that is not
 * theirs reads as "not found" (never "forbidden").
 */
export function registerConversationLibraryRoutes(app: express.Express, deps: { db: DatabaseSync; getUserKey: (req: express.Request) => Promise<string | null> }): void {
  const { db } = deps;
  const notFound = (res: express.Response) => res.status(404).json({ error: "Not found", type: "not_found" });
  const fail = (res: express.Response, e: unknown) => {
    if (e instanceof LibraryError) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  };
  const one = (v: unknown): string | undefined => (Array.isArray(v) ? String(v[0]) : typeof v === "string" ? v : undefined);

  app.get("/api/conversations/search", async (req, res) => {
    const uid = await deps.getUserKey(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    try {
      const r = searchConversations(db, uid, { q: one(req.query.q), tag: one(req.query.tag), folder: one(req.query.folder), pinned: one(req.query.pinned) === "true", limit: Number(one(req.query.limit)) || undefined });
      res.json(r);
    } catch (e) { fail(res, e); }
  });

  app.get("/api/conversations/facets", async (req, res) => {
    const uid = await deps.getUserKey(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    res.json(conversationFacets(db, uid));
  });

  app.patch("/api/conversations/:cid/meta", async (req, res) => {
    const uid = await deps.getUserKey(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const patch: Record<string, unknown> = {};
    for (const k of ["tags", "folder", "pinned"]) if (k in body) patch[k] = (body as any)[k];
    if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to change: send tags, folder or pinned.", code: "EMPTY_PATCH" });
    try {
      const meta = setConversationMeta(db, uid, String(req.params.cid), patch);
      if (!meta) return notFound(res);
      res.json({ id: String(req.params.cid), ...meta });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/conversations/:cid/branch", async (req, res) => {
    const uid = await deps.getUserKey(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const fromMessageId = req.body && typeof req.body.fromMessageId === "string" ? req.body.fromMessageId : "";
    if (!fromMessageId) return res.status(400).json({ error: "fromMessageId is required.", code: "MISSING_MESSAGE" });
    try {
      const out = branchConversation(db, uid, String(req.params.cid), fromMessageId, { newConversationId: crypto.randomUUID(), newMessageId: () => crypto.randomUUID(), now: Date.now() });
      if (!out) return notFound(res);
      res.status(201).json(out);
    } catch (e) { fail(res, e); }
  });
}
