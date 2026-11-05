window.Darkness = window.Darkness || {};
window.Darkness.pages = window.Darkness.pages || {};

/**
 * Settings: appearance, models, account and local data, laid out like the other management pages. Every control applies
 * at once (no Save button) and the active choice is always visible.
 */
function segmented(label, attr, items) {
  const esc = window.Darkness.utils.escapeHtml;
  return '<div class="mg-seg" role="radiogroup" aria-label="' + esc(label) + '">' +
    items.map((it) => '<button type="button" role="radio" aria-checked="false" class="mg-seg__opt" data-' + attr + '="' + it.value + '">' + esc(it.label) + '</button>').join("") +
    "</div>";
}

function settingRow(title, hint, control) {
  const esc = window.Darkness.utils.escapeHtml;
  return '<div class="mg-setrow"><div class="mg-setrow__txt"><strong>' + esc(title) + "</strong><span>" + esc(hint) + '</span></div><div class="mg-setrow__ctl">' + control + "</div></div>";
}

window.Darkness.pages.settings = function renderSettingsPage() {
  const D = window.Darkness;
  const M = D.mg;
  const main = document.getElementById("main");
  if (!main) return;

  const atmo = window.DarknessAtmosphere;
  const atmoLabels = { classic: "Classic", blood: "Blood Moon", water: "Deep Water" };
  const atmoModes = atmo && atmo.modes ? atmo.modes : [];

  main.innerHTML = [
    '<div class="page mg-page"><div class="page__inner page__inner--narrow" id="mgSettings">',
    '<header class="mg-head"><div><h1 class="mg-title">Settings</h1><p class="mg-sub">How the workspace looks, which model answers, and what is stored on this device.</p></div></header>',

    '<article class="mg-card" style="--i:0"><header class="mg-card__head"><div><h2>Appearance</h2><p>Changes apply straight away on this device.</p></div></header><div class="mg-set">',
      settingRow("Theme", "System follows your operating system.", segmented("Theme", "theme", [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }])),
      settingRow("Density", "Compact fits more on screen.", segmented("Density", "density", [{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }])),
      atmoModes.length ? settingRow("Atmosphere", "Classic is the plain interface. Blood Moon and Deep Water add an animated background.", segmented("Atmosphere", "atmo", atmoModes.map((id) => ({ value: id, label: atmoLabels[id] || id })))) : "",
    "</div></article>",

    '<article class="mg-card" style="--i:1"><header class="mg-card__head"><div><h2>Models</h2><p>Providers and the model that answers your chats.</p></div></header><div class="mg-set">',
      settingRow("Active model", "Switch, test, add or remove models on the Models page.", '<span class="mg-chip" id="mgsModel"><i></i>Loading…</span><a class="btn btn--outline btn--sm" href="#/model">' + M.icon("cpu", 15) + " <span>Manage models</span></a>"),
    "</div></article>",

    '<article class="mg-card" style="--i:2"><header class="mg-card__head"><div><h2>Account and usage</h2><p>Your profile, devices and how much you use the workspace.</p></div></header><div class="mg-links">',
      '<a class="mg-row" href="#/account"><span class="mg-row__ico">' + M.icon("user", 17) + '</span><span class="mg-row__main"><span class="mg-row__title">Account</span><span class="mg-row__sub">Name, password, signed-in devices</span></span><span class="mg-row__go">' + M.icon("arrow", 16) + "</span></a>",
      '<a class="mg-row" href="#/usage"><span class="mg-row__ico">' + M.icon("chart", 17) + '</span><span class="mg-row__main"><span class="mg-row__title">Usage</span><span class="mg-row__sub">Activity and model share</span></span><span class="mg-row__go">' + M.icon("arrow", 16) + "</span></a>",
    "</div></article>",

    '<article class="mg-card" style="--i:3"><header class="mg-card__head"><div><h2>Local data</h2><p>Stored in this browser only. Your account data on the server is not touched.</p></div></header><div class="mg-set">',
      settingRow("Reset local preferences", "Clears theme, density, atmosphere and cached attachments, then reloads. You stay signed in.", '<button class="btn btn--outline btn--sm btn--danger-outline" id="resetLocalBtn" type="button">' + M.icon("refresh", 15) + " <span>Reset</span></button>"),
    "</div></article>",
    "</div></div>",
  ].join("");

  const root = document.getElementById("mgSettings");
  const themeBtns = root.querySelectorAll(".mg-seg__opt[data-theme]");
  const densityBtns = root.querySelectorAll(".mg-seg__opt[data-density]");
  const atmoBtns = root.querySelectorAll(".mg-seg__opt[data-atmo]");

  const mark = (btns, attr, value) => btns.forEach((b) => {
    const on = b.getAttribute("data-" + attr) === value;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-checked", String(on));
  });
  const refresh = () => {
    const s = D.settings ? D.settings.get() : {};
    mark(themeBtns, "theme", s.theme || "light");
    mark(densityBtns, "density", s.density || "comfortable");
    mark(atmoBtns, "atmo", atmo ? atmo.get() : "classic");
  };
  refresh();

  themeBtns.forEach((btn) => btn.addEventListener("click", () => {
    const v = btn.getAttribute("data-theme");
    D.settings.applyTheme(v);
    D.theme.setMode(v);
    D.toast.show("Theme set to " + v.charAt(0).toUpperCase() + v.slice(1), "success");
    refresh();
  }));
  densityBtns.forEach((btn) => btn.addEventListener("click", () => {
    const v = btn.getAttribute("data-density");
    D.settings.set({ density: v });
    document.documentElement.setAttribute("data-density", v);
    D.toast.show("Density set to " + v, "success");
    refresh();
  }));
  atmoBtns.forEach((btn) => btn.addEventListener("click", () => {
    const v = btn.getAttribute("data-atmo");
    if (atmo) atmo.set(v);
    D.toast.show((atmoLabels[v] || v) + " atmosphere on", "success");
    refresh();
  }));

  // The active model: from the selector's memory if it has it, otherwise from the shared cache, otherwise one quick load.
  const chip = document.getElementById("mgsModel");
  const showModel = (name, count) => {
    if (!chip || !chip.isConnected) return;
    chip.className = "mg-chip" + (name ? " mg-chip--ok" : "");
    chip.innerHTML = "<i></i>" + M.esc(name ? name + (count > 1 ? " · " + count + " models" : "") : count ? "No model selected" : "No models yet");
  };
  const fromSelector = D.modelSelector && D.modelSelector.getActive && D.modelSelector.getActive();
  if (fromSelector) showModel(fromSelector.name || fromSelector.id, (D.modelSelector.all() || []).length);
  M.load("models", D.pages.modelData).then((d) => {
    const a = d.models.find((m) => m.id === d.active);
    showModel(a ? a.name || a.id : "", d.models.length);
  }).catch(() => { if (!fromSelector && chip) { chip.className = "mg-chip"; chip.innerHTML = "<i></i>Unavailable"; } });

  const reset = document.getElementById("resetLocalBtn");
  if (reset) reset.addEventListener("click", () => {
    D.modal.open("Reset local preferences?", '<div style="font-size:13.5px;line-height:1.5;color:var(--ink);">This clears the preferences stored in this browser and reloads the page. You will stay signed in and nothing on the server changes.</div>',
      '<button class="btn btn--outline" type="button" data-modal-close="true">Cancel</button><button class="btn btn--danger" id="confirmResetBtn" type="button">Reset</button>');
    const go = document.getElementById("confirmResetBtn");
    if (go) go.addEventListener("click", () => {
      D.modal.close();
      try {
        // Keep the sign-in itself (token + cached profile); everything else is a preference or a cache.
        const keep = ["auth_token", "darkness_token", "darkness_user"];
        Object.keys(localStorage).filter((k) => keep.indexOf(k) < 0).forEach((k) => localStorage.removeItem(k));
        D.toast.show("Local preferences cleared. Reloading…", "success");
        setTimeout(() => window.location.reload(), 600);
      } catch (e) {
        D.toast.show("Could not clear local preferences", "danger");
      }
    }, { once: true });
  });
};
