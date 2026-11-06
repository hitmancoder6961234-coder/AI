import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { redact } from "./security/redact.js";

/**
 * Prompt Engineering Studio: a user's own prompt library.
 *
 *  - prompts have a title, category, tags, description and a body with {{variables}} (optionally {{name|default}});
 *  - every change to the title or body creates a numbered VERSION (the last 50 are kept); restoring an old version creates a new one;
 *  - built-in TEMPLATES are read-only starting points; using one copies it into the user's own library (nothing is saved until they save);
 *  - export / import in a documented JSON format, validated row by row;
 *  - everything is scoped to the owner (another user's id answers "not found").
 * Running a prompt against models is handled in prompts-routes.ts through the same guarded runner the Compare page uses.
 */

export const CATEGORIES = ["writing", "coding", "analysis", "learning", "business", "creative", "other"] as const;
export type PromptCategory = (typeof CATEGORIES)[number];
export const MAX_BODY = 20_000;
export const MAX_TITLE = 120;
export const MAX_DESC = 300;
export const MAX_PROMPTS = 500;
export const MAX_VERSIONS = 50;
export const MAX_IMPORT = 100;
export const MAX_TAGS = 8;
export const MAX_VAR_VALUE = 4000;

export class PromptError extends Error {
  constructor(public code: string, message: string, public status = 400, public extra?: Record<string, unknown>) { super(message); }
}

export interface PromptVariable { name: string; default: string | null }
export interface PromptItem {
  id: string; title: string; category: PromptCategory; description: string; tags: string[]; body: string;
  variables: PromptVariable[]; favorite: boolean; version: number; createdAt: number; updatedAt: number;
}
export interface PromptVersion { version: number; title: string; body: string; note: string; createdAt: number }

export function ensurePromptTables(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    description TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    body TEXT NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    content_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_prompts_user_updated ON prompts (user_id, updated_at)");
  db.exec(`CREATE TABLE IF NOT EXISTS prompt_versions (
    prompt_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (prompt_id, version)
  )`);
}

// ---- variables ---------------------------------------------------------------------------------------------------------------------------

const VAR_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,39})\s*(?:\|([^{}]{0,200}))?\}\}/g;

/** The distinct {{variables}} of a prompt, in order of first use. `{{tone|friendly}}` carries a default. */
export function parseVariables(body: string): PromptVariable[] {
  const seen = new Map<string, PromptVariable>();
  for (const m of String(body).matchAll(VAR_RE)) {
    const name = m[1];
    const def = m[2] != null ? m[2].trim() : null;
    const cur = seen.get(name);
    if (!cur) seen.set(name, { name, default: def });
    else if (cur.default == null && def != null) cur.default = def;
  }
  return [...seen.values()];
}

/** Fill the variables. A missing value uses the default; with neither it is an error that lists every missing name (never a silent blank). */
export function renderPrompt(body: string, values: Record<string, unknown> = {}): string {
  const vars = parseVariables(body);
  const resolved: Record<string, string> = {};
  const missing: string[] = [];
  for (const v of vars) {
    const raw = values[v.name];
    const given = typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : "";
    if (given.length > MAX_VAR_VALUE) throw new PromptError("VALUE_TOO_LONG", `The value of "${v.name}" is longer than ${MAX_VAR_VALUE} characters.`, 413);
    if (given.trim()) resolved[v.name] = given;
    else if (v.default != null && v.default !== "") resolved[v.name] = v.default;
    else missing.push(v.name);
  }
  if (missing.length) throw new PromptError("MISSING_VARIABLES", `Fill in: ${missing.join(", ")}.`, 400, { missing });
  return String(body).replace(VAR_RE, (_m, name: string) => resolved[name]);
}

// ---- validation --------------------------------------------------------------------------------------------------------------------------

/** Credentials are refused (a prompt is stored and sent to providers); e-mail addresses are fine in a prompt, so they are masked before the check. */
function looksLikeCredential(text: string): boolean {
  const noEmail = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "EMAILADDRESS"); // no "@" left, so the redactor has nothing to mask
  return redact(noEmail) !== noEmail;
}

