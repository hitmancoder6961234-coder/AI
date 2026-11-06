import assert from "node:assert/strict";
import test from "node:test";
import AdmZip from "adm-zip";

// Regression tests for defects the TypeScript pass (Task 3) uncovered: values used without `await`, wrong property names and an
// option that was silently ignored. Each test fails on the old code.

const { analyzeProject } = await import("../server/project-analyzer.js");
const { buildProjectVisualIntelligence, renderSvgToPngBuffer } = await import("../server/visual-intelligence.js");
const { buildArtifactGenerationContext } = await import("../server/artifact-context.js");
const { generateDocxReport } = await import("../server/file-generator.js");
const { UniversalMathSolver } = await import("../server/study-learning-engine.js");

const mk = (p: string, c: string) => ({ path: p, name: p.split("/").pop()!, extension: "." + p.split(".").pop(), size: c.length, isBinary: false, content: c, buffer: Buffer.from(c), lineCount: c.split("\n").length });
const files = [
  mk("package.json", JSON.stringify({ name: "shop", version: "1.0.0", dependencies: { express: "^4.19.0" } })),
  mk("server.js", "const express = require('express');\nconst app = express();\napp.get('/api/items', (req,res)=>res.json([]));\napp.listen(3000);\n"),
  mk("README.md", "# Shop\nA tiny shop API.\n"),
];
const analysis: any = analyzeProject("Shop", "proj_gen_fixes", files as any);
const isPng = (b: unknown) => Buffer.isBuffer(b) && b.length > 100 && b.subarray(1, 4).toString() === "PNG";

test("renderSvgToPngBuffer is async: callers must get a real PNG Buffer, never a Promise", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#f00"/></svg>';
  const pending = renderSvgToPngBuffer(svg, 80);
  assert.ok(pending instanceof Promise);
  assert.ok(isPng(await pending));
});

test("buildProjectVisualIntelligence resolves to four PNG buffers (it used to store four un-awaited Promises)", async () => {
  const v = await buildProjectVisualIntelligence(analysis, files as any);
  for (const k of ["architecturePng", "workflowPng", "ragPipelinePng", "techStackPng"] as const) {
    assert.ok(!(v[k] instanceof Promise), k + " is not a Promise");
    assert.ok(isPng(v[k]), k + " is a PNG");
  }
});

test("buildArtifactGenerationContext awaits the visuals, and a detected repository screenshot no longer throws", async () => {
  const shot = { path: "docs/screenshot.png", name: "screenshot.png", extension: ".png", size: 70, isBinary: true, content: "", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"), lineCount: 0 };
  const ctx = await buildArtifactGenerationContext(analysis, [...files, shot] as any, "proj_gen_fixes");
  assert.ok(isPng(ctx.visuals.architecturePng));
  assert.ok(Array.isArray(ctx.visuals.screenshots));
  for (const s of ctx.visuals.screenshots) assert.equal(typeof s.bufferBase64, "string"); // was sc.buffer.toString(...): a TypeError on any screenshot
});

test("the DOCX report embeds the architecture diagram as a real .png (docx needs the image type; without it Word gets '.undefined')", async () => {
  const docx: any = await generateDocxReport(analysis, files as any);
  assert.ok(Buffer.isBuffer(docx) && docx.length > 1000, "a DOCX buffer was produced");
  const zip = new AdmZip(docx);
  const media = zip.getEntries().filter((e) => e.entryName.startsWith("word/media/") && e.header.size > 0).map((e) => e.entryName);
  assert.ok(media.length >= 1, "the report contains at least one picture");
  assert.ok(media.every((m) => /\.(png|jpg|gif|bmp)$/.test(m)), "picture types are real: " + media.join(", "));
  assert.ok(!media.some((m) => m.endsWith(".undefined")));
});

test("the deterministic math path: solveProblem returns a structured, self-verified result (solve() returns only a string)", () => {
  const solved = UniversalMathSolver.solveProblem("solve 2x + 3 = 7");
  assert.ok(solved, "recognised");
  assert.equal(solved!.overallVerified, true);
  assert.ok(solved!.canonicalMarkdown.length > 50);
  assert.equal(typeof UniversalMathSolver.solve("solve 2x + 3 = 7"), "string", "solve() is the string form: it has no .success / .canonicalMarkdown");
  assert.equal(UniversalMathSolver.solveProblem("find the bug in my login code"), null, "ordinary requests are not hijacked");
  assert.equal(UniversalMathSolver.solveProblem(""), null);
});
