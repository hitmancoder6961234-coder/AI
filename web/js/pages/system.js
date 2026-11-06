window.Darkness = window.Darkness || {};
window.Darkness.pages = window.Darkness.pages || {};

/**
 * System status: is the service healthy, and what needs attention in YOUR workspace?
 * Data: GET /api/system/status. It shows the readiness checks of this server (names and ok / fail, never paths or driver messages),
 * process vitals, and counts and alerts for the signed-in account only. Nothing about other users or the host is exposed.
 */
window.Darkness.pages.system = function renderSystemPage() {
  const D = window.Darkness, M = D.mg, V = D.viz, esc = M.esc;
  const main = document.getElementById("main");
  if (!main) return;

  main.innerHTML =
    '<div class="page mg-page"><div class="page__inner" id="ixSystem">' +
    '<header class="mg-head"><div><h1 class="mg-title">System status</h1><p class="mg-sub">Service health and what needs attention.</p></div></header>' +
    M.skeleton("chart") + "</div></div>";
  const root = document.getElementById("ixSystem");
  let timer = null;

  const STATE = { ready: ["ok", "Ready"], degraded: ["warn", "Degraded"], not_ready: ["bad", "Not ready"], draining: ["warn", "Shutting down"] };
  const uptime = function (s) {
    if (s < 90) return s + " s";
    if (s < 5400) return Math.round(s / 60) + " min";
    if (s < 172800) return (s / 3600).toFixed(1) + " h";
    return Math.round(s / 86400) + " days";
  };

  function buildMap(d) {
    const I = V.icons, chk = {};
    d.checks.forEach(function (c) { chk[c.name.toLowerCase()] = c; });
    const tone = function (c) { return !c ? "accent" : c.status === "ok" ? "ok" : "bad"; };
    const st = function (c, count) { return c ? (c.status === "ok" ? "active" : "bad") : (count > 0 ? "active" : "idle"); };
    const db = chk.database, stg = chk.storage;
    const o = d.own, m = d.models;
    const list = [
      { id: "chat", label: "Chat", sub: o.conversations + (o.conversations === 1 ? " conversation" : " conversations"), icon: I.chat, state: st(null, o.conversations), href: "#/history" },
      { id: "copilot", label: "Copilot", sub: o.copilotConversations + (o.copilotConversations === 1 ? " conversation" : " conversations"), icon: I.zap, state: st(null, o.copilotConversations), href: "/copilot.html" },
      { id: "agent", label: "Agent", sub: o.agentRuns14d + " runs · 14 days", icon: I.agent, state: st(null, o.agentRuns14d), href: "#/agents" },
      { id: "models", label: "Models", sub: m.enabled + " of " + m.total + " enabled", icon: I.cpu, state: m.enabled > 0 ? "active" : (m.total ? "warn" : "idle"), tone: m.enabled > 0 ? "accent" : "warn", href: "#/model" },
      { id: "projects", label: "Projects", sub: o.projects + (o.projects === 1 ? " project" : " projects"), icon: I.folder, state: st(null, o.projects), href: "#/project" },
      { id: "library", label: "Library", sub: o.files + (o.files === 1 ? " file" : " files"), icon: I.file, state: st(null, o.files), href: "#/knowledge" },
      { id: "database", label: "Database", sub: db ? (db.status === "ok" ? "responding · " + db.ms + " ms" : "not responding") : "—", icon: I.db, tone: tone(db), state: st(db, 0) },
      { id: "storage", label: "Storage", sub: stg ? (stg.status === "ok" ? "writable" : "problem") : "—", icon: I.disk, tone: tone(stg), state: st(stg, 0) },
    ];
    const nodes = [{ id: "core", x: 50, y: 50, label: "Workspace", sub: (STATE[d.state] || ["", d.state])[1], icon: I.network, tone: (STATE[d.state] || ["accent"])[0], state: d.state === "ready" ? "active" : "warn" }];
    const edges = [];
    list.forEach(function (n, i) {
      const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
      n.x = 50 + Math.cos(a) * 38; n.y = 50 + Math.sin(a) * 36;
      nodes.push(n);
      edges.push({ from: "core", to: n.id, active: n.state === "active" });
    });
    return V.graph({ nodes: nodes, edges: edges, width: 720, height: 460, label: "Your workspace and the services behind it" });
  }

  function paint(d) {
    const crit = d.alerts.filter(function (a) { return a.level === "critical"; }), warn = d.alerts.filter(function (a) { return a.level === "warning"; }), info = d.alerts.filter(function (a) { return a.level === "info"; });
    const st = STATE[d.state] || ["info", d.state];
    const ordered = crit.concat(warn, info);
    const failedChecks = d.checks.filter(function (c) { return c.status !== "ok"; }).length;

    root.innerHTML = [
      '<header class="mg-head"><div><h1 class="mg-title">System status</h1><p class="mg-sub">Service health and what needs attention.</p></div>',
      '<div class="mg-actions"><span class="ix-state ix-tone-' + st[0] + '" role="status">' + esc(st[1]) + "</span>" +
        '<button class="btn btn--outline btn--sm" id="ixSysRefresh" type="button">' + M.icon("refresh", 15) + " <span>Refresh</span></button></div></header>",
      '<div class="ix-system">',
      '<section class="ix-canvas" aria-labelledby="ixSysMap"><div class="ix-canvas__head"><div><h2 id="ixSysMap">Workspace overview</h2><p>Your data and the services it runs on. Select a pad to open it.</p></div></div>' + buildMap(d) +
        '<div class="ix-legend"><span class="ix-tone-ok"><i></i>Healthy</span><span class="ix-tone-warn"><i></i>Needs attention</span><span class="ix-tone-bad"><i></i>Failing</span><span class="is-dim"><i></i>Empty</span></div></section>',
      '<aside class="mg-card ix-alerts" aria-labelledby="ixAlertsTitle"><header class="mg-card__head"><div><h2 id="ixAlertsTitle">Alerts</h2><p>Derived from the checks and your account</p></div></header>' +
        '<div class="ix-alerts__counts"><div class="ix-alerts__count ix-tone-bad"><strong>' + crit.length + "</strong><span>Critical</span></div>" +
        '<div class="ix-alerts__count ix-tone-warn"><strong>' + warn.length + "</strong><span>Warning</span></div>" +
        '<div class="ix-alerts__count ix-tone-info"><strong>' + info.length + "</strong><span>Notice</span></div></div>" +
        (ordered.length ? '<ul class="ix-alert-list">' + ordered.map(function (a) {
          const tone = a.level === "critical" ? "bad" : a.level === "warning" ? "warn" : "info";
          const inner = "<div><strong>" + esc(a.title) + "</strong><span>" + esc(a.detail) + "</span></div>";
          return "<li>" + (a.href ? '<a class="ix-alert ix-tone-' + tone + '" href="' + esc(a.href) + '">' + inner + "</a>" : '<div class="ix-alert ix-tone-' + tone + '">' + inner + "</div>") + "</li>";
        }).join("") + "</ul>" : '<div class="mg-empty">' + M.icon("check", 28) + "<strong>All clear</strong><p>No alerts right now.</p></div>") + "</aside>",
      "</div>",
      '<section class="ix-vitals" aria-label="Vitals">',
      '<article class="mg-card ix-vital ix-tone-' + st[0] + '"><div class="ix-vital__label">Service</div><div class="ix-vital__value">' + esc(st[1]) + '</div><div class="ix-vital__sub">' + (failedChecks ? failedChecks + " of " + d.checks.length + " checks failing" : d.checks.length + " checks passing") + "</div>" +
        '<div class="ix-checks">' + d.checks.map(function (c) { return '<span class="ix-check ix-tone-' + (c.status === "ok" ? "ok" : c.required ? "bad" : "warn") + '">' + esc(c.name) + (c.required ? "" : " (optional)") + "</span>"; }).join("") + "</div></article>",
      '<article class="mg-card ix-vital"><div class="ix-vital__label">Memory</div><div class="ix-vital__value">' + M.num(d.process.memoryMb) + ' MB</div><div class="ix-vital__sub">' + M.num(d.process.heapMb) + " MB heap in use</div></article>",
      '<article class="mg-card ix-vital"><div class="ix-vital__label">Uptime</div><div class="ix-vital__value">' + esc(uptime(d.process.uptimeSec)) + '</div><div class="ix-vital__sub">since the server started</div></article>',
      '<article class="mg-card ix-vital ix-tone-' + (d.encryption === "on" ? "ok" : "warn") + '"><div class="ix-vital__label">Keys at rest</div><div class="ix-vital__value">' + (d.encryption === "on" ? "Encrypted" : "Not encrypted") + '</div><div class="ix-vital__sub">' +
        (d.models.withKey ? d.models.sealedKeys + " of your " + d.models.withKey + " API keys sealed" : "you have no saved API keys") + "</div></article>",
      "</section>",
      '<p class="mg-muted">Updated ' + esc(M.ago(d.generatedAt)) + ". Refreshes every 30 seconds while this page is open.</p>",
    ].join("");

    const b = document.getElementById("ixSysRefresh");
    if (b) b.addEventListener("click", function () { load(true); });
  }

  function load(manual) {
    D.api.get("/api/system/status").then(function (d) {
      if (document.getElementById("ixSystem") !== root) return;
      paint(d);
      if (manual) D.toast.show("Status refreshed", "success");
    }).catch(function (err) {
      if (document.getElementById("ixSystem") !== root) return;
      root.innerHTML = M.errorPanel(err && err.message, "ixRetry");
      const b = document.getElementById("ixRetry");
      if (b) b.addEventListener("click", function () { load(); });
    });
  }
  load();
  timer = setInterval(function () {
    if (document.getElementById("ixSystem") !== root) { clearInterval(timer); return; }
    if (!document.hidden) load();
  }, 30000);
};