export function cleanTitle(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new PromptError("TITLE_REQUIRED", "Give the prompt a title.");
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length > MAX_TITLE) throw new PromptError("TITLE_TOO_LONG", `A title is limited to ${MAX_TITLE} characters.`, 413);
  return t;
}
export function cleanBody(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new PromptError("BODY_REQUIRED", "The prompt text is empty.");
  // eslint-disable-next-line no-control-regex
  const b = raw.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (b.length > MAX_BODY) throw new PromptError("BODY_TOO_LONG", `A prompt is limited to ${MAX_BODY.toLocaleString("en-US")} characters.`, 413);
  if (looksLikeCredential(b)) throw new PromptError("LOOKS_SECRET", "This prompt contains something that looks like a password, API key or token. Remove it before saving.");
  return b;
}
export function cleanDescription(raw: unknown): string {
  if (raw == null || raw === "") return "";
  if (typeof raw !== "string") throw new PromptError("INVALID_DESCRIPTION", "The description must be text.");
  const d = raw.replace(/\s+/g, " ").trim();
  if (d.length > MAX_DESC) throw new PromptError("DESCRIPTION_TOO_LONG", `A description is limited to ${MAX_DESC} characters.`, 413);
  return d;
}
export function cleanCategory(raw: unknown): PromptCategory {
  if (raw == null || raw === "") return "other";
  if (typeof raw === "string" && (CATEGORIES as readonly string[]).includes(raw)) return raw as PromptCategory;
  throw new PromptError("INVALID_CATEGORY", `Category must be one of: ${CATEGORIES.join(", ")}.`);
}
export function cleanTags(raw: unknown): string[] {
  if (raw == null || raw === "") return [];
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : null;
  if (!list) throw new PromptError("INVALID_TAGS", "Tags must be a list.");
  const out: string[] = [];
  for (const t of list) {
    const s = String(t).trim().toLowerCase();
    if (!s) continue;
    if (s.length > 24 || !/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(s)) throw new PromptError("INVALID_TAGS", "Tags are up to 24 letters, numbers, spaces, - or _.");
    if (!out.includes(s)) out.push(s);
  }
  if (out.length > MAX_TAGS) throw new PromptError("TOO_MANY_TAGS", `At most ${MAX_TAGS} tags.`);
  return out;
}

const contentKey = (title: string, body: string) => crypto.createHash("sha256").update(title.toLowerCase() + "\n" + body).digest("hex").slice(0, 32);

const toItem = (r: any): PromptItem => ({
  id: String(r.id), title: String(r.title), category: (CATEGORIES as readonly string[]).includes(r.category) ? r.category : "other",
  description: String(r.description || ""), tags: (() => { try { const t = JSON.parse(r.tags || "[]"); return Array.isArray(t) ? t.map(String) : []; } catch { return []; } })(),
  body: String(r.body), variables: parseVariables(String(r.body)), favorite: Number(r.favorite) === 1, version: Number(r.version) || 1,
  createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
});

// ---- CRUD and versions -------------------------------------------------------------------------------------------------------------------

