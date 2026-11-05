import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const { createBackup, verifyBackup, restoreBackup } = await import("../scripts/backup.mjs");
const script = path.resolve(import.meta.dirname, "..", "scripts", "backup.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "darkness-backup-test-"));

function makeData() {
  const root = tmp();
  fs.mkdirSync(path.join(root, "database"), { recursive: true });
  const db = new DatabaseSync(path.join(root, "database", "darkness.db"));
  db.exec("PRAGMA journal_mode = WAL; CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); CREATE TABLE sessions (token TEXT, user_id TEXT);");
  db.prepare("INSERT INTO users VALUES (?, ?)").run("u1", "ada@example.com");
  db.prepare("INSERT INTO users VALUES (?, ?)").run("u2", "grace@example.com");
  fs.mkdirSync(path.join(root, "projects", "p1"), { recursive: true });
  fs.writeFileSync(path.join(root, "projects", "p1", "app.js"), "console.log('hi')");
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(path.join(root, "artifacts", "report.docx"), Buffer.from("PK-fake"));
  fs.mkdirSync(path.join(root, "cache"), { recursive: true });
  fs.writeFileSync(path.join(root, "cache", "rebuildable.bin"), "x".repeat(1000));
  return { root, db };
}
const users = (file: string) => { const d = new DatabaseSync(file, { readOnly: true }); try { return d.prepare("SELECT id, email FROM users ORDER BY id").all().map((r: any) => ({ ...r })); } finally { d.close(); } };

test("backup: a live WAL database is captured completely (a plain file copy would miss the un-checkpointed rows)", () => {
  const { root, db } = makeData();
  db.prepare("INSERT INTO users VALUES (?, ?)").run("u3", "linus@example.com"); // still only in the -wal file, writer connection stays open
  const out = tmp();
  const { dest, manifest } = createBackup({ root, out });
  assert.deepEqual(users(path.join(dest, "database", "darkness.db")).map((u) => u.id), ["u1", "u2", "u3"]);
  assert.equal(manifest.database.tables, 2);
  assert.ok(manifest.folders.projects.files === 1 && manifest.folders.artifacts.files === 1);
  assert.ok(!fs.existsSync(path.join(dest, "cache")), "rebuildable caches are not backed up");
  assert.ok(!fs.readdirSync(dest).some((f) => /env|secret|key/i.test(f)), "no host secrets in the backup");
  db.close();
});

test("verify: a good backup passes; a changed database, a missing file or a damaged folder fail", () => {
  const { root, db } = makeData(); db.close();
  const { dest } = createBackup({ root, out: tmp() });
  assert.equal(verifyBackup(dest).ok, true);
  // tamper with a stored file
  fs.appendFileSync(path.join(dest, "projects", "p1", "app.js"), "// changed");
  const bad = verifyBackup(dest);
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join(" "), /folder projects/);
  // corrupt the database
  const { dest: d2 } = createBackup({ root, out: tmp() });
  const dbf = path.join(d2, "database", "darkness.db");
  const buf = fs.readFileSync(dbf); buf.fill(0xff, 100, 140); fs.writeFileSync(dbf, buf);
  assert.match(verifyBackup(d2).problems.join(" "), /checksum/);
  assert.equal(verifyBackup(tmp()).ok, false, "a random folder is not a backup");
});

test("restore: needs --yes, refuses a damaged backup, keeps the old data aside, and gives back exactly what was backed up", () => {
  const { root, db } = makeData(); db.close();
  const { dest } = createBackup({ root, out: tmp() });
  // the "disaster": the live data changes (a user is lost, a file appears)
  const live = new DatabaseSync(path.join(root, "database", "darkness.db"));
  live.exec("DELETE FROM users WHERE id = 'u1'"); live.close();
  fs.writeFileSync(path.join(root, "projects", "p1", "junk.txt"), "after the backup");
  assert.throws(() => restoreBackup(dest, { root }), /--yes/);
  const r = restoreBackup(dest, { root, yes: true });
  assert.deepEqual(users(path.join(root, "database", "darkness.db")).map((u) => u.id), ["u1", "u2"]);
  assert.ok(!fs.existsSync(path.join(root, "projects", "p1", "junk.txt")), "the file created after the backup is gone from the live folder...");
  assert.ok(fs.existsSync(path.join(r.previousDataMovedTo, "projects", "p1", "junk.txt")), "...but kept in the 'before-restore' folder, so a wrong restore can be undone");
  assert.equal(fs.readFileSync(path.join(root, "projects", "p1", "app.js"), "utf8"), "console.log('hi')");
  // a damaged backup is refused before anything is touched
  const { dest: d2 } = createBackup({ root, out: tmp() });
  fs.appendFileSync(path.join(d2, "artifacts", "report.docx"), "tampered");
  const before = users(path.join(root, "database", "darkness.db"));
  assert.throws(() => restoreBackup(d2, { root, yes: true }), /fails verification/);
  assert.deepEqual(users(path.join(root, "database", "darkness.db")), before);
});

