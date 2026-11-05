#!/usr/bin/env node
/**
 * Operator tools. There is deliberately NO administrator role inside the web app: nothing in the product needs one, and an in-app admin is a
 * privilege-escalation target. The trust boundary for these actions is access to the server itself (a shell with the database file), the same
 * boundary that protects the database and the environment variables.
 *
 *   node scripts/admin.mjs users                          counts and a masked list (no password hashes, no full e-mail addresses)
 *   node scripts/admin.mjs revoke-sessions <email>        sign the account out everywhere
 *   node scripts/admin.mjs disable <email>                refuse sign-in and end every session (reversible)
 *   node scripts/admin.mjs enable <email>
 *   node scripts/admin.mjs reset-link <email> [--url <base>]   a ONE-TIME password reset link (valid 30 minutes) for a user who cannot get e-mail;
 *                                                         give it to them over a channel you trust; it is as sensitive as a password
 *
 * Reads DARKNESS_DB_PATH (or <DARKNESS_STORAGE_ROOT>/database/darkness.db). Safe while the server runs (SQLite WAL); session removal takes
 * effect immediately because the server checks the database for every request.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const RESET_TTL_MS = 30 * 60_000;

export const dbPath = (env = process.env) => (env.DARKNESS_DB_PATH ? path.resolve(env.DARKNESS_DB_PATH) : path.join(path.resolve(env.DARKNESS_STORAGE_ROOT || path.join(process.cwd(), "data")), "database", "darkness.db"));

export function openDb(file = dbPath()) {
  if (!fs.existsSync(file)) throw new Error("database not found: " + file);
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS password_resets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, via TEXT NOT NULL DEFAULT 'email')`);
  const cols = db.prepare("PRAGMA table_info(users)").all();
  if (!cols.some((c) => c.name === "disabled_at")) db.exec("ALTER TABLE users ADD COLUMN disabled_at INTEGER");
  return db;
}

export function mask(email) { const [u, d] = String(email).split("@"); return (u ? u[0] : "") + "***@" + (d || ""); }

export function findUser(db, email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) throw new Error("give an e-mail address");
  const row = db.prepare("SELECT id, email, name, created_at, disabled_at FROM users WHERE lower(email) = ?").get(e);
  if (!row) throw new Error("no account with that e-mail address");
  return row;
}

export function listUsers(db) {
  const rows = db.prepare("SELECT id, email, created_at, disabled_at FROM users ORDER BY created_at DESC").all();
  const sessions = new Map(db.prepare("SELECT user_id, COUNT(*) AS n FROM sessions WHERE expires_at > ? GROUP BY user_id").all(Date.now()).map((r) => [r.user_id, r.n]));
  return { total: rows.length, disabled: rows.filter((r) => r.disabled_at).length, users: rows.map((r) => ({ id: String(r.id).slice(0, 8), email: mask(r.email), created: new Date(Number(r.created_at)).toISOString().slice(0, 10), disabled: !!r.disabled_at, sessions: sessions.get(r.id) || 0 })) };
}

export function revokeSessions(db, email) {
  const u = findUser(db, email);
  return Number(db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id).changes) || 0;
}
export function setDisabled(db, email, disabled) {
  const u = findUser(db, email);
  db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(disabled ? Date.now() : null, u.id);
  const ended = disabled ? Number(db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id).changes) || 0 : 0;
  return { sessionsEnded: ended };
}

/** Same token format and storage as server/recovery.ts: 32 random bytes (base64url), only the SHA-256 is stored, 30 minutes, one use. */
export function makeResetLink(db, email, baseUrl, now = Date.now()) {
  const u = findUser(db, email);
  if (u.disabled_at) throw new Error("that account is disabled: enable it first");
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(now, u.id);
  db.prepare("INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at, via) VALUES (?, ?, ?, ?, ?, 'operator')")
    .run(crypto.randomUUID(), u.id, crypto.createHash("sha256").update(token).digest("hex"), now, now + RESET_TTL_MS);
  const base = String(baseUrl || "").replace(/\/+$/, "");
  return { url: `${base || "https://<your-app-url>"}/reset.html#token=${token}`, expiresAt: now + RESET_TTL_MS };
}

function main(argv) {
  const [cmd, a1, ...rest] = argv;
  const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
  const db = openDb();
  try {
    switch (cmd) {
      case "users": { const r = listUsers(db); console.log(`${r.total} accounts (${r.disabled} disabled)`); for (const u of r.users) console.log(`${u.id}  ${u.email.padEnd(32)} ${u.created}  sessions:${u.sessions}${u.disabled ? "  DISABLED" : ""}`); break; }
      case "revoke-sessions": console.log(`${revokeSessions(db, a1)} session(s) ended for ${mask(a1)}`); break;
      case "disable": { const r = setDisabled(db, a1, true); console.log(`${mask(a1)} is disabled (${r.sessionsEnded} session(s) ended)`); break; }
      case "enable": setDisabled(db, a1, false); console.log(`${mask(a1)} is enabled`); break;
      case "reset-link": {
        const r = makeResetLink(db, a1, flag("--url") || process.env.PUBLIC_APP_URL);
        console.log(`One-time reset link for ${mask(a1)} (valid until ${new Date(r.expiresAt).toLocaleTimeString()}, works once):\n\n${r.url}\n\nTreat it like a password: send it only over a channel you trust.`);
        break;
      }
      default: console.log("Usage: node scripts/admin.mjs users | revoke-sessions <email> | disable <email> | enable <email> | reset-link <email> [--url <base>]"); process.exitCode = cmd ? 2 : 0;
    }
  } catch (e) { console.error("Error: " + e.message); process.exitCode = 1; } finally { db.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
