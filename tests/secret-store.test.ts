import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

// A throwaway database for the db.ts-level checks, set before db.ts is first loaded.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "darkness-secrets-test-"));
process.env.DARKNESS_STORAGE_ROOT = tmp;
process.env.DARKNESS_DB_PATH = path.join(tmp, "secrets.db");

const K1 = crypto.randomBytes(32).toString("base64");
const K2 = crypto.randomBytes(32).toString("base64");
const setKeys = (cur: string | null, prev: string | null = null) => {
  if (cur) process.env.PRIVACY_ENCRYPTION_KEY = cur; else delete process.env.PRIVACY_ENCRYPTION_KEY;
  if (prev) process.env.PRIVACY_ENCRYPTION_KEY_PREVIOUS = prev; else delete process.env.PRIVACY_ENCRYPTION_KEY_PREVIOUS;
  _reset();
};

const vault = await import("../server/security/vault.js");
const store = await import("../server/security/secret-store.js");
const { _resetVaultForTests: _reset } = vault;
const { protectSecret, revealSecret, keyAad, isSealed, migrateModelKeys, countModelKeys } = store;

const KEY = "sk-live-ABCDEFGHIJKLMNOPQRSTUVWX";
const aad = keyAad("db", "u1", "m1");

test("with a vault key a key is stored sealed and reads back; without one nothing changes", () => {
  setKeys(K1);
  const sealed = protectSecret(KEY, aad)!;
  assert.ok(isSealed(sealed) && !sealed.includes(KEY) && !sealed.includes("ABCDEFGH"), "the stored form does not contain the key");
  assert.equal(revealSecret(sealed, aad), KEY);
  assert.notEqual(protectSecret(KEY, aad), sealed, "a fresh IV per seal");
  assert.equal(protectSecret(sealed, aad), sealed, "an already sealed value is kept, never double-sealed");
  assert.equal(protectSecret("", aad), "");
  assert.equal(protectSecret(null, aad), null);
  setKeys(null);
  assert.equal(protectSecret(KEY, aad), KEY, "no key configured: stored as before");
});

test("legacy plaintext still reads; an unreadable sealed value reads as no key and is never returned as ciphertext", () => {
  setKeys(K1);
  assert.equal(revealSecret(KEY, aad), KEY);
  const sealed = protectSecret(KEY, aad)!;
  setKeys(K2);
  assert.equal(revealSecret(sealed, aad), "", "wrong key");
  setKeys(null);
  assert.equal(revealSecret(sealed, aad), "", "no key at all");
  setKeys(K1);
  assert.equal(revealSecret(sealed, keyAad("db", "u2", "m1")), "", "bound to its user: copied onto another user's row it does not open");
  assert.equal(revealSecret(sealed, keyAad("db", "u1", "m2")), "", "and to its model");
  assert.equal(revealSecret(sealed.slice(0, -3) + "AAA", aad), "", "tampered ciphertext");
});

test("rotation: values sealed with the old key open while it is configured as PREVIOUS", () => {
  setKeys(K1);
  const old = protectSecret(KEY, aad)!;
  setKeys(K2, K1);
  assert.equal(revealSecret(old, aad), KEY);
  setKeys(K2);
  assert.equal(revealSecret(old, aad), "", "once the old key is removed the old value no longer opens");
});

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE models (id TEXT, user_id TEXT, api_key TEXT)");
  return db;
}
const insert = (db: DatabaseSync, id: string, user: string, key: string | null) => db.prepare("INSERT INTO models (id, user_id, api_key) VALUES (?, ?, ?)").run(id, user, key);
const raw = (db: DatabaseSync, id: string) => (db.prepare("SELECT api_key FROM models WHERE id = ?").get(id) as any).api_key as string | null;

