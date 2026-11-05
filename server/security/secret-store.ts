import type { DatabaseSync } from "node:sqlite";
import { open, seal, vaultEnabled } from "./vault.js";

/**
 * Provider API keys at rest.
 *
 * A key a user saves for a model is stored sealed (AES-256-GCM, security/vault.ts) whenever PRIVACY_ENCRYPTION_KEY is configured, bound to the
 * user and model it belongs to (a sealed value copied onto another row does not open). Reading is tolerant on purpose:
 *   - a legacy plaintext value is returned as is (so enabling encryption never locks anyone out, and `migrateModelKeys` converts them on request);
 *   - a sealed value that cannot be opened (wrong or missing key) reads as "no key" and is never returned as ciphertext, never thrown.
 * Rotation: set the new key as PRIVACY_ENCRYPTION_KEY and the old one as PRIVACY_ENCRYPTION_KEY_PREVIOUS, run the "rotate" migration, then remove the old key.
 */

const SEALED = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
export const isSealed = (v: unknown): boolean => typeof v === "string" && SEALED.test(v);

/** What a sealed key is bound to. `where` separates the local database from the optional cloud mirror (their id forms differ). */
export const keyAad = (where: "db" | "cloud", userId: string, modelId: string): string => `model-key:${where}:${String(userId)}:${String(modelId)}`;

/** The form to store: sealed when a vault key is configured, otherwise unchanged. Empty stays empty; an already sealed value is kept. */
export function protectSecret(plain: string | null | undefined, aad: string): string | null {
  const v = plain == null ? "" : String(plain);
  if (!v) return plain == null ? null : "";
  if (isSealed(v) || !vaultEnabled()) return v;
  return seal(v, aad);
}

/** The usable key: opens a sealed value (trying each candidate binding), passes plaintext through, and returns "" if it cannot be opened. */
export function revealSecret(stored: string | null | undefined, ...aads: string[]): string {
  const v = stored == null ? "" : String(stored);
  if (!v || !isSealed(v)) return v;
  if (!vaultEnabled()) return "";
  for (const aad of aads) {
    try { return open(v, aad); } catch { /* try the next binding */ }
  }
  return "";
}

export interface SecretCounts { total: number; plaintext: number; sealed: number; unreadable: number }

/** Counts only: never values. `unreadable` = sealed but not openable with the configured key(s). */
export function countModelKeys(db: DatabaseSync): SecretCounts {
  const out: SecretCounts = { total: 0, plaintext: 0, sealed: 0, unreadable: 0 };
  for (const r of db.prepare("SELECT id, user_id, api_key FROM models WHERE api_key IS NOT NULL AND api_key != ''").all() as any[]) {
    out.total++;
    if (!isSealed(r.api_key)) { out.plaintext++; continue; }
    out.sealed++;
    if (!vaultEnabled() || !revealSecret(r.api_key, keyAad("db", r.user_id, r.id))) out.unreadable++;
  }
  return out;
}

export interface MigrationResult { mode: "encrypt" | "rotate"; examined: number; changed: number; skipped: number; failed: number; backup: string | null }

/**
 * One-time, explicit conversion of stored keys (operator-triggered, see DEPLOY.md):
 *   encrypt - seal every plaintext key
 *   rotate  - re-seal every sealed key under the current key (the previous key must still be configured)
 * Safety: a consistent snapshot is written first (`VACUUM INTO backupPath`), every value is round-trip checked before it is written,
 * and all rows change in one transaction, so a failure leaves the database as it was. Values are never logged.
 */
export function migrateModelKeys(db: DatabaseSync, mode: "encrypt" | "rotate", opts: { backupPath?: string } = {}): MigrationResult {
  if (!vaultEnabled()) throw new Error("PRIVACY_ENCRYPTION_KEY is not configured: nothing to encrypt with.");
  const result: MigrationResult = { mode, examined: 0, changed: 0, skipped: 0, failed: 0, backup: null };
  if (opts.backupPath) {
    db.prepare("VACUUM INTO ?").run(opts.backupPath);
    result.backup = opts.backupPath;
  }
  const rows = db.prepare("SELECT rowid AS rid, id, user_id, api_key FROM models WHERE api_key IS NOT NULL AND api_key != ''").all() as any[];
  const update = db.prepare("UPDATE models SET api_key = ? WHERE rowid = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const r of rows) {
      result.examined++;
      const aad = keyAad("db", r.user_id, r.id);
      let plain: string;
      if (mode === "encrypt") {
        if (isSealed(r.api_key)) { result.skipped++; continue; }
        plain = r.api_key;
      } else {
        if (!isSealed(r.api_key)) { result.skipped++; continue; }
        plain = revealSecret(r.api_key, aad);
        if (!plain) { result.failed++; continue; } // cannot be opened: leave it exactly as it is
      }
      const sealed = seal(plain, aad);
      if (open(sealed, aad) !== plain) { result.failed++; continue; } // never write something that does not read back
      update.run(sealed, r.rid);
      result.changed++;
    }
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw err;
  }
  if (result.changed > 0) {
    // The old plaintext still sits in earlier pages and in the write-ahead log until they are rewritten: fold the log in and rebuild the
    // file (with secure_delete on, freed pages are zeroed). The snapshot written above is the one place a plaintext copy intentionally remains.
    try { db.exec("PRAGMA secure_delete = ON"); db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); db.exec("VACUUM"); db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* best effort: the values themselves are already sealed */ }
  }
  return result;
}
