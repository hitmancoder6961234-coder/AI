/**
 * Project Studio - turn a project (code, documents or just an idea) into a professional report,
 * a presentation and illustrations.
 *
 *   1 Project  ->  2 Deliverables & prompts  ->  3 Brief & recommendations  ->  4 Outline  ->  5 Build
 *
 * All model-written text is inserted with textContent / escapeHtml; nothing from the model or from
 * uploaded files is ever interpreted as HTML.
 */
window.Darkness = window.Darkness || {};
window.Darkness.pages = window.Darkness.pages || {};

(function () {
  "use strict";
  const D = window.Darkness;
  const esc = (s) => D.utils.escapeHtml(String(s == null ? "" : s));
  const STEPS = ["Project", "Deliverables", "Brief", "Outline", "Build"];

  const fresh = () => ({
    step: 1,
    projects: [],
    project: null,
    catalog: null,
    mode: null,
    model: null,
    options: { audience: "college examiners and technical reviewers", purpose: "final year project report", tone: "formal", length: "standard", language: "English", author: "", institution: "", guidance: { report: { mode: "inbuilt", text: "" }, deck: { mode: "inbuilt", text: "" }, image: { mode: "inbuilt", text: "" } } },
    deliver: { report: true, formats: ["docx", "pdf"], deck: true, theme: "midnight", images: true, bundle: true, extraImages: [] },
    brief: null,
    answers: {},
    accepted: {},
    outline: null,
    recs: [],
    feedback: "",
    warnings: [],
    job: null,
    busy: false,
    error: "",
  });
  let S = fresh();
  let pollTimer = null;

  // ---- helpers ---------------------------------------------------------------------------------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const root = () => document.getElementById("builderRoot");

  async function api(method, path, body) {
    return method === "GET" ? D.api.get(path) : D.api.post(path, body);
  }

  async function download(path, name) {
    const headers = typeof D.api._getAuthHeaders === "function" ? D.api._getAuthHeaders() : {};
    const resp = await fetch(D.api._url(path), { credentials: "include", headers });
    if (!resp.ok) throw new Error("Download failed (" + resp.status + ")");
    const blob = await resp.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function toast(msg, kind) {
    if (D.toast && D.toast.show) D.toast.show(msg, kind || "info");
  }

  function stepper() {
    return '<ol class="bld-steps" aria-label="Progress">' + STEPS.map((n, i) => {
      const cls = i + 1 === S.step ? "is-current" : i + 1 < S.step ? "is-done" : "";
      return '<li class="bld-step ' + cls + '"' + (i + 1 === S.step ? ' aria-current="step"' : "") + '><span class="bld-step__n">' + (i + 1 < S.step ? "&#10003;" : i + 1) + "</span><span>" + n + "</span></li>";
    }).join("") + "</ol>";
  }

  function frame(inner) {
    root().innerHTML =
      '<div class="page"><div class="page__inner bld">' +
      '<header class="page__header"><div><h1 class="page__title">Project Studio</h1>' +
      '<p class="page__subtitle">Turn a project into a professional report, a presentation and illustrations - with prompts written for deep understanding.</p></div></header>' +
      stepper() +
      (S.mode === "offline" ? '<div class="bld-banner" role="note"><strong>Offline mode.</strong> No AI model is configured, so content is derived from your project\'s structure only. <a href="#/model">Add a model</a> for deeper writing.</div>' : "") +
      (S.error ? '<div class="bld-banner bld-banner--bad" role="alert">' + esc(S.error) + "</div>" : "") +
      inner +
      "</div></div>";
  }

  const busyBtn = (label) => '<span class="bld-spin" aria-hidden="true"></span> ' + esc(label);

  // ---- step 1: project -------------------------------------------------------------------------
  function viewProject() {
    const list = S.projects.length
      ? '<div class="bld-grid">' + S.projects.map((p) => '<button type="button" class="bld-card bld-card--pick ' + (S.project && S.project.id === p.id ? "is-selected" : "") + '" data-pick="' + esc(p.id) + '"><strong>' + esc(p.name) + "</strong><span>" + esc(p.fileCount != null ? p.fileCount + " files" : "project") + "</span></button>").join("") + "</div>"
      : '<p class="bld-muted">You have no projects yet. Create one on the right.</p>';
    frame(
      '<div class="bld-cols">' +
      '<section class="bld-panel"><h2>Use an existing project</h2>' + list + "</section>" +
      '<section class="bld-panel"><h2>Create a new one</h2>' +
      '<label class="bld-label" for="bldName">Project name</label><input class="input" id="bldName" maxlength="80" placeholder="e.g. Smart Waste Monitor" value="">' +
      '<div class="bld-tabs" role="tablist"><button type="button" role="tab" class="is-on" data-tab="files">Upload files</button><button type="button" role="tab" data-tab="github">GitHub</button><button type="button" role="tab" data-tab="idea">Describe an idea</button></div>' +
      '<div data-pane="files"><label class="bld-drop" id="bldDrop"><input type="file" id="bldFiles" multiple hidden><span>' + (D.icons && D.icons.upload || "") + '<b>Drop files or click to choose</b><small>Code, ZIP, PDF, Word, PowerPoint, Excel, Markdown, images and more (up to 100 MB each)</small></span></label><div id="bldPicked" class="bld-muted"></div></div>' +
      '<div data-pane="github" hidden><label class="bld-label" for="bldGh">Repository URL</label><input class="input" id="bldGh" placeholder="https://github.com/owner/repo"><small class="bld-muted">Public repositories only unless you add a token in the Projects page.</small></div>' +
      '<div data-pane="idea" hidden><label class="bld-label" for="bldIdea">What is the project about?</label><textarea class="input" id="bldIdea" rows="6" maxlength="6000" placeholder="Describe the problem, the solution, who it is for, what you built or plan to build..."></textarea></div>' +
      '<button type="button" class="btn btn--primary" id="bldCreate" style="margin-top:14px">Create and continue</button></section>' +
      "</div>" +
      '<div class="bld-actions"><span></span><button type="button" class="btn btn--primary" id="bldNext1" ' + (S.project ? "" : "disabled") + ">Continue</button></div>"
    );

    $$("[data-pick]").forEach((b) => b.addEventListener("click", () => {
      S.project = S.projects.find((p) => p.id === b.getAttribute("data-pick"));
      viewProject();
    }));
    const drop = $("#bldDrop");
    const input = $("#bldFiles");
    const picked = () => { const n = input.files ? input.files.length : 0; $("#bldPicked").textContent = n ? n + " file" + (n > 1 ? "s" : "") + " selected" : ""; };
    input.addEventListener("change", picked);
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-over"); }));
    drop.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files.length) { input.files = e.dataTransfer.files; picked(); } });
    $$(".bld-tabs button").forEach((t) => t.addEventListener("click", () => {
      $$(".bld-tabs button").forEach((x) => x.classList.toggle("is-on", x === t));
      $$("[data-pane]").forEach((p) => (p.hidden = p.getAttribute("data-pane") !== t.getAttribute("data-tab")));
    }));
    $("#bldNext1").addEventListener("click", () => { S.step = 2; S.error = ""; viewOptions(); });
    $("#bldCreate").addEventListener("click", createProject);
  }

  async function createProject() {
    const btn = $("#bldCreate");
    const name = $("#bldName").value.trim();
    const tab = $(".bld-tabs .is-on").getAttribute("data-tab");
    const files = $("#bldFiles").files;
    const gh = $("#bldGh").value.trim();
    const idea = $("#bldIdea").value.trim();
    if (tab !== "github" && !name) return toast("Give the project a name", "warning");
    if (tab === "files" && !files.length) return toast("Choose at least one file", "warning");
    if (tab === "github" && !/github\.com\/[^/]+\/[^/]+/i.test(gh)) return toast("Enter a GitHub repository URL", "warning");
    if (tab === "idea" && idea.length < 20) return toast("Describe the idea in a few sentences", "warning");
    btn.disabled = true;
    btn.innerHTML = busyBtn("Creating...");
    try {
      let project;
      if (tab === "files") {
        const fd = new FormData();
        const isZip = files.length === 1 && /\.zip$/i.test(files[0].name);
        if (isZip) { fd.append("file", files[0]); fd.append("name", name); }
        else { Array.from(files).forEach((f) => fd.append("files", f)); fd.append("name", name); fd.append("paths", JSON.stringify(Array.from(files).map((f) => f.webkitRelativePath || f.name))); }
        const r = await D.api.upload(isZip ? "/api/projects/upload-zip" : "/api/projects/upload-files", fd);
        project = r.project || { id: r.projectId, name };
      } else if (tab === "github") {
        const r = await D.api.post("/api/github/import", { repoUrl: gh, name: name || undefined });
        project = r.project || { id: r.projectId, name: name || gh };
      } else {
        const p = await D.api.post("/api/projects", { name });
        await D.api.post("/api/projects/" + encodeURIComponent(p.id) + "/files", { path: "IDEA.md", content: "# " + name + "\n\n" + idea + "\n" });
        project = p;
      }
      if (!project || !project.id) throw new Error("The server did not return a project");
      S.project = { id: project.id, name: project.name || name };
      S.projects = (await api("GET", "/api/builder/projects")).projects || S.projects;
      S.step = 2;
      S.error = "";
      viewOptions();
    } catch (e) {
      S.error = e.message || "Could not create the project";
      viewProject();
    }
  }

  // ---- step 2: deliverables and prompts --------------------------------------------------------
  function guidanceCard(key, title, hint) {
    const g = S.options.guidance[key];
    const inbuilt = (S.catalog && S.catalog.inbuilt && S.catalog.inbuilt[key]) || "";
    return (
      '<div class="bld-card bld-prompt" data-g="' + key + '"><h3>' + title + '</h3><p class="bld-muted">' + hint + "</p>" +
      '<div class="bld-radio"><label><input type="radio" name="g-' + key + '" value="inbuilt" ' + (g.mode === "inbuilt" ? "checked" : "") + '> <b>Darkness expert prompt</b> <span class="bld-tag">recommended</span></label>' +
      '<label><input type="radio" name="g-' + key + '" value="custom" ' + (g.mode === "custom" ? "checked" : "") + '> <b>My own prompt</b></label></div>' +
      '<details ' + (g.mode === "custom" ? "open" : "") + "><summary>" + (g.mode === "custom" ? "Edit your prompt" : "View the inbuilt prompt") + '</summary><textarea class="input bld-ta" rows="9" data-ta="' + key + '" ' + (g.mode === "custom" ? "" : "readonly") + ">" + esc(g.mode === "custom" ? g.text : inbuilt) + "</textarea>" +
      '<small class="bld-muted">Your prompt changes style and emphasis. Darkness always enforces its accuracy rules (no invented facts, cite real files) and the output format, so a custom prompt cannot break the result.</small></details></div>'
    );
  }

  function viewOptions() {
    const o = S.options;
    const d = S.deliver;
    const fmts = (S.catalog && S.catalog.reportFormats) || [{ id: "docx", label: "Word" }, { id: "pdf", label: "PDF" }];
    const themes = (S.catalog && S.catalog.themes) || [];
    const sel = (id, val, opts) => '<select class="input" id="' + id + '">' + opts.map((x) => '<option ' + (x === val ? "selected" : "") + ' value="' + esc(x) + '">' + esc(x) + "</option>").join("") + "</select>";
    frame(
      '<div class="bld-cols">' +
      '<section class="bld-panel"><h2>What do you want?</h2>' +
      '<label class="bld-check"><input type="checkbox" id="dReport" ' + (d.report ? "checked" : "") + '> <b>Report</b></label>' +
      '<div class="bld-chips" id="dFormats">' + fmts.map((f) => '<label class="bld-chip"><input type="checkbox" value="' + f.id + '" ' + (d.formats.includes(f.id) ? "checked" : "") + "><span>" + esc(f.label) + "</span></label>").join("") + "</div>" +
      '<label class="bld-check"><input type="checkbox" id="dDeck" ' + (d.deck ? "checked" : "") + '> <b>Presentation</b> <small class="bld-muted">(PowerPoint, with speaker notes)</small></label>' +
      '<div class="bld-themes" id="dThemes" role="radiogroup" aria-label="Presentation theme">' + themes.map((t) => '<button type="button" role="radio" aria-checked="' + (d.theme === t.id) + '" class="bld-theme ' + (d.theme === t.id ? "is-on" : "") + '" data-theme="' + t.id + '" style="--b:#' + t.bg + ";--a:#" + t.accent + '"><i></i>' + esc(t.name) + "</button>").join("") + "</div>" +
      '<label class="bld-check"><input type="checkbox" id="dImages" ' + (d.images ? "checked" : "") + '> <b>AI illustrations</b> <small class="bld-muted">(needs an image model on the server)</small></label>' +
      '<label class="bld-check"><input type="checkbox" id="dBundle" ' + (d.bundle ? "checked" : "") + '> Also give me everything as one ZIP</label>' +
      '<h3 style="margin-top:18px">Images from your own words</h3>' +
      '<div class="bld-row"><input class="input" id="imgWords" maxlength="300" placeholder="e.g. a glowing blood moon over a server room"><button type="button" class="btn btn--outline" id="imgGo">Preview</button></div>' +
      '<label class="bld-check"><input type="checkbox" id="imgEnhance" checked> Improve my words into a detailed prompt</label>' +
      '<div id="imgOut"></div><div id="imgList" class="bld-chips"></div></section>' +

      '<section class="bld-panel"><h2>Who is it for?</h2>' +
      '<label class="bld-label" for="oAudience">Audience</label><input class="input" id="oAudience" maxlength="160" value="' + esc(o.audience) + '">' +
      '<label class="bld-label" for="oPurpose">Purpose</label><input class="input" id="oPurpose" maxlength="160" value="' + esc(o.purpose) + '">' +
      '<div class="bld-row3"><div><label class="bld-label" for="oTone">Tone</label>' + sel("oTone", o.tone, ["formal", "plain", "persuasive"]) + '</div><div><label class="bld-label" for="oLength">Length</label>' + sel("oLength", o.length, ["concise", "standard", "detailed"]) + '</div><div><label class="bld-label" for="oLang">Language</label><input class="input" id="oLang" maxlength="40" value="' + esc(o.language) + '"></div></div>' +
      '<div class="bld-row3"><div><label class="bld-label" for="oAuthor">Author</label><input class="input" id="oAuthor" maxlength="120" value="' + esc(o.author) + '"></div><div style="grid-column:span 2"><label class="bld-label" for="oInst">Institution / company</label><input class="input" id="oInst" maxlength="160" value="' + esc(o.institution) + '"></div></div></section>' +
      "</div>" +

      '<section class="bld-panel"><h2>Prompts</h2><p class="bld-muted">Use the prompts Darkness wrote for deep understanding, or give your own. You can read and edit the inbuilt ones.</p><div class="bld-grid3">' +
      guidanceCard("report", "Report writing", "Depth, evidence, structure and language rules.") +
      guidanceCard("deck", "Presentation", "Story arc, slide craft and speaker notes.") +
      guidanceCard("image", "Images", "How your words become a precise image prompt.") +
      "</div></section>" +
      '<div class="bld-actions"><button type="button" class="btn btn--outline" id="bldBack">Back</button><button type="button" class="btn btn--primary" id="bldNext2">Analyse my project</button></div>'
    );
    wireOptions();
  }

  function readOptions() {
    const o = S.options;
    const d = S.deliver;
    o.audience = $("#oAudience").value.trim() || o.audience;
    o.purpose = $("#oPurpose").value.trim() || o.purpose;
    o.tone = $("#oTone").value;
    o.length = $("#oLength").value;
    o.language = $("#oLang").value.trim() || "English";
    o.author = $("#oAuthor").value.trim();
    o.institution = $("#oInst").value.trim();
    d.report = $("#dReport").checked;
    d.formats = $$("#dFormats input:checked").map((i) => i.value);
    d.deck = $("#dDeck").checked;
    d.images = $("#dImages").checked;
    d.bundle = $("#dBundle").checked;
    ["report", "deck", "image"].forEach((k) => {
      const mode = ($('input[name="g-' + k + '"]:checked') || {}).value || "inbuilt";
      const ta = $('[data-ta="' + k + '"]');
      S.options.guidance[k] = { mode: mode, text: mode === "custom" ? ta.value : "" };
    });
  }

  function wireOptions() {
    $("#bldBack").addEventListener("click", () => { readOptions(); S.step = 1; viewProject(); });
    $$(".bld-theme").forEach((b) => b.addEventListener("click", () => { S.deliver.theme = b.getAttribute("data-theme"); readOptions(); viewOptions(); }));
    ["report", "deck", "image"].forEach((k) => {
      const ta = $('[data-ta="' + k + '"]');
      $$('input[name="g-' + k + '"]').forEach((r) => r.addEventListener("change", () => {
        const custom = r.value === "custom" && r.checked;
        ta.readOnly = !custom;
        if (custom) { if (!S.options.guidance[k].text) ta.value = S.catalog.inbuilt[k]; ta.focus(); }
        else ta.value = S.catalog.inbuilt[k];
        ta.closest("details").open = true;
      }));
      ta.addEventListener("input", () => { S.options.guidance[k].text = ta.value; });
    });
    const renderExtra = () => {
      $("#imgList").innerHTML = S.deliver.extraImages.map((x, i) => '<span class="bld-chip is-on"><span>' + esc(x.caption || x.words) + '</span><button type="button" class="bld-x" data-rm="' + i + '" aria-label="Remove">&times;</button></span>').join("");
      $$("[data-rm]").forEach((b) => b.addEventListener("click", () => { S.deliver.extraImages.splice(Number(b.getAttribute("data-rm")), 1); renderExtra(); }));
    };
    renderExtra();
    $("#imgGo").addEventListener("click", async () => {
      const words = $("#imgWords").value.trim();
      if (words.length < 3) return toast("Describe the image in a few words", "warning");
      const btn = $("#imgGo");
      btn.disabled = true; btn.innerHTML = busyBtn("Creating...");
      readOptions();
      try {
        const r = await api("POST", "/api/builder/image", { words: words, enhance: $("#imgEnhance").checked, theme: S.deliver.theme, options: S.options });
        const out = $("#imgOut");
        out.innerHTML = '<figure class="bld-fig"><img alt="" src="' + esc(r.image) + '"><figcaption></figcaption></figure><details><summary>Prompt used</summary><p class="bld-muted" id="imgPrompt"></p></details><button type="button" class="btn btn--sm btn--secondary" id="imgAdd">Add to my package</button>';
        $("figcaption", out).textContent = r.caption;
        $("#imgPrompt").textContent = r.prompt;
        $("#imgAdd").addEventListener("click", () => { S.deliver.extraImages.push({ words: words, caption: r.caption }); out.innerHTML = ""; $("#imgWords").value = ""; renderExtra(); toast("Image added", "success"); });
      } catch (e) {
        toast(e.message || "Image generation failed", "danger");
      } finally {
        btn.disabled = false; btn.textContent = "Preview";
      }
    });
    $("#bldNext2").addEventListener("click", async () => {
      readOptions();
      if (!S.deliver.deck && !(S.deliver.report && S.deliver.formats.length)) return toast("Choose a report format or the presentation", "warning");
      const btn = $("#bldNext2");
      btn.disabled = true; btn.innerHTML = busyBtn("Analysing your project...");
      try {
        const r = await api("POST", "/api/builder/projects/" + encodeURIComponent(S.project.id) + "/brief", { options: S.options });
        S.brief = r.brief; S.mode = r.mode; S.model = r.model; S.warnings = r.warnings || [];
        S.recs = r.brief.recommendations || [];
        S.answers = {}; r.brief.questions.forEach((q) => (S.answers[q.id] = q.default || ""));
        S.step = 3; S.error = "";
        viewBrief();
      } catch (e) {
        S.error = e.message || "Could not analyse the project";
        viewOptions();
      }
    });
  }

  // ---- step 3: brief + recommendations ---------------------------------------------------------
  const impactTag = (i) => '<span class="bld-tag bld-tag--' + esc(i) + '">' + esc(i) + "</span>";

  function recList(recs) {
    return recs.length ? '<ul class="bld-recs">' + recs.map((r) => '<li><label><input type="checkbox" data-rec="' + esc(r.id) + '" ' + (S.accepted[r.id] ? "checked" : "") + "> <span>" + esc(r.text) + "</span> " + impactTag(r.impact) + "</label></li>").join("") + "</ul>" : '<p class="bld-muted">No recommendations.</p>';
  }
  function wireRecs() {
    $$("[data-rec]").forEach((c) => c.addEventListener("change", () => (S.accepted[c.getAttribute("data-rec")] = c.checked)));
  }

  function viewBrief() {
    const b = S.brief;
    const list = (a) => (a && a.length ? "<ul>" + a.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : '<p class="bld-muted">None found.</p>');
    frame(
      '<div class="bld-cols"><section class="bld-panel"><h2>' + esc(b.title) + "</h2><p><em>" + esc(b.oneLiner) + "</em></p><p>" + esc(b.summary) + "</p>" +
      "<h3>The problem</h3><p>" + esc(b.problem) + "</p><h3>The solution</h3><p>" + esc(b.solution) + "</p>" +
      "<h3>Key features</h3>" + (b.keyFeatures.length ? '<ul class="bld-feat">' + b.keyFeatures.map((f) => "<li><b>" + esc(f.name) + "</b> - " + esc(f.what) + (f.evidence.length ? ' <code>' + esc(f.evidence[0]) + "</code>" : "") + "</li>").join("") + "</ul>" : '<p class="bld-muted">None detected.</p>') +
      "<h3>Architecture</h3><p>" + esc(b.architecture) + "</p>" +
      "<h3>Technology</h3>" + (b.techStack.length ? '<table class="bld-table"><thead><tr><th>Layer</th><th>Technology</th><th>Used for</th></tr></thead><tbody>' + b.techStack.map((t) => "<tr><td>" + esc(t.layer) + "</td><td>" + esc(t.technology) + "</td><td>" + esc(t.why) + "</td></tr>").join("") + "</tbody></table>" : '<p class="bld-muted">None detected.</p>') +
      '<div class="bld-cols" style="margin-top:12px"><div><h3>Strengths</h3>' + list(b.strengths) + "</div><div><h3>Gaps to be honest about</h3>" + list(b.risksOrGaps) + "</div></div>" +
      (S.model ? '<p class="bld-muted">Written by ' + esc(S.model) + ".</p>" : "") + "</section>" +

      '<section class="bld-panel"><h2>A few questions</h2><p class="bld-muted">These change what is written. Skip any you like.</p>' +
      b.questions.map((q) => '<div class="bld-q"><label class="bld-label" for="q-' + esc(q.id) + '">' + esc(q.question) + '</label><small class="bld-muted">' + esc(q.why) + "</small>" +
        (q.options.length ? '<select class="input" id="q-' + esc(q.id) + '" data-q="' + esc(q.id) + '">' + q.options.map((o) => '<option ' + (S.answers[q.id] === o ? "selected" : "") + ' value="' + esc(o) + '">' + esc(o) + "</option>").join("") + '</select>' : "") +
        '<input class="input" data-qx="' + esc(q.id) + '" maxlength="300" placeholder="Or type your own answer"></div>').join("") +
      '<h2 style="margin-top:20px">Recommendations</h2><p class="bld-muted">Tick the ones you want built into the outline.</p>' + recList(S.recs) +
      '<label class="bld-label" for="bldFeedback">Anything else you want changed or added?</label><textarea class="input" id="bldFeedback" rows="3" maxlength="2000" placeholder="e.g. Add a section on the viva questions. Focus the report on security. Keep slides under 12.">' + esc(S.feedback) + "</textarea></section></div>" +
      (S.warnings.length ? '<ul class="bld-warn">' + S.warnings.map((w) => "<li>" + esc(w) + "</li>").join("") + "</ul>" : "") +
      '<div class="bld-actions"><button type="button" class="btn btn--outline" id="bldBack">Back</button><button type="button" class="btn btn--primary" id="bldNext3">Create the outline</button></div>'
    );
    wireRecs();
    $("#bldBack").addEventListener("click", () => { S.step = 2; viewOptions(); });
    $("#bldNext3").addEventListener("click", () => makeOutline(false));
  }

  function collectAnswers() {
    $$("[data-q]").forEach((s) => (S.answers[s.getAttribute("data-q")] = s.value));
    $$("[data-qx]").forEach((i) => { if (i.value.trim()) S.answers[i.getAttribute("data-qx")] = i.value.trim(); });
    const fb = $("#bldFeedback");
    if (fb) S.feedback = fb.value;
  }

  async function makeOutline(revise) {
    collectAnswers();
    const btn = $(revise ? "#bldRevise" : "#bldNext3");
    btn.disabled = true; btn.innerHTML = busyBtn(revise ? "Updating..." : "Designing the outline...");
    try {
      const accepted = S.recs.filter((r) => S.accepted[r.id]).map((r) => r.text);
      const r = await api("POST", "/api/builder/projects/" + encodeURIComponent(S.project.id) + "/outline", { options: S.options, brief: S.brief, answers: S.answers, acceptedRecommendations: accepted, feedback: S.feedback, previous: revise ? S.outline : null });
      S.outline = r.outline;
      S.recs = r.recommendations || [];
      S.accepted = {};
      if (revise) S.feedback = "";
      S.warnings = r.warnings || [];
      S.step = 4; S.error = "";
      viewOutline();
    } catch (e) {
      S.error = e.message || "Could not create the outline";
      (S.step === 4 ? viewOutline : viewBrief)();
    }
  }

  // ---- step 4: outline -------------------------------------------------------------------------
  function viewOutline() {
    const o = S.outline;
    const vis = (v) => (v && v !== "none" ? ' <span class="bld-tag">' + esc(v) + "</span>" : "");
    frame(
      '<div class="bld-cols"><section class="bld-panel"><h2>Report: ' + esc(o.report.title) + "</h2><ol class=\"bld-outline\">" +
      o.report.sections.map((s) => "<li><b>" + esc(s.title) + "</b>" + vis(s.visual) + "<br><span class=\"bld-muted\">" + esc(s.purpose) + "</span></li>").join("") + "</ol></section>" +
      '<section class="bld-panel"><h2>Presentation: ' + esc(o.deck.title) + "</h2><ol class=\"bld-outline\">" +
      o.deck.slides.map((s) => "<li><b>" + esc(s.title) + "</b>" + vis(s.visual && s.visual.kind) + (s.message ? '<br><span class="bld-muted">' + esc(s.message) + "</span>" : "") + "</li>").join("") + "</ol></section></div>" +
      '<section class="bld-panel"><h2>Want changes?</h2>' +
      (S.recs.length ? "<h3>Recommended</h3>" + recList(S.recs) : "") +
      '<label class="bld-label" for="bldFeedback">Tell Darkness what to change</label><textarea class="input" id="bldFeedback" rows="3" maxlength="2000" placeholder="e.g. Merge Testing and Security. Add a slide about deployment. Make the introduction shorter."></textarea>' +
      '<button type="button" class="btn btn--secondary" id="bldRevise" style="margin-top:10px">Update the outline</button></section>' +
      (S.warnings.length ? '<ul class="bld-warn">' + S.warnings.map((w) => "<li>" + esc(w) + "</li>").join("") + "</ul>" : "") +
      '<div class="bld-actions"><button type="button" class="btn btn--outline" id="bldBack">Back</button><button type="button" class="btn btn--primary" id="bldBuild">Looks good - build it</button></div>'
    );
    wireRecs();
    $("#bldBack").addEventListener("click", () => { S.step = 3; viewBrief(); });
    $("#bldRevise").addEventListener("click", () => {
      const fb = $("#bldFeedback").value.trim();
      const any = S.recs.some((r) => S.accepted[r.id]);
      if (!fb && !any) return toast("Write a change or tick a recommendation first", "warning");
      S.feedback = fb;
      makeOutline(true);
    });
    $("#bldBuild").addEventListener("click", startBuild);
  }

  // ---- step 5: build ---------------------------------------------------------------------------
  async function startBuild() {
    S.step = 5; S.error = ""; S.job = { state: "running", pct: 1, message: "Starting", log: [], files: [], warnings: [] };
    viewBuild();
    try {
      const d = S.deliver;
      const r = await api("POST", "/api/builder/projects/" + encodeURIComponent(S.project.id) + "/generate", {
        options: S.options, brief: S.brief, outline: S.outline,
        build: { theme: d.theme, reportFormats: d.report ? d.formats : [], deck: d.deck, images: d.images, extraImages: d.extraImages, bundle: d.bundle },
      });
      S.job.id = r.jobId;
      poll();
    } catch (e) {
      S.job = null; S.step = 4; S.error = e.message || "Could not start the build";
      viewOutline();
    }
  }

  function poll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (!document.getElementById("builderRoot") || S.step !== 5) return clearInterval(pollTimer);
      try {
        S.job = Object.assign(S.job, await api("GET", "/api/builder/jobs/" + encodeURIComponent(S.job.id)));
        viewBuild();
        if (S.job.state !== "running") clearInterval(pollTimer);
      } catch (e) {
        clearInterval(pollTimer);
        S.error = e.message || "Lost contact with the build";
        viewBuild();
      }
    }, 1200);
  }

  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  const KIND = { report: "Report", deck: "Presentation", image: "Image", bundle: "Everything (ZIP)", notes: "Prompts used" };

  function viewBuild() {
    const j = S.job || {};
    const running = j.state === "running";
    const files = (j.files || []).slice().sort((a, b) => ["bundle", "report", "deck", "image", "notes"].indexOf(a.kind) - ["bundle", "report", "deck", "image", "notes"].indexOf(b.kind));
    frame(
      '<section class="bld-panel"><h2>' + (running ? "Building your documents" : j.state === "done" ? "Your documents are ready" : j.state === "cancelled" ? "Build cancelled" : "The build stopped") + "</h2>" +
      '<div class="bld-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + (j.pct || 0) + '"><i style="width:' + (j.pct || 0) + '%"></i></div>' +
      '<p class="bld-muted" aria-live="polite">' + esc(j.message || "") + "</p>" +
      (running ? '<button type="button" class="btn btn--outline" id="bldCancel">Cancel</button>' : "") +
      (j.state === "done" ? '<div class="bld-files">' + files.map((f) => '<div class="bld-file"><div><b>' + esc(f.name.split("/").pop()) + "</b><small>" + esc(KIND[f.kind] || f.kind) + " &middot; " + kb(f.size) + '</small></div><button type="button" class="btn btn--sm btn--primary" data-dl="' + esc(f.name) + '">Download</button></div>').join("") + "</div>" : "") +
      (j.state === "done" && j.stats ? '<p class="bld-muted">' + esc(j.stats.sections) + " sections, " + esc(j.stats.slides) + " slides, " + esc(j.stats.images) + " images, about " + esc(j.stats.words) + " words (" + esc(j.stats.mode === "ai" ? "AI-written" : "offline") + ").</p>" : "") +
      (j.warnings && j.warnings.length ? '<ul class="bld-warn">' + j.warnings.map((w) => "<li>" + esc(w) + "</li>").join("") + "</ul>" : "") +
      (j.error ? '<div class="bld-banner bld-banner--bad">' + esc(j.error) + "</div>" : "") +
      "</section>" +
      '<div class="bld-actions"><button type="button" class="btn btn--outline" id="bldBackEdit"' + (running ? " disabled" : "") + '>Back to outline</button><button type="button" class="btn btn--secondary" id="bldAgain"' + (running ? " disabled" : "") + ">Start another project</button></div>"
    );
    $$("[data-dl]").forEach((b) => b.addEventListener("click", async () => {
      const name = b.getAttribute("data-dl");
      try { await download("/api/builder/jobs/" + encodeURIComponent(j.id) + "/file?name=" + encodeURIComponent(name), name.split("/").pop()); }
      catch (e) { toast(e.message, "danger"); }
    }));
    const c = $("#bldCancel");
    if (c) c.addEventListener("click", () => api("POST", "/api/builder/jobs/" + encodeURIComponent(j.id) + "/cancel", {}));
    const back = $("#bldBackEdit");
    if (back) back.addEventListener("click", () => { S.step = 4; viewOutline(); });
    const again = $("#bldAgain");
    if (again) again.addEventListener("click", () => { clearInterval(pollTimer); S = fresh(); D.pages.builder(); });
  }

  // ---- entry -----------------------------------------------------------------------------------
  D.pages.builder = async function renderBuilderPage() {
    const main = document.getElementById("main");
    if (!main) return;
    main.innerHTML = '<div id="builderRoot"></div>';
    try {
      const [cat, proj] = await Promise.all([api("GET", "/api/builder/prompts"), api("GET", "/api/builder/projects")]);
      S.catalog = cat;
      S.projects = proj.projects || [];
    } catch (e) {
      S.error = e.message || "Could not load the Project Studio";
    }
    if (S.project && !S.projects.some((p) => p.id === S.project.id)) S.project = null;
    const views = { 1: viewProject, 2: viewOptions, 3: viewBrief, 4: viewOutline, 5: viewBuild };
    if (S.step > 1 && !S.project) S.step = 1;
    (views[S.step] || viewProject)();
  };
})();