test("migration 'encrypt': snapshots first, seals only plaintext, every key reads back, counts only", () => {
  setKeys(K1);
  const db = makeDb();
  insert(db, "a", "u1", KEY); insert(db, "b", "u1", "plain-two-123456"); insert(db, "c", "u2", null); insert(db, "d", "u2", "");
  insert(db, "e", "u3", protectSecret("already-sealed-key-9999", keyAad("db", "u3", "e")));
  assert.deepEqual(countModelKeys(db), { total: 3, plaintext: 2, sealed: 1, unreadable: 0 });
  const backup = path.join(tmp, "snapshot.db");
  const r = migrateModelKeys(db, "encrypt", { backupPath: backup });
  assert.deepEqual([r.examined, r.changed, r.skipped, r.failed], [3, 2, 1, 0]);
  assert.ok(fs.existsSync(backup), "snapshot written");
  const snap = new DatabaseSync(backup);
  assert.equal((snap.prepare("SELECT api_key FROM models WHERE id = 'a'").get() as any).api_key, KEY, "the snapshot is the pre-migration state");
  snap.close();
  assert.ok(isSealed(raw(db, "a")) && isSealed(raw(db, "b")));
  assert.ok(!String(raw(db, "a")).includes("sk-live"));
  assert.equal(revealSecret(raw(db, "a"), keyAad("db", "u1", "a")), KEY);
  assert.equal(revealSecret(raw(db, "b"), keyAad("db", "u1", "b")), "plain-two-123456");
  assert.equal(raw(db, "c"), null);
  assert.deepEqual(countModelKeys(db), { total: 3, plaintext: 0, sealed: 3, unreadable: 0 });
  const again = migrateModelKeys(db, "encrypt");
  assert.equal(again.changed, 0, "running it twice changes nothing");
});

test("migration 'rotate': re-seals under the new key; a value that cannot be opened is left exactly as it was", () => {
  setKeys(K1);
  const db = makeDb();
  insert(db, "a", "u1", protectSecret(KEY, keyAad("db", "u1", "a")));
  setKeys(crypto.randomBytes(32).toString("base64"));
  const orphan = protectSecret("orphan-key-value-000", keyAad("db", "u1", "orphan"));
  insert(db, "orphan", "u1", orphan); // sealed with a key that is no longer configured anywhere
  setKeys(K2, K1);
  const before = raw(db, "a");
  const r = migrateModelKeys(db, "rotate");
  assert.equal(r.changed, 1); assert.equal(r.failed, 1);
  assert.notEqual(raw(db, "a"), before);
  assert.equal(raw(db, "orphan"), orphan, "untouched");
  setKeys(K2); // the previous key can now be removed
  assert.equal(revealSecret(raw(db, "a"), keyAad("db", "u1", "a")), KEY);
  assert.equal(countModelKeys(db).unreadable, 1, "the orphan is reported, not hidden");
});

