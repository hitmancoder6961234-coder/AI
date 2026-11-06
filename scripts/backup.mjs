#!/usr/bin/env node
/**
 * Backup, verify and restore of the Darkness data directory (DARKNESS_STORAGE_ROOT, default ./data).
 *
 *   node scripts/backup.mjs create  [--root <dir>] [--out <dir>]        snapshot to <out>/darkness-backup-<UTC time>/
 *   node scripts/backup.mjs verify  <backup dir>                        integrity check + manifest check (non-destructive)
 *   node scripts/backup.mjs restore <backup dir> [--root <dir>] --yes   replace the data directory (STOP THE SERVER FIRST)
 *
 * What a backup contains: a consistent copy of the SQLite database (`VACUUM INTO`, safe while the server is running, WAL included)
 * plus the project, artifact, RAG and upload folders. It does NOT contain environment variables or API keys from the host.
 * BUT the database itself holds user accounts (password hashes), sessions, chats and any model API keys users entered: treat a
 * backup as sensitive as the live disk (encrypt it, restrict access, never commit it). Keep copies OFF the server's own disk.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const FOLDERS = ["projects", "artifacts", "rag", "embeddings", "uploads"]; // "cache" and the upload temp folder are rebuildable and skipped

export const defaultRoot = () => path.resolve(process.env.DARKNESS_STORAGE_ROOT || path.join(process.cwd(), "data"));
const dbPathFor = (root) => process.env.DARKNESS_DB_PATH ? path.resolve(process.env.DARKNESS_DB_PATH) : path.join(root, "database", "darkness.db");
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const sha256File = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

function folderStats(dir) {
  let files = 0, bytes = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { files++; bytes += fs.statSync(p).size; }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return { files, bytes };
}

function integrity(dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const rows = db.prepare("PRAGMA integrity_check").all();
    const ok = rows.length === 1 && Object.values(rows[0])[0] === "ok";
    const tables = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get().n;
    return { ok, tables, detail: ok ? "ok" : JSON.stringify(rows).slice(0, 300) };
  } catch (e) {
    return { ok: false, tables: 0, detail: String(e && e.message ? e.message : e) }; // a badly damaged file can make the check itself throw
  } finally {
    db.close();
  }
}

export function createBackup({ root = defaultRoot(), out } = {}) {
  const dbFile = dbPathFor(root);
  if (!fs.existsSync(dbFile)) throw new Error(`no database at ${dbFile}: is --root right?`);
  const outRoot = path.resolve(out || path.join(root, "backups"));
  const dest = path.join(outRoot, `darkness-backup-${stamp()}`);
  if (path.resolve(dest).startsWith(path.resolve(root) + path.sep) && FOLDERS.some((f) => path.resolve(dest).startsWith(path.join(root, f)))) throw new Error("the backup folder must not be inside a folder that is itself backed up");
  fs.mkdirSync(path.join(dest, "database"), { recursive: true, mode: 0o700 });

  // VACUUM INTO writes a consistent, defragmented copy while other connections keep reading and writing (the file is never half-written).
  const snap = path.join(dest, "database", "darkness.db");
  const src = new DatabaseSync(dbFile, { readOnly: true });
  try {
    src.exec("PRAGMA busy_timeout = 10000");
    src.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }
  const manifest = { format: 1, createdAt: new Date().toISOString(), database: { file: "database/darkness.db", sha256: sha256File(snap), bytes: fs.statSync(snap).size }, folders: {} };
  for (const f of FOLDERS) {
    const from = path.join(root, f);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(dest, f), { recursive: true });
    manifest.folders[f] = folderStats(path.join(dest, f));
  }
  const check = integrity(snap);
  if (!check.ok) throw new Error("the snapshot failed its integrity check: " + check.detail);
  manifest.database.tables = check.tables;
  fs.writeFileSync(path.join(dest, "MANIFEST.json"), JSON.stringify(manifest, null, 2));
  return { dest, manifest };
}

export function verifyBackup(dir) {
  const problems = [];
  const mf = path.join(dir, "MANIFEST.json");
  if (!fs.existsSync(mf)) return { ok: false, problems: ["MANIFEST.json is missing: not a backup folder"] };
  const manifest = JSON.parse(fs.readFileSync(mf, "utf8"));
  const dbFile = path.join(dir, manifest.database.file);
  if (!fs.existsSync(dbFile)) problems.push("database file is missing");
  else {
    if (sha256File(dbFile) !== manifest.database.sha256) problems.push("database checksum does not match the manifest (modified or damaged)");
    const c = integrity(dbFile);
    if (!c.ok) problems.push("database integrity check failed: " + c.detail);
  }
  for (const [f, st] of Object.entries(manifest.folders)) {
    const now = folderStats(path.join(dir, f));
    if (now.files !== st.files || now.bytes !== st.bytes) problems.push(`folder ${f}: ${now.files} files / ${now.bytes} bytes, manifest says ${st.files} / ${st.bytes}`);
  }
  return { ok: problems.length === 0, problems, manifest };
}

/** Deletes every sign-in session and password-reset token in the database file. A missing table (an older database) counts as zero. */
function invalidateCredentials(dbFile) {
  const db = new DatabaseSync(dbFile);
  const wipe = (table) => {
    try { return Number(db.prepare(`DELETE FROM ${table}`).run().changes) || 0; } catch { return 0; }
  };
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    return { sessionsRevoked: wipe("sessions"), resetTokensRevoked: wipe("password_resets") };
  } finally {
    db.close();
  }
}

