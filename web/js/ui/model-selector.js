window.Darkness = window.Darkness || {};

/**
 * Model selector.
 *
 * The list always comes from GET /api/models, which is backed by the server
 * model registry (env-configured models + the signed-in user's saved models).
 * There is no client-side fallback list: if the request fails the selector
 * reports the real error instead of inventing a model.
 */
window.Darkness.modelSelector = {
  _models: [],
  _active: null,
  _error: null,
  _containers: [],

  reset() {
    this._models = [];
    this._active = null;
    this._error = null;
  },

  async load() {
    try {
      const data = await window.Darkness.api.get("/api/models");
      this._models = data.models || [];
      this._active = data.active || null;
      this._error = null;
    } catch (err) {
      this._models = [];
      this._active = null;
      this._error = err.message || "Could not load models";
    }
    // Keep the chat's selection in step with the backend's stored selection.
    if (window.Darkness.uiChat) window.Darkness.uiChat.setModel(this._active, { persist: false });
    this._updateAllContainers();
    if (window.Darkness.uiTopbar) window.Darkness.uiTopbar.updateModelChip();
    return this._models;
  },

  all() {
    return this._models.slice();
  },

  error() {
    return this._error;
  },

  activeId() {
    return this._active;
  },

  getActive() {
    return this._models.find((m) => m.id === this._active) || null;
  },

  getModel(modelId) {
    return this._models.find((m) => m.id === modelId) || null;
  },

  /** Models the user may actually pick right now. */
  selectable() {
    return this._models.filter((m) => m.enabled !== false);
  },

  getCapabilities(modelId) {
    const model = this.getModel(modelId);
    return (model && model.capabilities) || {};
  },

  canHandle(modelId, capability) {
    return this.getCapabilities(modelId)[capability] === true;
  },

  async select(modelId) {
    if (!modelId) return false;
    const target = this.getModel(modelId);
    if (!target) {
      window.Darkness.toast.show("That model is no longer available", "danger");
      return false;
    }
    if (target.enabled === false) {
      window.Darkness.toast.show("Cannot select a disabled model", "danger");
      return false;
    }
    try {
      await window.Darkness.api.post("/api/models/set-active", { model_id: modelId });
    } catch (err) {
      window.Darkness.toast.show("Failed to select model: " + (err.message || ""), "danger");
      return false;
    }
    this._active = modelId;
    if (window.Darkness.uiChat) window.Darkness.uiChat.setModel(modelId);
    this._updateAllContainers();
    if (window.Darkness.uiTopbar) window.Darkness.uiTopbar.updateModelChip();
    window.Darkness.toast.show("Model switched to " + (target.name || modelId), "success");
    return true;
  },

  register(container) {
    if (container && !this._containers.includes(container)) {
      this._containers.push(container);
    }
  },

  renderChip(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const active = this.getActive();
    const escape = window.Darkness.utils.escapeHtml;

    if (!active) {
      const message = this._error ? "Models unavailable" : "Select a model";
      container.innerHTML =
        '<span class="model-chip__dot" style="background:var(--ink-faint);" aria-hidden="true"></span>' +
        '<span class="model-chip__name" id="modelChipLabel">' + escape(message) + '</span>' +
        '<svg class="model-chip__chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
      container.setAttribute("title", this._error || "No model selected");
      return;
    }

    const dotColor = active.status === "available" ? "#10b981"
      : active.status === "unavailable" ? "#ef4444"
      : "#f59e0b";
    container.innerHTML =
      '<span class="model-chip__dot" style="background:' + dotColor + ';" aria-hidden="true"></span>' +
      '<span class="model-chip__name" id="modelChipLabel">' + escape(active.name) + '</span>' +
      '<svg class="model-chip__chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
    container.setAttribute("title", active.name + " — " + (active.provider || "custom"));
  },

  renderDropdown(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    this.register(container);
    this._renderInto(container);
  },

  _updateAllContainers() {
    this._containers = this._containers.filter(c => document.body.contains(c));
    const dropdown = document.getElementById("modelSelectorDropdown");
    if (dropdown && !this._containers.includes(dropdown)) {
      this._containers.push(dropdown);
    }
    this._containers.forEach((c) => this._renderInto(c));
  },

  _renderInto(container) {
    if (!container) return;
    const escape = window.Darkness.utils.escapeHtml;

    if (this._error) {
      container.innerHTML =
        '<div class="model-empty">' + escape(this._error) +
        '<a class="model-empty__link" href="#/model">Open Model Management</a></div>';
      return;
    }

    const models = this.selectable();
    if (models.length === 0) {
      container.innerHTML =
        '<div class="model-empty">No enabled models yet.' +
        '<a class="model-empty__link" href="#/model">Add a model</a></div>';
      return;
    }

    const groups = new Map();
    models.forEach((m) => {
      const name = this._groupName(m);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(m);
    });

    const parts = [];
    ["Text", "Vision", "Code", "Image Generation", "Other"].forEach((group) => {
      const items = groups.get(group);
      if (!items || items.length === 0) return;
      parts.push('<div class="model-group-label">' + group + "</div>");
      items.forEach((m) => {
        const caps = [];
        if (m.capabilities?.text) caps.push("text");
        if (m.capabilities?.vision) caps.push("vision");
        if (m.capabilities?.codeGeneration) caps.push("code");
        if (m.capabilities?.imageGeneration) caps.push("image-gen");
        if (m.capabilities?.fileAnalysis) caps.push("files");
        const capsHtml = caps.length
          ? '<div class="model-caps">' + caps.map((c) => '<span class="tag tag--xxs">' + c + "</span>").join("") + "</div>"
          : "";
        parts.push(
          '<div class="model-option ' + (m.id === this._active ? "is-active" : "") + '" role="option" tabindex="0"' +
          ' aria-selected="' + (m.id === this._active) + '" data-model-id="' + escape(m.id) + '">' +
          '<div class="model-option__main">' +
          '<span class="model-option__name">' + escape(m.name) + "</span>" +
          '<div class="model-option__sub">' + escape(m.provider || "custom") + " • " +
          escape(String(m.contextWindow || "?")) + " ctx" +
          (m.status && m.status !== "available" ? " • " + escape(m.status) : "") + "</div>" +
          capsHtml +
          "</div>" +
          '<span class="tag tag--xs tag--muted">' + escape(m.provider || "custom") + "</span>" +
          "</div>"
        );
      });
    });

    container.innerHTML = parts.join("");
    container.querySelectorAll("[data-model-id]").forEach((el) => {
      const choose = () => {
        this.select(el.getAttribute("data-model-id"));
        this._closeDropdown();
      };
      el.addEventListener("click", choose);
      el.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          choose();
        }
      });
    });
  },

  _groupName(model) {
    const caps = model.capabilities || {};
    if (caps.imageGeneration) return "Image Generation";
    if (caps.vision) return "Vision";
    if (caps.codeGeneration) return "Code";
    if (caps.text) return "Text";
    return "Other";
  },

  _closeDropdown() {
    const el = document.getElementById("modelSelectorDropdown");
    if (el) {
      el.hidden = true;
      el.classList.remove("is-open");
    }
  },
};