test("migration is all-or-nothing: a failure part-way leaves every row as it was", () => {
  setKeys(K1);
  const db = makeDb();
  insert(db, "a", "u1", "first-plain-key-1111"); insert(db, "b", "u1", "second-plain-key-222");
  db.exec("CREATE TRIGGER boom BEFORE UPDATE ON models WHEN NEW.rowid = 2 BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
  assert.throws(() => migrateModelKeys(db, "encrypt"), /disk full/);
  assert.equal(raw(db, "a"), "first-plain-key-1111", "the first row was rolled back too");
  assert.equal(raw(db, "b"), "second-plain-key-222");
  assert.throws(() => { setKeys(null); migrateModelKeys(db, "encrypt"); }, /PRIVACY_ENCRYPTION_KEY/, "refuses to run without a key");
});

test("db.ts: saved model keys are sealed in the file, returned decrypted, blanked on delete, and survive a restart with the key", async () => {
  setKeys(K1);
  const dbmod = await import("../server/db.js");
  const uid = crypto.randomUUID();
  dbmod.dbSaveModel({ id: "enc-model", user_id: uid, name: "Enc", provider: "custom", baseUrl: "http://127.0.0.1:1/v1", apiKey: KEY, modelName: "x" });
  const rawRow = (dbmod.db.prepare("SELECT api_key FROM models WHERE id = 'enc-model'").get() as any).api_key;
  assert.ok(isSealed(rawRow) && !rawRow.includes("sk-live"), "sealed in the database file");
  assert.equal(dbmod.dbGetModel("enc-model", uid).api_key, KEY, "read back decrypted");
  assert.equal(dbmod.dbGetModels(uid).find((m: any) => m.id === "enc-model").api_key, KEY);
  // the file on disk does not contain the key
  dbmod.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const bytes = fs.readFileSync(process.env.DARKNESS_DB_PATH!);
  assert.ok(!bytes.includes(Buffer.from(KEY)), "the key is not in the database file");
  // a wrong/missing key reads as no key, not as ciphertext
  setKeys(K2);
  assert.equal(dbmod.dbGetModel("enc-model", uid).api_key, null);
  setKeys(K1);
  // an update that does not change the key re-seals (fresh IV) and still reads
  dbmod.dbSaveModel({ id: "enc-model", user_id: uid, name: "Enc2", provider: "custom", apiKey: dbmod.dbGetModel("enc-model", uid).api_key, modelName: "x" });
  assert.equal(dbmod.dbGetModel("enc-model", uid).api_key, KEY);
  // delete: gone, and not recoverable from the freed pages
  dbmod.dbDeleteModel("enc-model", uid);
  assert.equal(dbmod.dbGetModel("enc-model", uid), null);
  dbmod.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  assert.ok(!fs.readFileSync(process.env.DARKNESS_DB_PATH!).includes(Buffer.from(rawRow)), "the sealed value was zeroed out, not left in a free page");
  // plaintext mode (no vault key) behaves exactly as before
  setKeys(null);
  dbmod.dbSaveModel({ id: "plain-model", user_id: uid, name: "Plain", provider: "custom", apiKey: "plain-key-0000000000", modelName: "x" });
  assert.equal(dbmod.dbGetModel("plain-model", uid).api_key, "plain-key-0000000000");
});

test("an empty key never erases a stored one (a server started without the vault key must not write 'no key' over sealed keys)", async () => {
  setKeys(K1);
  const dbmod = await import("../server/db.js");
  const uid = crypto.randomUUID();
  dbmod.dbSaveModel({ id: "keep-me", user_id: uid, name: "Keep", provider: "custom", apiKey: KEY, modelName: "x" });
  setKeys(null); // the vault key is missing: the key reads as empty ...
  assert.equal(dbmod.dbGetModel("keep-me", uid).api_key, null);
  dbmod.dbSaveModel({ id: "keep-me", user_id: uid, name: "Keep renamed", provider: "custom", apiKey: "", modelName: "x" }); // ... and something saves the model back
  setKeys(K1);
  assert.equal(dbmod.dbGetModel("keep-me", uid).api_key, KEY, "the sealed key survived");
  assert.equal(dbmod.dbGetModel("keep-me", uid).name, "Keep renamed", "other fields still update");
});

test("migration leaves no plaintext behind in the database file or its write-ahead log (only in the snapshot it was told to write)", () => {
  setKeys(K1);
  const file = path.join(tmp, "migrate-file.db");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE models (id TEXT, user_id TEXT, api_key TEXT)");
  const secret = "sk-wal-residue-" + crypto.randomBytes(8).toString("hex");
  insert(db, "w", "u1", secret);
  assert.ok(fs.readFileSync(file + "-wal").includes(Buffer.from(secret)) || fs.readFileSync(file).includes(Buffer.from(secret)), "the plaintext is on disk before the migration");
  migrateModelKeys(db, "encrypt", { backupPath: path.join(tmp, "residue-snapshot.db") });
  const files = [file, file + "-wal"].filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f));
  assert.ok(files.every((b) => !b.includes(Buffer.from(secret))), "no plaintext left in the file or the log");
  assert.ok(fs.readFileSync(path.join(tmp, "residue-snapshot.db")).includes(Buffer.from(secret)), "the snapshot is the one intentional plaintext copy");
  db.close();
});
