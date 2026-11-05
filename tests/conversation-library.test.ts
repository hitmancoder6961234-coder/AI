import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const lib = await import("../server/conversation-library.js");
const { LibraryError } = lib;

function makeDb() {
  const db = new DatabaseSync(":memory:");
  // the same shape as server/db.ts (before the metadata columns exist)
  db.exec(`CREATE TABLE conversations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'user_default', project_id TEXT, title TEXT NOT NULL, model_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, model_id TEXT, attachments TEXT, created_at INTEGER NOT NULL, FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);`);
  const conv = (id: string, user: string, title: string, at: number, msgs: Array<[string, string]> = []) => {
    db.prepare("INSERT INTO conversations (id, user_id, title, model_id, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(id, user, title, "m1", at, at);
    msgs.forEach(([role, content], i) => db.prepare("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?,?,?,?,?)").run(`${id}-m${i}`, id, role, content, at + i));
  };
  conv("c1", "ada", "Trip planning", 100, [["user", "Plan 5 days in Lisbon with a budget of 800 euros"], ["assistant", "Day 1: Alfama. Day 2: Belem."]]);
  conv("c2", "ada", "Database tuning", 200, [["user", "Why is my SQL query slow? 100% CPU on _prod_"], ["assistant", "Add an index on user_id."]]);
  conv("c3", "ada", "Recipes", 300, [["user", "Give me a lentil soup recipe"]]);
  conv("x1", "bob", "Bob's secret plan", 150, [["user", "Lisbon is where I hide the secret"]]);
  return { db, conv };
}

test("the metadata columns are added once, and running the migration again (or on a database that has them) changes nothing", () => {
  const { db } = makeDb();
  lib.ensureConversationMetaColumns(db);
  lib.ensureConversationMetaColumns(db);
  const cols = (db.prepare("PRAGMA table_info(conversations)").all() as any[]).map((c) => c.name);
  for (const c of ["tags", "folder", "pinned"]) assert.equal(cols.filter((x) => x === c).length, 1, c);
  // a brand-new connection to a database that already has the columns
  const again = new DatabaseSync(":memory:");
  again.exec("CREATE TABLE conversations (id TEXT PRIMARY KEY, user_id TEXT, project_id TEXT, title TEXT, model_id TEXT, created_at INTEGER, updated_at INTEGER, tags TEXT, folder TEXT, pinned INTEGER NOT NULL DEFAULT 0)");
  assert.doesNotThrow(() => lib.ensureConversationMetaColumns(again));
  // existing rows keep their data and get defaults
  assert.deepEqual(lib.conversationMetaMap(db, "ada").get("c1"), { tags: [], folder: null, pinned: false });
});

test("tag and folder validation: normalised, de-duplicated, bounded, and refusing anything odd", () => {
  assert.deepEqual(lib.normalizeTags(["  Work ", "work", "Q3  plan", ""]), ["work", "q3 plan"]);
  assert.deepEqual(lib.normalizeTags(undefined), []);
  assert.deepEqual(lib.normalizeTags(["日本語", "café"]), ["日本語", "café"]);
  for (const bad of ["nope", [1], ["a".repeat(25)], ["<script>"], ["a;drop"], ["-leading"], Array.from({ length: 11 }, (_, i) => "t" + i)]) {
    assert.throws(() => lib.normalizeTags(bad), (e: any) => e instanceof LibraryError && e.code === "INVALID_TAGS" && e.status === 400, JSON.stringify(bad).slice(0, 40));
  }
  assert.equal(lib.normalizeFolder("  Client  A "), "Client A");
  assert.equal(lib.normalizeFolder(""), null);
  assert.equal(lib.normalizeFolder(null), null);
  for (const bad of [5, "x".repeat(41), "a/b", "../etc"]) assert.throws(() => lib.normalizeFolder(bad), (e: any) => e.code === "INVALID_FOLDER");
});

test("setting metadata works on your own conversation only, leaves unspecified fields alone, and never touches someone else's", () => {
  const { db } = makeDb();
  assert.deepEqual(lib.setConversationMeta(db, "ada", "c1", { tags: ["Travel", "2026"], folder: "Plans", pinned: true }), { tags: ["travel", "2026"], folder: "Plans", pinned: true });
  assert.deepEqual(lib.setConversationMeta(db, "ada", "c1", { pinned: false }), { tags: ["travel", "2026"], folder: "Plans", pinned: false }, "a partial patch keeps the rest");
  assert.deepEqual(lib.setConversationMeta(db, "ada", "c1", { folder: null }), { tags: ["travel", "2026"], folder: null, pinned: false });
  assert.equal(lib.setConversationMeta(db, "bob", "c1", { tags: ["stolen"] }), null, "not bob's conversation");
  assert.equal(lib.setConversationMeta(db, "ada", "x1", { tags: ["stolen"] }), null, "bob's conversation is invisible to ada");
  assert.deepEqual(lib.conversationMetaMap(db, "bob").get("x1"), { tags: [], folder: null, pinned: false });
  assert.deepEqual(lib.conversationMetaMap(db, "ada").get("c1")!.tags, ["travel", "2026"]);
  assert.throws(() => lib.setConversationMeta(db, "ada", "c1", { pinned: "yes" }), (e: any) => e.code === "INVALID_PINNED");
  assert.deepEqual(lib.conversationMetaMap(db, "ada").get("c1")!.pinned, false, "a rejected patch changes nothing");
});

test("facets list the tags and folders in use with counts, for the caller only", () => {
  const { db } = makeDb();
  lib.setConversationMeta(db, "ada", "c1", { tags: ["a", "b"], folder: "F1" });
  lib.setConversationMeta(db, "ada", "c2", { tags: ["a"], folder: "F1" });
  lib.setConversationMeta(db, "bob", "x1", { tags: ["a", "bobonly"], folder: "Secret" });
  assert.deepEqual(lib.conversationFacets(db, "ada"), { tags: [{ name: "a", count: 2 }, { name: "b", count: 1 }], folders: [{ name: "F1", count: 2 }] });
});

test("search finds words in messages and titles, case-insensitively, with a snippet around the match", () => {
  const { db } = makeDb();
  const r = lib.searchConversations(db, "ada", { q: "LISBON" });
  assert.deepEqual(r.results.map((x: any) => x.id), ["c1"]);
  assert.match(r.results[0].snippet, /Lisbon with a budget/);
  assert.equal(r.results[0].titleMatch, false);
  const t = lib.searchConversations(db, "ada", { q: "recipes" });
  assert.deepEqual(t.results.map((x: any) => x.id), ["c3"]);
  assert.equal(t.results[0].titleMatch, true);
  assert.equal(lib.searchConversations(db, "ada", { q: "no such words anywhere" }).total, 0);
  assert.equal(r.results[0].messageCount, 2);
});

test("search never returns another user's conversations or text", () => {
  const { db } = makeDb();
  assert.deepEqual(lib.searchConversations(db, "ada", { q: "secret" }).results, [], "bob's message and title are invisible to ada");
  assert.deepEqual(lib.searchConversations(db, "bob", { q: "lisbon" }).results.map((x: any) => x.id), ["x1"]);
  assert.deepEqual(lib.searchConversations(db, "mallory", { q: "lisbon" }).results, []);
  assert.deepEqual(lib.searchConversations(db, "mallory", {}).results, []);
});

test("LIKE wildcards in the query are literal characters, not patterns", () => {
  const { db } = makeDb();
  assert.deepEqual(lib.searchConversations(db, "ada", { q: "100%" }).results.map((x: any) => x.id), ["c2"], "percent sign matches only a percent sign");
  assert.deepEqual(lib.searchConversations(db, "ada", { q: "_prod_" }).results.map((x: any) => x.id), ["c2"]);
  assert.equal(lib.searchConversations(db, "ada", { q: "%%" }).total, 0, "'%%' is not 'match everything'");
  assert.equal(lib.searchConversations(db, "ada", { q: "__" }).total, 0, "'__' is not 'any two characters'");
  assert.equal(lib.searchConversations(db, "ada", { q: "a_" }).total, 0);
  assert.equal(lib.searchConversations(db, "ada", { q: "\\" + "%" }).total, 0, "a backslash does not escape out of the escaping");
  assert.equal(lib.searchConversations(db, "ada", { q: "x' OR '1'='1" }).total, 0, "quotes cannot inject SQL");
});

test("filters by tag, folder and pinned combine with the text; pinned conversations come first; limits are enforced", () => {
  const { db } = makeDb();
  lib.setConversationMeta(db, "ada", "c1", { tags: ["travel"], folder: "Plans", pinned: false });
  lib.setConversationMeta(db, "ada", "c2", { tags: ["work"], folder: "Plans", pinned: true });
  lib.setConversationMeta(db, "ada", "c3", { tags: ["travel", "food"], pinned: false });
  const ids = (o: object) => lib.searchConversations(db, "ada", o).results.map((x: any) => x.id);
  assert.deepEqual(ids({ tag: "travel" }).sort(), ["c1", "c3"]);
  assert.deepEqual(ids({ tag: "TRAVEL" }).sort(), ["c1", "c3"], "tag filters are normalised like tags");
  assert.deepEqual(ids({ folder: "Plans" }), ["c2", "c1"], "pinned first, then newest");
  assert.deepEqual(ids({ pinned: true }), ["c2"]);
  assert.deepEqual(ids({ q: "index", folder: "Plans" }), ["c2"]);
  assert.deepEqual(ids({ q: "index", folder: "nowhere" }), []);
  assert.deepEqual(ids({}), ["c2", "c3", "c1"], "no query: everything, pinned first, then by recency");
  assert.equal(lib.searchConversations(db, "ada", { limit: 2 }).results.length, 2);
  assert.equal(lib.searchConversations(db, "ada", { limit: 2 }).total, 3, "total counts all matches");
  assert.throws(() => lib.searchConversations(db, "ada", { q: "a" }), (e: any) => e.code === "QUERY_TOO_SHORT");
  assert.throws(() => lib.searchConversations(db, "ada", { q: "x".repeat(101) }), (e: any) => e.code === "QUERY_TOO_LONG");
});

test("branching copies the messages up to the chosen one into a new conversation and leaves the source untouched", () => {
  const { db } = makeDb();
  lib.setConversationMeta(db, "ada", "c1", { tags: ["travel"], folder: "Plans", pinned: true });
  let n = 0;
  const out = lib.branchConversation(db, "ada", "c1", "c1-m0", { newConversationId: "b1", newMessageId: () => "nm" + ++n, now: 999 });
  assert.deepEqual(out, { id: "b1", title: "Branch of Trip planning", copied: 1 });
  const copied = db.prepare("SELECT id, role, content FROM messages WHERE conversation_id = 'b1' ORDER BY created_at").all() as any[];
  assert.deepEqual(copied.map((m) => m.id), ["nm1"], "new message ids");
  assert.match(copied[0].content, /Lisbon/);
  assert.equal((db.prepare("SELECT count(*) n FROM messages WHERE conversation_id = 'c1'").get() as any).n, 2, "the source keeps both of its messages");
  assert.deepEqual(lib.conversationMetaMap(db, "ada").get("b1"), { tags: ["travel"], folder: "Plans", pinned: false }, "tags and folder carry over, pinning does not");
  assert.equal(lib.conversationMetaMap(db, "ada").get("c1")!.pinned, true, "the source is still pinned");
  // branching from the last message copies everything
  const full = lib.branchConversation(db, "ada", "c1", "c1-m1", { newConversationId: "b2", newMessageId: () => "z" + ++n, now: 1000 });
  assert.equal(full!.copied, 2);
});

test("branching refuses what is not yours or does not exist, and a failure leaves nothing half-copied", () => {
  const { db } = makeDb();
  const ids = (id: string) => ({ newConversationId: id, newMessageId: () => "m-" + Math.random(), now: 1 });
  assert.equal(lib.branchConversation(db, "bob", "c1", "c1-m0", ids("b9")), null, "bob cannot branch ada's conversation");
  assert.equal(lib.branchConversation(db, "ada", "x1", "x1-m0", ids("b9")), null, "ada cannot branch bob's");
  assert.equal(lib.branchConversation(db, "ada", "c1", "x1-m0", ids("b9")), null, "a message from another conversation is not accepted");
  assert.equal(lib.branchConversation(db, "ada", "c1", "no-such", ids("b9")), null);
  assert.equal((db.prepare("SELECT count(*) n FROM conversations WHERE id = 'b9'").get() as any).n, 0);
  // an insert failure part-way (duplicate message ids) rolls back the whole branch
  assert.throws(() => lib.branchConversation(db, "ada", "c1", "c1-m1", { newConversationId: "bf", newMessageId: () => "same-id", now: 1 }));
  assert.equal((db.prepare("SELECT count(*) n FROM conversations WHERE id = 'bf'").get() as any).n, 0, "no conversation row");
  assert.equal((db.prepare("SELECT count(*) n FROM messages WHERE conversation_id = 'bf'").get() as any).n, 0, "no message rows");
});
