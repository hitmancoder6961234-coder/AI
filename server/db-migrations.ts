import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Safe schema migration for the SQLite database (data layer).
 *
 * WHY THIS EXISTS. Databases created by early versions have tables without `user_id` (projects, conversations, workspace_files) and a `models`
 * table whose primary key is `id` alone. The old boot code converted them with "rename the table to X_old, create the new one, copy, drop X_old".
 * Two things were wrong with that, both proven with throw-away databases (SECURITY.md #63, #64):
 *
 *   1. If the copy failed, the error handler dropped the renamed original: every row of the table was lost, and the outer transaction committed.
 *   2. Even when the copy succeeded, `ALTER TABLE ... RENAME` rewrote the foreign keys of every child table (project_files, messages, ...) to
 *      point at `X_old`, and `DROP TABLE X_old` then performed an implicit `DELETE` that fired `ON DELETE CASCADE`: all child rows were deleted
 *      and the children were left pointing at a table that no longer exists.
 *
 * WHAT IT DOES NOW (the procedure SQLite documents for "other kinds of table schema changes", https://www.sqlite.org/lang_altertable.html):
 *   - Everything is checked BEFORE anything is changed: an unexpected shape (a column the new table does not know, a required column missing, a
 *     view that depends on the table, a leftover temporary table) makes the start-up refuse, with the data untouched.
 *   - A consistent snapshot (`VACUUM INTO`) is written first whenever a destructive step will run, and the start-up stops if it cannot be written.
 *   - Foreign keys are switched OFF (the pragma is a no-op inside a transaction, so it is set before BEGIN), ALL rebuilds run inside ONE
 *     `BEGIN IMMEDIATE` transaction (SQLite DDL is transactional): create the new table under a temporary name, copy, check the row count, drop
 *     the old table, rename the new one, recreate the old indexes and triggers. Any error rolls everything back and is rethrown; nothing is
 *     dropped on failure and nothing is swallowed.
 *   - `PRAGMA foreign_key_check` must not report MORE problems after the rebuild than before it (orphans that already existed are logged, not
 *     blamed on the migration), otherwise it rolls back. Foreign keys are switched back on afterwards, whatever happened.
 *   - Detection is by table shape, so a repeated start-up finds nothing to do (idempotent). `PRAGMA user_version` is a marker and a guard, not
 *     the source of truth: see SCHEMA_VERSION.
 */

/**
 * `PRAGMA user_version` strategy.
 *   0  = never stamped: any database created by an earlier build, legacy-shaped or current-shaped.
 *   1  = stamped by this code after a complete, successful initialisation (set inside the same transaction as the rest of the schema work, so a
 *        failed start-up never leaves a version behind).
 * Older builds do not read the field, so rolling the code back is safe. A database stamped with a number HIGHER than this constant was written
 * by a newer build: starting would risk an older build "migrating" something it does not understand, so the start-up refuses (override for an
 * informed operator: DARKNESS_ALLOW_NEWER_SCHEMA=true). Bump the constant only together with a migration that needs it.
 */
export const SCHEMA_VERSION = 1;

export interface MigrationLog {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface MigrationHooks {
  /** test seam only: runs after a table was copied and verified, before it replaces the original (inside the transaction) */
  afterCopy?: (table: string) => void;
  /** test seam only: runs after every rebuild, right before COMMIT */
  beforeCommit?: () => void;
}

export interface MigrationOptions {
  /** folder for the pre-migration snapshot (production: <storage root>/backups) */
  snapshotDir: string;
  log: MigrationLog;
  allowNewerSchema?: boolean;
  hooks?: MigrationHooks;
}

export class MigrationError extends Error {
  readonly step: string;
  constructor(step: string, detail: string) {
    super(`Database migration refused at "${step}": ${detail}`);
    this.name = "MigrationError";
    this.step = step;
  }
}

interface ColInfo { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }

interface RebuildSpec {
  table: string;
  /** columns of the CURRENT table, in order */
  columns: string[];
  /** columns the legacy table must have (NOT NULL without default in the current table) */
  required: string[];
  /** SQL literal used when the legacy table lacks the column */
  missing: Record<string, string>;
  /** SQL expression for a column the legacy table HAS (default: the column itself) */
  existing?: Record<string, string>;
  createSql: (name: string) => string;
  isLegacy: (info: ColInfo[]) => boolean;
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

// The DDL below equals the CREATE TABLE statements in db.ts (a unit test compares the result of a rebuild with a freshly created table).
const SPECS: RebuildSpec[] = [
  {
    table: "projects",
    columns: ["id", "user_id", "name", "description", "source_type", "root_path", "status", "created_at", "updated_at", "last_indexed_at", "metadata"],
    required: ["id", "name", "created_at", "updated_at"],
    missing: { user_id: "'user_default'", source_type: "'upload'", status: "'ready'" },
    createSql: (n) => `CREATE TABLE ${q(n)} (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'user_default',
      name TEXT NOT NULL,
      description TEXT,
      source_type TEXT DEFAULT 'upload',
      root_path TEXT,
      status TEXT DEFAULT 'ready',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_indexed_at INTEGER,
      metadata TEXT
    )`,
    isLegacy: (info) => !info.some((c) => c.name === "user_id"),
  },
  {
    table: "conversations",
    columns: ["id", "user_id", "project_id", "title", "model_id", "created_at", "updated_at"],
    required: ["id", "title", "created_at", "updated_at"],
    missing: { user_id: "'user_default'" },
    createSql: (n) => `CREATE TABLE ${q(n)} (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'user_default',
      project_id TEXT,
      title TEXT NOT NULL,
      model_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    isLegacy: (info) => !info.some((c) => c.name === "user_id"),
  },
  {
    table: "workspace_files",
    columns: ["id", "user_id", "filename", "mime", "size", "file_type", "content", "uploaded_at"],
    required: ["id", "filename", "uploaded_at"],
    missing: { user_id: "'user_default'", size: "0" },
    createSql: (n) => `CREATE TABLE ${q(n)} (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'user_default',
      filename TEXT NOT NULL,
      mime TEXT,
      size INTEGER DEFAULT 0,
      file_type TEXT,
      content TEXT,
      uploaded_at INTEGER NOT NULL
    )`,
    isLegacy: (info) => !info.some((c) => c.name === "user_id"),
  },
  {
    table: "models",
    columns: ["id", "user_id", "name", "provider", "base_url", "api_key", "model_name", "model_type", "capabilities", "context_window", "max_output_tokens",
      "default_temperature", "default_top_p", "supports_streaming", "enabled", "status", "is_user"],
    required: ["id", "name", "provider", "model_name"],
    missing: { user_id: "'user_default'", supports_streaming: "1", enabled: "1", is_user: "0" },
    existing: { user_id: "COALESCE(\"user_id\", 'user_default')" },
    createSql: (n) => `CREATE TABLE ${q(n)} (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'user_default',
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      base_url TEXT,
      api_key TEXT,
      model_name TEXT NOT NULL,
      model_type TEXT,
      capabilities TEXT,
      context_window INTEGER,
      max_output_tokens INTEGER,
      default_temperature REAL,
      default_top_p REAL,
      supports_streaming INTEGER DEFAULT 1,
      enabled INTEGER DEFAULT 1,
      status TEXT,
      is_user INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, id)
    )`,
    isLegacy: (info) => {
      const pk = info.filter((c) => c.pk > 0);
      return pk.length === 1 && pk[0].name === "id";
    },
  },
];

const tableInfo = (db: DatabaseSync, table: string): ColInfo[] => db.prepare(`PRAGMA table_info(${q(table)})`).all() as unknown as ColInfo[];
const countRows = (db: DatabaseSync, table: string): number => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${q(table)}`).get() as { n: number | bigint }).n);
const tableExists = (db: DatabaseSync, table: string): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
const fkViolations = (db: DatabaseSync): number => db.prepare("PRAGMA foreign_key_check").all().length;

export function readSchemaVersion(db: DatabaseSync): number {
  return Number((db.prepare("PRAGMA user_version").get() as { user_version: number | bigint }).user_version);
}

/** Refuses a database that a NEWER build has stamped (see SCHEMA_VERSION). */
export function assertSchemaVersion(db: DatabaseSync, allowNewer = false): void {
  const v = readSchemaVersion(db);
  if (v > SCHEMA_VERSION && !allowNewer) {
    throw new MigrationError("schema version", `the database is stamped with schema version ${v}, newer than the ${SCHEMA_VERSION} this build understands. Start the newer build, restore a backup, or set DARKNESS_ALLOW_NEWER_SCHEMA=true if you know what you are doing`);
  }
}

/** Stamps the schema version. Call it INSIDE the transaction that completes the initialisation, so a failed start-up never keeps a stamp. */
export function stampSchemaVersion(db: DatabaseSync): void {
  if (readSchemaVersion(db) < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

export interface PlannedRebuild { spec: RebuildSpec; rows: number; oldColumns: string[] }

export interface MigrationPlan {
  rebuilds: PlannedRebuild[];
  /** duplicate (project_id, path) rows in project_files that creating the unique index would remove */
  duplicateProjectFiles: number;
}

/** Read-only: decides what would run and REFUSES unexpected shapes. Changes nothing. */
export function planMigration(db: DatabaseSync): MigrationPlan {
  const rebuilds: PlannedRebuild[] = [];
  for (const spec of SPECS) {
    const info = tableInfo(db, spec.table);
    if (info.length === 0 || !spec.isLegacy(info)) continue;
    const oldColumns = info.map((c) => c.name);
    const unknown = oldColumns.filter((c) => !spec.columns.includes(c));
    if (unknown.length) throw new MigrationError(`${spec.table} (unexpected columns)`, `the existing table has columns this build does not know (${unknown.join(", ")}); copying it would drop their data. Nothing was changed`);
    const lacking = spec.required.filter((c) => !oldColumns.includes(c));
    if (lacking.length) throw new MigrationError(`${spec.table} (unexpected shape)`, `the existing table lacks required column(s) ${lacking.join(", ")}. Nothing was changed`);
    const tmp = tmpName(spec.table);
    if (tableExists(db, tmp)) throw new MigrationError(`${spec.table} (leftover)`, `a table named ${tmp} already exists; it is not touched. Inspect it, then rename or drop it yourself`);
    for (const v of db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'view'").all() as unknown as { name: string; sql: string }[]) {
      if (new RegExp(`\\b${spec.table}\\b`, "i").test(v.sql || "")) throw new MigrationError(`${spec.table} (dependent view)`, `view ${v.name} depends on the table; rebuilding it is not automated. Nothing was changed`);
    }
    rebuilds.push({ spec, rows: countRows(db, spec.table), oldColumns });
  }
  let duplicateProjectFiles = 0;
  if (tableExists(db, "project_files") && !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_project_files_unique_path'").get()) {
    duplicateProjectFiles = Number((db.prepare("SELECT COUNT(*) AS n FROM project_files WHERE rowid NOT IN (SELECT MIN(rowid) FROM project_files GROUP BY project_id, path)").get() as { n: number | bigint }).n);
  }
  return { rebuilds, duplicateProjectFiles };
}

const tmpName = (table: string) => `__migrating_${table}`;

/** Consistent copy of the whole database. Throws (so the start-up stops) if it cannot be written or does not verify. */
export function snapshotDatabase(db: DatabaseSync, dir: string): string {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let file = path.join(dir, `pre-migrate-${stamp}.db`);
    for (let i = 1; fs.existsSync(file); i++) file = path.join(dir, `pre-migrate-${stamp}-${i}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const check = new DatabaseSync(file, { readOnly: true });
    try {
      const r = check.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      if (r.integrity_check !== "ok") throw new Error("the snapshot failed its integrity check");
    } finally {
      check.close();
    }
    return file;
  } catch (e) {
    throw new MigrationError("snapshot", `a safety copy of the database could not be written (${String((e as Error)?.message || e).slice(0, 160)}); the start-up stops before changing anything`);
  }
}

function rebuildOne(db: DatabaseSync, p: PlannedRebuild, hooks?: MigrationHooks): number {
  const { spec } = p;
  const tmp = tmpName(spec.table);
  const indexes = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(spec.table) as unknown as { sql: string }[]).map((r) => r.sql);
  const triggers = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? AND sql IS NOT NULL").all(spec.table) as unknown as { sql: string }[]).map((r) => r.sql);

  db.exec(spec.createSql(tmp));
  const exprs = spec.columns.map((c) => {
    if (p.oldColumns.includes(c)) return spec.existing?.[c] ?? q(c);
    return spec.missing[c] ?? "NULL";
  });
  // plain INSERT (never OR IGNORE): a row that cannot be copied is an error, not a silent omission
  db.exec(`INSERT INTO ${q(tmp)} (${spec.columns.map(q).join(", ")}) SELECT ${exprs.join(", ")} FROM ${q(spec.table)}`);
  const before = countRows(db, spec.table);
  const after = countRows(db, tmp);
  if (before !== after) throw new MigrationError(`${spec.table} (copy)`, `copied ${after} of ${before} rows`);
  hooks?.afterCopy?.(spec.table);

  db.exec(`DROP TABLE ${q(spec.table)}`);
  db.exec(`ALTER TABLE ${q(tmp)} RENAME TO ${q(spec.table)}`);
  for (const sql of [...indexes, ...triggers]) db.exec(sql);
  return after;
}

/**
 * Runs every planned rebuild in ONE transaction with foreign keys off. All or nothing. Throws on any problem after rolling back.
 */
export function applyRebuilds(db: DatabaseSync, plan: MigrationPlan, log: MigrationLog, hooks?: MigrationHooks): void {
  if (plan.rebuilds.length === 0) return;
  const fkWasOn = Number((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number | bigint }).foreign_keys) === 1;
  try {
    db.exec("PRAGMA foreign_keys = OFF");
    if (Number((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number | bigint }).foreign_keys) !== 0) {
      throw new MigrationError("foreign keys", "could not be switched off (a transaction is open?), so the tables are not rebuilt");
    }
    const violationsBefore = fkViolations(db);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const p of plan.rebuilds) {
        const rows = rebuildOne(db, p, hooks);
        log.info("migration_table_rebuilt", { table: p.spec.table, rows });
      }
      const violationsAfter = fkViolations(db);
      if (violationsAfter > violationsBefore) {
        throw new MigrationError("foreign key check", `the rebuild would leave ${violationsAfter - violationsBefore} new foreign-key violation(s); it was rolled back`);
      }
      if (violationsBefore > 0) log.warn("migration_preexisting_fk_violations", { count: violationsBefore });
      hooks?.beforeCommit?.();
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* nothing left to roll back */ }
      if (e instanceof MigrationError) throw e;
      const step = plan.rebuilds.map((r) => r.spec.table).join(", ");
      throw new MigrationError(`rebuild (${step})`, `${String((e as Error)?.message || e).slice(0, 200)}; everything was rolled back, the original tables are intact`);
    }
  } finally {
    if (fkWasOn) db.exec("PRAGMA foreign_keys = ON");
  }
}

export interface PreparationResult { snapshot: string | null; rebuilt: string[]; duplicateProjectFiles: number }

/**
 * Stage 1 of the start-up, before the ordinary `CREATE TABLE IF NOT EXISTS` work: version guard, plan (refuses unexpected shapes), snapshot,
 * rebuilds. Everything is checked before the first change. Throws MigrationError on any problem.
 */
export function prepareDatabase(db: DatabaseSync, opts: MigrationOptions): PreparationResult {
  assertSchemaVersion(db, opts.allowNewerSchema);
  const plan = planMigration(db);
  let snapshot: string | null = null;
  if (plan.rebuilds.length > 0 || plan.duplicateProjectFiles > 0) {
    snapshot = snapshotDatabase(db, opts.snapshotDir);
    opts.log.warn("migration_snapshot_written", { file: path.basename(snapshot), rebuilds: plan.rebuilds.map((r) => r.spec.table), duplicateProjectFiles: plan.duplicateProjectFiles });
  }
  applyRebuilds(db, plan, opts.log, opts.hooks);
  return { snapshot, rebuilt: plan.rebuilds.map((r) => r.spec.table), duplicateProjectFiles: plan.duplicateProjectFiles };
}
