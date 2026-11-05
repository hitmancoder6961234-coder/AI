import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Point the database at a throwaway file before db.ts is loaded.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "darkness-dblog-test-"));
process.env.DARKNESS_STORAGE_ROOT = tmp;
process.env.DARKNESS_DB_PATH = path.join(tmp, "dblog.db");

const SENTINEL = "SENTINEL-prompt-text-do-not-log-7f3a9c";

/** Run `fn` and return everything it wrote to console / stdout / stderr. */
async function capture(fn: () => void | Promise<void>): Promise<string> {
  const out: string[] = [];
  const keep = { log: console.log, error: console.error, warn: console.warn, info: console.info, so: process.stdout.write, se: process.stderr.write };
  const grab = (...a: unknown[]) => { out.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x) + String(x))).join(" ")); };
  console.log = console.error = console.warn = console.info = grab as any;
  process.stdout.write = ((c: any) => { out.push(String(c)); return true; }) as any;
  process.stderr.write = ((c: any) => { out.push(String(c)); return true; }) as any;
  try { await fn(); } finally {
    console.log = keep.log; console.error = keep.error; console.warn = keep.warn; console.info = keep.info;
    process.stdout.write = keep.so; process.stderr.write = keep.se;
  }
  return out.join("\n");
}

test("a failing SQL statement never prints its bound values (run / get / all)", async () => {
  const { db } = await import("../server/db.js");
  db.exec("CREATE TABLE IF NOT EXISTS log_probe (k TEXT PRIMARY KEY, v TEXT)");
  db.prepare("INSERT INTO log_probe (k, v) VALUES (?, ?)").run("dup", "first");

  const logged = await capture(() => {
    // run(): UNIQUE violation, with the sentinel as both the value and inside an object/array parameter
    assert.throws(() => db.prepare("INSERT INTO log_probe (k, v) VALUES (?, ?)").run("dup", SENTINEL));
    assert.throws(() => db.prepare("INSERT INTO log_probe (k, v) VALUES (?, ?)").run("dup", { note: SENTINEL, list: [SENTINEL] } as any));
    // get() / all(): a statement that cannot compile
    assert.throws(() => db.prepare("SELECT nope FROM log_probe WHERE v = ?").get(SENTINEL));
    assert.throws(() => db.prepare("SELECT nope FROM log_probe WHERE v = ?").all(SENTINEL));
  });

  assert.ok(logged.includes("[SQLite Error]"), "the failure is still logged, so operators can see it");
  assert.ok(!logged.includes(SENTINEL), "bound values must never appear in logs");
  assert.ok(!/Params:/.test(logged), "no parameter dump at all");
});

test("describeSqlFailure gives a short label, the error code and no values", async () => {
  const { describeSqlFailure } = await import("../server/db.js");
  const line = describeSqlFailure("INSERT   INTO   t (a)\n VALUES (?)", Object.assign(new Error("UNIQUE constraint failed: t.a"), { code: "ERR_SQLITE_ERROR" }));
  assert.match(line, /ERR_SQLITE_ERROR/);
  assert.match(line, /UNIQUE constraint failed: t\.a/);
  assert.match(line, /INSERT INTO t \(a\) VALUES \(\?\)/, "whitespace is normalised");
  assert.ok(describeSqlFailure("x".repeat(5000), new Error("e")).length < 600, "long statements are truncated");
});
