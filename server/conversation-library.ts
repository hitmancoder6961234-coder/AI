import type { DatabaseSync } from "node:sqlite";

/**
 * Conversation library: tags, folders, pinning, search and branching.
 *
 * Everything here takes the database as a parameter and imports nothing from the application, so it is unit-tested against an
 * in-memory SQLite (tests/conversation-library.test.ts) and sits below the routes. Every function is scoped to ONE user: the
 * user id is part of every query, so another user's data can neither be read, changed nor branched, whatever ids are passed.
 *
 * Search is a bounded LIKE scan over the caller's own titles and messages (FTS5 exists in this SQLite, but a Node build without it
 * would turn a feature into a failed migration). Search text is user content: it is never logged here.
 */

export class LibraryError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export interface ConversationMeta { tags: string[]; folder: string | null; pinned: boolean }

export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 24;
export const MAX_FOLDER_LENGTH = 40;
export const MIN_QUERY = 2;
export const MAX_QUERY = 100;
export const MAX_RESULTS = 50;
export const MAX_BRANCH_MESSAGES = 500;
const SCAN_CAP = 800; // message rows examined per search
const LABEL_RE = /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u;

// ---------------------------------------------------------------------------------------------------------- schema

const migrated = new WeakSet<object>();
/** Adds the metadata columns if they are missing. Idempotent: safe to run on every start and on a database that already has them. */
export function ensureConversationMetaColumns(db: DatabaseSync): void {
  if (migrated.has(db)) return;
  const cols = new Set((db.prepare("PRAGMA table_info(conversations)").all() as any[]).map((c) => c.name));
  if (!cols.has("tags")) db.exec("ALTER TABLE conversations ADD COLUMN tags TEXT");
  if (!cols.has("folder")) db.exec("ALTER TABLE conversations ADD COLUMN folder TEXT");
  if (!cols.has("pinned")) db.exec("ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  db.exec("CREATE INDEX IF NOT EXISTS idx_conversations_user_pinned ON conversations(user_id, pinned)");
  migrated.add(db);
}

// ---------------------------------------------------------------------------------------------------------- validation

export function normalizeTags(input: unknown): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new LibraryError("INVALID_TAGS", "Tags must be a list.");
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") throw new LibraryError("INVALID_TAGS", "Each tag must be text.");
    const t = raw.trim().replace(/\s+/g, " ").toLowerCase();
    if (!t) continue;
    if (t.length > MAX_TAG_LENGTH) throw new LibraryError("INVALID_TAGS", `A tag can be at most ${MAX_TAG_LENGTH} characters.`);
    if (!LABEL_RE.test(t)) throw new LibraryError("INVALID_TAGS", "Tags may contain letters, numbers, spaces, - and _ only.");
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > MAX_TAGS) throw new LibraryError("INVALID_TAGS", `At most ${MAX_TAGS} tags per conversation.`);
  return out;
}

export function normalizeFolder(input: unknown): string | null {
  if (input === undefined || input === null || input === "") return null;
  if (typeof input !== "string") throw new LibraryError("INVALID_FOLDER", "The folder must be text.");
  const f = input.trim().replace(/\s+/g, " ");
  if (!f) return null;
  if (f.length > MAX_FOLDER_LENGTH) throw new LibraryError("INVALID_FOLDER", `A folder name can be at most ${MAX_FOLDER_LENGTH} characters.`);
  if (!LABEL_RE.test(f)) throw new LibraryError("INVALID_FOLDER", "Folder names may contain letters, numbers, spaces, - and _ only.");
  return f;
}

