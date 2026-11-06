import assert from "node:assert/strict";
import test, { after } from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.DARKNESS_STORAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "darkness-run-test-"));

const re = await import("../server/run-engine.js");
const { createTerminalSession, startTerminalSession, stopProject, getRunStatus, getProjectSessions, syncProjectFiles } = re;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (fn: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await sleep(50); return fn(); };
const LONG = `node -e "setInterval(function(){},1000)"`;

const started: string[] = [];
after(() => {
  for (const p of started) stopProject(p, { discard: true });
  // A process or timer left behind keeps this test file alive forever, and `node --test` then waits until the CI job times out. Fail fast and
  // say what is still open instead.
  setTimeout(() => {
    console.error("[run-engine.test] still running 20 s after the tests finished; open resources:", process.getActiveResourcesInfo());
    process.exit(1);
  }, 20_000).unref();
});

async function launch(pid: string, command: string) {
  started.push(pid);
  syncProjectFiles(pid, [{ filename: "package.json", content: JSON.stringify({ name: pid }) }]);
  const s = createTerminalSession(pid, command, "Test run");
  await startTerminalSession(s.id);
  return s;
}

test("getRunStatus: idle when nothing has run, then reflects the latest run (this is what the project Copilot reads)", async () => {
  assert.deepEqual(getRunStatus("proj_never_ran"), { status: "idle", logs: [] });

  const s = await launch("proj_status", `node -e "console.log('hello from the app'); process.exit(3)"`);
  assert.ok(await waitFor(() => s.status !== "running" && s.status !== "starting"), "the short-lived process ended");
  const st = getRunStatus("proj_status");
  assert.notEqual(st.status, "idle");
  assert.equal(st.command, s.command);
  assert.equal(st.runtime, "node");
  assert.equal(st.exitCode, 3);
  assert.ok(st.logs.join("").includes("hello from the app"), "the logs come with it");
});

test("stopProject stops a running process for real, and is safe to call again", async () => {
  const s = await launch("proj_stop", LONG);
  assert.ok(await waitFor(() => s.status === "running" && !!s.process?.pid), "the process is running");
  const pid = s.process!.pid!;
  assert.ok(alive(pid));

  assert.equal(stopProject("proj_stop"), 1, "one process was stopped");
  assert.equal(s.status, "stopped");
  assert.ok(await waitFor(() => !alive(pid), 5000), "the operating-system process is really gone");
  await sleep(400); // the killed process has exited by now; its non-zero exit code must not turn a requested stop into a "failure"
  assert.equal(s.status, "stopped", "a stop requested by the user stays 'stopped' after the process exits");
  assert.equal(stopProject("proj_stop"), 0, "calling it again stops nothing and does not throw");
  assert.equal(getProjectSessions("proj_stop").length, 1, "without discard the finished session is kept for its logs");
});

test("stopProject with discard (used when a project is deleted) stops AND forgets only that project's sessions", async () => {
  const a = await launch("proj_del_a", LONG);
  assert.ok(await waitFor(() => a.status === "running" && !!a.process?.pid));
  const pidA = a.process!.pid!;
  // a second project is unaffected: starting it would stop the first (one running project at a time), so only create a session for it
  const other = createTerminalSession("proj_del_b", "echo hi", "Other");

  assert.equal(stopProject("proj_del_a", { discard: true }), 1);
  assert.ok(await waitFor(() => !alive(pidA), 5000), "the process is gone before the project folder is removed");
  assert.deepEqual(getProjectSessions("proj_del_a"), [], "its sessions are forgotten");
  assert.equal(getProjectSessions("proj_del_b").length, 1, "another project's sessions are left alone");
  assert.equal(other.status, "idle");
  stopProject("proj_del_b", { discard: true });
});
