import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Point the database at a throwaway file before db.ts is loaded.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "darkness-ownership-test-"));
process.env.DARKNESS_STORAGE_ROOT = tmp;
process.env.DARKNESS_DB_PATH = path.join(tmp, "ownership.db");

const D = await import("../server/db.js");
const O = await import("../server/ownership.js");

const ALICE = "alice-raw-id", BOB = "bob-raw-id";

test("sameOwner: identical ids, ids that map to the same UUID, and never an empty or different id", () => {
  assert.equal(O.sameOwner(ALICE, ALICE), true);
  assert.equal(O.sameOwner(D.toValidUuid(ALICE), ALICE), true, "the database stores the UUID form of a raw id");
  assert.equal(O.sameOwner(ALICE, D.toValidUuid(ALICE)), true);
  assert.equal(O.sameOwner(ALICE, BOB), false);
  for (const empty of [undefined, null, ""]) {
    assert.equal(O.sameOwner(empty as any, ALICE), false);
    assert.equal(O.sameOwner(ALICE, empty as any), false);
    assert.equal(O.sameOwner(empty as any, empty as any), false, "two empty ids are not 'the same owner'");
  }
});

test("projects: owned / foreign / unknown, whether the record is in memory or ONLY in the database", () => {
  D.createProject({ id: "p-db-only", user_id: ALICE, name: "Alice, database only" }, true);
  const memory = new Map<string, any>([["p-mem", { id: "p-mem", user_id: ALICE }]]);
  assert.equal(O.projectOwnership("p-mem", ALICE, memory), "owned");
  assert.equal(O.projectOwnership("p-mem", BOB, memory), "foreign");
  // the case the old guards could not see: not loaded into memory
  assert.equal(O.projectOwnership("p-db-only", ALICE, memory), "owned");
  assert.equal(O.projectOwnership("p-db-only", BOB, memory), "foreign", "a project that exists only in the database is still protected");
  assert.equal(O.projectOwnership("p-nowhere", BOB, memory), "unknown");
  assert.equal(O.projectOwnership("p-db-only", undefined, memory), "foreign", "no caller means no ownership");
  for (const junk of [undefined, null, "", 0, {}, ["p-mem"]]) assert.equal(O.projectOwnership(junk as any, ALICE, memory), "unknown", "a non-string id is never an id: " + JSON.stringify(junk));
});

test("memory wins over the database (the live record is the one being served)", () => {
  D.createProject({ id: "p-both", user_id: ALICE, name: "x" }, true);
  const mem = new Map<string, any>([["p-both", { id: "p-both", user_id: BOB }]]);
  assert.equal(O.projectOwnership("p-both", BOB, mem), "owned");
  assert.equal(O.projectOwnership("p-both", ALICE, mem), "foreign");
});

test("conversations and files: the same three answers, from the database when memory does not know the record", () => {
  D.saveConversation({ id: "c-db-only", user_id: ALICE, title: "t" } as any, undefined, undefined, undefined, true);
  assert.equal(O.conversationOwnership("c-db-only", ALICE), "owned");
  assert.equal(O.conversationOwnership("c-db-only", BOB), "foreign");
  assert.equal(O.conversationOwnership("c-nowhere", BOB), "unknown");
  D.saveWorkspaceFile({ id: "f-db-only", user_id: ALICE, filename: "a.txt", content: "secret" });
  assert.equal(O.fileOwnership("f-db-only", ALICE), "owned");
  assert.equal(O.fileOwnership("f-db-only", BOB), "foreign");
  assert.equal(O.fileOwnership("f-nowhere", BOB), "unknown");
  const files = new Map<string, any>([["f-mem", { id: "f-mem", user_id: BOB }]]);
  assert.equal(O.fileOwnership("f-mem", BOB, files), "owned");
  assert.equal(O.fileOwnership("f-mem", ALICE, files), "foreign");
});

test("a database failure never grants access", () => {
  // an id that makes the lookup throw or return nothing is "unknown" (the route's own 404), never "owned"
  assert.notEqual(O.projectOwnership("x".repeat(100_000), ALICE), "owned");
  assert.notEqual(O.fileOwnership("\u0000", ALICE), "owned");
});

test("shared-owner model copies (an old bug saved every user's provider key a second time under 'user_default') are purged; real models and the server's own default model are kept", () => {
  const model = (id: string, user: string, key: string) => ({ id, user_id: user, name: id, provider: "custom", baseUrl: "http://127.0.0.1:9/v1", apiKey: key, modelName: "m", modelType: "text", capabilities: { text: true }, contextWindow: 0, maxOutputTokens: 0, defaultTemperature: 0.7, defaultTopP: 1, supportsStreaming: true, enabled: true, status: "available", isUser: true });
  D.dbSaveModel(model("alice-model", ALICE, "ALICE-REAL-KEY"));
  D.dbSaveModel(model("alice-model", "user_default", "ALICE-REAL-KEY")); // the old duplicate
  D.dbSaveModel(model("bob-model", "user_default", "BOB-REAL-KEY"));     // another one
  D.dbSaveModel(model("darkness-gemini", "user_default", "SERVER-OWN-KEY")); // the server's own default model: NOT a duplicate
  const shared = D.toValidUuid("user_default");
  const owners = () => (D.db.prepare("SELECT id, user_id FROM models ORDER BY id, user_id").all() as any[]).map((r) => `${r.id}:${r.user_id === shared ? "shared" : "alice"}`);
  assert.deepEqual(owners().sort(), ["alice-model:alice", "alice-model:shared", "bob-model:shared", "darkness-gemini:shared"]);
  assert.equal(D.dbPurgeSharedModelCopies(), 2, "two duplicates removed");
  assert.deepEqual(owners().sort(), ["alice-model:alice", "darkness-gemini:shared"], "Alice's own model and the server's default remain");
  assert.equal(D.dbPurgeSharedModelCopies(), 0, "running it again changes nothing");
});