const parseTags = (raw: unknown): string[] => { try { const v = JSON.parse(String(raw || "[]")); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };
const rowMeta = (r: any): ConversationMeta => ({ tags: parseTags(r.tags), folder: r.folder || null, pinned: Number(r.pinned) === 1 });

// ---------------------------------------------------------------------------------------------------------- metadata

/** Set tags / folder / pinned on one of the caller's conversations. Fields that are not in the patch are left alone. Null when it is not theirs. */
export function setConversationMeta(db: DatabaseSync, userId: string, conversationId: string, patch: { tags?: unknown; folder?: unknown; pinned?: unknown }): ConversationMeta | null {
  ensureConversationMetaColumns(db);
  const row = db.prepare("SELECT tags, folder, pinned FROM conversations WHERE id = ? AND user_id = ?").get(conversationId, userId) as any;
  if (!row) return null;
  const cur = rowMeta(row);
  const next: ConversationMeta = {
    tags: "tags" in patch ? normalizeTags(patch.tags) : cur.tags,
    folder: "folder" in patch ? normalizeFolder(patch.folder) : cur.folder,
    pinned: "pinned" in patch ? patch.pinned === true : cur.pinned,
  };
  if ("pinned" in patch && typeof patch.pinned !== "boolean") throw new LibraryError("INVALID_PINNED", "pinned must be true or false.");
  db.prepare("UPDATE conversations SET tags = ?, folder = ?, pinned = ? WHERE id = ? AND user_id = ?").run(JSON.stringify(next.tags), next.folder, next.pinned ? 1 : 0, conversationId, userId);
  return next;
}

/** id -> metadata for all of the caller's conversations (used to enrich the list without a query per row). */
export function conversationMetaMap(db: DatabaseSync, userId: string): Map<string, ConversationMeta> {
  ensureConversationMetaColumns(db);
  const m = new Map<string, ConversationMeta>();
  for (const r of db.prepare("SELECT id, tags, folder, pinned FROM conversations WHERE user_id = ?").all(userId) as any[]) m.set(r.id, rowMeta(r));
  return m;
}

/** Distinct tags and folders in use (with counts), for the filter UI. */
export function conversationFacets(db: DatabaseSync, userId: string): { tags: Array<{ name: string; count: number }>; folders: Array<{ name: string; count: number }> } {
  const tags = new Map<string, number>(), folders = new Map<string, number>();
  for (const meta of conversationMetaMap(db, userId).values()) {
    for (const t of meta.tags) tags.set(t, (tags.get(t) || 0) + 1);
    if (meta.folder) folders.set(meta.folder, (folders.get(meta.folder) || 0) + 1);
  }
  const list = (m: Map<string, number>) => [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { tags: list(tags), folders: list(folders) };
}

// ---------------------------------------------------------------------------------------------------------- search

export interface SearchHit {
  id: string; title: string; updatedAt: number; messageCount: number;
  tags: string[]; folder: string | null; pinned: boolean;
  titleMatch: boolean; matches: number; snippet: string | null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

function snippetAround(text: string, needle: string): string {
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return text.slice(0, 140);
  const start = Math.max(0, i - 60), end = Math.min(text.length, i + needle.length + 80);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ") + (end < text.length ? "…" : "");
}

export function searchConversations(db: DatabaseSync, userId: string, opts: { q?: string; tag?: string; folder?: string; pinned?: boolean; limit?: number } = {}): { query: string; total: number; results: SearchHit[] } {
  ensureConversationMetaColumns(db);
  const q = String(opts.q ?? "").trim();
  if (q && q.length < MIN_QUERY) throw new LibraryError("QUERY_TOO_SHORT", `Type at least ${MIN_QUERY} characters to search.`);
  if (q.length > MAX_QUERY) throw new LibraryError("QUERY_TOO_LONG", `Search text can be at most ${MAX_QUERY} characters.`);
  const limit = Math.min(MAX_RESULTS, Math.max(1, Math.floor(Number(opts.limit) || MAX_RESULTS)));
  const wantTag = opts.tag ? normalizeTags([opts.tag])[0] : null;
  const wantFolder = opts.folder ? normalizeFolder(opts.folder) : null;

  const convs = db.prepare(`SELECT c.id, c.title, c.updated_at, c.tags, c.folder, c.pinned,
      (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id AND m.role IN ('user','assistant')) AS n
    FROM conversations c WHERE c.user_id = ?`).all(userId) as any[];
  const byId = new Map<string, SearchHit>();
  for (const r of convs) {
    const meta = rowMeta(r);
    if (wantTag && !meta.tags.includes(wantTag)) continue;
    if (wantFolder && meta.folder !== wantFolder) continue;
    if (opts.pinned && !meta.pinned) continue;
    byId.set(r.id, { id: r.id, title: r.title, updatedAt: r.updated_at, messageCount: Number(r.n) || 0, ...meta, titleMatch: false, matches: 0, snippet: null });
  }

  if (q) {
    const needle = q.toLowerCase();
    for (const h of byId.values()) if (h.title.toLowerCase().includes(needle)) { h.titleMatch = true; h.matches++; h.snippet = h.title; }
    const rows = db.prepare(`SELECT m.conversation_id AS cid, m.content AS content FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.user_id = ? AND m.content LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC LIMIT ?`).all(userId, "%" + escapeLike(q) + "%", SCAN_CAP) as any[];
    for (const r of rows) {
      const h = byId.get(r.cid);
      if (!h) continue; // filtered out by tag / folder / pinned
      h.matches++;
      if (!h.titleMatch && !h.snippet) h.snippet = snippetAround(String(r.content), q);
    }
    for (const [id, h] of byId) if (!h.matches) byId.delete(id);
  }

  const all = [...byId.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.titleMatch) - Number(a.titleMatch) || b.matches - a.matches || b.updatedAt - a.updatedAt);
  return { query: q, total: all.length, results: all.slice(0, limit) };
}

// ---------------------------------------------------------------------------------------------------------- branching

/**
 * Copy a conversation up to and including one message into a new conversation of the caller's. The source is never modified. Returns
 * null when the conversation or the message is not the caller's.
 */
export function branchConversation(db: DatabaseSync, userId: string, conversationId: string, fromMessageId: string, ids: { newConversationId: string; newMessageId: () => string; now: number }): { id: string; title: string; copied: number } | null {
  ensureConversationMetaColumns(db);
  const src = db.prepare("SELECT id, title, model_id, project_id, tags, folder FROM conversations WHERE id = ? AND user_id = ?").get(conversationId, userId) as any;
  if (!src) return null;
  const msgs = db.prepare("SELECT id, role, content, model_id, attachments, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC").all(conversationId) as any[];
  const cut = msgs.findIndex((m) => m.id === fromMessageId);
  if (cut < 0) return null;
  const keep = msgs.slice(0, cut + 1);
  if (keep.length > MAX_BRANCH_MESSAGES) throw new LibraryError("TOO_MANY_MESSAGES", `A branch can copy at most ${MAX_BRANCH_MESSAGES} messages.`, 413);
  const title = `Branch of ${String(src.title || "conversation")}`.slice(0, 120);
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO conversations (id, user_id, project_id, title, model_id, created_at, updated_at, tags, folder, pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)")
      .run(ids.newConversationId, userId, src.project_id ?? null, title, src.model_id ?? null, ids.now, ids.now, src.tags ?? null, src.folder ?? null);
    const ins = db.prepare("INSERT INTO messages (id, conversation_id, role, content, model_id, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const m of keep) ins.run(ids.newMessageId(), ids.newConversationId, m.role, m.content, m.model_id ?? null, m.attachments ?? null, m.created_at);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { id: ids.newConversationId, title, copied: keep.length };
}
