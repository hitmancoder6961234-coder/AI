import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

/**
 * Boot-time schema migration (server/db-migrations.ts + initDatabaseSchema in server/db.ts).
 *
 * Every test uses its own temporary database file. The fixtures are the "legacy" shapes the migration was written for: the current table minus
 * `user_id` (projects, conversations, workspace_files) and `models` with a primary key on `id` alone, plus child tables with the same
 * `ON DELETE CASCADE` foreign keys the real schema has. (No earlier schema definition exists in the git history: the first committed db.ts
 * already contained the migration, so the legacy columns are taken from the migration's own SELECT lists.)
 *
 * What used to happen, proven with the same fixtures: a failed copy dropped the renamed original (all rows lost), and even a successful copy
 * deleted every child row through an implicit cascade and left the children pointing at a table that no longer existed (SECURITY.md #63, #64).
 */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "darkness-mig-"));
process.env.DARKNESS_STORAGE_ROOT = ROOT;
process.env.DARKNESS_DB_PATH = path.join(ROOT, "app.db");
const { initDatabaseSchema } = await import("../server/db.js");
const mig = await import("../server/db-migrations.js");

after(() => { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* the application connection keeps its file open on Windows */ } });

let counter = 0;
const file = (name: string) => path.join(ROOT, `${name}-${++counter}.db`);
const open = (f: string) => { const d = new DatabaseSync(f); d.exec("PRAGMA foreign_keys = ON"); return d; };
const events: Array<{ level: string; event: string; fields?: Record<string, unknown> }> = [];
const log = {
  info: (event: string, fields?: Record<string, unknown>) => { events.push({ level: "info", event, fields }); },
  warn: (event: string, fields?: Record<string, unknown>) => { events.push({ level: "warn", event, fields }); },
  error: (event: string, fields?: Record<string, unknown>) => { events.push({ level: "error", event, fields }); },
};
const seen = (event: string) => events.filter((e) => e.event === event).length;
const snapDir = () => fs.mkdtempSync(path.join(ROOT, "snap-"));
const q = (d: DatabaseSync, sql: string, ...a: Array<string | number | null>) => JSON.parse(JSON.stringify(d.prepare(sql).all(...a))) as Array<Record<string, unknown>>;
const DEFAULT_OWNER = "a8331e01-8219-c7e0-27ba-93b91f0c20aa"; // legacy "user_default" rows end up owned by this id (the existing remap, step 18 of the schema work)
const count = (d: DatabaseSync, t: string) => Number((d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number | bigint }).n);
const version = (d: DatabaseSync) => Number((d.prepare("PRAGMA user_version").get() as { user_version: number | bigint }).user_version);
const schemaDump = (d: DatabaseSync) => JSON.stringify(q(d, "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name"));
const rowsDump = (d: DatabaseSync, tables: string[]) => JSON.stringify(tables.map((t) => [t, q(d, `SELECT * FROM ${t} ORDER BY rowid`)]));
const cols = (d: DatabaseSync, t: string) => q(d, `PRAGMA table_info(${t})`).map((c) => `${c.name}|${c.type}|${c.notnull}|${c.dflt_value}|${c.pk}`).join(",");
const fkTarget = (d: DatabaseSync, t: string) => (String((d.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(t) as { sql: string }).sql).match(/REFERENCES\s+"?(\w+)"?/i) || [])[1];
const init = (d: DatabaseSync, dir = snapDir(), extra: Record<string, unknown> = {}) => initDatabaseSchema(d, { snapshotDir: dir, log, ...extra });

interface LegacyOptions { empty?: boolean; modelsWithUserId?: boolean; projectsColumns?: string; conversationsColumns?: string; extraConversationColumn?: boolean }

