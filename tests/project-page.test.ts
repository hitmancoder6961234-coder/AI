import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

/**
 * Source-level guards for the Project page. Two classes of bug had crept in unnoticed:
 *   - handlers bound to element ids that no markup creates (the whole project header was missing, so Back, Re-Analyze,
 *     Delete, Export report... were dead), and
 *   - tab renderers that nothing could open (no tab button).
 * The browser walkthrough in the improvement log exercises the real interactions; these checks keep the structure honest.
 */
const SRC = fs.readFileSync(path.join(process.cwd(), "web/js/pages/project.js"), "utf8").replace(/\r\n/g, "\n");

function between(from: string, to: string): string {
  const a = SRC.indexOf(from);
  const b = SRC.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `markers found: ${from} .. ${to}`);
  return SRC.slice(a, b);
}

const DETAIL = between("async function renderProjectDetail(", "function renderOverviewTab(");

test("every element the project header binds a handler to is actually rendered", () => {
  const bound = new Set<string>();
  for (const m of DETAIL.matchAll(/getElementById\("([A-Za-z0-9_]+)"\)\??\.addEventListener/g)) bound.add(m[1]);
  assert.ok(bound.size >= 6, "found the header handlers: " + [...bound].join(","));
  const missing = [...bound].filter((id) => !new RegExp(`id="${id}"`).test(DETAIL));
  assert.deepEqual(missing, [], "handlers bound to ids that the page never renders: " + missing.join(","));
});

test("the project header offers the actions that have handlers: back, assistant, report, diagram, re-analyze, delete", () => {
  for (const id of ["backBtn", "openChatTabBtn", "headerProjectActionsBtn", "headerProjectActionsMenu", "exportReportBtn", "exportDiagramPngLink", "exportDiagramJpgLink", "reAnalyzeBtn", "deleteProjectDetailBtn"]) {
    assert.match(DETAIL, new RegExp(`id="${id}"`), id);
  }
});

test("every tab the page can render has a button in the tab bar", () => {
  const rendered = new Set<string>();
  for (const m of between("function renderActiveTab()", "function switchTabToFile(").matchAll(/activeProjectTab === "([a-z_]+)"/g)) rendered.add(m[1]);
  const aliases = new Set(["knowledge", "mindmap", "pipeline", "advisor"]); // redirected to another tab by switchTab
  const bar = new Set<string>();
  for (const m of between("const tabDefs = [", "];").matchAll(/\["([a-z_]+)",/g)) bar.add(m[1]);
  const unreachable = [...rendered].filter((t) => !bar.has(t) && !aliases.has(t));
  assert.deepEqual(unreachable, [], "tab renderers with no tab button: " + unreachable.join(","));
  assert.ok(bar.has("run") && bar.has("visual_advisor") && bar.has("artifacts"), "the restored tabs are present");
});

test("shared modals live at module scope, so any tab can open them", () => {
  assert.match(SRC, /\nfunction openCodeChangeModal\(plan\) \{/);
  assert.match(SRC, /\nfunction openRepairAllAdvisorModal\(issuesToRepair, callback, projectIdHint\) \{/);
  assert.match(SRC, /window\.Darkness\.projectModals = \{ openCodeChangeModal, openRepairAllAdvisorModal \}/);
  // and nothing guards them with typeof any more (that guard is what hid the dead button)
  assert.ok(!/typeof openCodeChangeModal/.test(SRC) && !/typeof openRepairAllAdvisorModal/.test(SRC) && !/typeof switchTab(?!ToFile)/.test(SRC) && !/typeof activateFlow/.test(SRC));
});

test("the actions menu does not add a new document listener on every render", () => {
  assert.match(DETAIL, /document\.removeEventListener\("click", window\.__pjMenuClose\)/);
  assert.match(DETAIL, /document\.removeEventListener\("keydown", window\.__pjMenuKey\)/);
});
