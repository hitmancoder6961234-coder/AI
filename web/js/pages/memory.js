window.Darkness = window.Darkness || {};
window.Darkness.pages = window.Darkness.pages || {};

/**
 * Memory: short notes the user chose to keep, used in chats only when relevant. Nothing is saved automatically: notes come from this page,
 * from "Remember this" on a message (after an editable confirmation), or from an import. One switch turns the whole feature off.
 * Server: /api/memory (see server/memory-routes.ts). Everything here is scoped to the signed-in user.
 */
window.Darkness.pages.memory = function renderMemoryPage() {
  const D = window.Darkness, M = D.mg, esc = M.esc;
  const main = document.getElementById("main");
  if (!main) return;

  const CATS = [["preference", "Preference"], ["fact", "About me"], ["project", "Project"], ["style", "Writing style"], ["other", "Other"]];
  const catLabel = (c) => (CATS.filter((x) => x[0] === c)[0] || [c, c])[1];
  const state = { enabled: true, memories: [], category: "", q: "", limits: { maxLength: 500, maxMemories: 200 } };

  main.innerHTML =
    '<div class="page mg-page"><div class="page__inner" id="memRoot">' +
    '<header class="mg-head"><div><h1 class="mg-title">Memory</h1><p class="mg-sub">Notes Darkness keeps about you, only when you ask it to.</p></div></header>' + M.skeleton("list") + "</div></div>";
  const root = document.getElementById("memRoot");

  async function load() {
    const qs = {};
    if (state.category) qs.category = state.category;
    if (state.q.length >= 2) qs.q = state.q;
    const r = await D.api.get("/api/memory", qs);
    state.enabled = !!r.enabled; state.memories = r.memories || []; state.limits = r.limits || state.limits;
  }

  function itemHtml(m) {
    const used = m.useCount ? "used " + m.useCount + (m.useCount === 1 ? " time" : " times") + (m.lastUsedAt ? ", last " + M.ago(m.lastUsedAt) : "") : "not used yet";
    return '<li class="mem-item' + (m.enabled ? "" : " is-paused") + '" data-id="' + esc(m.id) + '">' +
      '<div class="mem-item__main"><p class="mem-item__text">' + esc(m.content) + "</p>" +
      '<p class="mem-item__meta"><span class="ix-badge ix-tone-accent">' + esc(catLabel(m.category)) + "</span>" +
      (m.always ? ' <span class="ix-badge ix-tone-info">Always use</span>' : "") + (m.enabled ? "" : ' <span class="ix-badge ix-tone-warn">Paused</span>') +
      ' <span class="mg-muted">' + esc(used) + (m.source === "chat" ? " · saved from a chat" : m.source === "import" ? " · imported" : "") + "</span></p></div>" +
      '<div class="mem-item__actions"><button class="btn btn--ghost btn--sm" type="button" data-mem-edit="' + esc(m.id) + '" aria-label="Edit memory: ' + esc(m.content.slice(0, 60)) + '">Edit</button>' +
      '<button class="btn btn--ghost btn--sm" type="button" data-mem-toggle="' + esc(m.id) + '" aria-pressed="' + (!m.enabled) + '" aria-label="' + (m.enabled ? "Pause" : "Resume") + " memory: " + esc(m.content.slice(0, 60)) + '">' + (m.enabled ? "Pause" : "Resume") + "</button>" +
      '<button class="btn btn--ghost btn--sm mem-danger" type="button" data-mem-delete="' + esc(m.id) + '" aria-label="Delete memory: ' + esc(m.content.slice(0, 60)) + '">Delete</button></div></li>';
  }

  function paint(keepFocus) {
    const max = state.limits.maxLength;
    root.innerHTML = [
      '<header class="mg-head"><div><h1 class="mg-title">Memory</h1><p class="mg-sub">Notes Darkness keeps about you, only when you ask it to.</p></div>',
      '<div class="mg-actions"><button class="btn btn--outline btn--sm" id="memExport" type="button">' + M.icon("download", 15) + " <span>Export</span></button>" +
        '<label class="btn btn--outline btn--sm" for="memImport">' + M.icon("plus", 15) + ' <span>Import</span></label><input id="memImport" type="file" accept="application/json,.json" class="sr-only"></div></header>',

      '<section class="mg-card mem-switch" aria-labelledby="memSwitchTitle"><div><h2 id="memSwitchTitle">Use my memory in chats</h2><p>' +
        (state.enabled ? "On: relevant notes are sent to the model with your question." : "Off: nothing is sent. Your notes are kept and can be turned back on.") + "</p></div>" +
        '<button type="button" class="mem-toggle" id="memToggle" role="switch" aria-checked="' + state.enabled + '" aria-labelledby="memSwitchTitle"><span class="mem-toggle__knob"></span></button></section>',

      '<section class="mg-card mem-how" aria-label="How memory works"><ul><li><strong>You decide.</strong> Nothing is saved automatically. Add notes here or use "Remember this" on a message.</li>' +
        "<li><strong>Only what is relevant.</strong> A note is sent only when it matches the question (or you marked it Always use), at most five at a time.</li>" +
        "<li><strong>Yours alone.</strong> Notes are private to your account, included in your data export, and removed when you delete your account.</li>" +
        "<li><strong>No secrets.</strong> Passwords, keys and e-mail addresses are refused.</li></ul></section>",

      '<form class="mg-card mem-add" id="memAdd" novalidate aria-labelledby="memAddTitle"><h2 id="memAddTitle">Add a memory</h2>' +
        '<label for="memText" class="label">What should Darkness remember?</label><textarea id="memText" class="input" rows="3" maxlength="' + max + '" aria-describedby="memCount memError" placeholder="e.g. I prefer short answers with examples"></textarea>' +
        '<p class="muted" id="memCount">0 / ' + max + "</p>" +
        '<div class="mem-add__row"><div><label for="memCat" class="label">Category</label><select id="memCat" class="input">' + CATS.map((c) => '<option value="' + c[0] + '"' + (c[0] === "other" ? " selected" : "") + ">" + c[1] + "</option>").join("") + "</select></div>" +
        '<label class="mem-check"><input type="checkbox" id="memAlways"> <span>Always use (send with every chat)</span></label>' +
        '<button type="submit" class="btn btn--primary" id="memSave" disabled>Save memory</button></div><p class="history-form-error" id="memError" role="alert" hidden></p></form>',

      '<section class="mg-card" aria-labelledby="memPreviewTitle"><h2 id="memPreviewTitle">What would be used?</h2><p class="mg-muted">Type a question to see which notes would be sent with it. Nothing is sent from here.</p>' +
        '<div class="mem-add__row"><div class="mem-grow"><label for="memQuery" class="sr-only">A question to test</label><input id="memQuery" class="input" type="text" maxlength="500" placeholder="e.g. Write a function in my favourite language"></div><button type="button" class="btn btn--outline" id="memPreview">Preview</button></div>' +
        '<div id="memPreviewOut" role="status" aria-live="polite"></div></section>',

      '<section aria-labelledby="memListTitle"><div class="ix-toolbar"><div class="mg-section"><h2 id="memListTitle">Your memories <span class="mg-muted">(' + state.memories.length + ")</span></h2></div>" +
        '<div class="mg-actions"><label for="memSearch" class="sr-only">Search memories</label><input id="memSearch" class="input" type="search" placeholder="Search" value="' + esc(state.q) + '">' +
        '<button class="btn btn--ghost btn--sm mem-danger" id="memDeleteAll" type="button"' + (state.memories.length ? "" : " disabled") + ">Delete all</button></div></div>" +
        '<div class="ix-chips" role="group" aria-label="Filter by category"><button type="button" class="ix-chip" data-cat="" aria-pressed="' + (!state.category) + '">All</button>' +
        CATS.map((c) => '<button type="button" class="ix-chip" data-cat="' + c[0] + '" aria-pressed="' + (state.category === c[0]) + '">' + c[1] + "</button>").join("") + "</div>" +
        '<p class="mg-muted" id="memStatus" role="status" aria-live="polite"></p>' +
        (state.memories.length ? '<ul class="mem-list">' + state.memories.map(itemHtml).join("") + "</ul>"
          : '<div class="mg-card"><div class="mg-empty">' + M.icon("sparkles", 28) + "<strong>" + (state.q || state.category ? "No memories match" : "No memories yet") + "</strong><p>" +
            (state.q || state.category ? "Try another filter." : "Add one above, or use \"Remember this\" on a message in a chat.") + "</p></div></div>") + "</section>",
    ].join("");
    bind();
    if (keepFocus) { const el = document.getElementById(keepFocus); if (el) { el.focus(); if (typeof el.value === "string" && el.setSelectionRange && /^(text|search)$/.test(el.type)) el.setSelectionRange(el.value.length, el.value.length); } }
  }

  function showError(msg) { const e = document.getElementById("memError"); if (e) { e.textContent = msg; e.hidden = !msg; } }
  async function refresh(focusId) { try { await load(); paint(focusId); } catch (e) { D.toast.show("Could not load memory: " + ((e && e.message) || ""), "danger"); } }

  function bind() {
    const text = document.getElementById("memText"), save = document.getElementById("memSave"), count = document.getElementById("memCount");
    text.addEventListener("input", () => { count.textContent = text.value.length + " / " + state.limits.maxLength; save.disabled = text.value.trim().length < 3; showError(""); });
    document.getElementById("memAdd").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (save.disabled) return;
      save.disabled = true; showError("");
      try {
        await D.api.post("/api/memory", { content: text.value, category: document.getElementById("memCat").value, always: document.getElementById("memAlways").checked });
        D.toast.show("Memory saved", "success");
        await refresh("memText");
      } catch (err) {
        showError(err.message || "Could not save");
        if (err.data && err.data.existing) showError((err.message || "") + ' Existing: "' + String(err.data.existing).slice(0, 120) + '"');
        save.disabled = false;
      }
    });
    document.getElementById("memToggle").addEventListener("click", async () => {
      try { await D.api.put("/api/memory/settings", { enabled: !state.enabled }); state.enabled = !state.enabled; paint("memToggle"); D.toast.show(state.enabled ? "Memory is on" : "Memory is off", "success"); }
      catch (err) { D.toast.show("Could not change the setting: " + (err.message || ""), "danger"); }
    });
    document.getElementById("memPreview").addEventListener("click", async () => {
      const out = document.getElementById("memPreviewOut"), q = document.getElementById("memQuery").value.trim();
      if (!q) { out.textContent = "Type a question first."; return; }
      try {
        const r = await D.api.post("/api/memory/preview", { query: q });
        out.innerHTML = !r.enabled ? "Memory is off, so nothing would be sent." : r.memories.length ? '<p class="mg-muted">These would be sent:</p><ul class="mem-preview">' + r.memories.map((m) => "<li>" + esc(m.content) + ' <span class="ix-badge ix-tone-accent">' + esc(catLabel(m.category)) + "</span></li>").join("") + "</ul>" : "No saved memory is relevant to that question, so nothing would be sent.";
      } catch (err) { out.textContent = err.message || "Preview failed"; }
    });
    let timer = null;
    document.getElementById("memSearch").addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value.trim(); refresh("memSearch"); }, 250); });
    root.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => { state.category = b.getAttribute("data-cat"); refresh(); }));

    root.querySelectorAll("[data-mem-toggle]").forEach((b) => b.addEventListener("click", async () => {
      const m = state.memories.filter((x) => x.id === b.getAttribute("data-mem-toggle"))[0];
      try { await D.api.patch("/api/memory/" + m.id, { enabled: !m.enabled }); await refresh(); } catch (err) { D.toast.show(err.message || "Could not update", "danger"); }
    }));
    root.querySelectorAll("[data-mem-delete]").forEach((b) => b.addEventListener("click", () => {
      const m = state.memories.filter((x) => x.id === b.getAttribute("data-mem-delete"))[0];
      D.modal.open("Delete this memory?", '<p>"' + esc(m.content) + '"</p><p class="muted">This cannot be undone.</p>',
        '<button class="btn btn--outline" type="button" data-modal-close="true">Cancel</button><button class="btn btn--danger-outline" id="memDelConfirm" type="button">Delete</button>');
      document.getElementById("memDelConfirm").addEventListener("click", async () => {
        try { await D.api.del("/api/memory/" + m.id); D.modal.close(); D.toast.show("Memory deleted", "success"); await refresh(); } catch (err) { D.toast.show(err.message || "Could not delete", "danger"); }
      });
    }));
    root.querySelectorAll("[data-mem-edit]").forEach((b) => b.addEventListener("click", () => {
      const m = state.memories.filter((x) => x.id === b.getAttribute("data-mem-edit"))[0];
      D.modal.open("Edit memory",
        '<div class="stack" style="gap:12px;"><div><label for="memEditText" class="label">Memory</label><textarea id="memEditText" class="input" rows="4" maxlength="' + state.limits.maxLength + '">' + esc(m.content) + "</textarea></div>" +
        '<div><label for="memEditCat" class="label">Category</label><select id="memEditCat" class="input">' + CATS.map((c) => '<option value="' + c[0] + '"' + (c[0] === m.category ? " selected" : "") + ">" + c[1] + "</option>").join("") + "</select></div>" +
        '<label class="mem-check"><input type="checkbox" id="memEditAlways"' + (m.always ? " checked" : "") + "> <span>Always use</span></label><p class=\"history-form-error\" id=\"memEditError\" role=\"alert\" hidden></p></div>",
        '<button class="btn btn--outline" type="button" data-modal-close="true">Cancel</button><button class="btn btn--primary" id="memEditSave" type="button">Save</button>');
      document.getElementById("memEditText").focus();
      document.getElementById("memEditSave").addEventListener("click", async () => {
        const err = document.getElementById("memEditError"); err.hidden = true;
        try {
          await D.api.patch("/api/memory/" + m.id, { content: document.getElementById("memEditText").value, category: document.getElementById("memEditCat").value, always: document.getElementById("memEditAlways").checked });
          D.modal.close(); D.toast.show("Memory updated", "success"); await refresh();
        } catch (e) { err.textContent = e.message || "Could not save"; err.hidden = false; }
      });
    }));
    document.getElementById("memDeleteAll").addEventListener("click", () => {
      D.modal.open("Delete all memories?", "<p>All " + state.memories.length + " notes will be permanently deleted.</p><p class=\"muted\">Your chats are not affected.</p>",
        '<button class="btn btn--outline" type="button" data-modal-close="true">Cancel</button><button class="btn btn--danger-outline" id="memDelAllConfirm" type="button">Delete all</button>');
      document.getElementById("memDelAllConfirm").addEventListener("click", async () => {
        try { await D.api.del("/api/memory?confirm=all"); D.modal.close(); D.toast.show("All memories deleted", "success"); await refresh(); } catch (err) { D.toast.show(err.message || "Could not delete", "danger"); }
      });
    });
    document.getElementById("memExport").addEventListener("click", async () => {
      try { const r = await D.api.get("/api/memory/export"); M.download("darkness-memory.json", JSON.stringify(r, null, 2), "application/json"); D.toast.show("Memory exported", "success"); }
      catch (err) { D.toast.show(err.message || "Export failed", "danger"); }
    });
    document.getElementById("memImport").addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = "";
      if (!f) return;
      if (f.size > 200000) { D.toast.show("That file is too large to be a memory export.", "danger"); return; }
      try {
        const data = JSON.parse(await f.text());
        const r = await D.api.post("/api/memory/import", { memories: Array.isArray(data) ? data : data.memories });
        D.toast.show("Imported " + r.added + (r.skipped.length ? ", skipped " + r.skipped.length + " (duplicates or invalid)" : ""), r.added ? "success" : "warning");
        await refresh();
      } catch (err) { D.toast.show("Import failed: " + (err.message || "not a valid file"), "danger"); }
    });
  }

  refresh();
};