/** A database as an early build left it. */
function legacyDb(f: string, o: LegacyOptions = {}) {
  const d = open(f);
  d.exec(`
    CREATE TABLE projects (${o.projectsColumns ?? "id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, source_type TEXT DEFAULT 'upload', root_path TEXT, status TEXT DEFAULT 'ready', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_indexed_at INTEGER, metadata TEXT"});
    CREATE TABLE project_files (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL, extension TEXT, language TEXT, size INTEGER DEFAULT 0, hash TEXT, version INTEGER DEFAULT 1, content TEXT, is_binary INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE);
    CREATE INDEX idx_project_files_proj ON project_files(project_id);
    CREATE TABLE artifacts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, file_id TEXT, name TEXT NOT NULL, path TEXT, mime_type TEXT, artifact_type TEXT, version INTEGER DEFAULT 1, hash TEXT, content TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE);
    CREATE TABLE conversations (${o.conversationsColumns ?? "id TEXT PRIMARY KEY, project_id TEXT, title TEXT NOT NULL, model_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL"}${o.extraConversationColumn ? ", pinned_old INTEGER" : ""});
    CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, model_id TEXT, attachments TEXT, created_at INTEGER NOT NULL, FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);
    CREATE INDEX idx_messages_conv ON messages(conversation_id);
    CREATE TABLE workspace_files (id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime TEXT, size INTEGER DEFAULT 0, file_type TEXT, content TEXT, uploaded_at INTEGER NOT NULL);
    CREATE TABLE models (id TEXT PRIMARY KEY, ${o.modelsWithUserId ? "user_id TEXT DEFAULT 'user_default', " : ""}name TEXT NOT NULL, provider TEXT NOT NULL, base_url TEXT, api_key TEXT, model_name TEXT NOT NULL, model_type TEXT, capabilities TEXT, context_window INTEGER, max_output_tokens INTEGER, default_temperature REAL, default_top_p REAL, supports_streaming INTEGER DEFAULT 1, enabled INTEGER DEFAULT 1, status TEXT, is_user INTEGER DEFAULT 0);
  `);
  if (!o.empty) {
    const seed = (table: string, rows: Array<Record<string, unknown>>) => {
      const have = q(d, `PRAGMA table_info(${table})`).map((c) => String(c.name));
      for (const row of rows) {
        const keys = Object.keys(row).filter((k) => have.includes(k));
        d.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((k) => row[k] as string | number | null));
      }
    };
    seed("projects", [{ id: "p1", name: "Legacy project", description: "kept", created_at: 10, updated_at: 20 }, { id: "p2", name: "Second", description: null, created_at: 11, updated_at: 21 }]);
    seed("project_files", [{ id: "f1", project_id: "p1", path: "a.txt", name: "a.txt", created_at: 1, updated_at: 2 }, { id: "f2", project_id: "p1", path: "b.txt", name: "b.txt", created_at: 1, updated_at: 2 }, { id: "f3", project_id: "p2", path: "c.txt", name: "c.txt", created_at: 1, updated_at: 2 }]);
    seed("artifacts", [{ id: "a1", project_id: "p1", name: "report", created_at: 1, updated_at: 2 }]);
    seed("conversations", [{ id: "c1", title: "Legacy chat", created_at: 1, updated_at: 2 }, { id: "c2", title: "Other chat", created_at: 3, updated_at: 4 }]);
    seed("messages", [{ id: "m1", conversation_id: "c1", role: "user", content: "hello", created_at: 1 }, { id: "m2", conversation_id: "c1", role: "assistant", content: "hi", created_at: 2 }, { id: "m3", conversation_id: "c2", role: "user", content: "x", created_at: 3 }]);
    seed("workspace_files", [{ id: "w1", filename: "notes.txt", size: 12, uploaded_at: 5 }]);
    seed("models", [{ id: "m-a", name: "Model A", provider: "openai", model_name: "gpt-x", api_key: "stored-test-key-1" }, { id: "m-b", name: "Model B", provider: "gemini", model_name: "gem-y", api_key: null }]);
  }
  return d;
}
const TABLES = ["projects", "project_files", "artifacts", "conversations", "messages", "workspace_files", "models"];