test("CLI: create / verify / restore with the documented exit codes", () => {
  const { root, db } = makeData(); db.close();
  const out = tmp();
  const run = (...a: string[]) => spawnSync(process.execPath, [script, ...a], { encoding: "utf8" });
  const c = run("create", "--root", root, "--out", out);
  assert.equal(c.status, 0, c.stderr);
  const dir = fs.readdirSync(out).map((d) => path.join(out, d))[0];
  assert.match(c.stdout, /backup written to/);
  assert.equal(run("verify", dir).status, 0);
  assert.equal(run("restore", dir, "--root", root).status, 1, "no --yes: refused");
  assert.equal(run("verify", tmp()).status, 1);
  assert.equal(run().status, 2, "usage");
  assert.equal(run("create", "--root", tmp()).status, 1, "no database there");
});

test("restore with DARKNESS_DB_PATH outside the storage root: leftover -wal / -shm files of the OLD database are set aside, never replayed onto the restored file", () => {
  const { root, db } = makeData();
  const external = path.join(tmp(), "elsewhere.db");
  const ext = new DatabaseSync(external);
  ext.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT)");
  ext.prepare("INSERT INTO users VALUES (?, ?)").run("u1", "ada@example.com");
  const saved = process.env.DARKNESS_DB_PATH;
  process.env.DARKNESS_DB_PATH = external;
  try {
    const out = tmp();
    const { dest } = createBackup({ root, out });
    // after the backup the live database changes, and the process dies before a checkpoint: a -wal file is left behind
    ext.prepare("INSERT INTO users VALUES (?, ?)").run("u9", "after-backup@example.com");
    const walBytes = fs.existsSync(external + "-wal") ? fs.statSync(external + "-wal").size : 0;
    assert.ok(walBytes > 0, "the scenario needs an un-checkpointed WAL");
    const walCopy = fs.readFileSync(external + "-wal"), shmCopy = fs.existsSync(external + "-shm") ? fs.readFileSync(external + "-shm") : null;
    ext.close();
    // simulate the crash: the files as they would be after the process is gone without a clean close
    fs.writeFileSync(external + "-wal", walCopy); if (shmCopy) fs.writeFileSync(external + "-shm", shmCopy);
    db.close(); // the server is stopped before a restore
    const r = restoreBackup(dest, { root, yes: true });
    assert.ok(!fs.existsSync(external + "-wal") || fs.statSync(external + "-wal").size === 0, "no stale WAL beside the restored database");
    assert.deepEqual(users(external).map((u: any) => u.id), ["u1"], "exactly the backed-up rows");
    assert.ok(!users(external).some((u: any) => u.id === "u9"), "the row written after the backup is not resurrected by a stale WAL");
    assert.ok(r.moved.some((m: string) => m.includes("elsewhere.db")), "the old files were moved aside, not deleted: " + r.moved.join(","));
  } finally { if (saved === undefined) delete process.env.DARKNESS_DB_PATH; else process.env.DARKNESS_DB_PATH = saved; try { db.close(); } catch { /* already closed */ } }
});

test("restore never brings back sign-in sessions or password-reset tokens (they may have been revoked, used or expired since the backup), but keeps accounts and disabled flags", () => {
  const { root, db } = makeData();
  db.exec("CREATE TABLE password_resets (id TEXT PRIMARY KEY, user_id TEXT, token_hash TEXT, created_at INTEGER, expires_at INTEGER, used_at INTEGER)");
  db.exec("ALTER TABLE users ADD COLUMN disabled_at INTEGER");
  db.prepare("UPDATE users SET disabled_at = 5 WHERE id = 'u2'").run();
  // at backup time: one valid session, one unused reset token
  db.prepare("INSERT INTO sessions VALUES ('tok-valid-then-signed-out', 'u1')").run();
  db.prepare("INSERT INTO password_resets VALUES ('r1', 'u1', 'hash1', 1, 9999999999999, NULL)").run();
  db.close();
  const { dest } = createBackup({ root, out: tmp() });
  // afterwards the user signs out and the reset link is used: both rows are gone/spent in the live database
  const live = new DatabaseSync(path.join(root, "database", "darkness.db"));
  live.exec("DELETE FROM sessions; UPDATE password_resets SET used_at = 7");
  live.close();
  const r = restoreBackup(dest, { root, yes: true });
  const after = new DatabaseSync(path.join(root, "database", "darkness.db"), { readOnly: true });
  try {
    assert.equal((after.prepare("SELECT COUNT(*) AS n FROM sessions").get() as any).n, 0, "the signed-out session is not resurrected");
    assert.equal((after.prepare("SELECT COUNT(*) AS n FROM password_resets").get() as any).n, 0, "the reset token is gone");
    assert.deepEqual(users(path.join(root, "database", "darkness.db")).map((u: any) => u.id), ["u1", "u2"], "accounts are restored");
    assert.equal((after.prepare("SELECT disabled_at FROM users WHERE id = 'u2'").get() as any).disabled_at, 5, "a disabled account stays disabled");
  } finally { after.close(); }
  assert.deepEqual([r.sessionsRevoked, r.resetTokensRevoked], [1, 1], "the result says how many credentials were invalidated");
});
