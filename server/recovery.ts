import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/**
 * Password reset tokens and account-disable state (the database side of account recovery).
 *
 * A reset token is 32 random bytes (base64url, 43 characters). Only its SHA-256 is stored, so a copy of the database cannot be used to reset
 * anyone's password; the token itself exists only in the e-mail (or in the operator's one-time link). It is valid for 30 minutes and for ONE use
 * (consumption is a single atomic UPDATE), creating a new one invalidates the older ones, and using one is the caller's cue to end every session.
 */

export const RESET_TTL_MS = 30 * 60_000;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");

export function ensureRecoveryTables(db: DatabaseSync, now = Date.now()): void {
  db.exec(`CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    via TEXT NOT NULL DEFAULT 'email'
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id)");
  // additive migration: an account can be disabled by the operator (see scripts/admin.mjs); a disabled account cannot sign in or reset
  const cols = db.prepare("PRAGMA table_info(users)").all() as any[];
  if (cols.length && !cols.some((c) => c.name === "disabled_at")) db.exec("ALTER TABLE users ADD COLUMN disabled_at INTEGER");
  purgeResets(db, now);
}

/** Tokens that expired or were used more than a day ago are of no use to anyone: remove them. */
export function purgeResets(db: DatabaseSync, now = Date.now()): number {
  const r = db.prepare("DELETE FROM password_resets WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)").run(now - 86_400_000, now - 86_400_000) as any;
  return Number(r.changes) || 0;
}

/** A fresh token for the user. Older unused tokens of the same user stop working. Returns the plain token (to be sent, never stored) and its expiry. */
export function createResetToken(db: DatabaseSync, userId: string, opts: { now?: number; via?: "email" | "operator"; ttlMs?: number } = {}): { token: string; expiresAt: number } {
  const now = opts.now ?? Date.now();
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(now, userId);
  db.prepare("INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at, via) VALUES (?, ?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), userId, hashToken(token), now, now + (opts.ttlMs ?? RESET_TTL_MS), opts.via ?? "email");
  return { token, expiresAt: now + (opts.ttlMs ?? RESET_TTL_MS) };
}

/** Use a token: returns the user it belongs to, or null if it is malformed, unknown, expired or already used. Atomic: two attempts cannot both succeed. */
export function consumeResetToken(db: DatabaseSync, token: unknown, now = Date.now()): string | null {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const h = hashToken(token);
  const row = db.prepare("SELECT user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").get(h, now) as any;
  if (!row) return null;
  const r = db.prepare("UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").run(now, h, now) as any;
  return Number(r.changes) === 1 ? String(row.user_id) : null;
}

export function isDisabled(db: DatabaseSync, userId: string): boolean {
  try { return !!(db.prepare("SELECT disabled_at FROM users WHERE id = ?").get(userId) as any)?.disabled_at; } catch { return false; }
}

/** A tiny fixed-window limiter (per key). `hit` records the attempt and returns 0 when it is within the limit, otherwise the seconds to wait. */
export class Window {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {}
  hit(key: string): number {
    const t = this.now();
    const list = (this.hits.get(key) || []).filter((x) => t - x < this.windowMs);
    if (list.length >= this.max) { this.hits.set(key, list); return Math.max(1, Math.ceil((this.windowMs - (t - list[0])) / 1000)); }
    list.push(t); this.hits.set(key, list);
    if (this.hits.size > 20_000) for (const [k, v] of this.hits) if (!v.some((x) => t - x < this.windowMs)) this.hits.delete(k);
    return 0;
  }
}