test("a legacy database migrates with every row, every child row and correct foreign keys (the case that used to delete all children)", () => {
  const d = legacyDb(file("legacy"));
  const before = Object.fromEntries(TABLES.map((t) => [t, count(d, t)]));
  init(d);
  for (const t of TABLES) assert.equal(count(d, t) - (t === "projects" ? 1 : 0), before[t], `${t}: row count`); // + the seeded "global" project
  assert.deepEqual(q(d, "SELECT id, user_id, name, description FROM projects WHERE id IN ('p1','p2') ORDER BY id"), [
    { id: "p1", user_id: DEFAULT_OWNER, name: "Legacy project", description: "kept" }, { id: "p2", user_id: DEFAULT_OWNER, name: "Second", description: null }]);
  assert.equal(fkTarget(d, "project_files"), "projects", "children still point at `projects`");
  assert.equal(fkTarget(d, "artifacts"), "projects");
  assert.equal(fkTarget(d, "messages"), "conversations");
  assert.equal(q(d, "PRAGMA foreign_key_check").length, 0);
  assert.deepEqual(q(d, "SELECT id FROM messages WHERE conversation_id = 'c1' ORDER BY id").map((r) => r.id), ["m1", "m2"]);
  assert.equal(version(d), mig.SCHEMA_VERSION);
});

test("the foreign keys really work afterwards: a new child row can be inserted, and a cascade removes only that parent's children", () => {
  const d = legacyDb(file("fk-works"));
  init(d);
  d.exec("INSERT INTO project_files (id, project_id, path, name, created_at, updated_at) VALUES ('f9','p1','new.txt','new.txt',1,2)");
  d.exec("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('m9','c1','user','more',9)");
  assert.throws(() => d.exec("INSERT INTO project_files (id, project_id, path, name, created_at, updated_at) VALUES ('fx','nope','z','z',1,2)"), /FOREIGN KEY/);
  d.exec("DELETE FROM projects WHERE id = 'p2'");
  assert.deepEqual(q(d, "SELECT id FROM project_files ORDER BY id").map((r) => r.id), ["f1", "f2", "f9"]);
});

test("a rebuilt table has exactly the shape of a freshly created one (the DDL in db-migrations.ts cannot drift from db.ts)", () => {
  const legacy = legacyDb(file("shape-legacy"), { modelsWithUserId: true });
  init(legacy);
  const fresh = open(file("shape-fresh"));
  init(fresh);
  for (const t of ["projects", "conversations", "workspace_files", "models"]) assert.equal(cols(legacy, t), cols(fresh, t), t);
});

test("models: the legacy primary key (id alone), with and without a user_id column, becomes (user_id, id); NULL user ids get the default owner", () => {
  for (const withUser of [false, true]) {
    const d = legacyDb(file(`models-${withUser}`), { modelsWithUserId: withUser });
    if (withUser) d.exec("UPDATE models SET user_id = NULL WHERE id = 'm-b'");
    init(d);
    assert.equal(count(d, "models"), 2);
    assert.deepEqual(q(d, "SELECT id, user_id, api_key FROM models ORDER BY id"), [
      { id: "m-a", user_id: DEFAULT_OWNER, api_key: "stored-test-key-1" }, { id: "m-b", user_id: DEFAULT_OWNER, api_key: null }]);
    assert.match(String((d.prepare("SELECT sql FROM sqlite_master WHERE name = 'models'").get() as { sql: string }).sql), /PRIMARY KEY \(user_id, id\)/);
  }
});

test("the current schema is a no-op: no snapshot, rows untouched, version stamped, and a repeated start changes nothing", () => {
  const d = open(file("current"));
  const dir = snapDir();
  init(d, dir);
  d.exec("INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES ('px', '11111111-1111-4111-8111-111111111111', 'mine', 1, 2)");
  const dump = rowsDump(d, ["projects", "users"]);
  assert.equal(version(d), mig.SCHEMA_VERSION);
  assert.equal(fs.readdirSync(dir).length, 0, "no snapshot for a database that needs no destructive step");
  for (let i = 0; i < 3; i++) init(d, dir);
  assert.equal(rowsDump(d, ["projects", "users"]), dump);
  assert.equal(fs.readdirSync(dir).length, 0);
  assert.equal(version(d), mig.SCHEMA_VERSION);
});

test("repeated starts of a legacy database migrate once: one snapshot, same data, no second rebuild", () => {
  const d = legacyDb(file("repeat"));
  const dir = snapDir();
  init(d, dir);
  const dump = rowsDump(d, TABLES);
  const rebuilds = seen("migration_table_rebuilt");
  init(d, dir); init(d, dir);
  assert.equal(fs.readdirSync(dir).length, 1);
  assert.equal(seen("migration_table_rebuilt"), rebuilds);
  assert.equal(rowsDump(d, TABLES), dump);
});

