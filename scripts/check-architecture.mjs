#!/usr/bin/env node
/**
 * Architecture guard: builds the static import graph of server/ and fails on
 *   - import cycles (a runtime cycle makes initialisation order fragile and refactoring unsafe),
 *   - layering violations (see RULES): lower layers must not import higher ones; nothing imports the entry file server/server.ts.
 *
 * Only RUNTIME imports count: `import type ...` and `import { type X }` are erased by the compiler and cannot cause a cycle.
 * Dynamic `import()` calls are reported separately (they are lazy, so they do not create initialisation cycles).
 *
 *   node scripts/check-architecture.mjs          prints a summary and exits 1 on violations
 *   node scripts/check-architecture.mjs --graph  also prints every module's runtime imports
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = "server";

/** Layers, lowest first. A module may import its own layer or lower ones, never a higher one. */
export const LAYERS = [
  { name: "foundation", match: /^server\/(storage-manager|env-loader|upload-config|upload-temp|upload-validation|upload-chunks|provider-http|observability\/.*|security\/(redact|csp|csrf|login-guard|vault|secret-store))\.ts$/ },
  { name: "data", match: /^server\/(db|supabase|project-storage)\.ts$/ },
  { name: "domain", match: /^server\/(?!server\.ts|.*-routes\.ts|.*\/routes\.ts)[^/]+\.ts$/ },
  { name: "routes", match: /^server\/(.*-routes\.ts|.*\/routes\.ts|security\/privacy\.ts)$/ },
  { name: "entry", match: /^server\/server\.ts$/ },
];

const layerOf = (file) => LAYERS.findIndex((l) => l.match.test(file));

function listFiles(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir + "/" + e.name;
    if (e.isDirectory()) listFiles(rel, out);
    else if (/\.(ts|mts|mjs)$/.test(e.name) && !/\.d\.m?ts$/.test(e.name)) out.push(rel);
  }
  return out;
}

function resolveImport(from, spec) {
  if (!spec.startsWith(".")) return null; // a package
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  const candidates = [base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".mts"), base, base + ".ts", base + "/index.ts"];
  return candidates.find((c) => fs.existsSync(path.join(root, c)) && fs.statSync(path.join(root, c)).isFile()) || null;
}

const exportCache = new Map();
/** Names the module declares as types only (interface / type alias, with no value of the same name). */
function typeOnlyExports(file) {
  if (exportCache.has(file)) return exportCache.get(file);
  const src = fs.readFileSync(path.join(root, file), "utf8");
  const types = new Set([...src.matchAll(/^export\s+(?:interface|type)\s+(\w+)/gm)].map((m) => m[1]));
  for (const m of src.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|enum|abstract\s+class)\s+(\w+)/gm)) types.delete(m[1]);
  exportCache.set(file, types);
  return types;
}
function onlyTypes(clause, target) {
  const c = clause.trim();
  const m = /^\{([^}]*)\}$/.exec(c);
  if (!m) return false; // default or namespace import: a value
  const names = m[1].split(",").map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim());
  if (!names.length) return false;
  const types = typeOnlyExports(target);
  return names.every((n) => types.has(n));
}

export function buildGraph() {
  const files = listFiles(SRC);
  const staticEdges = new Map();
  const dynamicEdges = new Map();
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const s = new Set(), d = new Set();
    // import ... from "x"  /  export ... from "x"  /  import "x"
    for (const m of src.matchAll(/(?:^|\n)\s*(import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g)) {
      const kind = m[1], clause = m[2] || "", spec = m[3] || m[4];
      if (kind === "import" && /^type\s/.test(clause.trim())) continue; // import type { X }
      if (/^\{[^}]*\}$/.test(clause.trim()) && clause.replace(/[{}]/g, "").split(",").map((x) => x.trim()).filter(Boolean).every((x) => /^type\s/.test(x))) continue; // import { type A, type B }
      if (kind === "export" && /^type\s/.test(clause.trim())) continue;
      const t = resolveImport(f, spec);
      if (!t || t === f) continue;
      // A plain `import { Foo }` of something that is only a type/interface in the target is erased by the compiler: not a runtime edge.
      if (kind === "import" && onlyTypes(clause, t)) continue;
      s.add(t);
    }
    for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      const t = resolveImport(f, m[1]);
      if (t && t !== f) d.add(t);
    }
    staticEdges.set(f, s);
    dynamicEdges.set(f, d);
  }
  return { files, staticEdges, dynamicEdges };
}

/** Strongly connected components with more than one node (Tarjan): each is an import cycle. */
export function findCycles(files, edges) {
  let index = 0;
  const idx = new Map(), low = new Map(), onStack = new Set(), stack = [], out = [];
  const visit = (v) => {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); onStack.add(v);
    for (const w of edges.get(v) || []) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) out.push(comp.sort());
    }
  };
  for (const f of files) if (!idx.has(f)) visit(f);
  return out;
}

export function checkArchitecture() {
  const { files, staticEdges, dynamicEdges } = buildGraph();
  const problems = [];
  const cycles = findCycles(files, staticEdges);
  for (const c of cycles) problems.push("import cycle: " + c.join(" <-> "));
  for (const [from, tos] of staticEdges) {
    for (const to of tos) {
      if (to === "server/server.ts") problems.push(`${from} imports the entry file server/server.ts (only type-only imports of it are allowed)`);
      const a = layerOf(from), b = layerOf(to);
      if (a >= 0 && b >= 0 && b > a) problems.push(`layering: ${from} (${LAYERS[a].name}) imports ${to} (${LAYERS[b].name})`);
    }
  }
  const unlayered = files.filter((f) => layerOf(f) < 0);
  return { files, staticEdges, dynamicEdges, cycles, problems, unlayered };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = checkArchitecture();
  const edges = [...r.staticEdges.values()].reduce((n, s) => n + s.size, 0);
  const dyn = [...r.dynamicEdges.values()].reduce((n, s) => n + s.size, 0);
  console.log(`modules: ${r.files.length}, runtime imports: ${edges}, lazy (dynamic) imports: ${dyn}, cycles: ${r.cycles.length}`);
  if (process.argv.includes("--graph")) for (const [f, s] of r.staticEdges) console.log(`${f} -> ${[...s].join(", ") || "(none)"}`);
  if (r.unlayered.length) console.log(`not in a layer (unchecked): ${r.unlayered.join(", ")}`);
  if (r.problems.length) { console.error("\nARCHITECTURE PROBLEMS:\n- " + r.problems.join("\n- ")); process.exitCode = 1; }
  else console.log("architecture: ok (no import cycles, no layering violations)");
}
