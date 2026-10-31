window.Clarity = window.Clarity || {};
window.Clarity.pages = window.Clarity.pages || {};

const MODEL_PROVIDERS = (window.Clarity && window.Clarity.providers && window.Clarity.providers.PROVIDERS) || [
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

window.Clarity.pages.model = async function renderModelPage(path) {
  console.log("[MODEL PAGE] Mount: renderModelPage invoked for path:", path);
  const main = document.getElementById("main");
  if (!main) return;

  let models = [];
  let activeId = null;
  let loadError = null;
  try {
    console.log("[MODEL PAGE] Fetching GET /api/models...");
    const data = await window.Clarity.api.get("/api/models");
    console.log("[MODEL PAGE] GET /api/models returned:", data);
    models = Array.isArray(data) ? data : (data.models || []);
    activeId = data.active || (window.Clarity.modelSelector && window.Clarity.modelSelector._active);
    
    // Sync modelSelector internal cache if present
    if (window.Clarity.modelSelector) {
      window.Clarity.modelSelector._models = models;
      if (activeId) window.Clarity.modelSelector._active = activeId;
    }
  } catch (err) {
    console.error("[MODEL PAGE] Failed to load models from /api/models:", err);
    loadError = err.message || "Failed to load models";
  }

  const sortedModels = models.slice().sort((a, b) => {
    if (a.id === activeId) return -1;
    if (b.id === activeId) return 1;
    return (a.name || "").localeCompare(b.name || "");
  });
  window.Clarity.pages._modelCache = sortedModels;

  main.innerHTML = [
    '<div class="page"><div class="page__inner">',
    '<header class="page__header">',
    '<div><h1 class="page__title">Model Management</h1>',
    '<p class="page__subtitle">Configure AI models. Each model is a real, complete provider configuration used by the backend for every request.</p></div>',
    '<div class="hstack" style="gap:8px;">',
    '<button class="btn btn--ghost btn--sm" id="refreshModelsBtn" type="button" title="Refresh models" aria-label="Refresh models">',
    '<svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
    ' Refresh</button>',
    '<button class="btn btn--primary" id="addModelBtn" type="button">',
    '<svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px;"><path d="M12 5v14M5 12h14"/></svg>',
    ' Add Models</button>',
    '</div></header>',
    loadError ? '<div class="alert alert--danger">' + window.Clarity.utils.escapeHtml(loadError) + '</div>' : '',
    '<section class="model-grid">',
    sortedModels.length === 0 ? '<div class="empty-state">No models configured. Click "Add Models" to add your first one.</div>' : '',
    sortedModels.map(modelCardHtml).join(""),
    '</section>',
    '</div></div>'
  ].join("");

  bindModelPageEvents();
};

function statusBadge(model) {
  const enabled = model.enabled !== false;
  if (!enabled) return '<span class="tag tag--muted">Disabled</span>';
  const s = model.status || "untested";
  if (s === "available") return '<span class="tag tag--ok">Available</span>';
  if (s === "unavailable") return '<span class="tag tag--danger">Unavailable</span>';
  if (s === "auth_error") return '<span class="tag tag--danger">Auth Error</span>';
  if (s === "rate_limit") return '<span class="tag tag--warn">Rate Limited</span>';
  if (s === "config_error") return '<span class="tag tag--danger">Config Error</span>';
  return '<span class="tag tag--muted">Untested</span>';
}

function modelCardHtml(model) {
  const isActive = model.is_active || model.id === (window.Clarity.modelSelector && window.Clarity.modelSelector._active);
  const caps = model.capabilities || {};
  const capTags = [];
  if (caps.text) capTags.push('<span class="tag tag--xs">Text</span>');
  if (caps.vision) capTags.push('<span class="tag tag--xs">Vision</span>');
  if (caps.codeGeneration) capTags.push('<span class="tag tag--xs">Code</span>');
  if (caps.imageGeneration) capTags.push('<span class="tag tag--xs">Image</span>');
  if (caps.fileAnalysis) capTags.push('<span class="tag tag--xs">Files</span>');
  if (caps.streaming) capTags.push('<span class="tag tag--xs">Stream</span>');

  const isUserModel = true;
  const enabled = model.enabled !== false;
  const lastTested = model.lastTestedAt ? new Date(model.lastTestedAt * 1000).toLocaleString() : null;
  const lastErr = model.lastError ? '<div class="muted" style="font-size:12px;color:var(--color-danger,#c0392b);margin-top:4px;">' + window.Clarity.utils.escapeHtml(model.lastError) + '</div>' : '';

  const formattedCtx = model.contextWindow
    ? (Number(model.contextWindow) >= 1000000
        ? (Number(model.contextWindow) / 1000000).toFixed(Number(model.contextWindow) % 1000000 === 0 ? 0 : 1) + "M"
        : (Number(model.contextWindow) >= 1000
            ? Math.round(Number(model.contextWindow) / 1000) + "k"
            : model.contextWindow)) + " ctx"
    : "? ctx";

  return '<article class="card model-card ' + (isActive ? "is-active" : "") + ' ' + (enabled ? "" : "is-disabled") + '" data-model-id="' + escapeAttr(model.id) + '">' +
    '<div class="card__body">' +
      '<div class="model-card__head">' +
        '<h3>' + window.Clarity.utils.escapeHtml(model.name) + '</h3>' +
        '<span class="tag">' + window.Clarity.utils.escapeHtml(model.provider || "custom") + '</span>' +
        statusBadge(model) +
      '</div>' +
      '<div class="model-card__body">' +
        '<div class="muted">Registry ID: <code>' + window.Clarity.utils.escapeHtml(model.id) + '</code></div>' +
        '<div class="muted">Provider Model: <code>' + window.Clarity.utils.escapeHtml(model.modelName || model.id) + '</code></div>' +
        (model.baseUrl ? '<div class="muted">Base URL: <code>' + window.Clarity.utils.escapeHtml(model.baseUrl) + '</code></div>' : '') +
      '</div>' +
      '<div class="model-card__meta">' + capTags.join("") + '</div>' +
      (lastTested ? '<div class="muted" style="font-size:12px;">Last tested: ' + window.Clarity.utils.escapeHtml(lastTested) + '</div>' : '') +
      lastErr +
      '<div class="model-card__foot">' +
        '<span class="muted" title="' + (model.contextWindow ? Number(model.contextWindow).toLocaleString() + ' tokens max context' : '') + '">' + formattedCtx + '</span>' +
        '<div class="hstack" style="gap:6px;">' +
          (isUserModel ? '<button class="btn btn--ghost btn--sm" type="button" data-action="toggle-enabled" data-model-id="' + escapeAttr(model.id) + '" title="' + (enabled ? "Disable" : "Enable") + '">' + (enabled ? "Disable" : "Enable") + '</button>' : '') +
          '<button class="btn btn--' + (isActive ? "primary" : "outline") + ' btn--sm" type="button" data-action="select" data-model-id="' + escapeAttr(model.id) + '"' + (enabled ? "" : " disabled") + '>' + (isActive ? "Active" : "Select") + '</button>' +
          (isUserModel ? '<button class="btn btn--ghost btn--icon-sm" type="button" data-action="edit" data-model-id="' + escapeAttr(model.id) + '" title="Edit" aria-label="Edit model">' +
            '<svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>' +
          '</button>' : '') +
          (isUserModel ? '<button class="btn btn--ghost btn--icon-sm" type="button" data-action="delete" data-model-id="' + escapeAttr(model.id) + '" title="Delete" aria-label="Delete model">' +
            '<svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>' +
          '</button>' : '') +
        '</div>' +
      '</div>' +
    '</div>' +
  '</article>';
}

function bindModelPageEvents() {
  document.getElementById("addModelBtn")?.addEventListener("click", () => openAddModelsModal());
  document.getElementById("refreshModelsBtn")?.addEventListener("click", () => {
    if (window.Clarity.modelSelector) window.Clarity.modelSelector.load();
    window.Clarity.app.navigate("#/model");
  });

  document.querySelectorAll('[data-action="select"]').forEach(btn => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      const id = btn.getAttribute("data-model-id");
      await window.Clarity.modelSelector.select(id);
      window.Clarity.app.navigate("#/model");
    });
  });
  document.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-model-id");
      let model = (window.Clarity.pages._modelCache || []).find(m => m.id === id) ||
                  (window.Clarity.modelSelector && window.Clarity.modelSelector.getModel(id));
      if (!model) {
        try {
          const res = await window.Clarity.api.get("/api/models/" + encodeURIComponent(id));
          model = res;
        } catch (e) {}
      }
      openModelModal(model);
    });
  });
  document.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-model-id");
      const modalBody = '<div style="font-size: 13.5px; line-height: 1.5; color: var(--ink);">Delete model <strong>' + window.Clarity.utils.escapeHtml(id) + '</strong>? Existing conversations will remain intact.</div>';
      const modalActions = `
        <button class="btn btn--outline" type="button" data-modal-close="true">Cancel</button>
        <button class="btn btn--danger" id="confirmDeleteModelBtn" type="button">Delete Model</button>
      `;
      window.Clarity.modal.open('Delete Model?', modalBody, modalActions);

      document.getElementById('confirmDeleteModelBtn')?.addEventListener('click', async () => {
        window.Clarity.modal.close();
        try {
          await window.Clarity.api.del("/api/models/" + encodeURIComponent(id));
          window.Clarity.toast.show("Model deleted", "success");
          if (window.Clarity.modelSelector) await window.Clarity.modelSelector.load();
          window.Clarity.app.navigate("#/model");
        } catch (err) {
          window.Clarity.toast.show("Delete failed: " + (err.message || ""), "danger");
        }
      }, { once: true });
    });
  });
  document.querySelectorAll('[data-action="toggle-enabled"]').forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-model-id");
      const willEnable = btn.textContent.trim() === "Enable";
      try {
        await window.Clarity.api.post("/api/models/" + encodeURIComponent(id) + "/enable", { enabled: willEnable });
        window.Clarity.toast.show(willEnable ? "Model enabled" : "Model disabled", "success");
        if (window.Clarity.modelSelector) await window.Clarity.modelSelector.load();
        window.Clarity.app.navigate("#/model");
      } catch (err) {
        window.Clarity.toast.show("Update failed: " + (err.message || ""), "danger");
      }
    });
  });
}