test("empty legacy tables migrate too", () => {
  const d = legacyDb(file("empty"), { empty: true });
  init(d);
  assert.equal(count(d, "conversations"), 0);
  assert.equal(count(d, "workspace_files"), 0);
  assert.equal(count(d, "models"), 0);
  assert.match(cols(d, "conversations"), /user_id\|TEXT\|1\|'user_default'\|0/);
});

test("an older shape that lacks OPTIONAL columns migrates, with the defaults the current table defines", () => {
  const d = legacyDb(file("optional-missing"), {
    projectsColumns: "id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL",
    conversationsColumns: "id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL",
  });
  init(d);
  assert.deepEqual(q(d, "SELECT id, name, source_type, status, last_indexed_at FROM projects WHERE id = 'p1'"), [{ id: "p1", name: "Legacy project", source_type: "upload", status: "ready", last_indexed_at: null }]);
  assert.equal(count(d, "conversations"), 2);
  assert.equal(count(d, "messages"), 3);
});

test("an unexpected shape is refused BEFORE anything changes: a missing required column, an unknown extra column, a dependent view, a leftover table", () => {
  const cases: Array<[string, LegacyOptions, (d: DatabaseSync) => void, RegExp]> = [
    ["required", { projectsColumns: "id TEXT PRIMARY KEY, description TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL" }, () => {}, /lacks required column/],
    ["extra", { extraConversationColumn: true }, () => {}, /unexpected columns|columns this build does not know/],
    ["view", {}, (d) => d.exec("CREATE VIEW project_names AS SELECT name FROM projects"), /dependent view|depends on the table/],
    ["leftover", {}, (d) => d.exec("CREATE TABLE __migrating_projects (x TEXT)"), /already exists/],
  ];
  for (const [name, opts, prepare, message] of cases) {
    const d = legacyDb(file(`refuse-${name}`), opts);
    prepare(d);
    const schema = schemaDump(d);
    const rows = q(d, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((r) => String(r.name)).filter((t) => t !== "__migrating_projects");
    const dump = rowsDump(d, rows);
    const dir = snapDir();
    assert.throws(() => init(d, dir), (e: unknown) => e instanceof mig.MigrationError && message.test(e.message), name);
    assert.equal(schemaDump(d), schema, `${name}: the schema is exactly as it was`);
    assert.equal(rowsDump(d, rows), dump, `${name}: no row changed`);
    assert.equal(version(d), 0, `${name}: no version stamp`);
    assert.equal(fs.readdirSync(dir).length, 0, `${name}: refused before the snapshot`);
  }
});

test("a copy that FAILS (a legacy row the current table cannot hold) rolls everything back and stops: nothing is dropped, no row is lost", () => {
  const d = legacyDb(file("copy-fails"), { conversationsColumns: "id TEXT PRIMARY KEY, project_id TEXT, title TEXT, model_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL" });
  d.exec("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('c3', NULL, 5, 6)"); // the old table allowed a NULL title, the current one does not
  const schema = schemaDump(d);
  const dump = rowsDump(d, TABLES);
  const dir = snapDir();
  assert.throws(() => init(d, dir), /rolled back|NOT NULL/i);
  assert.equal(schemaDump(d), schema, "original tables and their foreign keys are exactly as before");
  assert.equal(rowsDump(d, TABLES), dump, "every legacy row, children included, is still there");
  assert.equal(version(d), 0);
  assert.equal(q(d, "SELECT name FROM sqlite_master WHERE name LIKE '\\_\\_migrating%' ESCAPE '\\'").length, 0, "no temporary table is left");
  assert.equal(q(d, "SELECT value FROM (SELECT 1 AS value) WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE name = 'projects_old')").length, 0);
  assert.equal(fs.readdirSync(dir).length, 1, "the snapshot taken before the attempt is kept");
  assert.equal(q(d, "PRAGMA foreign_keys").length, 1);
  assert.equal(Number((d.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number | bigint }).foreign_keys), 1, "foreign keys are switched back on");
});

