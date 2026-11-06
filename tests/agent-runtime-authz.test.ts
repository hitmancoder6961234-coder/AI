import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// What reaches the MODEL, observed on the wire: the real AgentRuntime.execute is run against a stand-in provider that records every request body.
// (Reading the model's reply is not reliable: the stream filter can alter text. The request is what matters: it is what leaves the server.)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "darkness-runtime-authz-"));
process.env.DARKNESS_STORAGE_ROOT = tmp;
process.env.DARKNESS_DB_PATH = path.join(tmp, "runtime.db");

const { AgentRuntime } = await import("../server/agent-runtime.js");
const KE: any = await import("../server/knowledge-engine.js");
const PA: any = await import("../server/project-analyzer.js");

const seen: string[] = [];
const stub = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => { seen.push(body); res.writeHead(200, { "content-type": "text/event-stream" }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`); res.write("data: [DONE]\n\n"); res.end(); });
});
await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
test.after(() => { stub.closeAllConnections?.(); stub.close(); });
const port = (stub.address() as any).port;

const ALICE = "u-alice", BOB = "u-bob";
const files = new Map<string, any>([
  ["f-bob", { id: "f-bob", user_id: BOB, filename: "bob.txt", content: "BOB-PRIVATE-FILE-CONTENT-111", project_id: null, conversation_id: null }],
  ["f-alice", { id: "f-alice", user_id: ALICE, filename: "alice.txt", content: "ALICE-OWN-FILE-CONTENT-222", project_id: null, conversation_id: null }],
]);
const projects = new Map<string, any>([["p-bob", { id: "p-bob", user_id: BOB, name: "Bob project" }], ["p-alice", { id: "p-alice", user_id: ALICE, name: "Alice project" }]]);
const sample = (p: string, c: string) => [{ path: p, name: p.split("/").pop(), extension: ".js", size: c.length, isBinary: false, content: c, lineCount: 1 }];
for (const [pid, name, p, c] of [["p-bob", "Bob project", "src/app.js", "const BOB_PROJECT_SECRET_333 = 1; app.get('/x', h);"], ["p-alice", "Alice project", "src/mine.js", "const ALICE_PROJECT_CODE_444 = 1; app.get('/y', h);"]] as const) {
  const e = sample(p, c); KE.indexProject(pid, name, e, PA.analyzeProject(name, pid, e));
}
const model = { id: "m", name: "m", provider: "custom", baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "k", modelName: "stub", enabled: true, maxOutputTokens: 1024, defaultTemperature: 0.3 };

/** Run one request as ALICE and return everything the provider received for it. */
async function asAlice(message: string, extra: Record<string, unknown>): Promise<string> {
  const before = seen.length;
  await AgentRuntime.execute({
    userId: ALICE, conversationId: "c-" + Math.random().toString(36).slice(2), message, user: { id: ALICE, active_model_id: "m" }, sendSSE: () => {},
    conversations: new Map(), messages: new Map(), projects, files, projectAnalyses: new Map(), projectArtifacts: new Map(), dbCreateArtifact: () => ({}), resolveModelConfig: () => model, ...extra,
  } as any);
  return seen.slice(before).join("\n");
}

test("attached files: the caller's own file reaches the model, another user's file (chosen by id) never does", async () => {
  for (const msg of ["What does the attached file say?", "Summarise the attached document.", "Please explain the attached document in detail", "Based on the attached file, what is the key point?"]) {
    const own = await asAlice(msg, { fileIds: ["f-alice"] });
    assert.ok(own.includes("ALICE-OWN-FILE-CONTENT-222"), "control (the feature works for the owner): " + msg);
    const foreign = await asAlice(msg, { fileIds: ["f-bob"] });
    assert.ok(foreign.length > 0, "the request was still sent (nothing was attached)");
    assert.ok(!foreign.includes("BOB-PRIVATE-FILE-CONTENT-111"), "another user's file must never reach the model: " + msg);
    const mixed = await asAlice(msg, { fileIds: ["f-bob", "f-alice", "does-not-exist"] });
    assert.ok(mixed.includes("ALICE-OWN-FILE-CONTENT-222") && !mixed.includes("BOB-PRIVATE-FILE-CONTENT-111"), "only the caller's own file of a mixed list is used");
  }
});

test("project ids: the caller's own project reaches the model, another user's project (chosen by id) never does", async () => {
  for (const msg of ["Explain this project and summarise its files", "What does src/app.js do?", "Explain the architecture of this project", "Review the code in this project"]) {
    const own = await asAlice(msg, { projectId: "p-alice" });
    assert.ok(own.includes("ALICE_PROJECT_CODE_444"), "control (the feature works for the owner): " + msg);
    const foreign = await asAlice(msg, { projectId: "p-bob" });
    assert.ok(foreign.length > 0, "the request was still sent");
    assert.ok(!foreign.includes("BOB_PROJECT_SECRET_333"), "another user's project code must never reach the model: " + msg);
  }
});

test("ids that are not strings (arrays, objects, numbers) are ignored rather than coerced into somebody's id", async () => {
  const msg = "Explain this project and summarise its files";
  for (const junk of [["p-bob"], { toString: () => "p-bob" }, 7, true]) {
    const t = await asAlice(msg, { projectId: junk });
    assert.ok(!t.includes("BOB_PROJECT_SECRET_333"), "projectId " + JSON.stringify(junk));
  }
  const f = await asAlice("What does the attached file say?", { fileIds: [["f-bob"], { toString: () => "f-bob" }, null, 5] });
  assert.ok(!f.includes("BOB-PRIVATE-FILE-CONTENT-111"));
});
