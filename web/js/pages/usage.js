window.Darkness = window.Darkness || {};
window.Darkness.pages = window.Darkness.pages || {};

/**
 * Usage: how much the workspace is being used. Everything shown is counted from stored data. Token and cost metering is
 * not recorded anywhere, so the page says so instead of showing made-up numbers.
 */
window.Darkness.pages.usage = function renderUsagePage() {
  var D = window.Darkness, M = D.mg;
  var main = document.getElementById("main");
  if (!main) return;

  var RANGES = [7, 14, 30, 90];
  var days = 14;
  try { var saved = Number(localStorage.getItem("darkness_usage_days")); if (RANGES.indexOf(saved) >= 0) days = saved; } catch (e) {}

  main.innerHTML =
    '<div class="page mg-page"><div class="page__inner" id="mgUsage">' +
    '<header class="mg-head"><div><h1 class="mg-title">Usage</h1><p class="mg-sub">How you use your workspace.</p></div></header>' +
    M.skeleton("stats") + M.skeleton("chart") + "</div></div>";
  var root = document.getElementById("mgUsage");
  var lastData = null;

  function show() {
    M.swr(root, "usage:" + days, function () { return D.api.get("/api/usage", { days: days }); }, paint, function (err) {
      root.innerHTML = M.errorPanel(err && err.message, "mgRetry");
      var b = document.getElementById("mgRetry");
      if (b) b.addEventListener("click", function () { M.forget("usage:"); D.pages.usage(); });
    });
  }

  function paint(u, st) {
    lastData = u;
    root.classList.toggle("is-repaint", !st.firstPaint);
    var t = u.totals, w = u.window, tr = M.trend(w.messages, w.previousMessages);
    var prompts = u.series.reduce(function (a, s) { return a + s.userMessages; }, 0);
    var replies = u.series.reduce(function (a, s) { return a + s.replies; }, 0);
    var active = u.series.filter(function (s) { return s.userMessages + s.replies > 0; }).length;
    var busiest = u.series.reduce(function (best, s) { return s.userMessages + s.replies > best.n ? { n: s.userMessages + s.replies, date: s.date } : best; }, { n: 0, date: "" });
    var modelTotal = u.models.reduce(function (a, m) { return a + m.count; }, 0);

    var stat = function (i, ico, label, value, foot, extra) {
      return '<div class="mg-card mg-stat" style="--i:' + i + '"><span class="mg-stat__ico">' + M.icon(ico, 18) + '</span><span class="mg-stat__label">' + M.esc(label) + '</span><span class="mg-stat__value" data-count="' + value + '">' + M.num(value) + '</span><span class="mg-stat__foot">' + foot + "</span>" + (extra || "") + "</div>";
    };

    root.innerHTML = [
      '<header class="mg-head"><div><h1 class="mg-title">Usage</h1><p class="mg-sub">How you use your workspace, counted from your own history.</p></div>',
      '<div class="mg-actions"><div class="mg-seg" role="radiogroup" aria-label="Time range">' + RANGES.map(function (r) {
        return '<button type="button" role="radio" aria-checked="' + (r === days) + '" class="mg-seg__opt' + (r === days ? " is-active" : "") + '" data-days="' + r + '">' + r + "d</button>";
      }).join("") + '</div><button class="btn btn--outline btn--sm" id="mgCsv" type="button">' + M.icon("download", 15) + " <span>Export CSV</span></button></div></header>",

      '<section class="mg-stats">',
      stat(0, "msg", "Messages · " + u.days + " days", w.messages, '<span class="mg-delta mg-delta--' + tr.cls + '">' + M.esc(tr.text) + '</span><span class="mg-muted">vs previous ' + u.days + " days</span>", '<span class="mg-stat__spark">' + M.sparkline(u.series.map(function (s) { return s.userMessages + s.replies; })) + "</span>"),
      stat(1, "chat", "Your prompts", prompts, '<span class="mg-muted">' + M.num(replies) + " replies received</span>"),
      stat(2, "clock", "Active days", active, '<span class="mg-muted">of ' + u.days + (busiest.n ? " · busiest " + M.esc(new Date(busiest.date + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })) : "") + "</span>"),
      stat(3, "trending", "Average per day", Math.round((w.messages / u.days) * 10) / 10, '<span class="mg-muted">messages, all days counted</span>'),
      "</section>",

      '<article class="mg-card" style="--i:4"><header class="mg-card__head"><div><h2>Messages per day</h2><p>Prompts you sent and replies you received</p></div><div class="mg-legend"><span><i class="mg-dot mg-dot--u"></i>Prompts</span><span><i class="mg-dot mg-dot--r"></i>Replies</span></div></header>' +
        (w.messages ? M.bars(u.series, { height: 240 }) : '<div class="mg-empty">' + M.icon("chart", 28) + "<strong>No activity in this period</strong><p>Pick a longer range, or start a chat.</p></div>") + "</article>",

      '<section class="mg-grid mg-grid--even">',
      '<article class="mg-card" style="--i:5"><header class="mg-card__head"><div><h2>Which models answered</h2><p>Share of replies in this period</p></div></header>' +
        (modelTotal ? '<ul class="mg-meter">' + u.models.map(function (m) {
          var pct = Math.round((m.count / modelTotal) * 100);
          return '<li><div class="mg-meter__top"><span class="mg-meter__name">' + M.esc(m.name) + '</span><span class="mg-meter__num">' + M.num(m.count) + " · " + pct + '%</span></div><div class="mg-meter__bar" role="img" aria-label="' + M.esc(m.name) + " " + pct + ' percent"><i style="width:' + Math.max(2, pct) + '%"></i></div></li>';
        }).join("") + "</ul>" : '<div class="mg-empty">' + M.icon("cpu", 28) + "<strong>No replies yet</strong><p>Once a model answers, its share appears here.</p></div>") + "</article>",

      '<article class="mg-card" style="--i:6"><header class="mg-card__head"><div><h2>Your workspace</h2><p>Everything you have stored, all time</p></div></header><dl class="mg-kv">' +
        kv("Conversations", M.num(t.conversations), "#/history") + kv("Messages", M.num(t.messages), "") + kv("Projects", M.num(t.projects), "#/project") +
        kv("Generated files", M.num(t.artifacts), "#/project") + kv("Library files", M.num(t.files) + (t.fileBytes ? " · " + M.bytes(t.fileBytes) : ""), "#/knowledge") + kv("Connected models", M.num(t.models), "#/model") + "</dl></article>",
      "</section>",

      '<section id="ixModelsHost" aria-label="Models"></section>',

      '<aside class="mg-note" role="note">' + M.icon("alert", 16) + "<p><strong>Token counts are estimates, and cost is only what you enter.</strong> This workspace doesn't record the tokens a provider billed for. The Models section above estimates tokens from text length; your provider's own dashboard has the real billing figures.</p></aside>",
    ].join("");

    if (st.firstPaint) M.runCounts(root);
    M.bindTips(root);
    var modelsHost = document.getElementById("ixModelsHost");
    if (modelsHost && M.modelUsage) M.modelUsage(modelsHost, u.days);
  }

  function kv(label, value, href) {
    return "<div><dt>" + M.esc(label) + "</dt><dd>" + (href ? '<a href="' + href + '">' + value + "</a>" : value) + "</dd></div>";
  }

  // One delegated handler for the page (survives the repaint that replaces the markup).
  root.addEventListener("click", function (e) {
    var seg = e.target.closest && e.target.closest("[data-days]");
    if (seg) {
      var next = Number(seg.getAttribute("data-days"));
      if (next === days) return;
      days = next;
      try { localStorage.setItem("darkness_usage_days", String(days)); } catch (err) {}
      root.querySelectorAll("[data-days]").forEach(function (b) { var on = Number(b.getAttribute("data-days")) === days; b.classList.toggle("is-active", on); b.setAttribute("aria-checked", String(on)); });
      var card = root.querySelector(".mg-bars");
      if (card) card.classList.add("is-loading");
      show();
      return;
    }
    if (e.target.closest && e.target.closest("#mgCsv") && lastData) {
      var rows = [["date", "prompts", "replies", "total"]].concat(lastData.series.map(function (s) { return [s.date, s.userMessages, s.replies, s.userMessages + s.replies]; }));
      M.download("darkness-usage-" + lastData.days + "d.csv", M.csv(rows));
      D.toast.show("Usage exported", "success");
    }
  });

  show();
};