test("a rebuild that fails part-way (after some tables were already rebuilt) rolls ALL of them back", () => {
  const d = legacyDb(file("rebuild-fails"));
  const schema = schemaDump(d);
  const dump = rowsDump(d, TABLES);
  let copied = 0;
  assert.throws(() => init(d, snapDir(), { hooks: { afterCopy: () => { if (++copied === 3) throw new Error("injected failure after the third copy"); } } }), /injected failure/);
  assert.ok(copied >= 3);
  assert.equal(schemaDump(d), schema);
  assert.equal(rowsDump(d, TABLES), dump);
  assert.equal(version(d), 0);
  // and the next start, without the fault, completes normally
  init(d);
  assert.equal(version(d), mig.SCHEMA_VERSION);
  assert.equal(count(d, "project_files"), 3);
});

test("a failure right before COMMIT also rolls everything back", () => {
  const d = legacyDb(file("before-commit"));
  const schema = schemaDump(d);
  assert.throws(() => init(d, snapDir(), { hooks: { beforeCommit: () => { throw new Error("injected failure before commit"); } } }), /injected failure/);
  assert.equal(schemaDump(d), schema);
  assert.equal(count(d, "messages"), 3);
});

test("an interrupted migration (the process dies mid-rebuild) leaves the original database intact and recoverable", () => {
  const f = file("interrupted");
  const d = legacyDb(f);
  const schema = schemaDump(d);
  const dump = rowsDump(d, TABLES);
  d.close();
  const code = `
    import { DatabaseSync } from "node:sqlite";
    const m = await import(${JSON.stringify(pathToFileURL(path.resolve("server/db-migrations.ts")).href)});
    const db = new DatabaseSync(${JSON.stringify(f)});
    db.exec("PRAGMA foreign_keys = ON");
    const plan = m.planMigration(db);
    m.applyRebuilds(db, plan, { info() {}, warn() {}, error() {} }, { afterCopy: () => process.exit(7) });
  `;
  const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { encoding: "utf8", cwd: process.cwd() });
  assert.equal(r.status, 7, `the child died as planned: ${r.stderr.slice(0, 200)}`);
  const again = open(f);
  assert.equal(String((again.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check), "ok");
  assert.equal(schemaDump(again), schema, "the half-done transaction was never committed");
  assert.equal(rowsDump(again, TABLES), dump);
  init(again); // and the database can still be migrated afterwards
  assert.equal(count(again, "project_files"), 3);
});

test("the snapshot is a readable copy of the database as it was before the rebuild; if it cannot be written, nothing is changed", () => {
  const d = legacyDb(file("snapshot"));
  const dir = snapDir();
  const dump = rowsDump(d, TABLES);
  init(d, dir);
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^pre-migrate-.*\.db$/);
  const snap = new DatabaseSync(path.join(dir, files[0]), { readOnly: true });
  assert.equal(rowsDump(snap, TABLES), dump, "the snapshot holds the legacy rows exactly");
  assert.equal(String((snap.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check), "ok");
  snap.close();

  const d2 = legacyDb(file("snapshot-blocked"));
  const schema = schemaDump(d2);
  const blocked = path.join(ROOT, "not-a-folder");
  fs.writeFileSync(blocked, "x");
  assert.throws(() => initDatabaseSchema(d2, { snapshotDir: blocked, log }), (e: unknown) => e instanceof mig.MigrationError && e.step === "snapshot");
  assert.equal(schemaDump(d2), schema, "without a snapshot the database is not touched");
});

test("a database stamped by a NEWER build is refused unless the operator overrides it; a failed start-up never keeps a version stamp", () => {
  const d = open(file("newer"));
  init(d);
  d.exec("PRAGMA user_version = 99");
  assert.throws(() => init(d), (e: unknown) => e instanceof mig.MigrationError && /newer/.test(e.message));
  init(d, snapDir(), { allowNewerSchema: true });
  assert.equal(version(d), 99, "the override does not lower the stamp");

  const bad = open(file("stage2-fails"));
  bad.exec("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT)"); // an unexpected users table: no e-mail column, so the seed cannot work
  assert.throws(() => init(bad));
  assert.equal(version(bad), 0, "stage 2 failed, so nothing was stamped");
});

