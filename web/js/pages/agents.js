window.Darkness = window.Darkness || {};
window.Darkness.pages = window.Darkness.pages || {};

/**
 * Agent Workflow: the agent's tool pool as a live map, with the numbers behind it.
 * Everything shown is counted from the runs this account actually made (GET /api/agent/stats). Runs are recorded from the day this
 * page shipped; goals and tool outputs are never stored, only times, step counts, the model and tool names with their outcome.
 */
window.Darkness.pages.agents = function renderAgentsPage() {
  const D = window.Darkness, M = D.mg, V = D.viz, esc = M.esc;
  const main = document.getElementById("main");
  if (!main) return;

  const RANGES = [7, 14, 30, 90];
  let days = 14;
  try { const saved = Number(localStorage.getItem("darkness_agents_days")); if (RANGES.indexOf(saved) >= 0) days = saved; } catch (e) {}

  main.innerHTML =
    '<div class="page mg-page"><div class="page__inner" id="ixAgents">' +
    '<header class="mg-head"><div><h1 class="mg-title">Agent Workflow</h1><p class="mg-sub">What the agent can use, and how its runs are going.</p></div></header>' +
    M.skeleton("chart") + "</div></div>";
  const root = document.getElementById("ixAgents");

  function toolIcon(name) {
    const n = String(name).toLowerCase(), I = V.icons;
    if (/search|web|browse/.test(n)) return I.search;
    if (/fetch|http|url|site/.test(n)) return I.globe;
    if (/file|read|write|doc|note/.test(n)) return I.file;
    if (/code|run|exec|shell|script|python/.test(n)) return I.code;
    if (/calc|math|solve/.test(n)) return I.calc;
    if (/knowledge|library|rag/.test(n)) return I.book;
    return I.tool;
  }
  const pretty = function (s) { return String(s).replace(/[_-]+/g, " ").replace(/^\w/, function (c) { return c.toUpperCase(); }); };
  const shortDay = function (d) { return new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }); };
  const secs = function (ms) { return ms == null ? "—" : ms < 1000 ? Math.round(ms) + " ms" : (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + " s"; };
  const pct = function (x) { return x == null ? "—" : Math.round(x * 100) + "%"; };

  let hiddenTools = 0;
  function buildGraph(stats, toolList) {
    const byName = {};
    toolList.forEach(function (t) { byName[t.name] = { name: t.name, calls: 0, errors: 0 }; });
    stats.tools.forEach(function (t) { byName[t.tool] = { name: t.tool, calls: t.calls, errors: t.errors }; });
    const all = Object.keys(byName).map(function (k) { return byName[k]; }).sort(function (a, b) { return b.calls - a.calls || a.name.localeCompare(b.name); });
    const tools = all.slice(0, 6);
    hiddenTools = all.length - tools.length;
    const ran = stats.totals.runs > 0;
    const nodes = [
      { id: "goal", x: 8, y: 50, label: "Your goal", sub: ran ? stats.totals.runs + " runs" : "no runs yet", icon: V.icons.goal, tone: "info", state: ran ? "active" : "idle", href: "/agent.html" },
      { id: "agent", x: 27, y: 50, label: "Agent", sub: "plans and acts", icon: V.icons.agent, tone: "accent", state: ran ? "active" : "idle", href: "/agent.html" },
      { id: "answer", x: 93, y: 50, label: "Answer", sub: ran ? pct(stats.totals.successRate) + " succeeded" : "—", icon: V.icons.answer, tone: "ok", state: ran ? "active" : "idle" },
    ];
    const edges = [{ from: "goal", to: "agent", active: ran }];
    const rows = tools.length > 3 ? 2 : 1, cols = rows === 1 ? Math.max(1, tools.length) : 3;
    tools.forEach(function (t, i) {
      const col = rows === 1 ? i : Math.floor(i / 2), row = rows === 1 ? 0 : i % 2;
      const x = cols === 1 ? 62 : 46 + col * (34 / (cols - 1)); // 3 columns of ~17% (120 px) so labels never touch
      const y = rows === 1 ? 50 : (row === 0 ? 27 : 73);
      const used = t.calls > 0, bad = used && t.errors / t.calls >= 0.5;
      nodes.push({ id: "t:" + t.name, x: x, y: y, label: pretty(t.name), sub: used ? t.calls + (t.calls === 1 ? " call" : " calls") + (t.errors ? " · " + t.errors + " failed" : "") : "not used yet", icon: toolIcon(t.name), tone: bad ? "warn" : "accent", state: used ? (bad ? "warn" : "active") : "idle" });
      edges.push({ from: "agent", to: "t:" + t.name, active: used });
      edges.push({ from: "t:" + t.name, to: "answer", active: used });
    });
    return V.graph({ nodes: nodes, edges: edges, width: 720, height: 420, label: "The agent, its tools and how often each was used" });
  }

  function metric(title, value, hint, series, tone, fmt, labels) {
    return '<article class="mg-card ix-metric ix-tone-' + tone + '"><div class="ix-metric__head"><h3 class="ix-metric__title">' + esc(title) + '</h3><span class="ix-metric__value">' + esc(value) + "</span></div>" +
      V.area(series, { tone: tone, labels: labels, label: title, format: fmt }) + '<span class="ix-metric__hint">' + esc(hint) + "</span></article>";
  }

  function paint(stats, tools) {
    const t = stats.totals, s = stats.series;
    const labels = s.length ? [shortDay(s[0].day), shortDay(s[s.length - 1].day)] : null;
    const graph = buildGraph(stats, tools);
    const rate = s.map(function (d) { return d.ok + d.failed ? d.ok / (d.ok + d.failed) * 100 : null; });
    const more = hiddenTools > 0 ? '<p class="ix-note">' + hiddenTools + " more unused tool" + (hiddenTools === 1 ? "" : "s") + " not drawn here.</p>" : "";
    const note = more + (t.runs ? "" : '<p class="ix-note">No runs recorded yet. Open the Agent, give it a goal, and its tool use shows up here. Only runs made after this page was added are counted.</p>');

    root.innerHTML = [
      '<header class="mg-head"><div><h1 class="mg-title">Agent Workflow</h1><p class="mg-sub">What the agent can use, and how its runs are going.</p></div>',
      '<div class="mg-actions"><label class="mg-muted" for="ixAgentRange">Range</label><select id="ixAgentRange" class="input" aria-label="Time range">' +
        RANGES.map(function (r) { return '<option value="' + r + '"' + (r === days ? " selected" : "") + ">Last " + r + " days</option>"; }).join("") + "</select>" +
        '<a class="btn btn--primary btn--sm" href="/agent.html">' + M.icon("bot", 15) + " <span>Open the Agent</span></a></div></header>",
      '<div class="ix-agent">',
      '<section class="ix-canvas" aria-labelledby="ixMapTitle"><div class="ix-canvas__head"><div><h2 id="ixMapTitle">Tool pool</h2><p>Brighter pads were used in the last ' + days + " days; lines pulse where work flowed.</p></div></div>" + graph + note +
        '<div class="ix-legend"><span class="ix-tone-accent"><i></i>Used</span><span class="ix-tone-warn"><i></i>Mostly failing</span><span class="is-dim"><i></i>Not used yet</span></div></section>',
      '<div class="ix-metrics">',
      metric("Runs per day", M.num(t.runs), t.runs ? M.num(t.cancelled) + " cancelled" : "no runs yet", s.map(function (d) { return d.runs; }), "accent", null, labels),
      metric("Success rate", pct(t.successRate), t.ok + t.failed ? t.ok + " of " + (t.ok + t.failed) + " finished runs" : "needs a finished run", rate, "ok", function (n) { return Math.round(n) + "%"; }, labels),
      metric("Failed runs", M.num(t.failed), t.errorRate == null ? "no finished runs" : pct(t.errorRate) + " error rate", s.map(function (d) { return d.failed; }), "bad", null, labels),
      metric("Average duration", secs(t.avgDurationMs), t.avgSteps == null ? "—" : t.avgSteps.toFixed(1) + " steps per run", s.map(function (d) { return d.avgDurationMs == null ? null : d.avgDurationMs / 1000; }), "info", function (n) { return n.toFixed(1) + " s"; }, labels),
      "</div></div>",
      '<section class="mg-grid mg-grid--even">',
      '<article class="mg-card"><header class="mg-card__head"><div><h2>Tools used</h2><p>Calls and failures in the last ' + days + " days</p></div></header>" +
        (stats.tools.length ? '<div class="ix-scroll"><table class="ix-table"><caption class="sr-only">Tool usage</caption><thead><tr><th scope="col">Tool</th><th scope="col" class="ix-num">Calls</th><th scope="col" class="ix-num">Failed</th></tr></thead><tbody>' +
          stats.tools.map(function (x) { return "<tr><td>" + esc(pretty(x.tool)) + '</td><td class="ix-num">' + M.num(x.calls) + '</td><td class="ix-num">' + M.num(x.errors) + "</td></tr>"; }).join("") + "</tbody></table></div>"
          : '<p class="mg-muted">No tool calls recorded in this range.</p>') + "</article>",
      '<article class="mg-card"><header class="mg-card__head"><div><h2>Recent runs</h2><p>Newest first</p></div></header>' +
        (stats.recent.length ? '<div class="ix-scroll"><table class="ix-table"><caption class="sr-only">Recent agent runs</caption><thead><tr><th scope="col">When</th><th scope="col">Result</th><th scope="col" class="ix-num">Steps</th><th scope="col" class="ix-num">Time</th></tr></thead><tbody>' +
          stats.recent.map(function (r) {
            const tone = r.status === "ok" ? "ok" : r.status === "cancelled" ? "info" : "bad", label = r.status === "ok" ? "Succeeded" : r.status === "cancelled" ? "Cancelled" : "Failed";
            return "<tr><td>" + esc(M.ago(r.startedAt)) + '</td><td><span class="ix-badge ix-tone-' + tone + '">' + label + '</span></td><td class="ix-num">' + r.steps + '</td><td class="ix-num">' + secs(r.durationMs) + "</td></tr>";
          }).join("") + "</tbody></table></div>" : '<p class="mg-muted">No runs yet.</p>') + "</article>",
      "</section>",
    ].join("");

    const sel = document.getElementById("ixAgentRange");
    if (sel) sel.addEventListener("change", function () {
      days = Number(sel.value) || 14;
      try { localStorage.setItem("darkness_agents_days", String(days)); } catch (e) {}
      load();
    });
  }

  function load() {
    Promise.all([D.api.get("/api/agent/stats", { days: days }), D.api.get("/api/agent/tools").catch(function () { return { tools: [] }; })])
      .then(function (r) { if (document.getElementById("ixAgents") === root) paint(r[0], (r[1] && r[1].tools) || []); })
      .catch(function (err) {
        root.innerHTML = M.errorPanel(err && err.message, "ixRetry");
        const b = document.getElementById("ixRetry");
        if (b) b.addEventListener("click", function () { D.pages.agents(); });
      });
  }
  load();
};
