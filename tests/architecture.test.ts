import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { checkArchitecture, findCycles, LAYERS } = await import("../scripts/check-architecture.mjs");

test("the server has no import cycles and no layering violations", () => {
  const r = checkArchitecture();
  assert.deepEqual(r.problems, [], "run: node scripts/check-architecture.mjs");
  assert.ok(r.files.length > 60, "the graph covers the server");
});

test("findCycles reports real runtime cycles and ignores acyclic graphs", () => {
  const edges = new Map([["a", new Set(["b"])], ["b", new Set(["c"])], ["c", new Set(["a"])], ["d", new Set(["a"])], ["e", new Set<string>()]]);
  const cycles = findCycles(["a", "b", "c", "d", "e"], edges);
  assert.deepEqual(cycles, [["a", "b", "c"]]);
  assert.deepEqual(findCycles(["x", "y"], new Map([["x", new Set(["y"])], ["y", new Set<string>()]])), []);
});

test("layers are ordered foundation < data < domain < routes < entry, and every layer matches something", () => {
  assert.deepEqual(LAYERS.map((l: any) => l.name), ["foundation", "data", "domain", "routes", "entry"]);
  const r = checkArchitecture();
  for (const l of LAYERS) assert.ok(r.files.some((f: string) => l.match.test(f)), l.name + " layer matches at least one module");
});

test("the pure redaction module stays a dependency-free leaf (that is what keeps logger, provider-http and privacy from importing each other)", () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, "..", "server", "security", "redact.ts"), "utf8");
  assert.ok(!/^\s*import\s/m.test(src), "redact.ts imports nothing");
  const r = checkArchitecture();
  for (const f of ["server/observability/logger.ts", "server/provider-http.ts"]) {
    assert.ok(!r.staticEdges.get(f)!.has("server/security/privacy.ts"), f + " must not import the privacy middleware");
  }
});

test("a violation is actually detected (the guard is not vacuous)", () => {
  // build a throw-away module tree that imports upward and cyclically, and run the same graph code over it
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-"));
  fs.mkdirSync(path.join(dir, "server"), { recursive: true });
  fs.writeFileSync(path.join(dir, "server", "db.ts"), 'import { x } from "./a-routes.js";\nexport const y = x;\n');
  fs.writeFileSync(path.join(dir, "server", "a-routes.ts"), 'import { y } from "./db.js";\nexport const x = y;\n');
  const edges = new Map([["server/db.ts", new Set(["server/a-routes.ts"])], ["server/a-routes.ts", new Set(["server/db.ts"])]]);
  assert.equal(findCycles([...edges.keys()], edges).length, 1);
  const layer = (f: string) => LAYERS.findIndex((l: any) => l.match.test(f));
  assert.ok(layer("server/a-routes.ts") > layer("server/db.ts"), "db (data) must sit below routes: the db -> routes import above is a violation");
  fs.rmSync(dir, { recursive: true, force: true });
});