function addVersion(db: DatabaseSync, userId: string, id: string, version: number, title: string, body: string, note: string, now: number): void {
  db.prepare("INSERT INTO prompt_versions (prompt_id, user_id, version, title, body, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, userId, version, title, body, note.slice(0, 200), now);
  db.prepare("DELETE FROM prompt_versions WHERE prompt_id = ? AND user_id = ? AND version <= ?").run(id, userId, version - MAX_VERSIONS);
}

export function createPrompt(db: DatabaseSync, userId: string, input: { title: unknown; body: unknown; category?: unknown; description?: unknown; tags?: unknown; note?: unknown }): PromptItem {
  const title = cleanTitle(input.title), body = cleanBody(input.body);
  const count = Number((db.prepare("SELECT COUNT(*) AS n FROM prompts WHERE user_id = ?").get(userId) as any).n);
  if (count >= MAX_PROMPTS) throw new PromptError("LIMIT_REACHED", `You can keep up to ${MAX_PROMPTS} prompts. Delete some you no longer use.`, 409);
  const now = Date.now(), id = crypto.randomUUID();
  const meta = { category: cleanCategory(input.category), description: cleanDescription(input.description), tags: cleanTags(input.tags) };
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO prompts (id, user_id, title, category, description, tags, body, favorite, version, content_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)")
      .run(id, userId, title, meta.category, meta.description, JSON.stringify(meta.tags), body, contentKey(title, body), now, now);
    addVersion(db, userId, id, 1, title, body, typeof input.note === "string" ? input.note : "Created", now);
    db.exec("COMMIT");
  } catch (e) { try { db.exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
  return getPrompt(db, userId, id)!;
}

export function getPrompt(db: DatabaseSync, userId: string, id: string): PromptItem | null {
  const r = db.prepare("SELECT * FROM prompts WHERE id = ? AND user_id = ?").get(String(id), userId) as any;
  return r ? toItem(r) : null;
}

export function listPrompts(db: DatabaseSync, userId: string, opts: { category?: string; tag?: string; q?: string; favorite?: boolean } = {}): PromptItem[] {
  const where = ["user_id = ?"], args: any[] = [userId];
  if (opts.category) { cleanCategory(opts.category); where.push("category = ?"); args.push(opts.category); }
  if (opts.favorite) where.push("favorite = 1");
  const q = String(opts.q || "").trim().slice(0, 100);
  if (q.length >= 2) { where.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')"); const like = "%" + q.replace(/[\\%_]/g, (m) => "\\" + m) + "%"; args.push(like, like, like, like); }
  const rows = (db.prepare(`SELECT * FROM prompts WHERE ${where.join(" AND ")} ORDER BY favorite DESC, updated_at DESC LIMIT ${MAX_PROMPTS}`).all(...args) as any[]).map(toItem);
  const tag = String(opts.tag || "").trim().toLowerCase();
  return tag ? rows.filter((p) => p.tags.includes(tag)) : rows;
}

/** Edit a prompt. A change to the title or body creates the next version; metadata-only edits (category, tags, favourite) do not. */
export function updatePrompt(db: DatabaseSync, userId: string, id: string, patch: { title?: unknown; body?: unknown; category?: unknown; description?: unknown; tags?: unknown; favorite?: unknown; note?: unknown }): PromptItem | null {
  const cur = getPrompt(db, userId, id);
  if (!cur) return null;
  const title = patch.title !== undefined ? cleanTitle(patch.title) : cur.title;
  const body = patch.body !== undefined ? cleanBody(patch.body) : cur.body;
  const category = patch.category !== undefined ? cleanCategory(patch.category) : cur.category;
  const description = patch.description !== undefined ? cleanDescription(patch.description) : cur.description;
  const tags = patch.tags !== undefined ? cleanTags(patch.tags) : cur.tags;
  if (patch.favorite !== undefined && typeof patch.favorite !== "boolean") throw new PromptError("INVALID_FLAG", "favorite must be true or false.");
  const favorite = patch.favorite !== undefined ? (patch.favorite as boolean) : cur.favorite;
  const changedContent = title !== cur.title || body !== cur.body;
  const now = Date.now(), version = changedContent ? cur.version + 1 : cur.version;
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE prompts SET title = ?, body = ?, category = ?, description = ?, tags = ?, favorite = ?, version = ?, content_key = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(title, body, category, description, JSON.stringify(tags), favorite ? 1 : 0, version, contentKey(title, body), now, cur.id, userId);
    if (changedContent) addVersion(db, userId, cur.id, version, title, body, typeof patch.note === "string" ? patch.note : "", now);
    db.exec("COMMIT");
  } catch (e) { try { db.exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
  return getPrompt(db, userId, id);
}

export function deletePrompt(db: DatabaseSync, userId: string, id: string): boolean {
  const r = db.prepare("DELETE FROM prompts WHERE id = ? AND user_id = ?").run(String(id), userId) as any;
  db.prepare("DELETE FROM prompt_versions WHERE prompt_id = ? AND user_id = ?").run(String(id), userId);
  return Number(r.changes) > 0;
}

export function listVersions(db: DatabaseSync, userId: string, id: string): PromptVersion[] | null {
  if (!getPrompt(db, userId, id)) return null;
  return (db.prepare("SELECT version, title, body, note, created_at FROM prompt_versions WHERE prompt_id = ? AND user_id = ? ORDER BY version DESC").all(String(id), userId) as any[])
    .map((v) => ({ version: Number(v.version), title: String(v.title), body: String(v.body), note: String(v.note || ""), createdAt: Number(v.created_at) }));
}

/** Bring an old version's text back as a NEW version (history is never rewritten). */
export function restoreVersion(db: DatabaseSync, userId: string, id: string, version: number): PromptItem | null {
  const cur = getPrompt(db, userId, id);
  if (!cur) return null;
  const v = db.prepare("SELECT title, body FROM prompt_versions WHERE prompt_id = ? AND user_id = ? AND version = ?").get(cur.id, userId, Math.floor(Number(version))) as any;
  if (!v) throw new PromptError("VERSION_NOT_FOUND", "That version does not exist.", 404);
  if (v.title === cur.title && v.body === cur.body) return cur;
  return updatePrompt(db, userId, id, { title: v.title, body: v.body, note: `Restored version ${Math.floor(Number(version))}` });
}

// ---- import / export ---------------------------------------------------------------------------------------------------------------------

export const EXPORT_FORMAT = "darkness-prompts";

export function exportPrompts(db: DatabaseSync, userId: string, ids?: string[]) {
  const all = listPrompts(db, userId);
  const picked = ids && ids.length ? all.filter((p) => ids.includes(p.id)) : all;
  return { format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), prompts: picked.map((p) => ({ title: p.title, category: p.category, description: p.description, tags: p.tags, body: p.body })) };
}

export function importPrompts(db: DatabaseSync, userId: string, data: unknown): { added: number; skipped: Array<{ index: number; code: string }> } {
  const rows = Array.isArray(data) ? data : (data && typeof data === "object" && (data as any).format === EXPORT_FORMAT ? (data as any).prompts : undefined);
  if (!Array.isArray(rows)) throw new PromptError("INVALID_IMPORT", `Expected a Darkness prompt export (format "${EXPORT_FORMAT}") or a list of prompts.`);
  if (rows.length > MAX_IMPORT) throw new PromptError("IMPORT_TOO_LARGE", `Import at most ${MAX_IMPORT} prompts at a time.`, 413);
  let added = 0; const skipped: Array<{ index: number; code: string }> = [];
  rows.forEach((r: any, index) => {
    try {
      if (!r || typeof r !== "object") throw new PromptError("INVALID_ROW", "Not a prompt.");
      const title = cleanTitle(r.title), body = cleanBody(r.body);
      if (db.prepare("SELECT 1 FROM prompts WHERE user_id = ? AND content_key = ?").get(userId, contentKey(title, body))) throw new PromptError("DUPLICATE", "Already in your library.", 409);
      createPrompt(db, userId, { title, body, category: r.category, description: r.description, tags: r.tags, note: "Imported" });
      added++;
    } catch (e) {
      if (e instanceof PromptError) skipped.push({ index, code: e.code }); else throw e;
    }
  });
  return { added, skipped };
}

// ---- built-in templates ------------------------------------------------------------------------------------------------------------------

export interface PromptTemplate { id: string; category: PromptCategory; title: string; description: string; body: string }
export const TEMPLATES: PromptTemplate[] = [
  { id: "summarize", category: "writing", title: "Summarize a text", description: "A faithful short summary with the key points.", body: "Summarize the text below in {{length|5 bullet points}} for {{audience|a busy reader}}. Keep every number and name exactly as written and do not add facts that are not in the text.\n\nText:\n{{text}}" },
  { id: "rewrite-tone", category: "writing", title: "Rewrite in a different tone", description: "Change the tone without changing the meaning.", body: "Rewrite the text below in a {{tone|friendly and professional}} tone. Keep the meaning and all facts. Return only the rewritten text.\n\nText:\n{{text}}" },
  { id: "email-reply", category: "business", title: "Draft an e-mail reply", description: "A clear, polite reply to a message you received.", body: "Write a {{tone|polite and concise}} reply to the e-mail below. My goal: {{goal}}.\n\nE-mail:\n{{email}}" },
  { id: "code-explain", category: "coding", title: "Explain code line by line", description: "A beginner-friendly walkthrough with an example.", body: "Explain this {{language|Python}} code for a {{level|beginner}}. Go through it in execution order, show the value of each variable with a small example input, and point out common mistakes.\n\n```\n{{code}}\n```" },
  { id: "code-review", category: "coding", title: "Review code for bugs", description: "Find bugs and risks, with fixes.", body: "Review the {{language|JavaScript}} code below. List real bugs first (with the line and a fix), then security risks, then readability improvements. Do not rewrite code that is fine.\n\n```\n{{code}}\n```" },
  { id: "unit-tests", category: "coding", title: "Write unit tests", description: "Tests that cover normal, edge and error cases.", body: "Write {{framework|pytest}} unit tests for the function below. Cover normal cases, edge cases and error cases, and name each test after the behaviour it checks.\n\n```\n{{code}}\n```" },
  { id: "analyze-data", category: "analysis", title: "Analyze a table of data", description: "Findings, anomalies and what to check next.", body: "Analyze the data below. Give the three most important findings with the numbers that support them, point out anything that looks like an error or outlier, and suggest what to check next.\n\nData:\n{{data}}" },
  { id: "pros-cons", category: "analysis", title: "Compare options (pros and cons)", description: "A balanced comparison with a recommendation.", body: "Compare these options for {{goal}}: {{options}}. For each give pros, cons and the situation where it is the best choice. End with a recommendation and the one thing that would change it." },
  { id: "explain-concept", category: "learning", title: "Explain a concept simply", description: "Teach it with an analogy and a quick check.", body: "Explain {{topic}} to {{audience|a first-year student}}. Start with a one-sentence definition, then an everyday analogy, then a worked example, and finish with three quiz questions with answers." },
  { id: "study-plan", category: "learning", title: "Make a study plan", description: "A realistic plan around your time.", body: "Create a {{weeks|4}}-week study plan for {{subject}}. I can study {{hours|1 hour}} per day and my current level is {{level|beginner}}. Give weekly goals, daily tasks and a short self-test at the end of each week." },
  { id: "product-brief", category: "business", title: "Write a product brief", description: "Problem, users, scope and success measures.", body: "Write a one-page product brief for {{product}}. Include the problem, the target users, what is in and out of scope for the first version, and three measurable success criteria." },
  { id: "story-idea", category: "creative", title: "Story starter", description: "Three distinct openings to choose from.", body: "Write three different opening paragraphs for a {{genre|mystery}} story set in {{setting}}. Each should have a different narrator and mood. Keep each under 100 words." },
];

export const getTemplate = (id: string): PromptTemplate | null => TEMPLATES.find((t) => t.id === id) || null;
