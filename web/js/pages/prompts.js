window.Darkness = window.Darkness || {};
window.Darkness.pages = window.Darkness.pages || {};

/**
 * Prompt Studio: a personal prompt library with {{variables}}, version history, templates, test runs on your own models (1-3 at once),
 * A/B/C comparison of prompt variations, and import / export. Server: /api/prompts (server/prompts-routes.ts).
 * Test runs call your configured models with your own keys, so the page says so and caps them at three.
 */
window.Darkness.pages.prompts = function renderPromptStudioPage() {
  const D = window.Darkness, M = D.mg, esc = M.esc;
  const main = document.getElementById("main");
  if (!main) return;

  const CATS = [["writing", "Writing"], ["coding", "Coding"], ["analysis", "Analysis"], ["learning", "Learning"], ["business", "Business"], ["creative", "Creative"], ["other", "Other"]];
  const catLabel = (c) => (CATS.filter((x) => x[0] === c)[0] || [c, c])[1];
  const VAR_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,39})\s*(?:\|([^{}]{0,200}))?\}\}/g;
  const parseVars = (body) => { const seen = new Map(); for (const m of String(body).matchAll(VAR_RE)) { if (!seen.has(m[1])) seen.set(m[1], m[2] != null ? m[2].trim() : null); else if (seen.get(m[1]) == null && m[2] != null) seen.set(m[1], m[2].trim()); } return [...seen.entries()].map((e) => ({ name: e[0], def: e[1] })); };

  const st = { prompts: [], category: "", favorite: false, q: "", selectedId: null, draft: null, saved: null, models: [], modelsLoaded: false, values: {}, mode: "run", results: null, running: false, variants: ["", ""], variantModel: "", chosen: [] };

  main.innerHTML = '<div class="page mg-page"><div class="page__inner" id="psRoot"><header class="mg-head"><div><h1 class="mg-title">Prompt Studio</h1><p class="mg-sub">Write, test and keep your best prompts.</p></div></header>' + M.skeleton("list") + "</div></div>";
  const root = document.getElementById("psRoot");

  const blankDraft = (over) => Object.assign({ id: null, title: "", category: "other", description: "", tags: "", body: "", favorite: false, version: 0 }, over || {});
  const dirty = () => !!st.draft && (!st.saved || ["title", "category", "description", "tags", "body"].some((k) => String(st.draft[k]) !== String(st.saved[k])));
  const asDraft = (p) => ({ id: p.id, title: p.title, category: p.category, description: p.description, tags: (p.tags || []).join(", "), body: p.body, favorite: p.favorite, version: p.version });

  async function loadList() {
    const qs = {};
    if (st.category) qs.category = st.category;
    if (st.favorite) qs.favorite = "true";
    if (st.q.length >= 2) qs.q = st.q;
    st.prompts = (await D.api.get("/api/prompts", qs)).prompts || [];
  }
  async function loadModels() {
    if (st.modelsLoaded) return;
    try { const r = await D.api.get("/api/models"); st.models = (r.models || []).filter((m) => m && m.enabled !== false); } catch (e) { st.models = []; }
    st.modelsLoaded = true;
  }

  // ------------------------------------------------------------------ rendering
  function listHtml() {
    return (st.prompts.length ? '<ul class="ps-list">' + st.prompts.map((p) =>
      '<li><button type="button" class="ps-item' + (p.id === st.selectedId ? " is-active" : "") + '" data-ps-open="' + esc(p.id) + '"' + (p.id === st.selectedId ? ' aria-current="true"' : "") + ">" +
      '<span class="ps-item__title">' + (p.favorite ? '<span class="sr-only">Favourite: </span><span aria-hidden="true">★ </span>' : "") + esc(p.title) + "</span>" +
      '<span class="ps-item__meta"><span class="ix-badge ix-tone-accent">' + esc(catLabel(p.category)) + "</span> " + (p.tags || []).slice(0, 3).map((t) => '<span class="mg-muted">#' + esc(t) + "</span>").join(" ") + ' <span class="mg-muted">v' + p.version + " · " + esc(M.ago(p.updatedAt)) + "</span></span></button></li>").join("") + "</ul>"
      : '<div class="mg-empty">' + M.icon("sparkles", 28) + "<strong>" + (st.q || st.category || st.favorite ? "No prompts match" : "No prompts yet") + "</strong><p>" + (st.q || st.category || st.favorite ? "Try another filter." : "Start from a template or write your own.") + "</p></div>");
  }

  function editorHtml() {
    const d = st.draft;
    if (!d) return '<div class="mg-card"><div class="mg-empty">' + M.icon("sparkles", 28) + "<strong>Pick a prompt, or start a new one</strong><p>Use a template for a quick start. Variables look like {{topic}}.</p>" +
      '<div class="mg-actions"><button class="btn btn--primary btn--sm" type="button" data-ps-new="1">New prompt</button><button class="btn btn--outline btn--sm" type="button" data-ps-templates="1">Browse templates</button></div></div></div>';
    const vars = parseVars(d.body);
    return '<form class="mg-card ps-editor" id="psForm" novalidate aria-label="Prompt editor">' +
      '<div class="ps-editor__head"><h2 class="ps-editor__title">' + (d.id ? "Edit prompt" : "New prompt") + (dirty() ? ' <span class="ix-badge ix-tone-warn" role="status">Unsaved changes</span>' : "") + "</h2>" +
      '<div class="mg-actions">' + (d.id ? '<button type="button" class="btn btn--ghost btn--sm" id="psFav" aria-pressed="' + d.favorite + '">' + (d.favorite ? "★ Favourite" : "☆ Favourite") + '</button><button type="button" class="btn btn--ghost btn--sm" id="psVersions">History (v' + d.version + ')</button><button type="button" class="btn btn--ghost btn--sm mem-danger" id="psDelete">Delete</button>' : "") + "</div></div>" +
      '<div class="ps-grid2"><div><label for="psTitle" class="label">Title</label><input id="psTitle" class="input" maxlength="120" value="' + esc(d.title) + '"></div>' +
      '<div><label for="psCat" class="label">Category</label><select id="psCat" class="input">' + CATS.map((c) => '<option value="' + c[0] + '"' + (c[0] === d.category ? " selected" : "") + ">" + c[1] + "</option>").join("") + "</select></div></div>" +
      '<div class="ps-grid2"><div><label for="psDesc" class="label">Description <span class="muted">(optional)</span></label><input id="psDesc" class="input" maxlength="300" value="' + esc(d.description) + '"></div>' +
      '<div><label for="psTags" class="label">Tags <span class="muted">(comma separated)</span></label><input id="psTags" class="input" value="' + esc(d.tags) + '"></div></div>' +
      '<label for="psBody" class="label">Prompt</label><textarea id="psBody" class="input ps-body" rows="10" maxlength="20000" aria-describedby="psVarsInfo psCount" spellcheck="false">' + esc(d.body) + "</textarea>" +
      '<p class="muted" id="psCount">' + d.body.length + ' / 20000</p>' +
      '<p class="muted" id="psVarsInfo">' + (vars.length ? "Variables: " + vars.map((v) => '<code class="ps-var">{{' + esc(v.name) + (v.def != null ? "|" + esc(v.def) : "") + "}}</code>").join(" ") : "Add variables like {{topic}} or {{tone|friendly}} (with a default) to reuse a prompt.") + "</p>" +
      '<div class="ps-grid2"><div><label for="psNote" class="label">What changed? <span class="muted">(optional, saved with the version)</span></label><input id="psNote" class="input" maxlength="200"></div>' +
      '<div class="ps-savebar"><button type="submit" class="btn btn--primary" id="psSave">' + (d.id ? "Save as version " + (d.version + 1) : "Save prompt") + '</button><button type="button" class="btn btn--outline" id="psCopy">Copy</button><button type="button" class="btn btn--outline" id="psToChat">Use in chat</button></div></div>' +
      '<p class="history-form-error" id="psError" role="alert" hidden></p></form>' + testHtml(vars);
  }

  function testHtml(vars) {
    const modelBoxes = st.models.length ? st.models.map((m) => {
      const multi = st.mode === "run";
      return '<label class="cmp-model"><input type="' + (multi ? "checkbox" : "radio") + '" name="psModel" value="' + esc(m.id) + '"' + ((multi ? st.chosen.indexOf(m.id) >= 0 : st.variantModel === m.id) ? " checked" : "") + "> <span class=\"cmp-model__name\">" + esc(m.name || m.modelName || m.id) + '</span> <span class="muted">' + esc(m.provider || "") + "</span></label>";
    }).join("") : '<p class="muted">You have no enabled models. <a href="#/model">Add one</a> to test prompts.</p>';
    const variantsHtml = st.mode === "compare" ? '<div class="ps-variants">' + st.variants.map((v, i) => '<div><label for="psVar' + i + '" class="label">Variation ' + String.fromCharCode(65 + i) + (i === 0 ? " (starts as the editor text)" : "") + '</label><textarea id="psVar' + i + '" class="input ps-body" rows="5" maxlength="20000" data-ps-variant="' + i + '">' + esc(v) + "</textarea></div>").join("") +
      (st.variants.length < 3 ? '<button type="button" class="btn btn--ghost btn--sm" id="psAddVariant">+ Add a third variation</button>' : "") + "</div>" : "";
    const allVars = st.mode === "compare" ? parseVars(st.variants.join("\n")) : vars;
    return '<section class="mg-card ps-test" aria-labelledby="psTestTitle"><h2 id="psTestTitle">Test it</h2>' +
      '<p class="mg-muted">A test sends the prompt to the models you choose, using your own keys. Each model is a separate request; at most three, one test at a time.</p>' +
      '<div class="ix-tabs" role="tablist" aria-label="Test mode"><button type="button" class="ix-tab" role="tab" id="psTabRun" aria-selected="' + (st.mode === "run") + '" data-ps-mode="run">Run on models</button><button type="button" class="ix-tab" role="tab" id="psTabCmp" aria-selected="' + (st.mode === "compare") + '" data-ps-mode="compare">Compare variations</button></div>' +
      variantsHtml +
      (allVars.length ? '<fieldset class="ps-values"><legend class="label">Fill in the variables</legend>' + allVars.map((v) => '<div><label for="psVal-' + esc(v.name) + '" class="label">' + esc(v.name) + (v.def != null ? ' <span class="muted">(default: ' + esc(v.def) + ")</span>" : "") + '</label><textarea id="psVal-' + esc(v.name) + '" class="input" rows="2" maxlength="4000" data-ps-value="' + esc(v.name) + '">' + esc(st.values[v.name] || "") + "</textarea></div>").join("") + "</fieldset>" : "") +
      '<fieldset class="cmp-models"><legend class="label">' + (st.mode === "run" ? "Models <span class=\"muted\">(choose 1 to 3)</span>" : "Model <span class=\"muted\">(one, used for every variation)</span>") + '</legend><div class="cmp-models__grid">' + modelBoxes + "</div></fieldset>" +
      '<div class="hstack" style="gap:8px;"><button type="button" class="btn btn--primary" id="psRun"' + (st.running ? " disabled" : "") + ">" + (st.running ? "Running…" : "Run test") + '</button><button type="button" class="btn btn--ghost" id="psCancel"' + (st.running ? "" : " hidden") + '>Cancel</button></div>' +
      '<section id="psResults" class="cmp-results" aria-label="Test results" aria-live="polite" aria-busy="' + st.running + '">' + resultsHtml() + "</section></section>";
  }

  function resultsHtml() {
    if (st.running) return '<p class="muted" role="status">Waiting for the models… this can take up to a minute.</p>';
    if (!st.results) return "";
    return '<div class="cmp-grid cmp-grid--' + st.results.length + '">' + st.results.map((r, i) => {
      const ok = r.finish === "done", status = ok ? "Answered" : r.finish === "timeout" ? "Timed out" : r.finish === "cancelled" ? "Cancelled" : "Failed";
      const title = r.variant ? "Variation " + r.variant : r.label;
      return '<article class="cmp-card' + (ok ? "" : " cmp-card--bad") + '" aria-label="' + esc(title) + '"><header class="cmp-card__head"><h3 class="cmp-card__title">' + esc(title) + '</h3><span class="muted">' + esc(r.variant ? r.label : r.provider) + "</span></header>" +
        '<p class="cmp-card__meta"><span class="cmp-badge cmp-badge--' + (ok ? "ok" : "bad") + '">' + status + '</span> <span class="muted">' + (r.latencyMs / 1000).toFixed(1) + ' s</span></p>' +
        (ok ? '<div class="cmp-card__text" tabindex="0" role="region" aria-label="Answer: ' + esc(title) + '" data-ps-answer="' + i + '"></div><button type="button" class="btn btn--ghost btn--sm" data-ps-copy-answer="' + i + '">Copy answer</button>' : '<p class="cmp-card__error" role="alert">' + esc(r.error || "No answer.") + "</p>") + "</article>";
    }).join("") + "</div>";
  }

  function paint(focusId) {
    root.innerHTML = [
      '<header class="mg-head"><div><h1 class="mg-title">Prompt Studio</h1><p class="mg-sub">Write, test and keep your best prompts.</p></div>',
      '<div class="mg-actions"><button class="btn btn--primary btn--sm" type="button" data-ps-new="1">' + M.icon("plus", 15) + " <span>New prompt</span></button>" +
        '<button class="btn btn--outline btn--sm" type="button" data-ps-templates="1">Templates</button>' +
        '<button class="btn btn--outline btn--sm" type="button" id="psExport">' + M.icon("download", 15) + " <span>Export</span></button>" +
        '<label class="btn btn--outline btn--sm" for="psImport">Import</label><input id="psImport" type="file" accept="application/json,.json" class="sr-only"></div></header>',
      '<div class="ps-layout"><aside class="ps-side" aria-label="Your prompts"><label for="psSearch" class="sr-only">Search prompts</label><input id="psSearch" class="input" type="search" placeholder="Search prompts" value="' + esc(st.q) + '">' +
        '<div class="ix-chips" role="group" aria-label="Filter prompts"><button type="button" class="ix-chip" data-ps-cat="" aria-pressed="' + (!st.category && !st.favorite) + '">All</button><button type="button" class="ix-chip" data-ps-fav="1" aria-pressed="' + st.favorite + '">★ Favourites</button>' +
        CATS.map((c) => '<button type="button" class="ix-chip" data-ps-cat="' + c[0] + '" aria-pressed="' + (st.category === c[0]) + '">' + c[1] + "</button>").join("") + "</div>" +
        '<p class="mg-muted" role="status" aria-live="polite" id="psCountList">' + st.prompts.length + (st.prompts.length === 1 ? " prompt" : " prompts") + "</p>" + listHtml() + "</aside>",
      '<div class="ps-main">' + editorHtml() + "</div></div>",
    ].join("");
    bind();
    if (st.results) fillAnswers();
    if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); if (typeof el.value === "string" && el.setSelectionRange && /^(text|search|)$/.test(el.type || "")) el.setSelectionRange(el.value.length, el.value.length); } }
  }
  const fillAnswers = () => root.querySelectorAll("[data-ps-answer]").forEach((el) => { const r = st.results[Number(el.getAttribute("data-ps-answer"))]; if (r) el.textContent = r.text; });
  const showError = (msg) => { const e = document.getElementById("psError"); if (e) { e.textContent = msg || ""; e.hidden = !msg; } };

  // ------------------------------------------------------------------ actions
  function readForm() {
    const d = st.draft;
    d.title = document.getElementById("psTitle").value; d.category = document.getElementById("psCat").value; d.description = document.getElementById("psDesc").value;
    d.tags = document.getElementById("psTags").value; d.body = document.getElementById("psBody").value;
  }
  function confirmDiscard(then) {
    if (!dirty()) return then();
    D.modal.open("Discard unsaved changes?", "<p>You have changes that are not saved.</p>", '<button class="btn btn--outline" type="button" data-modal-close="true">Keep editing</button><button class="btn btn--danger-outline" id="psDiscard" type="button">Discard</button>');
    document.getElementById("psDiscard").addEventListener("click", () => { D.modal.close(); then(); });
  }
  function startDraft(over, saved) { st.draft = blankDraft(over); st.saved = saved || null; st.selectedId = st.draft.id; st.results = null; st.variants = [st.draft.body, ""]; paint("psTitle"); }
  async function open(id) {
    try { const p = await D.api.get("/api/prompts/" + id); st.saved = asDraft(p); st.draft = asDraft(p); st.selectedId = p.id; st.results = null; st.variants = [p.body, ""]; await loadModels(); paint(); }
    catch (e) { D.toast.show("Could not open the prompt: " + (e.message || ""), "danger"); }
  }
  async function save(e) {
    e.preventDefault(); readForm(); showError("");
    const d = st.draft, body = { title: d.title, body: d.body, category: d.category, description: d.description, tags: d.tags, note: document.getElementById("psNote").value };
    const btn = document.getElementById("psSave"); btn.disabled = true;
    try {
      const p = d.id ? await D.api.patch("/api/prompts/" + d.id, body) : await D.api.post("/api/prompts", body);
      st.saved = asDraft(p); st.draft = asDraft(p); st.selectedId = p.id; st.variants[0] = p.body;
      await loadList(); paint("psTitle"); D.toast.show(d.id ? "Saved as version " + p.version : "Prompt saved", "success");
    } catch (err) { showError(err.message || "Could not save"); btn.disabled = false; }
  }
  function currentBodyForRun() { return st.mode === "compare" ? null : (document.getElementById("psBody") ? document.getElementById("psBody").value : st.draft.body); }
  function collectValues() { const v = {}; root.querySelectorAll("[data-ps-value]").forEach((el) => { if (el.value) v[el.getAttribute("data-ps-value")] = el.value; }); st.values = Object.assign(st.values, v); return v; }
  let abortCtl = null;
  async function run() {
    const values = collectValues();
    let path, payload;
    if (st.mode === "run") {
      const ids = Array.from(root.querySelectorAll('input[name="psModel"]:checked')).map((i) => i.value); st.chosen = ids;
      if (ids.length < 1 || ids.length > 3) { D.toast.show("Choose 1 to 3 models.", "warning"); return; }
      path = "/api/prompts/run"; payload = { body: currentBodyForRun(), values, modelIds: ids };
    } else {
      const sel = root.querySelector('input[name="psModel"]:checked'); st.variantModel = sel ? sel.value : "";
      if (!sel) { D.toast.show("Choose a model.", "warning"); return; }
      st.variants = Array.from(root.querySelectorAll("[data-ps-variant]")).map((t) => t.value);
      const list = st.variants.map((b, i) => ({ label: String.fromCharCode(65 + i), body: b })).filter((v) => v.body.trim());
      path = "/api/prompts/compare"; payload = { variants: list, values, modelId: sel.value };
    }
    st.running = true; st.results = null; abortCtl = new AbortController(); renderTest(); const rb = document.getElementById("psResults"); if (rb) rb.focus();
    try { st.results = (await D.api.request(path, { method: "POST", body: JSON.stringify(payload), signal: abortCtl.signal })).results; }
    catch (err) { st.results = null; if (!abortCtl.signal.aborted) D.toast.show(err.message || "The test failed", "danger"); else D.toast.show("Test cancelled", "info"); }
    st.running = false; abortCtl = null; renderTest();
  }

  function lineDiff(a, b) {
    const x = String(a).split("\n"), y = String(b).split("\n"), n = x.length, m = y.length;
    if (n * m > 160000) return [{ t: "note", s: "These versions are too long to compare line by line." }];
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) { if (x[i] === y[j]) { out.push({ t: "same", s: x[i] }); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: "del", s: x[i++] }); else out.push({ t: "add", s: y[j++] }); }
    while (i < n) out.push({ t: "del", s: x[i++] }); while (j < m) out.push({ t: "add", s: y[j++] });
    return out;
  }
  async function showVersions() {
    const d = st.draft;
    try {
      const { versions } = await D.api.get("/api/prompts/" + d.id + "/versions");
      D.modal.open("Version history", '<div class="ps-versions"><ul class="ps-vlist">' + versions.map((v) => '<li><button type="button" class="ps-vitem" data-ps-v="' + v.version + '"><strong>Version ' + v.version + (v.version === d.version ? " (current)" : "") + '</strong><span class="mg-muted">' + esc(M.dateTime(v.createdAt)) + (v.note ? " · " + esc(v.note) : "") + "</span></button></li>").join("") + '</ul><div id="psDiff" class="ps-diff" aria-live="polite"><p class="mg-muted">Select a version to compare it with the current text.</p></div></div>', '<button class="btn btn--outline" type="button" data-modal-close="true">Close</button>');
      document.querySelectorAll("[data-ps-v]").forEach((b) => b.addEventListener("click", () => {
        const v = versions.filter((x) => x.version === Number(b.getAttribute("data-ps-v")))[0];
        const rows = lineDiff(v.body, d.body);
        document.getElementById("psDiff").innerHTML = '<p><strong>Version ' + v.version + " compared with the current text</strong> <span class=\"mg-muted\">(− removed since, + added since)</span></p>" +
          '<pre class="ps-diffbox">' + rows.map((r) => '<span class="ps-d ps-d--' + r.t + '">' + (r.t === "add" ? "+ " : r.t === "del" ? "− " : "  ") + esc(r.s) + "</span>").join("\n") + "</pre>" +
          (v.version === d.version ? "" : '<button class="btn btn--primary btn--sm" type="button" id="psRestore">Restore version ' + v.version + " as a new version</button>");
        const rb = document.getElementById("psRestore");
        if (rb) rb.addEventListener("click", async () => {
          try { const p = await D.api.post("/api/prompts/" + d.id + "/versions/" + v.version + "/restore", {}); D.modal.close(); st.saved = asDraft(p); st.draft = asDraft(p); st.variants[0] = p.body; await loadList(); paint(); D.toast.show("Restored as version " + p.version, "success"); }
          catch (err) { D.toast.show(err.message || "Could not restore", "danger"); }
        });
      }));
    } catch (err) { D.toast.show(err.message || "Could not load the history", "danger"); }
  }
  async function showTemplates() {
    try {
      const { templates } = await D.api.get("/api/prompts/templates");
      const groups = CATS.map((c) => [c, templates.filter((t) => t.category === c[0])]).filter((g) => g[1].length);
      D.modal.open("Templates", '<div class="ps-templates">' + groups.map((g) => "<h3>" + g[0][1] + '</h3><ul class="ps-tlist">' + g[1].map((t) => '<li><div><strong>' + esc(t.title) + '</strong><p class="mg-muted">' + esc(t.description) + '</p></div><button type="button" class="btn btn--outline btn--sm" data-ps-use="' + esc(t.id) + '" aria-label="Use template: ' + esc(t.title) + '">Use</button></li>').join("") + "</ul>").join("") + "</div>", '<button class="btn btn--outline" type="button" data-modal-close="true">Close</button>');
      document.querySelectorAll("[data-ps-use]").forEach((b) => b.addEventListener("click", () => {
        const t = templates.filter((x) => x.id === b.getAttribute("data-ps-use"))[0];
        D.modal.close(); confirmDiscard(async () => { await loadModels(); startDraft({ title: t.title, category: t.category, description: t.description, body: t.body }); D.toast.show("Template loaded. Save it to keep your own copy.", "info"); });
      }));
    } catch (err) { D.toast.show(err.message || "Could not load templates", "danger"); }
  }

  // ------------------------------------------------------------------ wiring
  function bind() {
    root.querySelectorAll("[data-ps-new]").forEach((b) => b.addEventListener("click", () => confirmDiscard(async () => { await loadModels(); startDraft({}); })));
    root.querySelectorAll("[data-ps-templates]").forEach((b) => b.addEventListener("click", showTemplates));
    root.querySelectorAll("[data-ps-open]").forEach((b) => b.addEventListener("click", () => { const id = b.getAttribute("data-ps-open"); if (id !== st.selectedId) confirmDiscard(() => open(id)); }));
    let timer = null;
    document.getElementById("psSearch").addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(async () => { st.q = e.target.value.trim(); await loadList(); paint("psSearch"); }, 250); });
    root.querySelectorAll("[data-ps-cat]").forEach((b) => b.addEventListener("click", async () => { st.category = b.getAttribute("data-ps-cat"); st.favorite = false; await loadList(); paint(); }));
    root.querySelectorAll("[data-ps-fav]").forEach((b) => b.addEventListener("click", async () => { st.favorite = !st.favorite; if (st.favorite) st.category = ""; await loadList(); paint(); }));
    document.getElementById("psExport").addEventListener("click", async () => { try { M.download("darkness-prompts.json", JSON.stringify(await D.api.get("/api/prompts/export"), null, 2), "application/json"); D.toast.show("Prompts exported", "success"); } catch (e) { D.toast.show(e.message || "Export failed", "danger"); } });
    document.getElementById("psImport").addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
      if (f.size > 2000000) { D.toast.show("That file is too large to be a prompt export.", "danger"); return; }
      try { const r = await D.api.post("/api/prompts/import", JSON.parse(await f.text())); D.toast.show("Imported " + r.added + (r.skipped.length ? ", skipped " + r.skipped.length + " (duplicates or invalid)" : ""), r.added ? "success" : "warning"); await loadList(); paint(); }
      catch (err) { D.toast.show("Import failed: " + (err.message || "not a valid file"), "danger"); }
    });
    if (!st.draft) return;
    bindTest();
    const body = document.getElementById("psBody");
    body.addEventListener("input", () => { // live: counter, variables line and the unsaved badge, without losing focus
      st.draft.body = body.value; document.getElementById("psCount").textContent = body.value.length + " / 20000";
      const vars = parseVars(body.value);
      document.getElementById("psVarsInfo").innerHTML = vars.length ? "Variables: " + vars.map((v) => '<code class="ps-var">{{' + esc(v.name) + (v.def != null ? "|" + esc(v.def) : "") + "}}</code>").join(" ") : "Add variables like {{topic}} or {{tone|friendly}} (with a default) to reuse a prompt.";
      updateBadge();
      clearTimeout(varTimer);
      varTimer = setTimeout(() => { const sig = parseVars(st.mode === "compare" ? st.variants.join("\n") : body.value).map((v) => v.name).join(","); if (sig !== lastSig) renderTest(); }, 400);
    });
    ["psTitle", "psCat", "psDesc", "psTags"].forEach((id) => document.getElementById(id).addEventListener("input", () => { readForm(); updateBadge(); }));
    document.getElementById("psForm").addEventListener("submit", save);
    document.getElementById("psCopy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(document.getElementById("psBody").value); D.toast.show("Copied", "success"); } catch (e) { D.toast.show("Copy failed", "danger"); } });
    document.getElementById("psToChat").addEventListener("click", async () => {
      collectValues();
      try { const r = await D.api.post("/api/prompts/render", { body: document.getElementById("psBody").value, values: st.values }); sessionStorage.setItem("darkness_pending_prompt", r.rendered.slice(0, 8000)); try { D.store.remove("active_conversation"); } catch (e) {} window.location.hash = "#/chat"; }
      catch (err) { D.toast.show(err.message || "Fill in the variables first", "warning"); }
    });
    const fav = document.getElementById("psFav");
    if (fav) fav.addEventListener("click", async () => { try { const p = await D.api.patch("/api/prompts/" + st.draft.id, { favorite: !st.draft.favorite }); st.draft.favorite = p.favorite; st.saved.favorite = p.favorite; await loadList(); paint("psFav"); } catch (e) { D.toast.show(e.message || "Could not update", "danger"); } });
    const vb = document.getElementById("psVersions"); if (vb) vb.addEventListener("click", showVersions);
    const del = document.getElementById("psDelete");
    if (del) del.addEventListener("click", () => {
      D.modal.open("Delete this prompt?", "<p>\"" + esc(st.draft.title) + "\" and its version history will be permanently deleted.</p>", '<button class="btn btn--outline" type="button" data-modal-close="true">Cancel</button><button class="btn btn--danger-outline" id="psDelConfirm" type="button">Delete</button>');
      document.getElementById("psDelConfirm").addEventListener("click", async () => { try { await D.api.del("/api/prompts/" + st.draft.id); D.modal.close(); st.draft = null; st.saved = null; st.selectedId = null; await loadList(); paint(); D.toast.show("Prompt deleted", "success"); } catch (e) { D.toast.show(e.message || "Could not delete", "danger"); } });
    });
  }

  let varTimer = null, lastSig = "";
  /** The unsaved-changes badge is added or removed in place (a repaint while typing would move the caret). */
  function updateBadge() {
    const h = document.querySelector(".ps-editor__title");
    if (!h) return;
    const has = h.querySelector(".ix-badge");
    if (dirty() && !has) h.insertAdjacentHTML("beforeend", ' <span class="ix-badge ix-tone-warn" role="status">Unsaved changes</span>');
    else if (!dirty() && has) has.remove();
  }
  /** Re-render only the "Test it" section (the variable fields follow the prompt's variables) and bind it again. */
  function renderTest() {
    const el = document.querySelector(".ps-test");
    if (!el || !st.draft) return;
    collectValues();
    const vars = parseVars(document.getElementById("psBody").value);
    el.outerHTML = testHtml(vars);
    bindTest();
    if (st.results) fillAnswers();
  }
  function bindTest() {
    lastSig = parseVars(st.mode === "compare" ? st.variants.join("\n") : (document.getElementById("psBody") || { value: "" }).value).map((v) => v.name).join(",");
    root.querySelectorAll("[data-ps-mode]").forEach((b) => b.addEventListener("click", () => { collectValues(); readForm(); st.mode = b.getAttribute("data-ps-mode"); if (st.mode === "compare") st.variants[0] = st.draft.body; st.results = null; renderTest(); const t = document.getElementById(b.id); if (t) t.focus(); }));
    root.querySelectorAll("[data-ps-variant]").forEach((t) => t.addEventListener("input", () => { st.variants[Number(t.getAttribute("data-ps-variant"))] = t.value; clearTimeout(varTimer); varTimer = setTimeout(() => { const sig = parseVars(st.variants.join("\n")).map((v) => v.name).join(","); if (sig !== lastSig) renderTest(); }, 400); }));
    const add = document.getElementById("psAddVariant"); if (add) add.addEventListener("click", () => { st.variants = Array.from(root.querySelectorAll("[data-ps-variant]")).map((t) => t.value); st.variants.push(""); renderTest(); const t = document.getElementById("psVar2"); if (t) t.focus(); });
    const runBtn = document.getElementById("psRun"); if (runBtn) runBtn.addEventListener("click", run);
    const cancel = document.getElementById("psCancel"); if (cancel) cancel.addEventListener("click", () => { if (abortCtl) abortCtl.abort(); });
    root.querySelectorAll("[data-ps-copy-answer]").forEach((b) => b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(st.results[Number(b.getAttribute("data-ps-copy-answer"))].text); D.toast.show("Answer copied", "success"); } catch (e) { D.toast.show("Copy failed", "danger"); } }));
  }

  (async () => { try { await loadList(); } catch (e) { D.toast.show("Could not load prompts: " + (e.message || ""), "danger"); } paint(); })();
};
