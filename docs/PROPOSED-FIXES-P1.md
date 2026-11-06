# Proposed fixes P1-01, P1-03, P1-09 (Phase 1: proposals only, nothing implemented)

Prepared 6 November 2026. **No code was changed.** Each fix is described so you can approve, change or reject it individually; none is implemented until you say so, and each would be a separate, small, reviewable commit on `release-hardening` with regression tests. Source of each finding: [STAGING-READINESS-REPORT.md](STAGING-READINESS-REPORT.md) section 8.

| Fix | Severity of the problem | Necessary for staging? | Necessary before production? |
|---|---|---|---|
| P1-01 fail-fast configuration check | MEDIUM | No (the plan runs `npm run preflight` as a manual gate) | **Recommended**: a typo should not be able to start an unsafe production server |
| P1-03 safe boot migrations | **HIGH when an older-shaped database is opened (proven data loss); MEDIUM otherwise** | No (staging starts from a fresh database; the legacy migrations never trigger) | **Necessary before any existing database from an older version is started with this code; recommended in any case** |
| P1-09 backup scheduler (09a) and monitoring (09b) | MEDIUM | 09a: **no**, manual backups are enough to start Phase 2; needed before Phase 4's restore and reliability testing. 09b: optional | 09a: **necessary** (no automatic backup exists). 09b: recommended |

---

## P1-01 Fail-fast configuration check at start-up

