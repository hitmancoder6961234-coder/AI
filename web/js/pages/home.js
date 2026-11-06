window.Darkness = window.Darkness || {};
window.Darkness.pages = window.Darkness.pages || {};

/**
 * Overview: where you are, what you did recently, and the next useful thing to do.
 * Paints instantly (skeleton or cached data) and fills in as data arrives; nothing blocks on the slowest request.
 */
window.Darkness.pages.home = function renderOverviewPage() {
  const D = window.Darkness, M = D.mg;
  const main = document.getElementById("main");
  if (!main) return;

  main.innerHTML =
    '<div class="page mg-page"><div class="page__inner" id="mgOverview">' +
    '<header class="mg-head"><div><h1 class="mg-title">Overview</h1><p class="mg-sub">Your workspace at a glance.</p></div></header>' +
    M.skeleton("stats") + '<div class="mg-grid">' + M.skeleton("chart") + M.skeleton("list") + "</div></div></div>";
  const root = document.getElementById("mgOverview");

  const fetchAll = function () {
    return Promise.all([
      D.api.get("/api/usage", { days: 14 }),
      D.api.get("/api/account").catch(function () { return null; }),
    ]).then(function (r) { return { usage: r[0], account: r[1] }; });
  };

  const tiles = [
    { key: "conversations", label: "Conversations", icon: "chat", href: "#/history" },
    { key: "window", label: "Messages · 14 days", icon: "msg", href: "#/usage" },
    { key: "projects", label: "Projects", icon: "folder", href: "#/project" },
    { key: "files", label: "Library files", icon: "file", href: "#/knowledge" },
  ];

  function pill(tone, ico, text, href, action) {
    return '<a class="mg-pill mg-pill--' + tone + '" href="' + href + '"><span class="mg-pill__ico">' + M.icon(ico, 15) + '</span><span class="mg-pill__text">' + text + '</span><span class="mg-pill__act">' + M.esc(action) + "</span></a>";
  }
  function hint(key, t) {
    if (key === "conversations") return "across chat and Copilot";
    if (key === "projects") return t.artifacts ? M.num(t.artifacts) + " generated files" : "none generated yet";
    return t.fileBytes ? M.bytes(t.fileBytes) + " stored" : "nothing uploaded yet";
  }
  function recentList(items, emptyTitle, emptyText) {
    if (!items.length) return empty("chat", emptyTitle, emptyText, "");
    return '<ul class="mg-list">' + items.map(function (c) {
      return '<li><a class="mg-row" href="#/chat/' + M.esc(c.id) + '"><span class="mg-row__ico">' + M.icon("chat", 16) + '</span><span class="mg-row__main"><span class="mg-row__title">' + M.esc(c.title || "New conversation") + '</span><span class="mg-row__sub">' + M.esc(M.ago(c.at)) + '</span></span><span class="mg-row__go">' + M.icon("arrow", 14) + "</span></a></li>";
    }).join("") + "</ul>";
  }
  function empty(ico, title, text, action) {
    return '<div class="mg-empty">' + M.icon(ico, 28) + "<strong>" + title + "</strong><p>" + text + "</p>" + action + "</div>";
  }

  function paint(data, st) {
    // A second paint (fresh data replacing cached data) must not replay entrance animations or count-ups.
    root.classList.toggle("is-repaint", !st.firstPaint);
    const u = data.usage, a = data.account, t = u.totals;
    const userName = (a && a.user && a.user.name) || "";
    const first = userName.trim().split(/\s+/)[0] || "there";
    const active = D.modelSelector && D.modelSelector.getActive && D.modelSelector.getActive();
    const tr = M.trend(u.window.messages, u.window.previousMessages);
    const daily = u.series.map(function (s) { return s.userMessages + s.replies; });
    const values = { conversations: t.conversations, window: u.window.messages, projects: t.projects, files: t.files };

    root.innerHTML = [
      '<header class="mg-head"><div><h1 class="mg-title">' + M.esc(M.greeting()) + ", " + M.esc(first) + '</h1><p class="mg-sub">Here\'s what\'s happening in your workspace.</p></div>',
      '<div class="mg-actions"><a class="btn btn--outline btn--sm" href="#/knowledge">' + M.icon("file", 15) + ' <span>Upload</span></a><a class="btn btn--primary btn--sm" href="#/chat">' + M.icon("plus", 15) + " <span>New chat</span></a></div></header>",

      askCard(first),

      '<section class="mg-status" aria-label="Status">',
      pill(active ? "ok" : "warn", "cpu", active ? "Model: " + M.esc(active.name) : "No model selected", "#/model", active ? "Change" : "Choose one"),
      pill(a && a.privacyStrict ? "ok" : "info", "shield", a ? (a.privacyStrict ? "Strict privacy is on" : "Standard privacy mode") : "Privacy status unavailable", "#/account", "Review"),
      pill("info", "chart", t.messages ? M.num(t.messages) + " messages all-time" : "No messages yet", "#/usage", "Usage"),
      "</section>",

      '<section class="mg-stats">',
      tiles.map(function (x, i) {
        const isWin = x.key === "window";
        return '<a class="mg-card mg-stat mg-lift" href="' + x.href + '" style="--i:' + i + '"><span class="mg-stat__ico">' + M.icon(x.icon, 18) + '</span><span class="mg-stat__label">' + M.esc(x.label) + '</span><span class="mg-stat__value" data-count="' + values[x.key] + '">' + M.num(values[x.key]) + "</span>" +
          '<span class="mg-stat__foot">' + (isWin ? '<span class="mg-delta mg-delta--' + tr.cls + '">' + M.esc(tr.text) + '</span><span class="mg-muted">vs previous 14 days</span>' : '<span class="mg-muted">' + hint(x.key, t) + "</span>") + "</span>" +
          (isWin ? '<span class="mg-stat__spark">' + M.sparkline(daily) + "</span>" : "") + "</a>";
      }).join(""),
      "</section>",

      '<section class="mg-grid">',
      '<article class="mg-card" style="--i:4"><header class="mg-card__head"><div><h2>Activity</h2><p>Prompts and replies per day, last 14 days</p></div><div class="mg-legend"><span><i class="mg-dot mg-dot--u"></i>Prompts</span><span><i class="mg-dot mg-dot--r"></i>Replies</span></div></header>' +
        (u.window.messages ? M.bars(u.series, { height: 270 }) : empty("chart", "Nothing yet", "Start a chat and your activity shows up here.", '<a class="btn btn--primary btn--sm" href="#/chat">Start a chat</a>')) + "</article>",
      '<article class="mg-card" style="--i:5"><header class="mg-card__head"><div><h2>Jump back in</h2><p>Your conversations</p></div><div class="mg-actions"><div class="ix-tabs" role="tablist" aria-label="Which conversations"><button type="button" class="ix-tab" role="tab" id="ixTabRecent" aria-selected="true" aria-controls="ixRecentPanel" data-recent="recent">Recent</button><button type="button" class="ix-tab" role="tab" id="ixTabPinned" aria-selected="false" aria-controls="ixRecentPanel" tabindex="-1" data-recent="pinned">Pinned</button></div><a class="mg-link" href="#/history">All</a></div></header>' +
        '<div id="ixRecentPanel" role="tabpanel" aria-labelledby="ixTabRecent">' + recentList(u.recent.map(function (c) { return { id: c.id, title: c.title, at: c.updated_at }; }), "No conversations yet", "Ask anything to begin.") + "</div></article>",
      "</section>",

      '<section aria-label="Start something"><div class="mg-section"><h2>Start something</h2><p>Pick a workspace to create in.</p></div><div class="mg-tiles">',
      [
        ["sparkles", "Project Studio", "Brief, outline and generate a full project with a report and slides.", "#/builder"],
        ["file", "Word Studio", "Draft and export professional reports and manuals.", "#/document-studio"],
        ["monitor", "Slide Studio", "Design a deck and export it to PowerPoint.", "#/presentation-studio"],
        ["bot", "Agent", "Give it a goal; it plans and works with tools.", "/agent.html"],
      ].map(function (c, i) {
        return '<a class="mg-card mg-tile mg-lift" href="' + c[3] + '" style="--i:' + (6 + i) + '"><span class="mg-tile__ico">' + M.icon(c[0], 20) + "</span><strong>" + c[1] + "</strong><span>" + c[2] + "</span></a>";
      }).join(""),
      "</div></section>",
    ].join("");

    if (st.firstPaint) M.runCounts(root);
    M.bindTips(root);
    bindAsk();
    bindRecentTabs(u);
  }

  function bindRecentTabs(u) {
    const panel = document.getElementById("ixRecentPanel"), tabs = Array.prototype.slice.call(root.querySelectorAll("[data-recent]"));
    if (!panel || !tabs.length) return;
    let pinned = null;
    function select(which, focus) {
      tabs.forEach(function (t) { const on = t.getAttribute("data-recent") === which; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
      panel.setAttribute("aria-labelledby", which === "pinned" ? "ixTabPinned" : "ixTabRecent");
      if (which === "recent") { panel.innerHTML = recentList(u.recent.map(function (c) { return { id: c.id, title: c.title, at: c.updated_at }; }), "No conversations yet", "Ask anything to begin."); return; }
      const show = function () { panel.innerHTML = recentList(pinned, "Nothing pinned", "Pin a conversation from History to keep it here."); };
      if (pinned) return show();
      panel.innerHTML = '<p class="mg-muted" role="status">Loading…</p>';
      D.api.get("/api/conversations/search", { pinned: "true", limit: 8 }).then(function (r) {
        pinned = (r.results || []).map(function (c) { return { id: c.id, title: c.title, at: c.updatedAt }; });
        if (panel.isConnected) show();
      }).catch(function () { if (panel.isConnected) panel.innerHTML = '<p class="mg-muted" role="alert">Could not load pinned conversations.</p>'; });
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { select(t.getAttribute("data-recent")); });
      t.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault(); select(tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length].getAttribute("data-recent"), true);
      });
    });
  }

  // ---- "Ask" card: focus chips + a question box that opens a fresh chat and sends it ---------------------------------------------
  const FOCUS = [
    ["Summarize reports", "Summarize the key points of the following, in a short list: "],
    ["Extract key insights", "Extract the key insights, risks and next steps from: "],
    ["Compare projects", "Compare these options and recommend one, with reasons: "],
    ["Answer questions", ""],
    ["Draft documents", "Draft a clear, well-structured document about: "],
  ];
  function askCard(first) {
    return '<section class="mg-card ix-ask" style="--i:0" aria-labelledby="ixAskTitle"><div><h2 id="ixAskTitle">What would you like to explore, ' + M.esc(first) + '?</h2><p>Choose a focus, or just ask. This opens a new chat and sends your question.</p></div>' +
      '<div class="ix-chips" role="group" aria-label="Choose your focus">' + FOCUS.map(function (f, i) { return '<button type="button" class="ix-chip" data-focus="' + i + '" aria-pressed="false">' + M.esc(f[0]) + "</button>"; }).join("") + "</div>" +
      '<div class="ix-askbox"><label for="ixAskInput" class="sr-only">Ask something</label><textarea id="ixAskInput" rows="2" maxlength="8000" placeholder="Ask anything about your work…"></textarea>' +
      '<button type="button" class="btn btn--primary" id="ixAskSend" disabled>' + M.icon("arrow", 15) + " <span>Ask</span></button></div></section>";
  }
  function bindAsk() {
    const input = document.getElementById("ixAskInput"), send = document.getElementById("ixAskSend");
    if (!input || !send) return;
    const sync = function () { send.disabled = !input.value.trim(); };
    input.addEventListener("input", sync);
    root.querySelectorAll("[data-focus]").forEach(function (b) {
      b.addEventListener("click", function () {
        const i = Number(b.getAttribute("data-focus"));
        root.querySelectorAll("[data-focus]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        if (!input.value.trim() || FOCUS.some(function (f) { return f[1] && input.value === f[1]; })) input.value = FOCUS[i][1];
        input.focus(); input.setSelectionRange(input.value.length, input.value.length); sync();
      });
    });
    const go = function () {
      const text = input.value.trim();
      if (!text) return;
      try { sessionStorage.setItem("darkness_pending_prompt", text.slice(0, 8000)); } catch (e) { D.toast.show("Could not start the chat from here: open Chat and paste your question.", "danger"); return; }
      try { D.store.remove("active_conversation"); } catch (e) {}
      window.location.hash = "#/chat";
    };
    send.addEventListener("click", go);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); go(); } });
  }

  M.swr(root, "overview", fetchAll, paint, function (err) {
    root.innerHTML = M.errorPanel(err && err.message, "mgRetry");
    const b = document.getElementById("mgRetry");
    if (b) b.addEventListener("click", function () { M.forget("overview"); D.pages.home(); });
  });
};