function getCanonicalProviders() {
  if (window.Clarity && window.Clarity.providers && Array.isArray(window.Clarity.providers.PROVIDERS)) {
    return window.Clarity.providers.PROVIDERS;
  }
  return MODEL_PROVIDERS;
}

function getProviderConfig(providerId) {
  if (window.Clarity && window.Clarity.providers && typeof window.Clarity.providers.getProvider === "function") {
    const p = window.Clarity.providers.getProvider(providerId);
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
  const defaultBaseForInitial = window.Clarity.providers?.getDefaultBaseUrl(initialProvider) || "";
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
    ? '<div class="muted" style="margin-top:4px;">Current key on file: <code>' + window.Clarity.utils.escapeHtml(m.apiKeyMasked || '••••••') + '</code></div>'
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
            '<div class="muted">Local identifier; unique key in Clarity.</div>',
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

  window.Clarity.modal.open(isEdit ? "Edit model" : "Add model", body, actions);

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
      const res = await window.Clarity.api.post("/api/models/test", payload);
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
          await window.Clarity.api.post("/api/models/set-active", { model_id: payload.id });
        } catch (e) {}
        if (window.Clarity.modelSelector) await window.Clarity.modelSelector.load();
        window.Clarity.app.navigate("#/model");
        window.Clarity.modal.close();
        window.Clarity.toast.show("Model verified — status: Available", "success");
      }
    } catch (err) {
      showTestResult("✗ Test failed: " + (err.message || ""), false);
    }
  });

  document.getElementById("modelSaveBtn")?.addEventListener("click", async () => {
    const payload = collectEditModelForm();
    if (!payload.id || !payload.modelName) {
      window.Clarity.toast.show("Registry ID and Provider Model ID are required", "danger");
      return;
    }
    const prov = getProviderConfig(payload.provider);
    if (!payload.baseUrl && prov?.defaultBase) {
      payload.baseUrl = prov.defaultBase;
    }
    try {
      if (isEdit) {
        await window.Clarity.api.put("/api/models/" + encodeURIComponent(existing.id), payload);
        try {
          await window.Clarity.api.post("/api/models/set-active", { model_id: payload.id });
        } catch (e) {}
      } else {
        await window.Clarity.api.post("/api/models", payload);
        try {
          await window.Clarity.api.post("/api/models/set-active", { model_id: payload.id });
        } catch (e) {}
      }

      window.Clarity.toast.show(isEdit ? "Model updated and set active" : "Model added and set active", "success");
      if (window.Clarity.modelSelector) await window.Clarity.modelSelector.load();
      window.Clarity.modal.close();
      window.Clarity.app.navigate("#/model");
    } catch (err) {
      window.Clarity.toast.show("Save failed: " + (err.message || ""), "danger");
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

  window.Clarity.modal.open("Add Models", body, actions);

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
        await window.Clarity.api.post("/api/models", payload);
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
          await window.Clarity.api.post("/api/models/set-active", { model_id: firstSuccessId });
        } catch (e) {}
      }
      window.Clarity.toast.show(successCount + " model(s) added and set active" + (failCount > 0 ? " (" + failCount + " failed)" : ""), failCount > 0 ? "warning" : "success");
      if (window.Clarity.modelSelector) await window.Clarity.modelSelector.load();
      window.Clarity.modal.close();
      window.Clarity.app.navigate("#/model");
    } else {
      showAddModelsResultNew("Failed to add models:\n" + errors.join("\n"), false);
    }
  });
}

function createModelMappingHTML(index, mapping, provObj) {
  const removeBtn = index === 0
    ? ''
    : '<button type="button" class="btn btn--ghost btn--sm" onclick="removeModelMapping(' + index + ')" style="margin-left:auto;">Remove</button>';

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