export function restoreBackup(dir, { root = defaultRoot(), yes = false } = {}) {
  if (!yes) throw new Error("restore replaces the live data directory: pass --yes (and stop the server first)");
  const v = verifyBackup(dir);
  if (!v.ok) throw new Error("refusing to restore a backup that fails verification: " + v.problems.join("; "));
  const dbFile = dbPathFor(root);
  // Never delete anything: what is there now is moved aside, so a wrong restore can be undone.
  const aside = path.join(path.dirname(path.resolve(root)), `${path.basename(path.resolve(root))}.before-restore-${stamp()}`);
  fs.mkdirSync(aside, { recursive: true });
  const moved = [];
  for (const f of [...FOLDERS, "database"]) {
    const cur = path.join(root, f);
    if (fs.existsSync(cur)) { fs.renameSync(cur, path.join(aside, f)); moved.push(f); }
  }
  // A database that lives OUTSIDE <root>/database (DARKNESS_DB_PATH) was not moved with the folder above. Its write-ahead log must not stay
  // beside the restored file: SQLite would replay the old log onto the restored database (resurrecting rows written after the backup or
  // corrupting it). Move the file and its -wal / -shm aside too.
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = dbFile + suffix;
    if (!fs.existsSync(f)) continue;
    fs.mkdirSync(path.join(aside, "external-db"), { recursive: true });
    fs.renameSync(f, path.join(aside, "external-db", path.basename(f)));
    moved.push("external-db/" + path.basename(f));
  }
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  fs.copyFileSync(path.join(dir, v.manifest.database.file), dbFile);
  for (const f of Object.keys(v.manifest.folders)) fs.cpSync(path.join(dir, f), path.join(root, f), { recursive: true });
  const check = integrity(dbFile);
  if (!check.ok) throw new Error("the restored database failed its integrity check: " + check.detail + ` (the previous data is in ${aside})`);
  // A backup holds the sign-in state of the moment it was taken. Anything that happened afterwards (a sign-out, a password change, a used or
  // expired reset link, an account erased by its owner) would otherwise be undone, because sessions and reset tokens live in the database.
  // So every session and every reset token is invalidated: users sign in again (accounts, data and disabled flags are kept).
  const { sessionsRevoked, resetTokensRevoked } = invalidateCredentials(dbFile);
  return { restoredFrom: dir, previousDataMovedTo: aside, moved, tables: check.tables, sessionsRevoked, resetTokensRevoked };
}

function arg(name) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, target] = process.argv.slice(2);
  try {
    if (cmd === "create") {
      const r = createBackup({ root: arg("--root") ? path.resolve(arg("--root")) : undefined, out: arg("--out") });
      console.log(`backup written to ${r.dest}`);
      console.log(`  database: ${r.manifest.database.bytes} bytes, ${r.manifest.database.tables} tables, sha256 ${r.manifest.database.sha256.slice(0, 16)}...`);
      for (const [f, s] of Object.entries(r.manifest.folders)) console.log(`  ${f}: ${s.files} files, ${s.bytes} bytes`);
      console.log("Copy it off this machine (it contains accounts and chats) and test it with: node scripts/backup.mjs verify <folder>");
    } else if (cmd === "verify" && target) {
      const r = verifyBackup(path.resolve(target));
      console.log(r.ok ? "backup verified: database integrity ok, checksum and folder sizes match the manifest" : "BACKUP PROBLEMS:\n- " + r.problems.join("\n- "));
      process.exitCode = r.ok ? 0 : 1;
    } else if (cmd === "restore" && target) {
      const r = restoreBackup(path.resolve(target), { root: arg("--root") ? path.resolve(arg("--root")) : undefined, yes: process.argv.includes("--yes") });
      console.log(`restored ${r.tables} tables from ${r.restoredFrom}\nthe data that was there is kept at ${r.previousDataMovedTo}\nfor safety ${r.sessionsRevoked} sign-in session(s) and ${r.resetTokensRevoked} password-reset token(s) were invalidated: everyone signs in again\nstart the server and check /api/ready`);
    } else {
      console.error("usage: node scripts/backup.mjs create [--root dir] [--out dir] | verify <backup> | restore <backup> [--root dir] --yes");
      process.exitCode = 2;
    }
  } catch (e) {
    console.error("error: " + e.message);
    process.exitCode = 1;
  }
}
