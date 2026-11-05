window.Darkness = window.Darkness || {};
window.Darkness.pages = window.Darkness.pages || {};

const MODEL_PROVIDERS = (window.Darkness && window.Darkness.providers && window.Darkness.providers.PROVIDERS) || [
  { id: "gemini", label: "Google Gemini", defaultBase: "https://generativelanguage.googleapis.com/v1beta/openai/", needsKey: true, modelIdPlaceholder: "gemini-3.8-flash", keyPlaceholder: "AIzaSy..." },
  { id: "openai", label: "OpenAI", defaultBase: "https://api.openai.com/v1", needsKey: true, modelIdPlaceholder: "gpt-4o", keyPlaceholder: "sk-proj-..." },
  { id: "openrouter", label: "OpenRouter", defaultBase: "https://openrouter.ai/api/v1", needsKey: true, modelIdPlaceholder: "meta-llama/llama-3.3-70b-instruct", keyPlaceholder: "sk-or-v1-..." },
  { id: "anthropic", label: "Anthropic", defaultBase: "https://api.anthropic.com/v1", needsKey: true, modelIdPlaceholder: "claude-3-5-sonnet-20241022", keyPlaceholder: "sk-ant-..." },
  { id: "groq", label: "Groq", defaultBase: "https://api.groq.com/openai/v1", needsKey: true, modelIdPlaceholder: "llama-3.3-70b-versatile", keyPlaceholder: "gsk_..." },
  { id: "mistral", label: "Mistral AI", defaultBase: "https://api.mistral.ai/v1", needsKey: true, modelIdPlaceholder: "mistral-large-latest", keyPlaceholder: "your-mistral-api-key" },
  { id: "together", label: "Together AI", defaultBase: "https://api.together.xyz/v1", needsKey: true, modelIdPlaceholder: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", keyPlaceholder: "your-together-api-key" },
  { id: "z.ai", label: "Z.ai (GLM)", defaultBase: "https://api.z.ai/api/paas/v4", needsKey: true, modelIdPlaceholder: "glm-4-plus", keyPlaceholder: "your-z-ai-api-key" },
  { id: "ollama", label: "Ollama (local)", defaultBase: "http://localhost:11434/v1", needsKey: false, modelIdPlaceholder: "llama3.2", keyPlaceholder: "(No API key required for local Ollama)" },
  { id: "azure", label: "Azure OpenAI", defaultBase: "", needsKey: true, modelIdPlaceholder: "your-deployment-name", keyPlaceholder: "your-azure-api-key" },
  { id: "custom", label: "Custom / Other (OpenAI-compatible)", defaultBase: "", needsKey: true, modelIdPlaceholder: "custom-model-id", keyPlaceholder: "sk-..." },
];

function escapeAttr(s) { return String(s ?? "").replace(/"/g, "&quot;"); }

// -------------------------------------------------------------------------------------------------------------------
// Models page (management view).
//
// The list, filters and quick actions work in place: choosing a model, enabling/disabling, testing and deleting update
// the page immediately (and roll back with a message if the server says no), so nothing re-navigates or flashes. The
// add / edit dialogs further down are unchanged. Data comes from /api/models, plus /api/usage for "replies in 30 days".
// -------------------------------------------------------------------------------------------------------------------

let V = null; // the live page, so the dialogs below can ask it to refresh

function modelsFetcher() {
  const api = window.Darkness.api;
  return Promise.all([api.get("/api/models"), api.get("/api/usage", { days: 30 }).catch(() => null)]).then((r) => {
    const raw = r[0];
    return { models: Array.isArray(raw) ? raw : (raw && raw.models) || [], active: (raw && raw.active) || "", usage: r[1] };
  });
}
window.Darkness.pages.modelData = modelsFetcher;

function hueOf(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

function providerLabel(m) {
  const p = getProviderConfig(m.provider);
  return (p && p.label) || m.provider || "Custom";
}

function ctxLabel(n) {
  n = Number(n);
  if (!n) return "Unknown";
  if (n >= 1000000) return (n % 1000000 === 0 ? n / 1000000 : (n / 1000000).toFixed(1)) + "M tokens";
  if (n >= 1000) return Math.round(n / 1000) + "k tokens";
  return n + " tokens";
}

/** One place that decides what a model's status looks like, from the server status or a test run on this page. */
function stateOf(m, st) {
  if (m.enabled === false) return { key: "disabled", label: "Disabled", cls: "muted" };
  const t = st.tests[m.id];
  if (t) return t.ok ? { key: "ready", label: "Ready", cls: "ok" } : { key: "attention", label: "Test failed", cls: "bad" };
  switch (m.status) {
    // New models are stored as "available" by default, which proves nothing; only trust it once a test has really run.
    case "available": return m.lastTestedAt ? { key: "ready", label: "Ready", cls: "ok" } : { key: "untested", label: "Not tested", cls: "muted" };
    case "rate_limit": return { key: "attention", label: "Rate limited", cls: "warn" };
    case "auth_error": return { key: "attention", label: "Key rejected", cls: "bad" };
    case "unavailable": return { key: "attention", label: "Unreachable", cls: "bad" };
    case "config_error": return { key: "attention", label: "Config error", cls: "bad" };
    default: return { key: "untested", label: "Not tested", cls: "muted" };
  }
}

function repliesOf(m, st) {
  return st.replies.byId[m.id] ?? st.replies.byId[m.modelName] ?? st.replies.byName[String(m.name || "").toLowerCase()] ?? 0;
}

function buildReplies(usage) {
  const byId = {};
  const byName = {};
  ((usage && usage.models) || []).forEach((u) => {
    byId[u.id] = u.count;
    if (u.name) byName[String(u.name).toLowerCase()] = u.count;
  });
  return { byId, byName, known: !!usage };
}

function sortedModels(st) {
  return st.data.models.slice().sort((a, b) => {
    if (a.id === st.data.active) return -1;
    if (b.id === st.data.active) return 1;
    if ((a.enabled === false) !== (b.enabled === false)) return a.enabled === false ? 1 : -1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function capChips(m) {
  const c = m.capabilities || {};
  const items = [["text", "Text"], ["vision", "Vision"], ["codeGeneration", "Code"], ["imageGeneration", "Image"], ["fileAnalysis", "Files"], ["streaming", "Streaming"]];
  const on = items.filter((i) => c[i[0]]);
  return on.length ? on.map((i) => '<span class="mg-cap">' + i[1] + "</span>").join("") : '<span class="mg-cap mg-cap--none">No capabilities set</span>';
}

function testedLabel(m, st) {
  const t = st.tests[m.id];
  const M = window.Darkness.mg;
  if (t) return t.ok ? "Passed · " + (t.ms < 1000 ? t.ms + " ms" : (t.ms / 1000).toFixed(1) + " s") : "Failed just now";
  return m.lastTestedAt ? M.ago(m.lastTestedAt) : "Never";
}

function shortError(msg) {
  const s = String(msg || "").replace(/\s+/g, " ").trim();
  return s.length > 150 ? s.slice(0, 147) + "…" : s;
}

function modelCard(m, st, i) {
  const M = window.Darkness.mg;
  const e = M.esc;
  const s = stateOf(m, st);
  const active = m.id === st.data.active;
  const enabled = m.enabled !== false;
  const n = repliesOf(m, st);
  const pct = st.maxReplies ? Math.max(n ? 4 : 0, Math.round((n / st.maxReplies) * 100)) : 0;
  const prov = providerLabel(m);
  const t = st.tests[m.id];
  const err = t && !t.ok ? t.msg : s.key === "attention" && m.lastError ? m.lastError : "";
  const name = e(m.name || m.id);
  return (
    '<article class="mg-card mg-model' + (active ? " is-active" : "") + (enabled ? "" : " is-off") + '" style="--i:' + Math.min(i, 10) + ";--h:" + hueOf(m.provider) + '" data-id="' + e(m.id) + '">' +
    '<header class="mg-model__top">' +
      '<span class="mg-model__av" aria-hidden="true">' + e(String(prov).charAt(0).toUpperCase()) + "</span>" +
      '<div class="mg-model__id"><h3 title="' + name + '">' + name + "</h3><p>" + e(prov) + " · <code>" + e(m.modelName || m.id) + "</code></p></div>" +
      '<span class="mg-chip mg-chip--' + s.cls + '"><i></i>' + e(s.label) + "</span>" +
    "</header>" +
    '<div class="mg-model__caps">' + capChips(m) + "</div>" +
    '<dl class="mg-model__facts">' +
      "<div><dt>Context</dt><dd>" + e(ctxLabel(m.contextWindow)) + "</dd></div>" +
      "<div><dt>Replies · 30 days</dt><dd>" + (st.replies.known ? M.num(n) : "-") + "</dd></div>" +
      "<div><dt>Last test</dt><dd>" + e(testedLabel(m, st)) + "</dd></div>" +
    "</dl>" +
    (st.replies.known ? '<div class="mg-model__bar" role="img" aria-label="' + name + " share of replies" + '"><i style="width:' + pct + '%"></i></div>' : "") +
    (err ? '<p class="mg-model__err" role="status">' + M.icon("alert", 14) + "<span>" + e(shortError(err)) + "</span></p>" : "") +
    '<footer class="mg-model__foot">' +
      '<button class="btn btn--' + (active ? "primary" : "outline") + ' btn--sm" type="button" data-act="use"' + (enabled ? "" : " disabled") + (active ? ' aria-pressed="true"' : ' aria-pressed="false"') + ">" + (active ? "Active" : "Use this model") + "</button>" +
      '<button class="btn btn--ghost btn--sm" type="button" data-act="test"' + (enabled ? "" : " disabled") + ">Test</button>" +
      '<button class="mg-switch" type="button" role="switch" data-act="toggle" aria-checked="' + enabled + '" aria-label="' + (enabled ? "Disable " : "Enable ") + name + '" title="' + (enabled ? "Enabled" : "Disabled") + '"><i></i></button>' +
      '<span class="mg-model__sp"></span>' +
      '<button class="mg-iconbtn" type="button" data-act="edit" aria-label="Edit ' + name + '" title="Edit">' + M.icon("edit", 16) + "</button>" +
      '<button class="mg-iconbtn mg-iconbtn--danger" type="button" data-act="del" aria-label="Delete ' + name + '" title="Delete">' + M.icon("trash", 16) + "</button>" +
    "</footer>" +
    "</article>"
  );
}

function modelStats(st) {
  const M = window.Darkness.mg;
  const list = st.data.models;
  const count = (key) => list.filter((m) => stateOf(m, st).key === key).length;
  const ready = count("ready");
  const attention = count("attention");
  const enabled = list.filter((m) => m.enabled !== false).length;
  const replies = list.reduce((a, m) => a + repliesOf(m, st), 0);
  const tile = (i, ico, label, value, foot) =>
    '<div class="mg-card mg-stat" style="--i:' + i + '"><span class="mg-stat__ico">' + M.icon(ico, 18) + '</span><span class="mg-stat__label">' + label + '</span><span class="mg-stat__value" data-count="' + value + '">' + M.num(value) + '</span><span class="mg-stat__foot"><span class="mg-muted">' + foot + "</span></span></div>";
  return (
    tile(0, "cpu", "Models", list.length, enabled + " enabled") +
    tile(1, "check", "Ready", ready, ready ? "passed a check" : "run a test to confirm") +
    tile(2, "alert", "Need attention", attention, attention ? "check key or endpoint" : "nothing failing") +
    tile(3, "chat", "Replies · 30 days", replies, st.replies.known ? "across all models" : "usage unavailable")
  );
}

function modelHero(st) {
  const M = window.Darkness.mg;
  const e = M.esc;
  const list = st.data.models;
  if (!list.length) return "";
  const m = list.find((x) => x.id === st.data.active);
  if (!m) {
    return '<article class="mg-card mg-hero mg-hero--none" style="--i:4">' + M.icon("sparkles", 20) + '<div><strong>No model is selected</strong><p>Pick one below with "Use this model" and chats will be answered by it.</p></div></article>';
  }
  const s = stateOf(m, st);
  const n = repliesOf(m, st);
  return (
    '<article class="mg-card mg-hero" style="--i:4;--h:' + hueOf(m.provider) + '" data-id="' + e(m.id) + '">' +
    '<span class="mg-model__av mg-model__av--lg" aria-hidden="true">' + e(String(providerLabel(m)).charAt(0).toUpperCase()) + "</span>" +
    '<div class="mg-hero__main"><span class="mg-hero__kicker">Answering your chats now</span><h2>' + e(m.name || m.id) + "</h2>" +
    "<p>" + e(providerLabel(m)) + " · <code>" + e(m.modelName || m.id) + "</code> · " + e(ctxLabel(m.contextWindow)) + (st.replies.known ? " · " + M.num(n) + " repl" + (n === 1 ? "y" : "ies") + " in 30 days" : "") + "</p></div>" +
    '<span class="mg-chip mg-chip--' + s.cls + '"><i></i>' + e(s.label) + "</span>" +
    '<div class="mg-hero__acts"><button class="btn btn--outline btn--sm" type="button" data-act="test">Test</button><button class="btn btn--ghost btn--sm" type="button" data-act="edit">Edit</button></div>' +
    "</article>"
  );
}

function filteredModels(st) {
  const q = st.q.trim().toLowerCase();
  return sortedModels(st).filter((m) => {
    if (st.status !== "all" && stateOf(m, st).key !== st.status) return false;
    if (st.provider !== "all" && (m.provider || "custom") !== st.provider) return false;
    if (!q) return true;
    return [m.name, m.id, m.modelName, m.provider, providerLabel(m)].some((v) => String(v || "").toLowerCase().includes(q));
  });
}

function drawGrid(st) {
  const M = window.Darkness.mg;
  const grid = st.root.querySelector("#mgmGrid");
  if (!grid) return;
  if (!st.data.models.length) {
    grid.innerHTML = '<div class="mg-card mg-empty mg-empty--wide">' + M.icon("cpu", 30) + "<strong>No models connected yet</strong><p>Add a provider and the models you want to chat with. One API key can power several models.</p>" +
      '<button class="btn btn--primary" type="button" data-act="add">' + M.icon("plus", 15) + " <span>Add models</span></button></div>";
    return;
  }
  const rows = filteredModels(st);
  if (!rows.length) {
    grid.innerHTML = '<div class="mg-card mg-empty mg-empty--wide">' + M.icon("search", 30) + "<strong>No models match</strong><p>Try a different search or filter.</p>" +
      '<button class="btn btn--outline btn--sm" type="button" data-act="clear">Clear filters</button></div>';
    return;
  }
  const htmls = rows.map((m, i) => modelCard(m, st, i));
  const cards = Array.from(grid.children);
  const sameShape = cards.length === rows.length && cards.every((c, i) => c.classList.contains("mg-model") && c.getAttribute("data-id") === rows[i].id);

  // Remember keyboard focus so a redraw never drops it.
  const ae = document.activeElement;
  const fc = ae && grid.contains(ae) ? ae.closest("[data-id]") : null;
  const refocus = fc && ae.getAttribute("data-act") ? [fc.getAttribute("data-id"), ae.getAttribute("data-act")] : null;

  if (sameShape) {
    // Same cards in the same order: swap only the ones whose content changed, so untouched cards keep hover, focus and clicks.
    cards.forEach((c, i) => {
      if (c.__h === htmls[i]) return;
      const tpl = document.createElement("template");
      tpl.innerHTML = htmls[i];
      const n = tpl.content.firstElementChild;
      n.__h = htmls[i];
      c.replaceWith(n);
    });
  } else {
    grid.innerHTML = htmls.join("");
    Array.from(grid.children).forEach((c, i) => { c.__h = htmls[i]; });
  }

  if (refocus) {
    const sel = '[data-id="' + (window.CSS && CSS.escape ? CSS.escape(refocus[0]) : refocus[0]) + '"] [data-act="' + refocus[1] + '"]';
    const t = grid.querySelector(sel);
    if (t && !t.disabled && document.activeElement !== t) t.focus({ preventScroll: true });
  }
}

function drawToolbar(st) {
  const counts = { all: st.data.models.length, ready: 0, attention: 0, disabled: 0 };
  st.data.models.forEach((m) => { const k = stateOf(m, st).key; if (counts[k] != null) counts[k]++; });
  st.root.querySelectorAll("[data-status]").forEach((b) => {
    const k = b.getAttribute("data-status");
    const on = k === st.status;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-checked", String(on));
    const c = b.querySelector("b");
    if (c) c.textContent = counts[k];
  });
  const sel = st.root.querySelector("#mgmProv");
  if (sel) {
    const provs = Array.from(new Set(st.data.models.map((m) => m.provider || "custom"))).sort();
    if (st.provider !== "all" && provs.indexOf(st.provider) < 0) st.provider = "all";
    const sig = provs.join("|");
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig;
      sel.innerHTML = '<option value="all">All providers</option>' + provs.map((p) => '<option value="' + escapeAttr(p) + '">' + window.Darkness.mg.esc(providerLabel({ provider: p })) + "</option>").join("");
    }
    sel.value = st.provider;
    sel.hidden = provs.length < 2;
  }
}

/** Redraw the pieces that depend on the data. The toolbar (and the search box inside it) is never replaced. */
function drawAll(st) {
  st.maxReplies = st.data.models.reduce((a, m) => Math.max(a, repliesOf(m, st)), 0);
  const stats = st.root.querySelector("#mgmStats");
  const hero = st.root.querySelector("#mgmHero");
  const M = window.Darkness.mg;
  // Only touch the DOM when the markup actually changed (keeps hover/focus and any click in progress).
  if (stats) {
    const h = modelStats(st);
    if (stats.__h !== h) { stats.__h = h; stats.innerHTML = h; if (!st.drawn) M.runCounts(stats); }
  }
  if (hero) {
    const h = modelHero(st);
    if (hero.__h !== h) { hero.__h = h; hero.innerHTML = h; }
  }
  drawToolbar(st);
  drawGrid(st);
}

function syncSelector(st) {
  const sel = window.Darkness.modelSelector;
  if (!sel) return;
  sel._models = st.data.models;
  if (st.data.active) sel._active = st.data.active;
}

function modelsShell(loading) {
  const M = window.Darkness.mg;
  return (
    '<header class="mg-head"><div><h1 class="mg-title">Models</h1><p class="mg-sub">Connect providers, choose which model answers, and check that each one works.</p></div>' +
    '<div class="mg-actions"><button class="btn btn--outline btn--sm" id="mgmRefresh" type="button" data-act="refresh">' + M.icon("refresh", 15) + " <span>Refresh</span></button>" +
    '<button class="btn btn--primary btn--sm" type="button" data-act="add">' + M.icon("plus", 15) + " <span>Add models</span></button></div></header>" +
    '<section class="mg-stats" id="mgmStats">' + (loading ? M.skeleton("stats").replace('<div class="mg-stats">', "").replace(/<\/div>$/, "") : "") + "</section>" +
    '<div id="mgmHero"></div>' +
    '<div class="mg-toolbar" role="search">' +
      '<label class="mg-search">' + M.icon("search", 16) + '<input id="mgmQ" type="search" placeholder="Search models, providers or IDs" aria-label="Search models" autocomplete="off" spellcheck="false"></label>' +
      '<div class="mg-seg" role="radiogroup" aria-label="Filter by status">' +
        [["all", "All"], ["ready", "Ready"], ["attention", "Attention"], ["disabled", "Disabled"]].map((p) => '<button type="button" role="radio" class="mg-seg__opt" data-status="' + p[0] + '" aria-checked="false">' + p[1] + " <b>0</b></button>").join("") +
      "</div>" +
      '<select class="mg-select" id="mgmProv" aria-label="Filter by provider" hidden></select>' +
    "</div>" +
    '<section class="mg-models" id="mgmGrid" aria-live="polite">' + (loading ? M.skeleton("card") + M.skeleton("card") + M.skeleton("card") : "") + "</section>"
  );
}

window.Darkness.pages.model = function renderModelPage() {
  const D = window.Darkness;
  const M = D.mg;
  const main = document.getElementById("main");
  if (!main) return;

  main.innerHTML = '<div class="page mg-page"><div class="page__inner" id="mgModels">' + modelsShell(true) + "</div></div>";
  const root = document.getElementById("mgModels");
  const st = { root, data: null, replies: { byId: {}, byName: {}, known: false }, maxReplies: 0, q: "", status: "all", provider: "all", tests: {}, drawn: false };
  V = st;

  function paint(data, s) {
    st.data = data;
    st.replies = buildReplies(data.usage);
    syncSelector(st);
    root.classList.toggle("is-repaint", st.drawn);
    drawAll(st);
    st.drawn = true;
  }

  function fail(err) {
    root.innerHTML = M.errorPanel(err && err.message, "mgmRetry");
    const b = document.getElementById("mgmRetry");
    if (b) b.addEventListener("click", () => { M.forget("models"); D.pages.model(); });
  }

  M.swr(root, "models", modelsFetcher, paint, fail, { freshFor: 0 });

  root.addEventListener("click", (ev) => onModelsClick(st, ev));
  root.addEventListener("input", (ev) => {
    if (ev.target && ev.target.id === "mgmQ") { st.q = ev.target.value; drawGrid(st); }
  });
  root.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && ev.target && ev.target.id === "mgmQ" && st.q) { ev.target.value = ""; st.q = ""; drawGrid(st); }
  });
  root.addEventListener("change", (ev) => {
    if (ev.target && ev.target.id === "mgmProv") { st.provider = ev.target.value; drawToolbar(st); drawGrid(st); }
  });
};

/** Pull fresh data into the open page (used after the add/edit dialogs and when Refresh is pressed). */
window.Darkness.pages.modelRefresh = function modelRefresh() {
  const st = V;
  const M = window.Darkness.mg;
  if (!st || !st.root.isConnected) return Promise.resolve();
  M.forget("models");
  return M.load("models", modelsFetcher).then(
    (data) => {
      if (!st.root.isConnected) return;
      st.data = data;
      st.replies = buildReplies(data.usage);
      syncSelector(st);
      st.root.classList.add("is-repaint");
      drawAll(st);
    },
    () => window.Darkness.toast.show("Couldn't refresh the list", "danger")
  );
};

function modelById(st, id) {
  return st.data.models.find((m) => m.id === id) || null;
}

function onModelsClick(st, ev) {
  const D = window.Darkness;
  const btn = ev.target.closest && ev.target.closest("[data-act],[data-status]");
  if (!btn || !st.root.contains(btn)) return;

  if (btn.hasAttribute("data-status")) {
    st.status = btn.getAttribute("data-status");
    drawToolbar(st);
    drawGrid(st);
    return;
  }
  const act = btn.getAttribute("data-act");
  const holder = btn.closest("[data-id]");
  const m = holder ? modelById(st, holder.getAttribute("data-id")) : null;

  if (act === "add") return openAddModelsModal();
  if (act === "refresh") {
    btn.classList.add("is-busy");
    return D.pages.modelRefresh().finally(() => btn.classList.remove("is-busy"));
  }
  if (act === "clear") {
    st.q = ""; st.status = "all"; st.provider = "all";
    const q = st.root.querySelector("#mgmQ");
    if (q) q.value = "";
    drawToolbar(st);
    drawGrid(st);
    return;
  }
  if (!m) return;
  if (act === "use") return useModel(st, m);
  if (act === "test") return testModel(st, m, btn);
  if (act === "toggle") return toggleModel(st, m);
  if (act === "edit") return openModelModal(m);
  if (act === "del") return confirmDelete(st, m);
}

/** Switch the active model: the page updates at once and rolls back if the server refuses. */
async function useModel(st, m) {
  const D = window.Darkness;
  if (m.enabled === false || st.data.active === m.id) return;
  const before = st.data.active;
  st.data.active = m.id;
  drawAll(st);
  syncSelector(st);
  const ok = D.modelSelector ? await D.modelSelector.select(m.id) : false;
  if (!ok) {
    st.data.active = before;
    if (D.modelSelector) D.modelSelector._active = before;
    if (st.root.isConnected) drawAll(st);
  }
}

async function toggleModel(st, m) {
  const D = window.Darkness;
  const next = m.enabled === false;
  m.enabled = next;
  drawAll(st);
  try {
    await D.api.post("/api/models/" + encodeURIComponent(m.id) + "/enable", { enabled: next });
    D.toast.show((m.name || m.id) + (next ? " enabled" : " disabled"), "success");
    if (D.modelSelector) D.modelSelector.load();
  } catch (err) {
    m.enabled = !next;
    if (st.root.isConnected) drawAll(st);
    D.toast.show("Update failed: " + (err.message || ""), "danger");
  }
}

async function testModel(st, m, btn) {
  const D = window.Darkness;
  const label = btn.textContent;
  btn.disabled = true;
  btn.classList.add("is-busy");
  btn.textContent = "Testing…";
  const t0 = performance.now();
  try {
    await D.api.post("/api/models/test", { id: m.id, name: m.name, provider: m.provider, baseUrl: m.baseUrl, modelName: m.modelName || m.id });
    st.tests[m.id] = { ok: true, ms: Math.round(performance.now() - t0), at: Date.now() };
    D.toast.show((m.name || m.id) + " responded", "success");
  } catch (err) {
    st.tests[m.id] = { ok: false, ms: 0, at: Date.now(), msg: err && err.message ? err.message : "The provider did not respond" };
    D.toast.show((m.name || m.id) + " failed its check", "danger");
  }
  if (st.root.isConnected) drawAll(st);
  else { btn.disabled = false; btn.classList.remove("is-busy"); btn.textContent = label; }
}

function confirmDelete(st, m) {
  const D = window.Darkness;
  const body = '<div style="font-size:13.5px;line-height:1.5;color:var(--ink);">Delete <strong>' + D.mg.esc(m.name || m.id) + "</strong>? Existing conversations will remain intact.</div>";
  D.modal.open("Delete model?", body, '<button class="btn btn--outline" type="button" data-modal-close="true">Cancel</button><button class="btn btn--danger" id="confirmDeleteModelBtn" type="button">Delete model</button>');
  document.getElementById("confirmDeleteModelBtn")?.addEventListener("click", async () => {
    D.modal.close();
    const card = st.root.querySelector('.mg-model[data-id="' + (window.CSS && CSS.escape ? CSS.escape(m.id) : m.id) + '"]');
    if (card) card.classList.add("is-leaving");
    try {
      await D.api.del("/api/models/" + encodeURIComponent(m.id));
      D.toast.show("Model deleted", "success");
      if (D.modelSelector) await D.modelSelector.load();
      await D.pages.modelRefresh();
    } catch (err) {
      if (card) card.classList.remove("is-leaving");
      D.toast.show("Delete failed: " + (err.message || ""), "danger");
    }
  }, { once: true });
}

function getCanonicalProviders() {
  if (window.Darkness && window.Darkness.providers && Array.isArray(window.Darkness.providers.PROVIDERS)) {
    return window.Darkness.providers.PROVIDERS;
  }
  return MODEL_PROVIDERS;
}

function getProviderConfig(providerId) {
  if (window.Darkness && window.Darkness.providers && typeof window.Darkness.providers.getProvider === "function") {
    const p = window.Darkness.providers.getProvider(providerId);
    if (p) return p;
  }
  const list = getCanonicalProviders();
  const cleanId = String(providerId || "").toLowerCase().trim();
  return list.find(p => p.id === cleanId) || null;
}

function setupProviderBaseUrlBinding({
  providerSel,
  baseInput,
  baseHint,
  resetBaseBtn,
  modelNameInput,
  keyInput,
  keyLabel,
  initialProvider,
  isEdit = false,
  hasExistingKey = false,
  onProviderChange = null
}) {
  let previousProviderId = providerSel?.value || initialProvider;
  let userManuallyEditedBase = false;

  const providerList = getCanonicalProviders();

  function isKnownDefaultUrl(url) {
    if (!url) return true;
    const trimmed = url.trim();
    return providerList.some(p => p.defaultBase && p.defaultBase === trimmed);
  }

  function updateBaseUrlUI() {
    const provId = providerSel?.value || "gemini";
    const provObj = getProviderConfig(provId);
    const defaultUrl = provObj?.defaultBase || "";
    const currentVal = baseInput?.value?.trim() || "";

    if (resetBaseBtn) {
      if (defaultUrl && currentVal !== defaultUrl) {
        resetBaseBtn.style.display = "inline-block";
      } else {
        resetBaseBtn.style.display = "none";
      }
    }

    if (baseHint) {
      if (!defaultUrl) {
        baseHint.textContent = "Custom provider endpoint required.";
      } else if (currentVal === defaultUrl) {
        baseHint.textContent = "Standard default endpoint for " + (provObj?.label || provId) + ".";
      } else {
        baseHint.textContent = "Custom endpoint configured.";
      }
    }
  }

  baseInput?.addEventListener("input", () => {
    const provId = providerSel?.value || "gemini";
    const provObj = getProviderConfig(provId);
    const defaultUrl = provObj?.defaultBase || "";
    const currentVal = baseInput?.value?.trim() || "";
    
    if (defaultUrl && currentVal === defaultUrl) {
      userManuallyEditedBase = false;
    } else if (currentVal !== "") {
      userManuallyEditedBase = true;
    }
    updateBaseUrlUI();
  });

  resetBaseBtn?.addEventListener("click", () => {
    const provId = providerSel?.value || "gemini";
    const provObj = getProviderConfig(provId);
    if (baseInput && provObj) {
      baseInput.value = provObj.defaultBase || "";
      userManuallyEditedBase = false;
      updateBaseUrlUI();
    }
  });

  providerSel?.addEventListener("change", () => {
    const newProvId = providerSel.value;
    const newProv = getProviderConfig(newProvId);
    const oldProv = getProviderConfig(previousProviderId);

    const currentBase = baseInput?.value?.trim() || "";
    const wasPreviousDefault = !currentBase || (oldProv && currentBase === oldProv.defaultBase);
    const wasAnyDefault = isKnownDefaultUrl(currentBase);

    if (baseInput && newProv) {
      if (!userManuallyEditedBase || wasPreviousDefault || wasAnyDefault) {
        baseInput.value = newProv.defaultBase || "";
        userManuallyEditedBase = false;
      }
      baseInput.placeholder = newProv.defaultBase || "https://api.example.com/v1";
    }

    if (newProv) {
      if (modelNameInput && (!modelNameInput.value || (oldProv && modelNameInput.value === oldProv.modelIdPlaceholder))) {
        modelNameInput.placeholder = newProv.modelIdPlaceholder || "model-id";
      }
      if (keyInput) {
        if (!isEdit || !hasExistingKey) {
          keyInput.placeholder = newProv.keyPlaceholder || "sk-...";
        }
      }
      if (keyLabel) {
        if (newProv.needsKey === false) {
          keyLabel.innerHTML = 'API key <span class="muted">(Optional / Not required for local Ollama)</span>';
        } else {
          keyLabel.innerHTML = 'API key' + (isEdit ? ' <span class="muted">(leave blank to keep current)</span>' : ' <span class="req">*</span>');
        }
      }
    }

    if (typeof onProviderChange === "function") {
      onProviderChange(newProv, oldProv);
    }

    previousProviderId = newProvId;
    updateBaseUrlUI();
  });

  // Initial update
  updateBaseUrlUI();
}

function openModelModal(existing) {
  const isEdit = !!existing;
  const initialProvider = (existing && existing.provider) || "gemini";
  const defaultBaseForInitial = window.Darkness.providers?.getDefaultBaseUrl(initialProvider) || "";
  const initialBase = existing ? (existing.baseUrl || defaultBaseForInitial) : defaultBaseForInitial;

  const m = existing || {
    id: "",
    name: "",
    provider: initialProvider,
    baseUrl: initialBase,
    apiKey: "",
    modelName: "",
    capabilities: { text: true, vision: false, codeGeneration: false, imageGeneration: false, fileAnalysis: false, streaming: true },
    status: "untested",
    enabled: true,
  };

  const providerList = getCanonicalProviders();
  const currentProvObj = getProviderConfig(m.provider);

  const providerOptions = providerList.map(p =>
    '<option value="' + p.id + '" ' + (p.id === m.provider ? "selected" : "") + '>' + p.label + '</option>'
  ).join("");

  const caps = m.capabilities || {};
  const cap = (k, label) => '<label class="check"><input type="checkbox" name="cap_' + k + '" ' + (caps[k] ? "checked" : "") + '><span class="check__label">' + label + '</span></label>';

  const maskedKeyNote = isEdit && m.hasApiKey
    ? '<div class="muted" style="margin-top:4px;">Current key on file: <code>' + window.Darkness.utils.escapeHtml(m.apiKeyMasked || '••••••') + '</code></div>'
    : '';

  const body = [
    '<form id="modelForm" class="model-form" autocomplete="off">',
      '<div class="model-form__section">',
        '<div class="model-form__row">',
          '<label class="model-form__label" for="mf-name">Display name <span class="req">*</span></label>',
          '<input class="input model-form__input" id="mf-name" type="text" name="name" required value="' + escapeAttr(m.name) + '" placeholder="e.g. Gemini 2.5 Flash">',
        '</div>',
        '<div class="model-form__row model-form__row--2">',
          '<div class="model-form__field">',
            '<label class="model-form__label" for="mf-id">Registry ID <span class="req">*</span></label>',
            '<input class="input model-form__input" id="mf-id" type="text" name="id" required value="' + escapeAttr(m.id) + '" placeholder="gemini-3.8-flash">',
            '<div class="muted">Local identifier; unique key in Darkness.</div>',
          '</div>',
          '<div class="model-form__field">',
            '<label class="model-form__label" for="mf-modelName">Provider model ID <span class="req">*</span></label>',
            '<input class="input model-form__input" id="mf-modelName" type="text" name="modelName" required value="' + escapeAttr(m.modelName) + '" placeholder="' + escapeAttr(currentProvObj?.modelIdPlaceholder || 'gemini-3.8-flash') + '">',
            '<div class="muted">Exact model ID expected by provider API.</div>',
          '</div>',
        '</div>',
      '</div>',
      '<div class="model-form__section">',
        '<div class="model-form__row model-form__row--2">',
          '<div class="model-form__field">',
            '<label class="model-form__label" for="mf-provider">Provider <span class="req">*</span></label>',
            '<select class="input model-form__input" id="mf-provider" name="provider">' + providerOptions + '</select>',
          '</div>',
          '<div class="model-form__field">',
            '<div class="hstack" style="justify-content:space-between;align-items:baseline;">',
              '<label class="model-form__label" for="mf-base">Base URL <span class="req">*</span></label>',
              '<button type="button" id="mf-reset-base" class="btn btn--ghost btn--xs" style="padding:0 4px;font-size:11px;color:var(--accent,#3b82f6);display:none;">↺ Reset to default</button>',
            '</div>',
            '<input class="input model-form__input" id="mf-base" type="text" name="baseUrl" value="' + escapeAttr(m.baseUrl) + '" placeholder="https://generativelanguage.googleapis.com/v1beta/openai/">',
            '<div class="muted" id="mf-base-hint" style="font-size:11.5px;margin-top:2px;">Default provider endpoint auto-populated.</div>',
          '</div>',
        '</div>',
        '<div class="model-form__row">',
          '<label class="model-form__label" for="mf-key" id="mf-key-label">API key' + (isEdit ? ' <span class="muted">(leave blank to keep current)</span>' : '') + '</label>',
          '<input class="input model-form__input" id="mf-key" type="password" name="apiKey" value="" placeholder="' + (isEdit && m.hasApiKey ? '•••••••••••• (Saved securely)' : escapeAttr(currentProvObj?.keyPlaceholder || 'AIzaSy...')) + '" autocomplete="new-password">',
          maskedKeyNote,
        '</div>',
        '<div class="model-form__row model-form__row--2">',
          '<div class="model-form__field">',
            '<label class="model-form__label" for="mf-context">Context window (tokens)</label>',
            '<input class="input model-form__input" id="mf-context" type="number" name="contextWindow" value="' + escapeAttr(m.contextWindow || 128000) + '" placeholder="128000">',
            '<div class="muted">Max input context tokens supported by model.</div>',
          '</div>',
          '<div class="model-form__field">',
            '<label class="model-form__label" for="mf-maxout">Max output tokens</label>',
            '<input class="input model-form__input" id="mf-maxout" type="number" name="maxOutputTokens" value="' + escapeAttr(m.maxOutputTokens || 4096) + '" placeholder="4096">',
            '<div class="muted">Max output tokens generated per turn.</div>',
          '</div>',
        '</div>',
        '<fieldset class="model-form__caps">',
          '<legend class="model-form__caps-legend">Capabilities</legend>',
          '<div class="check-grid">',
            cap("text", "Text"),
            cap("vision", "Vision"),
            cap("codeGeneration", "Code"),
            cap("imageGeneration", "Image"),
            cap("fileAnalysis", "Files"),
            cap("streaming", "Stream"),
          '</div>',
        '</fieldset>',
      '</div>',
      '<div id="modelTestResult" class="model-form__result" style="display:none"></div>',
    '</form>'
  ].join("");

  const actions = [
    '<button class="btn btn--outline" type="button" data-modal-close="true">Cancel</button>',
    '<button class="btn btn--ghost" type="button" id="modelTestBtn">Test connection</button>',
    '<button class="btn btn--primary" type="button" id="modelSaveBtn">' + (isEdit ? "Save changes" : "Save model") + '</button>',
  ].join("");

  window.Darkness.modal.open(isEdit ? "Edit model" : "Add model", body, actions);

  const providerSel = document.getElementById("mf-provider");
  const baseInput = document.getElementById("mf-base");
  const baseHint = document.getElementById("mf-base-hint");
  const resetBaseBtn = document.getElementById("mf-reset-base");
  const modelNameInput = document.getElementById("mf-modelName");
  const keyInput = document.getElementById("mf-key");
  const keyLabel = document.getElementById("mf-key-label");

  setupProviderBaseUrlBinding({
    providerSel,
    baseInput,
    baseHint,
    resetBaseBtn,
    modelNameInput,
    keyInput,
    keyLabel,
    initialProvider,
    isEdit,
    hasExistingKey: !!m.hasApiKey,
  });

  document.getElementById("modelTestBtn")?.addEventListener("click", async () => {
    const payload = collectEditModelForm();
    if (!payload.id || !payload.modelName) {
      showTestResult("Registry ID and Provider Model ID are required.", false);
      return;
    }
    const prov = getProviderConfig(payload.provider);
    if (!payload.baseUrl && prov?.defaultBase) {
      payload.baseUrl = prov.defaultBase;
    }
    if (!payload.baseUrl && payload.provider !== "ollama" && payload.provider !== "anthropic") {
      showTestResult("Base URL is required for this provider.", false);
      return;
    }
    if (!payload.apiKey && !existing?.hasApiKey && payload.provider !== "ollama") {
      showTestResult("API key is required for this provider.", false);
      return;
    }
    showTestResult("Testing connection with " + payload.modelName + "…", null);
    try {
      const res = await window.Darkness.api.post("/api/models/test", payload);
      const ok = !!res.ok;
      let msg;
      if (ok) {
        msg = "✓ Connection successful — provider responded.";
      } else {
        const type = res.error_type || "";
        if (type === "auth_error") msg = "✗ Connection failed: Invalid API key.";
        else if (type === "model_not_found") msg = "✗ Connection failed: Provider rejected the model ID \"" + payload.modelName + "\".";
        else if (type === "connection_error") msg = "✗ Connection failed: Provider unreachable.";
        else if (type === "rate_limit") msg = "✗ Connection failed: Rate limited by provider.";
        else if (type === "missing_api_key") msg = "✗ API key required.";
        else if (type === "missing_base_url") msg = "✗ Base URL required.";
        else msg = "✗ Connection failed: " + (res.error || "Unknown error");
      }
      showTestResult(msg + (res.note ? " — " + res.note : ""), ok);
      if (ok) {
        try {
          await window.Darkness.api.post("/api/models/set-active", { model_id: payload.id });
        } catch (e) {}
        if (window.Darkness.modelSelector) await window.Darkness.modelSelector.load();
        window.Darkness.pages.modelRefresh();
        window.Darkness.modal.close();
        window.Darkness.toast.show("Model verified — status: Available", "success");
      }
    } catch (err) {
      showTestResult("✗ Test failed: " + (err.message || ""), false);
    }
  });

  document.getElementById("modelSaveBtn")?.addEventListener("click", async () => {
    const payload = collectEditModelForm();
    if (!payload.id || !payload.modelName) {
      window.Darkness.toast.show("Registry ID and Provider Model ID are required", "danger");
      return;
    }
    const prov = getProviderConfig(payload.provider);
    if (!payload.baseUrl && prov?.defaultBase) {
      payload.baseUrl = prov.defaultBase;
    }
    try {
      if (isEdit) {
        await window.Darkness.api.put("/api/models/" + encodeURIComponent(existing.id), payload);
        try {
          await window.Darkness.api.post("/api/models/set-active", { model_id: payload.id });
        } catch (e) {}
      } else {
        await window.Darkness.api.post("/api/models", payload);
        try {
          await window.Darkness.api.post("/api/models/set-active", { model_id: payload.id });
        } catch (e) {}
      }

      window.Darkness.toast.show(isEdit ? "Model updated and set active" : "Model added and set active", "success");
      if (window.Darkness.modelSelector) await window.Darkness.modelSelector.load();
      window.Darkness.modal.close();
      window.Darkness.pages.modelRefresh();
    } catch (err) {
      window.Darkness.toast.show("Save failed: " + (err.message || ""), "danger");
    }
  });
}

function collectEditModelForm() {
  const name = document.getElementById("mf-name")?.value?.trim() || "";
  const provider = document.getElementById("mf-provider")?.value || "openai";
  const baseUrl = document.getElementById("mf-base")?.value?.trim() || "";
  const apiKey = document.getElementById("mf-key")?.value || "";

  const id = document.getElementById("mf-id")?.value?.trim() || "";
  const modelName = document.getElementById("mf-modelName")?.value?.trim() || "";

  const rawCtx = document.getElementById("mf-context")?.value;
  const contextWindow = rawCtx && Number(rawCtx) > 0 ? parseInt(rawCtx, 10) : 2097152;
  const rawMax = document.getElementById("mf-maxout")?.value;
  const maxOutputTokens = rawMax && Number(rawMax) > 0 ? parseInt(rawMax, 10) : 65536;

  const capabilities = {
    text: document.querySelector("[name='cap_text']")?.checked || false,
    vision: document.querySelector("[name='cap_vision']")?.checked || false,
    codeGeneration: document.querySelector("[name='cap_codeGeneration']")?.checked || false,
    imageGeneration: document.querySelector("[name='cap_imageGeneration']")?.checked || false,
    fileAnalysis: document.querySelector("[name='cap_fileAnalysis']")?.checked || false,
    streaming: document.querySelector("[name='cap_streaming']")?.checked || false,
  };

  return {
    name: name || modelName.split("/").pop() || id,
    id,
    modelName,
    provider,
    baseUrl,
    apiKey,
    contextWindow,
    maxOutputTokens,
    capabilities,
  };
}

let _modelMappings = [];

function openAddModelsModal() {
  const providerList = getCanonicalProviders();
  const initialProvider = "gemini";
  const initialProvObj = getProviderConfig(initialProvider) || providerList[0];

  _modelMappings = [
    { id: "", modelName: "", displayName: "" },
  ];

  const providerOptions = providerList.map(p =>
    '<option value="' + p.id + '" ' + (p.id === initialProvider ? "selected" : "") + '>' + p.label + '</option>'
  ).join("");

  const body = [
    '<form id="addModelsForm" class="add-models-form" autocomplete="off">',
      '<p class="muted" style="margin-bottom:16px;">',
        'Add multiple models using the same provider connection. The API key is stored once and shared by every model below.',
      '</p>',

      '<div class="model-form__section">',
        '<div class="model-form__section-title">Provider configuration</div>',
        '<div class="model-form__row model-form__row--2">',
          '<div class="model-form__field">',
            '<label class="model-form__label" for="mf-provider">Provider <span class="req">*</span></label>',
            '<select class="input model-form__input" id="mf-provider" name="provider">' + providerOptions + '</select>',
          '</div>',
          '<div class="model-form__field">',
            '<div class="hstack" style="justify-content:space-between;align-items:baseline;">',
              '<label class="model-form__label" for="mf-base">Base URL <span class="req">*</span></label>',
              '<button type="button" id="mf-reset-base" class="btn btn--ghost btn--xs" style="padding:0 4px;font-size:11px;color:var(--accent,#3b82f6);display:none;">↺ Reset to default</button>',
            '</div>',
            '<input class="input model-form__input" id="mf-base" type="text" name="baseUrl" value="' + escapeAttr(initialProvObj?.defaultBase || "") + '" placeholder="https://generativelanguage.googleapis.com/v1beta/openai/">',
            '<div class="muted" id="mf-base-hint" style="font-size:11.5px;margin-top:2px;">Default provider endpoint auto-populated.</div>',
          '</div>',
        '</div>',
        '<div class="model-form__row">',
          '<label class="model-form__label" for="mf-key" id="mf-key-label">API key <span class="req">*</span></label>',
          '<input class="input model-form__input" id="mf-key" type="password" name="apiKey" value="" placeholder="' + escapeAttr(initialProvObj?.keyPlaceholder || 'AIzaSy...') + '" autocomplete="new-password">',
          '<div class="muted">One API key can power multiple models. It is stored once and reused for every model in this form.</div>',
        '</div>',
      '</div>',

      '<div class="model-form__section">',
        '<div class="model-form__section-title">Models using this API key</div>',
        '<div id="modelMappingsContainer">',
          createModelMappingHTML(0, _modelMappings[0], initialProvObj),
        '</div>',
        '<button type="button" class="btn btn--outline btn--sm" id="addMappingBtn" style="margin-top:8px;">',
          '<svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
          ' Add Another Model',
        '</button>',
      '</div>',

      '<div id="addModelsResult" class="model-form__result" style="display:none;"></div>',
    '</form>'
  ].join("");

  const actions = [
    '<button class="btn btn--outline" type="button" data-modal-close="true">Cancel</button>',
    '<button class="btn btn--primary" type="button" id="saveModelsBtn">Save Models</button>',
  ].join("");

  window.Darkness.modal.open("Add Models", body, actions);

  const sel = document.getElementById("mf-provider");
  const baseInput = document.getElementById("mf-base");
  const baseHint = document.getElementById("mf-base-hint");
  const resetBaseBtn = document.getElementById("mf-reset-base");
  const keyInput = document.getElementById("mf-key");
  const keyLabel = document.getElementById("mf-key-label");

  setupProviderBaseUrlBinding({
    providerSel: sel,
    baseInput,
    baseHint,
    resetBaseBtn,
    modelNameInput: null,
    keyInput,
    keyLabel,
    initialProvider,
    isEdit: false,
    hasExistingKey: false,
    onProviderChange: (newProv, oldProv) => {
      const mappingContainer = document.getElementById("modelMappingsContainer");
      if (mappingContainer && newProv) {
        mappingContainer.querySelectorAll(".model-mapping").forEach((row) => {
          const mnameInput = row.querySelector("input[name$='[modelName]']");
          if (mnameInput && (!mnameInput.value || (oldProv && mnameInput.placeholder === oldProv.modelIdPlaceholder))) {
            mnameInput.placeholder = newProv.modelIdPlaceholder || "model-id";
          }
        });
      }
    }
  });

  document.getElementById("addMappingBtn")?.addEventListener("click", () => {
    _modelMappings.push({ id: "", modelName: "", displayName: "" });
    const idx = _modelMappings.length - 1;
    const container = document.getElementById("modelMappingsContainer");
    const currentProv = getProviderConfig(sel?.value) || providerList[0];
    if (container) {
      container.insertAdjacentHTML("beforeend", createModelMappingHTML(idx, _modelMappings[idx], currentProv));
    }
  });

  document.getElementById("saveModelsBtn")?.addEventListener("click", async () => {
    const payloads = collectAddModelsFormNew();
    if (!payloads || payloads.length === 0) {
      showAddModelsResultNew("At least one model mapping with Registry ID and Provider Model ID is required.", false);
      return;
    }

    let successCount = 0;
    let failCount = 0;
    const errors = [];
    let firstSuccessId = null;

    for (const payload of payloads) {
      if (!payload.id || !payload.modelName) {
        failCount++;
        errors.push("Mapping '" + (payload.id || 'unnamed') + "' is missing required fields.");
        continue;
      }

      const prov = getProviderConfig(payload.provider);
      if (!payload.baseUrl && prov?.defaultBase) {
        payload.baseUrl = prov.defaultBase;
      }

      try {
        await window.Darkness.api.post("/api/models", payload);
        successCount++;
        if (!firstSuccessId) {
          firstSuccessId = payload.id;
        }
      } catch (err) {
        failCount++;
        errors.push("Failed to add '" + (payload.id) + "': " + (err.message || "Unknown error"));
      }
    }

    if (successCount > 0) {
      if (firstSuccessId) {
        try {
          await window.Darkness.api.post("/api/models/set-active", { model_id: firstSuccessId });
        } catch (e) {}
      }
      window.Darkness.toast.show(successCount + " model(s) added and set active" + (failCount > 0 ? " (" + failCount + " failed)" : ""), failCount > 0 ? "warning" : "success");
      if (window.Darkness.modelSelector) await window.Darkness.modelSelector.load();
      window.Darkness.modal.close();
      window.Darkness.pages.modelRefresh();
    } else {
      showAddModelsResultNew("Failed to add models:\n" + errors.join("\n"), false);
    }
  });
}

function createModelMappingHTML(index, mapping, provObj) {
  const removeBtn = index === 0
    ? ''
    : '<button type="button" class="btn btn--ghost btn--sm" data-act="remove-model-mapping" data-index="' + index + '" style="margin-left:auto;">Remove</button>';

  const placeholderModelName = provObj?.modelIdPlaceholder || "meta-llama/llama-3.3-70b-instruct";

  return [
    '<div class="model-mapping card" id="modelMapping' + index + '" data-mapping-index="' + index + '" style="padding:12px;margin-bottom:12px;">',
      '<div class="hstack" style="justify-content:space-between;align-items:center;margin-bottom:8px;">',
        '<strong style="font-size:13px;">Model ' + (index + 1) + '</strong>',
        removeBtn,
      '</div>',
      '<div class="model-form__row">',
        '<label class="model-form__label" for="mapping-name-' + index + '">Display name <span class="req">*</span></label>',
        '<input class="input model-form__input" id="mapping-name-' + index + '" type="text" name="mappings[' + index + '][displayName]" value="' + escapeAttr(mapping.displayName || "") + '" placeholder="e.g. Primary Model">',
      '</div>',
      '<div class="model-form__row model-form__row--2">',
        '<div class="model-form__field">',
          '<label class="model-form__label" for="mapping-id-' + index + '">Registry ID <span class="req">*</span></label>',
          '<input class="input model-form__input" id="mapping-id-' + index + '" type="text" name="mappings[' + index + '][id]" required value="' + escapeAttr(mapping.id || "") + '" placeholder="model-' + (index + 1) + '">',
        '</div>',
        '<div class="model-form__field">',
          '<label class="model-form__label" for="mapping-mname-' + index + '">Provider model ID <span class="req">*</span></label>',
          '<input class="input model-form__input" id="mapping-mname-' + index + '" type="text" name="mappings[' + index + '][modelName]" required value="' + escapeAttr(mapping.modelName || "") + '" placeholder="' + escapeAttr(placeholderModelName) + '">',
        '</div>',
      '</div>',
      '<div class="model-form__row model-form__row--2" style="display:none !important;">',
        '<div class="model-form__field">',
          '<label class="model-form__label" for="mapping-ctx-' + index + '">Context window (tokens)</label>',
          '<input class="input model-form__input" id="mapping-ctx-' + index + '" type="number" name="mappings[' + index + '][contextWindow]" value="' + escapeAttr(mapping.contextWindow || 2097152) + '" placeholder="2097152">',
        '</div>',
        '<div class="model-form__field">',
          '<label class="model-form__label" for="mapping-max-' + index + '">Max output tokens</label>',
          '<input class="input model-form__input" id="mapping-max-' + index + '" type="number" name="mappings[' + index + '][maxOutputTokens]" value="' + escapeAttr(mapping.maxOutputTokens || 65536) + '" placeholder="65536">',
        '</div>',
      '</div>',
      '<fieldset class="model-form__caps" style="margin-top:8px;">',
        '<legend class="model-form__caps-legend">Capabilities</legend>',
        '<div class="check-grid">',
          '<label class="check"><input type="checkbox" name="mappings[' + index + '][cap_text]" checked><span class="check__label">Text</span></label>',
          '<label class="check"><input type="checkbox" name="mappings[' + index + '][cap_streaming]" checked><span class="check__label">Stream</span></label>',
          '<label class="check"><input type="checkbox" name="mappings[' + index + '][cap_codeGeneration]"><span class="check__label">Code</span></label>',
          '<label class="check"><input type="checkbox" name="mappings[' + index + '][cap_fileAnalysis]"><span class="check__label">Files</span></label>',
          '<label class="check"><input type="checkbox" name="mappings[' + index + '][cap_vision]"><span class="check__label">Vision</span></label>',
        '</div>',
      '</fieldset>',
    '</div>'
  ].join("");
}

window.removeModelMapping = function removeModelMapping(index) {
  const entry = document.getElementById("modelMapping" + index);
  if (entry) {
    entry.remove();
    _modelMappings[index] = null;
  }
};

function collectAddModelsFormNew() {
  const payloads = [];

  const provider = document.getElementById("mf-provider")?.value || "openai";
  const baseUrl = document.getElementById("mf-base")?.value?.trim() || "";
  const apiKey = document.getElementById("mf-key")?.value || "";

  const mappingContainer = document.getElementById("modelMappingsContainer");
  if (!mappingContainer) return payloads;

  const mappings = mappingContainer.querySelectorAll(".model-mapping");
  mappings.forEach((el) => {
    const idx = el.getAttribute("data-mapping-index");
    if (_modelMappings[idx] === null) return;

    const displayName = el.querySelector("[name='mappings[" + idx + "][displayName]']")?.value?.trim() || "";
    const mappingId = el.querySelector("[name='mappings[" + idx + "][id]']")?.value?.trim() || "";
    const mappingModelName = el.querySelector("[name='mappings[" + idx + "][modelName]']")?.value?.trim() || "";
    const rawCtx = el.querySelector("[name='mappings[" + idx + "][contextWindow]']")?.value;
    const contextWindow = rawCtx && Number(rawCtx) > 0 ? parseInt(rawCtx, 10) : 2097152;
    const rawMax = el.querySelector("[name='mappings[" + idx + "][maxOutputTokens]']")?.value;
    const maxOutputTokens = rawMax && Number(rawMax) > 0 ? parseInt(rawMax, 10) : 65536;

    if (!mappingId && !mappingModelName) return;

    const capabilities = {
      text: el.querySelector("[name='mappings[" + idx + "][cap_text]']")?.checked || false,
      vision: el.querySelector("[name='mappings[" + idx + "][cap_vision]']")?.checked || false,
      codeGeneration: el.querySelector("[name='mappings[" + idx + "][cap_codeGeneration]']")?.checked || false,
      imageGeneration: false,
      fileAnalysis: el.querySelector("[name='mappings[" + idx + "][cap_fileAnalysis]']")?.checked || false,
      streaming: el.querySelector("[name='mappings[" + idx + "][cap_streaming]']")?.checked || false,
    };

    const name = displayName || mappingModelName.split("/").pop() || mappingId;

    payloads.push({
      name,
      id: mappingId,
      modelName: mappingModelName,
      provider,
      baseUrl,
      apiKey,
      contextWindow,
      maxOutputTokens,
      capabilities,
      status: "untested",
      enabled: true,
    });
  });

  return payloads;
}

function showAddModelsResultNew(msg, ok) {
  const el = document.getElementById("addModelsResult");
  if (!el) return;
  el.textContent = msg;
  el.className = "alert " + (ok === null ? "alert--info" : ok ? "alert--success" : "alert--danger");
  el.style.display = "";
}

function showTestResult(msg, ok) {
  const el = document.getElementById("modelTestResult");
  if (!el) return;
  el.textContent = msg;
  el.className = "alert " + (ok === null ? "alert--info" : ok ? "alert--success" : "alert--danger");
  el.style.display = "";
}