test("project_files duplicates are removed once, after a snapshot, keeping the oldest row; a later start does nothing", () => {
  const d = open(file("dedupe"));
  const dir = snapDir();
  init(d, dir);
  d.exec("DROP INDEX idx_project_files_unique_path"); // the state older builds left: duplicates allowed
  d.exec("INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES ('pd','user_default','dup',1,2)");
  d.exec("INSERT INTO project_files (id, project_id, path, name, created_at, updated_at) VALUES ('d1','pd','x.txt','x.txt',1,1), ('d2','pd','x.txt','x.txt',1,2), ('d3','pd','y.txt','y.txt',1,2)");
  const warns = seen("migration_duplicate_project_files_removed");
  init(d, dir);
  assert.deepEqual(q(d, "SELECT id FROM project_files WHERE project_id = 'pd' ORDER BY id").map((r) => r.id), ["d1", "d3"]);
  assert.equal(seen("migration_duplicate_project_files_removed"), warns + 1);
  assert.equal(fs.readdirSync(dir).length, 1, "a snapshot was written because rows were about to be removed");
  assert.equal(q(d, "SELECT 1 FROM sqlite_master WHERE name = 'idx_project_files_unique_path'").length, 1);
  init(d, dir);
  assert.equal(fs.readdirSync(dir).length, 1);
  assert.equal(count(d, "project_files"), 2);
});

test("the legacy user-id remap is all-or-nothing per mapping: a foreign-key failure rolls the whole mapping back, is reported, and the start-up carries on", () => {
  const d = open(file("remap"));
  init(d);
  // the state an older database can be in: the legacy owner exists and has a session, the default UUID owner does not exist yet
  d.exec(`DELETE FROM users WHERE id = '${DEFAULT_OWNER}'`);
  d.exec("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ('t1', 'user_default', 1, 9999999999999)");
  d.exec("INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES ('pr', 'user_default', 'remap me', 1, 2)");
  const before = seen("legacy_user_id_remap_skipped");
  init(d); // must not throw: renaming the owner is refused by the foreign key from sessions
  assert.ok(seen("legacy_user_id_remap_skipped") > before, "the skipped mapping is reported");
  assert.equal((q(d, "SELECT user_id FROM sessions WHERE token = 't1'")[0] as { user_id: string }).user_id, "user_default", "the session stays with its owner");
  assert.equal((q(d, "SELECT user_id FROM projects WHERE id = 'pr'")[0] as { user_id: string }).user_id, "user_default", "and so does the project: no table is remapped on its own");
  assert.equal(q(d, "PRAGMA foreign_key_check").length, 0);
});

test("the application refuses to start on a database it cannot migrate safely, and starts on one it can (a real child process importing server/db.ts)", () => {
  const run = (f: string) => spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(path.resolve("server/db.ts")).href)}); console.log("STARTED");`], {
    encoding: "utf8", cwd: process.cwd(), env: { ...process.env, DARKNESS_DB_PATH: f, DARKNESS_STORAGE_ROOT: path.join(ROOT, `boot-${++counter}`), LOG_FORMAT: "json" },
  });
  const badFile = file("boot-bad");
  const bad = legacyDb(badFile, { conversationsColumns: "id TEXT PRIMARY KEY, project_id TEXT, title TEXT, model_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL" });
  bad.exec("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('c3', NULL, 5, 6)");
  const dump = rowsDump(bad, TABLES);
  bad.close();
  const refused = run(badFile);
  assert.notEqual(refused.status, 0, "a failed migration is a failed start");
  assert.ok(!/STARTED/.test(refused.stdout), "it never reports a successful start");
  const check = open(badFile);
  assert.equal(rowsDump(check, TABLES), dump, "the legacy data is intact after the refused start");
  check.close();

  const goodFile = file("boot-good");
  legacyDb(goodFile).close();
  const ok = run(goodFile);
  assert.equal(ok.status, 0, ok.stderr.slice(0, 300));
  assert.match(ok.stdout, /STARTED/);
  const after1 = open(goodFile);
  assert.equal(count(after1, "project_files"), 3);
  assert.equal(count(after1, "messages"), 3);
  assert.equal(version(after1), mig.SCHEMA_VERSION);
});