1. **Problem.** In production the server starts with an unsafe or incomplete configuration and only the optional `npm run preflight` would have said so: `PRIVACY_STRICT=false`, `PRIVACY_CSP=off`, `ENABLE_RUN_ENGINE=true`, `PRIVACY_LOG_REDACTION=off`, a storage root inside the temp folder, a malformed `PRIVACY_ENCRYPTION_KEY`, `CORS_ORIGINS` containing `*`, `AIVEN_ALLOW_PLAINTEXT=true`.
2. **Root cause and evidence.** *Proven:* `server/server.ts` has no call that validates the overall configuration before `app.listen` (~l. 8334); `scripts/preflight.mjs` exports `runPreflight(env, opts)` with 16 FAIL conditions (lines 44-149) but nothing calls it at boot. The existing boot-time parsing (`intEnv`, CSP and body-limit parsers) ignores junk silently. Existed before this branch.
3. **Files / functions.** New `server/startup-checks.ts` exporting `enforceStartupChecks(env)`; one call in `server/server.ts` just before `app.listen`; reuse of `runPreflight` from `scripts/preflight.mjs` (the esbuild bundle inlines it, so the Dockerfile needs no change; a `.d.mts` file gives it types, as `server/classic/transform.d.mts` does); `.env.example` and docs for the new switch; `tests/startup-checks.test.ts`; adjustment of `scripts/smoke.mjs`'s environment so it satisfies the checks instead of bypassing them.
4. **Proposed change.** When `NODE_ENV=production`, run the *configuration* subset of the preflight (not host conditions such as free disk space and not the Vercel-only `BACKEND_URL` checks) and log each result as a structured line (names and verdicts only, never values). If any FAIL remains the process logs `startup_check_failed` and exits non-zero **before listening**. Switch `STARTUP_CHECKS=enforce` (default in production) | `warn` (log, then start anyway: the emergency escape hatch) | `off` (development default). Warnings never block.
5. **Impact.** *Security:* positive: unsafe production settings cannot go live by accident. *Reliability:* a wrong setting now stops a deploy loudly; on Render the platform keeps the previous deploy serving while the new one fails its health check (per Render's documentation, not verified). *Compatibility:* correct deployments are unaffected; an existing production service that runs with `PRIVACY_STRICT=false` or `ENABLE_RUN_ENGINE=true` would stop starting (intended; `STARTUP_CHECKS=warn` as a bridge).
6. **Risks.** A false FAIL taking the service down (mitigated: only deterministic configuration FAILs, the escape hatch, and trying it on staging first); the smoke and authorization-audit servers run with `NODE_ENV=production` and must pass the checks honestly (their storage roots must not be in the temp folder); `process.exit` must not fire inside the unit-test process (the function returns a verdict; only the entry point exits).
7. **Tests.** Unit: each FAIL condition produces a failing verdict; `warn` mode never exits; development never runs the checks; output never contains a value (reuse the preflight no-secrets test); a good environment passes. End-to-end (smoke): spawn the built server with `PRIVACY_STRICT=false` in production and assert a non-zero exit and the log line, no open port; spawn with the escape hatch and assert it starts; the normal smoke run still passes 97/97. CI runs all of it.
8. **Reversible?** Yes: revert one commit, or set `STARTUP_CHECKS=warn` / `off` without redeploying code.

---

## P1-03 Safe boot migrations

1. **Problem.** The database schema is created and migrated automatically at every start, but (a) the four *legacy-table rebuild* migrations (projects, conversations, workspace_files, models) have no snapshot beforehand, (b) **the `projects` rebuild destroys the original table when its copy step fails** (its `catch` drops `projects_old` and the transaction commits), (c) the other rebuilds log or swallow their errors and carry on on a half-migrated database, (d) there is no schema version, so neither the operator nor the code knows what state the database is in. **Proven by experiment (6 Nov 2026, throw-away database in a temporary folder, no repository or real data touched; probe kept outside the repository): starting the current code against a database whose `projects` table has an older shape (no `user_id`, and no `last_indexed_at` / `metadata` columns) made the rebuild's `INSERT ... SELECT` fail, the `catch` then ran `DROP TABLE IF EXISTS projects_old`, and the outer transaction committed: the legacy project row was GONE afterwards (only the seeded "Global Workspace" row remained). A silent loss of every project in such a database.**
2. **Root cause and evidence.** *Proven by the probe above:* the `projects` block (`db.ts` l. 155-182) runs `RENAME TO projects_old`, `CREATE TABLE`, `INSERT ... SELECT`, `DROP TABLE IF EXISTS projects_old` inside one `db.exec`, and its `catch` (l. 178-182) runs `DROP TABLE IF EXISTS projects_old` again, after the rename, so a failed copy leaves no original. `runTransaction` (l. 133) only rolls back when the callback throws, and the inner `catch` swallows the error, so the transaction commits. *Read from the code, not probed:* the conversations and workspace_files blocks only `console.error` (the data stays in `conversations_old` / `workspace_files_old` while the application sees empty new tables), the models block is an empty `catch`. Also: `server/db.ts` `initDatabaseSchema` (l. 152 onward) contains `DROP TABLE projects_old` (l. 159, 176, 182), `DROP TABLE conversations_old` (l. 402), `DROP TABLE workspace_files_old` (l. 455) and `DROP TABLE models` (l. 553) inside `try { ... } catch (e) {}`; 12 empty `catch` blocks between lines 152 and 700; no `PRAGMA user_version`. The function also runs twice per start: at import (`db.ts` l. 1999) and in `hydrateFromDatabase` (`server.ts` l. 651). Existed before this branch. They trigger only when an *old table shape* is detected, so a fresh database is unaffected.
3. **Files / functions.** `server/db.ts` (`initDatabaseSchema`, a small `snapshotBeforeMigration()` using `VACUUM INTO`, a `schemaVersion` helper); `tests/db-migration.test.ts` with old-shape fixtures; docs (DEPLOY, OPERATIONS-VERIFICATION section 7).
4. **Proposed change.** (0) **The data-loss bug itself:** the `catch` of every rebuild must roll back instead of dropping (log `migration_failed` with the step name, then rethrow, so `runTransaction` rolls back the rename and the new table and the boot stops with the original data intact). (a) Detect cheaply whether any destructive rebuild *would* run; if so, first write `<root>/backups/pre-migrate-<time>.db` with `VACUUM INTO` (outside the transaction, as SQLite requires) and **abort the boot if the snapshot fails**. (b) In the four rebuild blocks, log the step name and error (`migration_failed`, no data) and rethrow so the surrounding transaction rolls back and the boot stops; keep best-effort handling only for harmless, expected errors (for example "duplicate column name" from `ADD COLUMN`). (c) After a successful run set `PRAGMA user_version` to the code's schema number and log `schema_version` at boot. (d) Optional: refuse to start when the database's `user_version` is **newer** than the code knows (a downgrade guard), off by default so that rolling the code back stays possible as documented. (e) Optional: stop running the schema init twice.
5. **Impact.** *Reliability:* positive: no silent half-migrations, a recoverable snapshot before any destructive step. *Security:* neutral. *Compatibility:* none for fresh databases; legacy databases gain one snapshot file (about the size of the database) and the first boot that previously "succeeded" over a hidden failure will now stop and say why.
6. **Risks.** A previously ignored, harmless error becomes a boot failure (mitigated by the explicit allow-list and by testing against fixtures of the old shapes and against a copy of any real database you want upgraded: **never the live one**); snapshot needs free disk space and time on a large database; the downgrade guard (if enabled) conflicts with "older builds ignore newer tables" and is therefore optional.
7. **Tests.** Fixtures created with the old table shapes (projects without `user_id`, a `models` table with a single-column primary key, and so on): migrated rows are preserved and counted, the snapshot exists and opens, `user_version` is set; injected failure (snapshot directory not writable, a table that cannot be renamed): the boot stops, the old data and the snapshot are intact; a fresh database creates no snapshot; running the init twice is idempotent; the existing 363 unit tests and the smoke run still pass.
8. **Reversible?** Yes for code (one commit). Effects on a database are the snapshot (deletable) and the `user_version` marker (harmless to older builds).

---

## P1-09 Backups and operational visibility

Split in two so each can be approved separately.

### P1-09a Automatic backups (in-process scheduler)

1. **Problem.** No automatic backup exists; the only backup is a person running `scripts/backup.mjs`. A Render cron job or one-off job cannot reach the web service's disk (Render documentation), and Render's own snapshots are not a safe way to back up a database on disk.
2. **Root cause and evidence.** *Proven:* no scheduler or scheduled job exists in `server/` (the only periodic task is the 10-minute upload-temp sweep); `scripts/backup.mjs` exports `createBackup`, `verifyBackup`, `restoreBackup` but is run by hand. Existed before.
3. **Files / functions.** New `server/backup-scheduler.ts`; start/stop wiring in `server/server.ts` (next to the upload sweeper and the shutdown handler); an optional read-only readiness check "last backup age"; a `.d.mts` for `scripts/backup.mjs`; `.env.example`, docs; `tests/backup-scheduler.test.ts`.
4. **Proposed change.** Opt-in by environment: `BACKUP_INTERVAL_HOURS` (unset = off, so nothing changes by default), `BACKUP_KEEP_COUNT` (default 3), `BACKUP_DIR` (default `<root>/backups`). At each interval: `createBackup`, then `verifyBackup`; prune beyond the keep count; log `backup_ok` (size, duration) or `backup_failed` (reason, no paths of user content); skip if a backup is already running or free disk is below the readiness threshold. `/api/ready` gets an *optional* (non-blocking) check that turns `degraded` when the last good backup is older than twice the interval. Off-site encrypted copy is **not** included (a separate approval; see the backup plan, option C).
5. **Impact.** *Reliability:* positive. *Security:* backups on the same disk are as sensitive as the disk; no new credential in this part. *Compatibility:* none when unset. *Cost:* disk space for the kept backups.
6. **Risks.** I/O and CPU on the single instance while a backup runs (`VACUUM INTO` is a read; the API stays up in WAL mode); a full disk (guarded by the prune and the free-space skip); backups stop during a deploy; a restore of a scheduler-made backup must be rehearsed (plan section 7).
7. **Tests.** Unit with a fake clock and a temp root: a backup is created, verified, pruned to N; a failing step logs `backup_failed` and does not crash the server; unset means no timer; no overlapping runs; readiness turns `degraded` when stale; end-to-end: restore the scheduler's newest backup into a scratch root and compare row counts.
8. **Reversible?** Yes: unset the variable, or revert the commit. Existing backups remain valid files.

### P1-09b Minimal operational visibility (optional)

1. **Problem.** No metrics, alerting or error tracking exist; only JSON logs, `/api/health` and `/api/ready`.
2. **Evidence.** *Proven:* no metrics or alerting module under `server/observability/` (logger, request-context, health only).
3. **Proposed change (smallest useful step, optional).** Rely first on platform log search plus an **external uptime check on `/api/ready`** (configuration, no code); then, if wanted, an operator-only JSON snapshot endpoint with counters (requests, 5xx, provider errors, p50/p95 latency, last backup age) held in memory. No third-party error-tracking service is proposed without your decision, because it would receive error data.
4. **Impact / risks.** Low code risk; the counters are per process (single instance); operator-only access must be covered by the authorization audit; an external monitor is another service and possibly a cost.
5. **Tests.** The endpoint refuses ordinary users (`OPERATOR_ONLY`) and anonymous callers, counters move as expected, no user content or secret appears in the output; the audit must still report 0 violations.
6. **Reversible?** Yes.

---

## Order I would suggest, if you approve any

1. P1-09a (needed before Phase 4's restore testing), after the manual backup route is rehearsed in Phase 2.
2. P1-01 (small, high value, before any production deploy).
3. P1-03 only if an existing database must be upgraded; otherwise defer to Phase 4's migration-behaviour test.
4. P1-09b optional.

Each approval means: implement on `release-hardening` as its own commit, add the tests above, run `npm run verify`, smoke, the authorization audit and CI, and report before the next one.

---

## Proposed diffs (illustrative sketches: NOT applied, NOT compiled, NOT tested)

They show the shape and size of each change so it can be judged. The real implementation would be written, type-checked and tested on `release-hardening` only after your approval.

### P1-01 (about 60 lines plus tests)

```diff
+++ server/startup-checks.ts            (new)
+import { runPreflight } from "../scripts/preflight.mjs";
+/** Only deterministic configuration problems block a start; host conditions (free disk) and Vercel-only checks do not. */
+const BLOCKING = new Set(["node", "NODE_ENV", "PRIVACY_STRICT", "PRIVACY_CSP", "ENABLE_RUN_ENGINE", "PRIVACY_LOG_REDACTION",
+  "AIVEN_ALLOW_PLAINTEXT", "CORS_ORIGINS", "PRIVACY_ENCRYPTION_KEY", "PRIVACY_ENCRYPTION_KEY_PREVIOUS", "MAIL_*", "PORT",
+  "DARKNESS_STORAGE_ROOT", "DARKNESS_DB_PATH"]);
+export function evaluateStartupChecks(env = process.env) {
+  const mode = env.NODE_ENV !== "production" ? "off" : (env.STARTUP_CHECKS === "warn" ? "warn" : "enforce");
+  if (mode === "off") return { mode, ok: true, failures: [], warnings: [] };
+  const results = runPreflight(env);               // names and verdicts only, never values
+  const failures = results.filter((r) => r.level === "FAIL" && BLOCKING.has(r.id));
+  return { mode, ok: mode === "warn" || failures.length === 0, failures, warnings: results.filter((r) => r.level === "WARN") };
+}
+++ server/server.ts                     (before app.listen)
+  const startup = evaluateStartupChecks(process.env);
+  for (const f of startup.failures) logger.error("startup_check_failed", { check: f.id, detail: f.message });
+  if (!startup.ok) { logger.error("startup_refused", { failures: startup.failures.length }); process.exit(1); }
```

### P1-03 (about 50 lines plus fixtures and tests)

```diff
--- server/db.ts   initDatabaseSchema()
 export function initDatabaseSchema() {
+  const rebuilds = legacyRebuildsNeeded(db);                 // PRAGMA table_info checks only: no writes
+  if (rebuilds.length) snapshotBeforeMigration(rebuilds);    // VACUUM INTO <root>/backups/pre-migrate-<time>.db ; throws if it fails, so the boot stops
   runTransaction(() => {
     // 1. Projects
     try { ...rename, create, INSERT ... SELECT, drop projects_old... }
     } catch (e) {
-      console.error("Migration error for projects.user_id:", e);
-      try {
-        db.exec("DROP TABLE IF EXISTS projects_old;");
-      } catch {}
+      logger.error("migration_failed", { step: "projects.user_id" });   // no data in the log
+      throw e;      // runTransaction rolls back the rename and the new table: the original data is untouched, the boot stops
     }
@@ conversations and workspace_files blocks: the same (log, then throw)
@@ models block
-    } catch (e) {}
+    } catch (e) { if (!isExpectedDuplicateColumn(e)) { logger.error("migration_failed", { step: "models.pk" }); throw e; } }
@@ end of the transaction
+    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);        // logged as schema_version at boot
```

### P1-09a (about 110 lines plus tests)

```diff
+++ server/backup-scheduler.ts           (new, off unless BACKUP_INTERVAL_HOURS is set)
+import { createBackup, verifyBackup } from "../scripts/backup.mjs";
+export function startBackupScheduler({ root, intervalHours, keep, log, freeMbBelow = 100 }) {
+  if (!intervalHours) return { stop() {}, status: () => ({ enabled: false }) };
+  let running = false, last: { ok: boolean; at: number } | null = null;
+  const run = async () => {
+    if (running) return; running = true; const t0 = Date.now();
+    try {
+      const dir = createBackup({ root, out: path.join(root, "backups") });  // VACUUM INTO: safe while the server runs
+      verifyBackup(dir); pruneOldBackups(path.join(root, "backups"), keep);
+      last = { ok: true, at: Date.now() }; log.info("backup_ok", { ms: Date.now() - t0, bytes: dirSize(dir) });
+    } catch (e) { last = { ok: false, at: Date.now() }; log.error("backup_failed", { reason: String(e?.message).slice(0, 120) }); }
+    finally { running = false; }
+  };
+  const timer = setInterval(run, intervalHours * 3_600_000); timer.unref();
+  return { stop: () => clearInterval(timer), status: () => ({ enabled: true, last }) };
+}
+++ server/server.ts
+  const backups = startBackupScheduler({ root: storageRoot, intervalHours: Number(process.env.BACKUP_INTERVAL_HOURS) || 0,
+                                         keep: Number(process.env.BACKUP_KEEP_COUNT) || 3, log: logger });
+  healthChecks.push({ name: "backup", required: false, run: () => { if (backupIsStale(backups.status())) throw new Error("last good backup is too old"); } });
+  // in shutdown(): backups.stop();
```

### P1-09b: no diff proposed yet (an external uptime check on `/api/ready` needs no code; counters would be a separate proposal if you want them).

