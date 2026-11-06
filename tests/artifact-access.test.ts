import assert from "node:assert/strict";
import test from "node:test";

const { createArtifactAccess } = await import("../server/artifact-access.js");

const same = (a?: string | null, b?: string | null) => !!a && !!b && a === b;
function make(over: Record<string, unknown> = {}) {
  const projects = new Map<string, any>([["p-bob", { user_id: "bob" }]]);
  const artifacts = new Map<string, any>([["a-mem", { projectId: "p-bob", userId: "bob" }], ["a-mem-noowner", { projectId: "p-bob" }]]);
  const dbArtifacts: Record<string, any> = { "a-db": { project_id: "p-bob" }, "a-db-unloaded-project": { project_id: "p-carol" } };
  const dbProjects: Record<string, any> = { "p-carol": { user_id: "carol" } };
  const dbVisuals: Record<string, any> = { "v-1": { project_id: "p-bob" } };
  return createArtifactAccess({
    projects, artifacts,
    getProjectRow: (id) => dbProjects[id],
    getArtifactRow: (id) => dbArtifacts[id],
    getVisualAssetRow: (id) => dbVisuals[id],
    isUserOwner: same,
    ...over,
  } as any);
}

test("the creator and the project's owner may use an artifact; anyone else may not", () => {
  const a = make();
  assert.equal(a.mayUseArtifact("a-mem", "bob"), true);
  assert.equal(a.mayUseArtifact("a-mem", "eve"), false);
  assert.equal(a.mayUseArtifact("a-mem-noowner", "bob"), true, "no recorded creator: the project owner decides");
  assert.equal(a.mayUseArtifact("a-mem-noowner", "eve"), false);
  assert.equal(a.mayUseArtifact("a-db", "bob"), true, "an artifact only in the database resolves through its project");
  assert.equal(a.mayUseArtifact("a-db", "eve"), false);
});

test("a project that is not loaded in memory is looked up in the database", () => {
  const a = make();
  assert.equal(a.mayUseArtifact("a-db-unloaded-project", "carol"), true);
  assert.equal(a.mayUseArtifact("a-db-unloaded-project", "bob"), false);
});

test("no caller means no access; unknown ids pass the guard (the route answers 404) but are never 'owned'", () => {
  const a = make();
  assert.equal(a.mayUseArtifact("a-mem", null), false);
  assert.equal(a.mayUseArtifact("a-mem", undefined), false);
  assert.equal(a.mayUseArtifact("nope", "bob"), true);
  assert.equal(a.ownsArtifact("nope", "bob"), false, "bulk operations skip ids that do not exist");
  assert.equal(a.ownsArtifact("a-mem", "bob"), true);
  assert.equal(a.ownsArtifact("a-mem", "eve"), false, "another user's id is skipped exactly like an unknown one");
});

test("generated images follow their project's owner", () => {
  const a = make();
  assert.equal(a.mayUseVisualAsset("v-1", "bob"), true);
  assert.equal(a.mayUseVisualAsset("v-1", "eve"), false);
  assert.equal(a.mayUseVisualAsset("v-unknown", "eve"), true);
});

test("a failing database never grants access and never throws", () => {
  const boom = () => { throw new Error("db down"); };
  const a = make({ getProjectRow: boom, getArtifactRow: boom, getVisualAssetRow: boom });
  assert.equal(a.mayUseArtifact("a-db", "bob"), true, "unresolvable id: the route's own 404 applies");
  assert.equal(a.ownsArtifact("a-db", "bob"), false);
  assert.equal(a.mayUseArtifact("a-mem-noowner", "bob"), true, "in-memory project is still found");
  assert.equal(a.ownerOfProject("p-unknown"), null);
});

test("the same person written in a different UUID form is still the owner (isUserOwner decides)", () => {
  const a = make({ isUserOwner: (o?: string | null, u?: string | null) => !!o && !!u && o.replace(/-/g, "").toLowerCase() === u.replace(/-/g, "").toLowerCase() });
  const projects = new Map([["p", { user_id: "AAAA-BBBB" }]]);
  const b = createArtifactAccess({ projects, artifacts: new Map([["x", { projectId: "p" }]]), getProjectRow: () => null, getArtifactRow: () => null, getVisualAssetRow: () => null, isUserOwner: (o, u) => !!o && !!u && o.replace(/-/g, "").toLowerCase() === u.replace(/-/g, "").toLowerCase() } as any);
  assert.equal(b.mayUseArtifact("x", "aaaabbbb"), true);
  assert.equal(b.mayUseArtifact("x", "ccccdddd"), false);
  void a;
});
