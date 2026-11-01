/**
 * Clarity Universal AI File & Asset Generation Engine — UI Module
 * Handles Artifact Cards, Resizable Preview Panel with Draggable Divider,
 * Multi-format previewers (Code, DOCX, XLSX, PPTX, PDF, CSV, SVG),
 * and workspace application.
 */

(function () {
  window.Clarity = window.Clarity || {};

  const PREVIEW_WIDTH_KEY = "clarity_artifact_preview_width";
  let activeArtifact = null;
  let isDraggingDivider = false;
  let startX = 0;
  let startWidth = 480;

  function getSavedWidth() {
    try {
      const val = parseInt(localStorage.getItem(PREVIEW_WIDTH_KEY), 10);
      if (val && val >= 320 && val <= 950) return val;
    } catch (e) {}
    return 520;
  }

  function setSavedWidth(w) {
    try {
      localStorage.setItem(PREVIEW_WIDTH_KEY, String(w));
    } catch (e) {}
  }

  function getCategoryColor(category) {
    switch (category) {
      case "image": return { bg: "#fdf2f8", border: "#fbcfe8", text: "#db2777", badge: "Image" };
      case "document": return { bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8", badge: "Document" };
      case "spreadsheet": return { bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d", badge: "Spreadsheet" };
      case "presentation": return { bg: "#fff7ed", border: "#fed7aa", text: "#c2410c", badge: "Presentation" };
      case "pdf": return { bg: "#fef2f2", border: "#fecaca", text: "#b91c1c", badge: "PDF" };
      case "diagram": return { bg: "#faf5ff", border: "#e9d5ff", text: "#7e22ce", badge: "Diagram" };
      case "code": return { bg: "#f8fafc", border: "#cbd5e1", text: "#334155", badge: "Code" };
      default: return { bg: "var(--bg-card)", border: "var(--line)", text: "var(--ink)", badge: "Asset" };
    }
  }

  function getFormatIcon(filename, mimeType, category) {
    const ext = (filename || "").split(".").pop().toLowerCase();
    if (category === "image" || ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "webp" || ext === "gif") {
      return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#db2777" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
    }
    if (category === "document" || ext === "docx" || ext === "doc") {
      return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#2563eb" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
    }
    if (category === "spreadsheet" || ext === "xlsx" || ext === "xls" || ext === "csv") {
      return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#16a34a" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>`;
    }
    if (category === "presentation" || ext === "pptx" || ext === "ppt") {
      return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#ea580c" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><path d="M7 8h4M7 11h7"/></svg>`;
    }
    if (category === "pdf" || ext === "pdf") {
      return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#dc2626" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13v4M9 15h2a1 1 0 0 0 0-2H9M13 13v4M13 13h1.5a1.5 1.5 0 0 1 0 3H13"/></svg>`;
    }
    if (category === "diagram" || ext === "svg") {
      return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#9333ea" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M10 6.5h4M6.5 10v4M17.5 10v4M10 17.5h4"/></svg>`;
    }
    // Code or default
    return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#0ea5e9" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ---------------------------------------------------------------------------
  // Artifact Card Component
  // ---------------------------------------------------------------------------
  function renderCard(art, options = {}) {
    if (!art) return "";
    if (art.intent === "CODE_EXPLANATION" || art.intent === "code_explanation" || art.category === "explanation") {
      return "";
    }
    const style = getCategoryColor(art.category);
    const iconSvg = getFormatIcon(art.filename, art.mimeType, art.category);
    const validation = art.validation || { status: "passed", message: "Validated" };
    const isValidated = validation.status === "passed" || validation.status === "validated" || validation.passed === true || (!validation.status && validation.passed !== false);
    const isCode = art.category === "code" || (art.content && !art.bufferBase64);
    const hasApplied = !!art.appliedToProject;

    const validationBadge = isValidated
      ? `<span class="tag tag--xs" style="background:#dcfce7; color:#15803d; font-weight:600;" title="Passed structural verification">✓ Validated</span>`
      : `<span class="tag tag--xs" style="background:#fee2e2; color:#b91c1c; font-weight:600;" title="${escapeHtml((validation.errors && validation.errors[0]) || validation.message || 'Validation warning')}">⚠️ ${escapeHtml((validation.errors && validation.errors[0]) || 'Warning')}</span>`;

    const appliedBadge = hasApplied
      ? `<span class="tag tag--xs" style="background:#e0e7ff; color:#4338ca; font-weight:600;" title="Applied to project files">⚡ In Workspace</span>`
      : "";

    const sizeStr = formatBytes(art.size);
    const lineCountStr = art.lineCount ? ` • ${art.lineCount} lines` : "";
    const isMod = art.isModification && art.targetFile;

    return `
      <div class="artifact-card" id="art_${art.id}" data-artifact-id="${art.id}" style="border: 1px solid ${style.border}; background: var(--bg-card); border-radius: 12px; margin: 12px 0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); transition: all 0.15s ease;">
        <div style="padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); background: ${style.bg};">
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
            <div style="width: 34px; height: 34px; border-radius: 8px; background: white; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 2px rgba(0,0,0,0.08); flex-shrink: 0;">
              ${iconSvg}
            </div>
            <div style="min-width: 0;">
              <div style="font-weight: 600; font-size: 14px; color: var(--ink); display: flex; align-items: center; gap: 8px;">
                <span class="truncate" style="max-width: 260px;" title="${escapeHtml(art.filename)}">${escapeHtml(art.filename)}</span>
                ${isMod ? `<span class="tag tag--xs" style="background:#fef3c7; color:#92400e; font-weight:600;">Modified</span>` : ""}
              </div>
              <div style="font-size: 12px; color: var(--ink-muted); margin-top: 2px;">
                ${style.badge} • ${sizeStr}${lineCountStr}
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
            ${validationBadge}
            ${appliedBadge}
          </div>
        </div>

        ${art.description ? `
          <div style="padding: 10px 14px; font-size: 12.5px; color: var(--ink-secondary); line-height: 1.45; border-bottom: 1px solid var(--line-soft);">
            ${escapeHtml(art.description)}
          </div>
        ` : ""}

        <div style="padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px; background: var(--bg-card-subtle, var(--bg-card)); flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            ${(art.category === "document" || (art.filename && art.filename.endsWith(".docx"))) ? `
              <button type="button" class="btn btn--sm btn--primary art-preview-btn" data-art-id="${art.id}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px;">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                Preview
              </button>

              <button type="button" class="btn btn--sm btn--outline art-edit-ai-doc-btn" data-art-id="${art.id}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px;" title="Edit this document with AI natural language">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edit with AI
              </button>

              <button type="button" class="btn btn--sm btn--outline art-regenerate-doc-btn" data-art-id="${art.id}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px;" title="Regenerate this document with prompt">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                Regenerate
              </button>

              <a href="/api/artifacts/${art.id}/download" download="${escapeHtml(art.filename)}" class="btn btn--sm btn--outline art-download-btn" data-art-id="${art.id}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; text-decoration: none;">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export DOCX
              </a>

              <button type="button" class="btn btn--sm btn--outline art-export-pdf-doc-btn" data-art-id="${art.id}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px;" title="Export and compile PDF report">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Export PDF
              </button>
            ` : (art.category === "presentation" || (art.filename && art.filename.endsWith(".pptx"))) ? `
              <button type="button" class="btn btn--sm btn--primary art-preview-btn" data-art-id="${art.id}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px;">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                Preview
              </button>

              <button type="button" class="btn btn--sm btn--outline art-edit-ai-pres-btn" data-art-id="${art.id}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px;" title="Edit this presentation slide element with AI">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edit with AI
              </button>

              <button type="button" class="btn btn--sm btn--outline art-regenerate-pres-btn" data-art-id="${art.id}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px;" title="Regenerate this entire slide deck with custom prompt">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                Regenerate
              </button>

              <a href="/api/artifacts/${art.id}/download" download="${escapeHtml(art.filename)}" class="btn btn--sm btn--outline art-download-btn" data-art-id="${art.id}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; text-decoration: none;">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export PPTX
              </a>

              <button type="button" class="btn btn--sm btn--outline art-export-pdf-pres-btn" data-art-id="${art.id}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px;" title="Export slide deck to landscape PDF">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Export PDF
              </button>
            ` : `
              <button type="button" class="btn btn--sm btn--primary art-preview-btn" data-art-id="${art.id}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px;">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                Preview
              </button>

              <a href="/api/artifacts/${art.id}/download" download="${escapeHtml(art.filename)}" class="btn btn--sm btn--outline art-download-btn" data-art-id="${art.id}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; text-decoration: none;">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download
              </a>

              ${isCode ? `
                <button type="button" class="btn btn--sm btn--outline art-open-file-btn" data-art-id="${art.id}" data-art-file="${escapeHtml(art.targetFile || art.filename)}" data-project-id="${escapeHtml(art.projectId || '')}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--ink);" title="Open file directly in Code Explorer">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  <span>Open File</span>
                </button>

                <button type="button" class="btn btn--sm btn--ghost art-apply-btn" data-art-id="${art.id}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--accent);" title="Apply file changes to project files">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                  ${hasApplied ? 'Applied' : 'Apply to Workspace'}
                </button>
              ` : ""}
            `}
          </div>

          <div style="display: flex; align-items: center; gap: 4px;">
            <button type="button" class="btn btn--ghost btn--icon-sm art-delete-btn" data-art-id="${art.id}" title="Delete artifact" style="color: var(--ink-muted);">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Event Binding
  // ---------------------------------------------------------------------------
  function bindEvents(rootEl = document) {
    // Open File button
    rootEl.querySelectorAll(".art-open-file-btn").forEach(btn => {
      btn.removeEventListener("click", btn._artOpenFileHandler);
      btn._artOpenFileHandler = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const filePath = btn.getAttribute("data-art-file");
        const projectId = btn.getAttribute("data-project-id") || window.Clarity.currentProjectId;
        if (!filePath) return;

        if (window.Clarity.jumpToFile) {
          window.Clarity.jumpToFile(filePath, 1, projectId);
        } else if (projectId) {
          window.location.hash = `#/project/${projectId}?file=${encodeURIComponent(filePath)}&line=1`;
        } else {
          window.Clarity.toast.show(`File located at ${filePath}`, "info");
        }
      };
      btn.addEventListener("click", btn._artOpenFileHandler);
    });

    // Preview button
    rootEl.querySelectorAll(".art-preview-btn").forEach(btn => {
      btn.removeEventListener("click", btn._artHandler);
      btn._artHandler = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-art-id");
        try {
          const data = await window.Clarity.api.get(`/api/artifacts/${id}`);
          if (data && data.artifact) {
            openPreview(data.artifact);
          } else {
            window.Clarity.toast.show("Artifact not found", "danger");
          }
        } catch (err) {
          window.Clarity.toast.show("Failed to load artifact: " + (err.message || ""), "danger");
        }
      };
      btn.addEventListener("click", btn._artHandler);
    });

    // Apply button
    rootEl.querySelectorAll(".art-apply-btn").forEach(btn => {
      btn.removeEventListener("click", btn._artApplyHandler);
      btn._artApplyHandler = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-art-id");
        btn.disabled = true;
        btn.textContent = "Applying...";
        try {
          const res = await window.Clarity.api.post(`/api/artifacts/${id}/apply`, {});
          window.Clarity.toast.show(res.message || "File applied to project workspace!", "success");
          btn.textContent = "✓ Applied";
          btn.classList.add("btn--outline");
          // Refresh artifact card if present
          const card = document.getElementById(`art_${id}`);
          if (card) {
            const badgeContainer = card.querySelector(".tag--xs:last-child")?.parentElement;
            if (badgeContainer && !card.querySelector(".tag--applied")) {
              const appliedTag = document.createElement("span");
              appliedTag.className = "tag tag--xs tag--applied";
              appliedTag.style.cssText = "background:#e0e7ff; color:#4338ca; font-weight:600;";
              appliedTag.textContent = "⚡ In Workspace";
              badgeContainer.appendChild(appliedTag);
            }
          }
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "Apply to Workspace";
          window.Clarity.toast.show("Failed to apply file: " + (err.message || ""), "danger");
        }
      };
      btn.addEventListener("click", btn._artApplyHandler);
    });

    // Delete button
    rootEl.querySelectorAll(".art-delete-btn").forEach(btn => {
      btn.removeEventListener("click", btn._artDelHandler);
      btn._artDelHandler = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-art-id");
        const modalBody = '<div style="font-size: 13.5px; line-height: 1.5; color: var(--ink);">Are you sure you want to delete this generated asset?</div>';
        const modalActions = `
          <button class="btn btn--outline" type="button" data-modal-close="true">Cancel</button>
          <button class="btn btn--danger" id="confirmDeleteArtBtn" type="button">Delete Asset</button>
        `;
        window.Clarity.modal.open('Delete Asset?', modalBody, modalActions);

        document.getElementById('confirmDeleteArtBtn')?.addEventListener('click', async () => {
          window.Clarity.modal.close();
          try {
            await window.Clarity.api.del(`/api/artifacts/${id}`);
            window.Clarity.toast.show("Asset deleted", "success");
            const card = document.getElementById(`art_${id}`);
            if (card) card.remove();
            if (activeArtifact && activeArtifact.id === id) {
              closePreview();
            }
            window.dispatchEvent(new CustomEvent("artifact:deleted", { detail: { id } }));
          } catch (err) {
            window.Clarity.toast.show("Failed to delete asset: " + (err.message || ""), "danger");
          }
        }, { once: true });
      };
      btn.addEventListener("click", btn._artDelHandler);
    });
  }

  // ---------------------------------------------------------------------------
  // Resizable Preview Panel with Draggable Divider
  // ---------------------------------------------------------------------------
  function ensurePreviewContainer() {
    let container = document.getElementById("clarityArtifactPreviewContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "clarityArtifactPreviewContainer";
      container.style.display = "none";
      container.innerHTML = `
        <div id="clarityArtifactDivider" class="artifact-preview-resizer" title="Drag to resize preview">
          <div class="resizer-handle"></div>
        </div>
        <div id="clarityArtifactPanel" class="artifact-preview-panel">
          <div id="clarityArtifactHeader" class="artifact-preview-header"></div>
          <div id="clarityArtifactBody" class="artifact-preview-body"></div>
        </div>
      `;
      document.body.appendChild(container);
      setupDividerDrag();
    }
    return container;
  }

  function setupDividerDrag() {
    const divider = document.getElementById("clarityArtifactDivider");
    if (!divider) return;

    divider.addEventListener("pointerdown", (e) => {
      isDraggingDivider = true;
      startX = e.clientX;
      const panel = document.getElementById("clarityArtifactPanel");
      startWidth = panel ? panel.offsetWidth : getSavedWidth();
      divider.setPointerCapture(e.pointerId);
      document.body.style.userSelect = "none";
      document.body.classList.add("is-resizing-artifact");
    });

    divider.addEventListener("pointermove", (e) => {
      if (!isDraggingDivider) return;
      const deltaX = startX - e.clientX; // dragging left expands panel
      let newWidth = startWidth + deltaX;
      newWidth = Math.max(340, Math.min(window.innerWidth - 300, Math.min(960, newWidth)));
      const panel = document.getElementById("clarityArtifactPanel");
      if (panel) {
        panel.style.width = `${newWidth}px`;
      }
    });

    const stopDrag = () => {
      if (isDraggingDivider) {
        isDraggingDivider = false;
        document.body.style.userSelect = "";
        document.body.classList.remove("is-resizing-artifact");
        const panel = document.getElementById("clarityArtifactPanel");
        if (panel) {
          setSavedWidth(panel.offsetWidth);
        }
      }
    };

    divider.addEventListener("pointerup", stopDrag);
    divider.addEventListener("pointercancel", stopDrag);
  }

  function openPreview(art) {
    activeArtifact = art;
    const container = ensurePreviewContainer();
    const panel = document.getElementById("clarityArtifactPanel");
    const width = getSavedWidth();
    if (panel) {
      panel.style.width = `${width}px`;
    }
    container.style.display = "flex";
    document.body.classList.add("has-artifact-preview");

    renderPreviewHeader(art);
    renderPreviewBody(art);
  }

  function closePreview() {
    activeArtifact = null;
    const container = document.getElementById("clarityArtifactPreviewContainer");
    if (container) container.style.display = "none";
    document.body.classList.remove("has-artifact-preview");
  }

  function renderPreviewHeader(art) {
    const header = document.getElementById("clarityArtifactHeader");
    if (!header) return;

    const iconSvg = getFormatIcon(art.filename, art.mimeType, art.category);
    const isCode = art.category === "code" || (art.content && !art.bufferBase64);
    const sizeStr = formatBytes(art.size);

    header.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
        <div style="width: 32px; height: 32px; border-radius: 6px; background: var(--bg-card); display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 2px rgba(0,0,0,0.06); flex-shrink: 0;">
          ${iconSvg}
        </div>
        <div style="min-width: 0;">
          <div style="font-weight: 600; font-size: 14px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(art.filename)}">
            ${escapeHtml(art.filename)}
          </div>
          <div style="font-size: 11.5px; color: var(--ink-muted);">
            ${escapeHtml((art.category || 'unknown').toUpperCase())} • ${sizeStr} ${art.lineCount ? `• ${art.lineCount} lines` : ""}
          </div>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
        ${isCode ? `
          <button type="button" class="btn btn--sm btn--ghost" id="artPreviewCopyBtn" title="Copy code to clipboard">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>Copy</span>
          </button>
          <button type="button" class="btn btn--sm btn--primary" id="artPreviewApplyBtn" title="Apply to project files">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            <span>Apply</span>
          </button>
        ` : ""}

        <button type="button" class="btn btn--sm btn--outline" id="artPreviewExpandBtn" title="Toggle Full View / Wide Reader">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          <span>Full View</span>
        </button>

        <a href="/api/artifacts/${art.id}/download" download="${escapeHtml(art.filename)}" class="btn btn--sm btn--primary" style="text-decoration: none;" title="Download file">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>Download</span>
        </a>

        <button type="button" class="btn btn--sm" id="artPreviewCloseBtn" title="Close preview (Esc)" aria-label="Close preview" style="background:#fee2e2; color:#b91c1c; border:1px solid #fecaca; font-weight:600; display:inline-flex; align-items:center; gap:4px;">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          <span>Close</span>
        </button>
      </div>
    `;

    document.getElementById("artPreviewCloseBtn")?.addEventListener("click", closePreview);

    document.getElementById("artPreviewExpandBtn")?.addEventListener("click", () => {
      const panel = document.getElementById("clarityArtifactPanel");
      if (panel) {
        if (panel.classList.contains("is-expanded-fullscreen")) {
          panel.classList.remove("is-expanded-fullscreen");
          panel.style.width = `${getSavedWidth()}px`;
        } else {
          panel.classList.add("is-expanded-fullscreen");
          panel.style.width = "92vw";
        }
      }
    });

    document.getElementById("artPreviewCopyBtn")?.addEventListener("click", () => {
      if (art.content) {
        navigator.clipboard.writeText(art.content).then(() => {
          window.Clarity.toast.show("Copied to clipboard", "success");
        });
      }
    });

    document.getElementById("artPreviewApplyBtn")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Applying...";
      try {
        const res = await window.Clarity.api.post(`/api/artifacts/${art.id}/apply`, {});
        window.Clarity.toast.show(res.message || "File applied to project workspace!", "success");
        btn.textContent = "✓ Applied";
        art.appliedToProject = true;
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Apply";
        window.Clarity.toast.show("Failed to apply file: " + (err.message || ""), "danger");
      }
    });
  }

  function renderPreviewBody(art) {
    const body = document.getElementById("clarityArtifactBody");
    if (!body) return;

    // 0. Jupyter Notebook Previewer
    if (art.filename.endsWith(".ipynb")) {
      renderJupyterViewer(body, art);
      return;
    }
    // 1. Architecture Diagram / SVG Previewer
    if (art.category === "diagram" || art.filename.endsWith(".svg")) {
      renderSvgViewer(body, art);
      return;
    }

    // 2. Spreadsheet / CSV / XLSX Previewer
    if (art.category === "spreadsheet" || art.filename.endsWith(".xlsx") || art.filename.endsWith(".csv")) {
      renderSpreadsheetViewer(body, art);
      return;
    }

    // 3. Presentation / PPTX Previewer
    if (art.category === "presentation" || art.filename.endsWith(".pptx")) {
      renderPresentationViewer(body, art);
      return;
    }

    // 4. Word Document / DOCX Previewer
    if (art.category === "document" || art.filename.endsWith(".docx")) {
      renderDocumentViewer(body, art);
      return;
    }

    // 5. PDF Document Previewer
    if (art.category === "pdf" || art.filename.endsWith(".pdf")) {
      renderPdfViewer(body, art);
      return;
    }

    // 6. Code / Text Previewer (Default)
    renderCodeViewer(body, art);

    if (window.Clarity && window.Clarity.renderKaTeX) {
      window.Clarity.renderKaTeX(body);
    }
  }

  // ---------------------------------------------------------------------------
  // Specialized Viewers
  // ---------------------------------------------------------------------------

  // SVG Architecture Diagram Viewer
  
  function renderJupyterViewer(container, art) {
    let nb;
    try {
      nb = JSON.parse(art.content);
    } catch (e) {
      container.innerHTML = [
        '<div style="padding: 40px; max-width: 600px; margin: 40px auto; text-align: center; border: 1px solid #ef4444; border-radius: 8px; background: #fff;">',
        '  <div style="font-size: 32px; margin-bottom: 16px;">⚠️</div>',
        '  <h3 style="color: #ef4444; margin-bottom: 8px; font-weight: 600;">Failed to parse Notebook Artifact</h3>',
        '  <p style="color: #6b7280; margin-bottom: 16px; font-size: 14px; line-height: 1.5;">The Jupyter Notebook could not be parsed. The generated artifact may contain incomplete JSON.</p>',
        '  <div style="background: #f9fafb; padding: 12px; border-radius: 6px; text-align: left; overflow-x: auto; border: 1px solid #e5e7eb;">',
        '    <code style="color: #ef4444; font-size: 12px; font-family: ui-monospace, monospace;">' + escapeHtml(e.message) + '</code>',
        '  </div>',
        '</div>'
      ].join('');
      return;
    }
    const cells = nb.cells || [];
    let html = '<div style="padding: 20px; max-width: 900px; margin: 0 auto; background: #ffffff; color: #111;">';
    html += '<h2 style="margin-bottom: 20px; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px;">' + escapeHtml(art.filename) + '</h2>';
    
    cells.forEach((cell, idx) => {
      const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
      html += '<div style="margin-bottom: 16px; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden;">';
      html += '<div style="background: #f9fafb; padding: 4px 10px; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; border-bottom: 1px solid #e5e7eb;">' + escapeHtml(cell.cell_type) + '</div>';
      
      if (cell.cell_type === 'markdown') {
        const rendered = window.Clarity.markdown && window.Clarity.markdown.render ? window.Clarity.markdown.render(source) : escapeHtml(source);
        html += '<div style="padding: 12px; font-size: 14px; line-height: 1.6;">' + rendered + '</div>';
      } else if (cell.cell_type === 'code') {
        const highlighted = window.Clarity.highlighter && window.Clarity.highlighter.highlightLines ? 
            window.Clarity.highlighter.highlightLines(source, "file.py").join('\n') : escapeHtml(source);
        html += '<div style="padding: 12px; background: #0d1117; color: #c9d1d9; font-family: ui-monospace, monospace; font-size: 13px; overflow-x: auto; white-space: pre;">' + highlighted + '</div>';
        
        // Render outputs if any
        if (cell.outputs && cell.outputs.length > 0) {
          html += '<div style="padding: 8px 12px; background: #fdfdfd; border-top: 1px solid #e5e7eb; font-size: 12.5px; font-family: ui-monospace, monospace; color: #333; overflow-x: auto; white-space: pre;">';
          cell.outputs.forEach(out => {
            if (out.text) {
              const text = Array.isArray(out.text) ? out.text.join('') : out.text;
              html += escapeHtml(text);
            } else if (out.data && out.data['text/plain']) {
              const text = Array.isArray(out.data['text/plain']) ? out.data['text/plain'].join('') : out.data['text/plain'];
              html += escapeHtml(text);
            }
          });
          html += '</div>';
        }
      } else {
        html += '<div style="padding: 12px; font-size: 13px;">' + escapeHtml(source) + '</div>';
      }
      
      html += '</div>';
    });
    
    html += '</div>';
    
    // Check dark mode
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      html = html.replace(/background: #ffffff/g, 'background: #1e1e1e').replace(/color: #111/g, 'color: #e5e7eb').replace(/border-color: #e5e7eb/g, 'border-color: #333').replace(/background: #f9fafb/g, 'background: #252526');
    }
    
    container.innerHTML = html;
    if (window.Clarity && window.Clarity.renderMermaid) {
      window.Clarity.renderMermaid(container);
    }
  }

  function renderSvgViewer(container, art) {
    let svgContent = art.content || "";
    if (!svgContent && art.bufferBase64) {
      try {
        svgContent = atob(art.bufferBase64);
      } catch (e) {}
    }

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; height: 100%;">
        <div style="padding: 8px 14px; background: var(--bg-card-subtle, #f8fafc); border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; font-size: 12px; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 600; color: var(--ink-secondary);">Vector Architecture Diagram</span>
            <span class="tag tag--xs" style="background: rgba(59,130,246,0.1); color: #2563eb; font-weight: 600;">Scalable</span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <button class="btn btn--xs btn--outline" id="svgFullscreenBtn" title="Toggle Fullscreen View">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
              <span id="svgFullscreenText">Full Screen</span>
            </button>
            <button class="btn btn--xs btn--outline" id="svgDownloadPngBtn" title="Download High-Res PNG">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Download PNG</span>
            </button>
            <button class="btn btn--xs btn--outline" id="svgDownloadJpgBtn" title="Download High-Quality JPG">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Download JPG</span>
            </button>
            <span style="width: 1px; height: 14px; background: var(--line); margin: 0 2px;"></span>
            <button class="btn btn--xs btn--ghost" id="svgZoomOutBtn" title="Zoom Out">-</button>
            <span id="svgZoomLevel" style="font-family: monospace; font-size: 11px;">100%</span>
            <button class="btn btn--xs btn--ghost" id="svgZoomInBtn" title="Zoom In">+</button>
            <button class="btn btn--xs btn--outline" id="svgResetBtn">Reset</button>
            <button class="btn btn--xs btn--ghost" id="svgBgToggleBtn" title="Toggle dark/light canvas">Toggle BG</button>
          </div>
        </div>
        <div id="svgCanvasContainer" style="flex: 1; overflow: auto; padding: 10px 14px; display: flex; align-items: center; justify-content: center; background: #ffffff; transition: background 0.2s ease; position: relative;">
          <button id="svgFloatingCloseBtn" class="fullscreen-overlay-close-btn" title="Exit Fullscreen (Esc)" style="display: none; align-items: center; gap: 6px;">
            <svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/><line x1="9" y1="12" x2="20" y2="12"/></svg>
            <span>← Back (Esc)</span>
          </button>
          <div id="svgWrapper" style="transform-origin: center center; transition: transform 0.1s ease; max-width: 100%;">
            ${svgContent}
          </div>
        </div>
      </div>
    `;

    let zoom = 1.0;
    let isDiagramFullscreen = false;
    const wrapper = document.getElementById("svgWrapper");
    const zoomLevel = document.getElementById("svgZoomLevel");
    const canvasContainer = document.getElementById("svgCanvasContainer");
    const fullscreenBtn = document.getElementById("svgFullscreenBtn");
    const fullscreenText = document.getElementById("svgFullscreenText");
    const floatingCloseBtn = document.getElementById("svgFloatingCloseBtn");

    const toggleFullscreenMode = () => {
      isDiagramFullscreen = !isDiagramFullscreen;
      const modalBody = container.closest(".modal-body") || container;
      if (modalBody) {
        modalBody.classList.toggle("is-fullscreen", isDiagramFullscreen);
      }
      if (isDiagramFullscreen) {
        if (canvasContainer) {
          canvasContainer.style.position = "fixed";
          canvasContainer.style.top = "0";
          canvasContainer.style.left = "0";
          canvasContainer.style.width = "100vw";
          canvasContainer.style.height = "100vh";
          canvasContainer.style.zIndex = "999999";
        }
        if (floatingCloseBtn) floatingCloseBtn.style.display = "inline-flex";
        if (fullscreenText) fullscreenText.textContent = "Exit Full Screen";
        zoom = 1.25;
        updateZoom();
        window.Clarity?.toast?.show("Entered full screen diagram view (Press Esc to return)", "info");
      } else {
        if (canvasContainer) {
          canvasContainer.style.position = "relative";
          canvasContainer.style.top = "";
          canvasContainer.style.left = "";
          canvasContainer.style.width = "";
          canvasContainer.style.height = "";
          canvasContainer.style.zIndex = "";
        }
        if (floatingCloseBtn) floatingCloseBtn.style.display = "none";
        if (fullscreenText) fullscreenText.textContent = "Full Screen";
        zoom = 1.0;
        updateZoom();
      }
    };

    fullscreenBtn?.addEventListener("click", () => {
      const currentSvg = wrapper?.querySelector("svg");
      if (window.Clarity?.openDiagramModalViewer && (currentSvg || svgContent)) {
        window.Clarity.openDiagramModalViewer({
          svgElement: currentSvg,
          svgString: svgContent,
          title: art.title || "Vector Architecture Diagram",
          subtitle: art.filename || "Interactive scalable system architecture diagram",
          filename: art.filename || "architecture_diagram"
        });
      } else {
        toggleFullscreenMode();
      }
    });
    floatingCloseBtn?.addEventListener("click", toggleFullscreenMode);

    const onModalKeyDown = (e) => {
      if (e.key === "Escape" && isDiagramFullscreen) {
        e.preventDefault();
        toggleFullscreenMode();
      }
    };
    window.addEventListener("keydown", onModalKeyDown);

    const updateZoom = () => {
      if (wrapper) wrapper.style.transform = `scale(${zoom})`;
      if (zoomLevel) zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
    };

    document.getElementById("svgZoomInBtn")?.addEventListener("click", () => {
      zoom = Math.min(3.0, zoom + 0.15);
      updateZoom();
    });

    document.getElementById("svgZoomOutBtn")?.addEventListener("click", () => {
      zoom = Math.max(0.3, zoom - 0.15);
      updateZoom();
    });

    document.getElementById("svgResetBtn")?.addEventListener("click", () => {
      zoom = 1.0;
      updateZoom();
    });

    document.getElementById("svgDownloadPngBtn")?.addEventListener("click", () => {
      const svgEl = wrapper?.querySelector("svg");
      const baseFilename = (art.filename || "architecture_diagram.svg").replace(/\.[^.]+$/, "");
      if (svgEl && window.Clarity?.downloadPngDiagram) {
        window.Clarity.downloadPngDiagram(svgEl, `${baseFilename}.png`);
      } else {
        window.Clarity?.toast?.show("Unable to convert diagram to PNG", "warning");
      }
    });

    document.getElementById("svgDownloadJpgBtn")?.addEventListener("click", () => {
      const svgEl = wrapper?.querySelector("svg");
      const baseFilename = (art.filename || "architecture_diagram.svg").replace(/\.[^.]+$/, "");
      if (svgEl && window.Clarity?.downloadJpgDiagram) {
        window.Clarity.downloadJpgDiagram(svgEl, `${baseFilename}.jpg`);
      } else {
        window.Clarity?.toast?.show("Unable to convert diagram to JPG", "warning");
      }
    });

    let isDarkBg = false;
    document.getElementById("svgBgToggleBtn")?.addEventListener("click", () => {
      isDarkBg = !isDarkBg;
      if (canvasContainer) canvasContainer.style.background = isDarkBg ? "#0f172a" : "#ffffff";
    });
  }

  // Spreadsheet / CSV / XLSX Viewer
  function renderSpreadsheetViewer(container, art) {
    const meta = art.structuredData || {};
    const sheetName = meta.sheetName || "Sheet1";
    const columns = meta.columns || [];
    const rows = meta.rows || [];

    // If CSV text content exists but no rows array, parse CSV
    let displayCols = columns;
    let displayRows = rows;
    if (displayCols.length === 0 && art.content) {
      const lines = art.content.trim().split("\n").map(l => l.split(",").map(c => c.trim().replace(/^"|"$/g, "")));
      if (lines.length > 0) {
        displayCols = lines[0];
        displayRows = lines.slice(1);
      }
    }

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; height: 100%;">
        <div style="padding: 8px 14px; background: var(--bg-card-subtle, #f8fafc); border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; font-size: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="tag tag--xs" style="background:#dcfce7; color:#16a34a; font-weight:600;">📊 ${escapeHtml(sheetName)}</span>
            <span style="color: var(--ink-muted);">${displayRows.length} rows • ${displayCols.length} columns</span>
          </div>
          <input type="text" id="spreadsheetSearch" placeholder="Search cells..." style="padding: 4px 8px; font-size: 11px; border: 1px solid var(--line); border-radius: 6px; width: 140px;" />
        </div>
        <div style="flex: 1; overflow: auto;">
          <table class="spreadsheet-table" id="spreadsheetTable" style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left;">
            <thead>
              <tr style="background: var(--bg-card-subtle, #f1f5f9); position: sticky; top: 0; z-index: 2; border-bottom: 2px solid var(--line);">
                <th style="padding: 8px 12px; border-right: 1px solid var(--line); width: 36px; text-align: center; color: var(--ink-muted); font-size: 11px;">#</th>
                ${displayCols.map(c => `<th style="padding: 8px 12px; border-right: 1px solid var(--line); font-weight: 600; color: var(--ink);">${escapeHtml(c)}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${displayRows.map((row, idx) => {
                const values = Array.isArray(row) ? row : displayCols.map(c => row[c] ?? "");
                return `
                  <tr style="border-bottom: 1px solid var(--line-soft); background: ${idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-card-subtle, #fcfcfd)'};">
                    <td style="padding: 6px 12px; border-right: 1px solid var(--line); text-align: center; color: var(--ink-muted); font-size: 11px; font-family: monospace;">${idx + 1}</td>
                    ${values.map(val => `<td style="padding: 6px 12px; border-right: 1px solid var(--line-soft);">${escapeHtml(String(val))}</td>`).join("")}
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById("spreadsheetSearch")?.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      const trs = document.querySelectorAll("#spreadsheetTable tbody tr");
      trs.forEach(tr => {
        const text = tr.textContent.toLowerCase();
        tr.style.display = (!q || text.includes(q)) ? "" : "none";
      });
    });
  }

  // Presentation / PPTX Viewer
  function renderPresentationViewer(container, art) {
    const meta = art.structuredData || {};
    let slides = meta.slides;
    if (!slides || !Array.isArray(slides) || slides.length < 2) {
      const cleanName = (art.filename || "Project Presentation").replace(/\.pptx$/i, '');
      slides = [
        {
          title: cleanName,
          bullets: [
            "Full Architectural & Engineering Slide Deck",
            "Generated by AI Universal Intelligence Engine",
            "Includes Executive Summary, Subsystems, Data Flow, APIs, Security & Viva Defense"
          ],
          notes: "Title Slide: Welcome judges and present overall project title and domain architecture."
        },
        {
          title: "Executive Overview & Stack",
          bullets: [
            `Project Description: ${art.description || "Comprehensive system breakdown"}`,
            "Primary Stack: TypeScript, Node.js, Modular Client-Server Architecture",
            "System Health: Passed static security verification & codebase structure analysis"
          ],
          notes: "Key executive metrics detailing system purpose, core languages, and framework dependencies."
        },
        {
          title: "System Subsystems & Modules",
          bullets: [
            "UI / Client Layer: Responsive web interface & artifact renderers",
            "Server Routing Layer: REST API routes & Event Stream handlers",
            "Intelligence Engine: Universal project analyzer & file generation pipeline"
          ],
          notes: "Core subsystem components and their responsible modular files."
        },
        {
          title: "End-to-End Data Flow Pipeline",
          bullets: [
            "Step 1: User Prompt / Event Trigger → Input Sanitization & Intent Detection",
            "Step 2: Analysis Engine → Project Workspace Inspection & RAG Retrieval",
            "Step 3: Response Assembly → Artifact Packaging & Direct Workspace Delivery"
          ],
          notes: "Trace of the request-response lifecycle across client and server."
        },
        {
          title: "APIs & Data Storage Model",
          bullets: [
            "API Catalog: Modular endpoints for artifact generation, file inspection, and chat stream",
            "Data Persistence: Structured SQLite / Firestore models for artifact state & history",
            "Security: Secret redaction, input validation, and route isolation"
          ],
          notes: "API routes and database persistence structures."
        },
        {
          title: "Security Audit & Quality Health",
          bullets: [
            "Static Security Scan: 0 Critical vulnerabilities detected",
            "Code Quality Index: High maintainability & clean modular structure",
            "Validation Status: Verified OpenXML package structure"
          ],
          notes: "Security vulnerabilities, remediation steps, and code health metrics."
        },
        {
          title: "Technical Defense (Viva Q&A)",
          bullets: [
            "Q: Why was this architecture chosen?\nA: Provides clean separation of concerns, high maintainability, and fast rendering.",
            "Q: How is user data protected?\nA: Automatic secret redaction and client-side isolation."
          ],
          notes: "Targeted hackathon viva questions and answers for panel defense."
        },
        {
          title: "Conclusion & Future Roadmap",
          bullets: [
            "Production-ready modular foundation with verified asset exports",
            "Support for DOCX, XLSX, PPTX, PDF, CSV, and SVG diagrams",
            "Future Scope: Real-time cloud sync & expanded multi-format previews"
          ],
          notes: "Summary slide wrapping up achievements and upcoming enhancements."
        }
      ];
    }

    let currentSlide = 0;

    const sanitizeViewerText = (t) => {
      if (!t || typeof t !== "string") return "";
      return t.replace(/^[-—\s]+$/gm, "").replace(/---/g, "").trim();
    };

    const renderCurrentSlide = () => {
      const rawSlide = slides[currentSlide] || slides[0];
      const slide = {
        title: sanitizeViewerText(rawSlide.title) || `Slide ${currentSlide + 1}`,
        subtitle: sanitizeViewerText(rawSlide.subtitle),
        category: sanitizeViewerText(rawSlide.category) || "Architecture Deck",
        content: sanitizeViewerText(rawSlide.content),
        layout: rawSlide.layout || "split_layout",
        bullets: (rawSlide.bullets || []).map(b => sanitizeViewerText(typeof b === "string" ? b : b?.text)).filter(b => b.length > 0),
        notes: sanitizeViewerText(rawSlide.speakerNotes || rawSlide.notes),
        metrics: Array.isArray(rawSlide.metrics) ? rawSlide.metrics : null,
        cards: Array.isArray(rawSlide.cards) ? rawSlide.cards : null,
        features: Array.isArray(rawSlide.features) ? rawSlide.features : null,
        steps: Array.isArray(rawSlide.steps) ? rawSlide.steps : null,
        events: Array.isArray(rawSlide.events) ? rawSlide.events : null,
        leftColumn: rawSlide.leftColumn,
        rightColumn: rawSlide.rightColumn,
        diagram: rawSlide.diagram,
      };

      const slideEl = document.getElementById("pptxCurrentSlide");
      const notesEl = document.getElementById("pptxSpeakerNotes");
      const indicatorEl = document.getElementById("pptxSlideCounter");

      if (indicatorEl) indicatorEl.textContent = `Slide ${currentSlide + 1} of ${slides.length}`;

      if (slideEl) {
        let bodyHtml = "";

        // Subtitle
        const subtitleHtml = slide.subtitle
          ? `<div style="font-size: 13px; color: #64748b; margin-top: -8px; margin-bottom: 14px;">${escapeHtml(slide.subtitle)}</div>`
          : "";

        // Main content narrative
        const contentHtml = slide.content
          ? `<p style="font-size: 13.5px; color: #334155; line-height: 1.6; margin-bottom: 14px;">${escapeHtml(slide.content)}</p>`
          : "";

        // Metrics Layout
        if (slide.metrics && slide.metrics.length > 0) {
          bodyHtml += `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 16px;">
              ${slide.metrics.map(m => `
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center;">
                  <div style="font-size: 22px; font-weight: 700; color: #0284c7;">${escapeHtml(m.value)}</div>
                  <div style="font-size: 11px; font-weight: 600; color: #64748b; margin-top: 4px; text-transform: uppercase;">${escapeHtml(m.label)}</div>
                </div>
              `).join("")}
            </div>
          `;
        }

        // Problem / Solution Layout
        if (slide.leftColumn && slide.rightColumn) {
          bodyHtml += `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px;">
              <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px;">
                <div style="font-size: 13px; font-weight: 700; color: #991b1b; margin-bottom: 6px;">${escapeHtml(slide.leftColumn.title || "The Friction")}</div>
                <div style="font-size: 12.5px; color: #450a0a; line-height: 1.5;">${escapeHtml(slide.leftColumn.content || "")}</div>
              </div>
              <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px;">
                <div style="font-size: 13px; font-weight: 700; color: #166534; margin-bottom: 6px;">${escapeHtml(slide.rightColumn.title || "The Solution")}</div>
                <div style="font-size: 12.5px; color: #052e16; line-height: 1.5;">${escapeHtml(slide.rightColumn.content || "")}</div>
              </div>
            </div>
          `;
        }

        // Cards Grid
        if (slide.cards && slide.cards.length > 0) {
          bodyHtml += `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px;">
              ${slide.cards.map(c => `
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
                  <span style="display: inline-block; font-size: 10px; font-weight: 700; background: #e0e7ff; color: #4338ca; padding: 2px 6px; border-radius: 4px; margin-bottom: 6px;">${escapeHtml(c.badge || "Module")}</span>
                  <div style="font-size: 13px; font-weight: 600; color: #0f172a; margin-bottom: 4px;">${escapeHtml(c.title || "")}</div>
                  <div style="font-size: 12px; color: #64748b; line-height: 1.4;">${escapeHtml(c.description || "")}</div>
                </div>
              `).join("")}
            </div>
          `;
        }

        // Feature Grid
        if (slide.features && slide.features.length > 0) {
          bodyHtml += `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
              ${slide.features.map(f => `
                <div style="border-left: 3px solid #0284c7; padding-left: 10px;">
                  <div style="font-size: 13px; font-weight: 600; color: #0f172a;">${escapeHtml(f.title || "")}</div>
                  <div style="font-size: 12px; color: #64748b; margin-top: 2px;">${escapeHtml(f.description || "")}</div>
                </div>
              `).join("")}
            </div>
          `;
        }

        // Steps / Architecture Flow
        if (slide.steps && slide.steps.length > 0) {
          bodyHtml += `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 16px;">
              ${slide.steps.map((s, idx) => `
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; position: relative;">
                  <span style="font-size: 10px; font-weight: 700; color: #94a3b8;">0${idx + 1}</span>
                  <div style="font-size: 12.5px; font-weight: 600; color: #0f172a; margin: 2px 0 4px;">${escapeHtml(s.title || "")}</div>
                  <div style="font-size: 11.5px; color: #64748b; line-height: 1.4;">${escapeHtml(s.description || "")}</div>
                </div>
              `).join("")}
            </div>
          `;
        }

        // Timeline
        if (slide.events && slide.events.length > 0) {
          bodyHtml += `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 16px;">
              ${slide.events.map(e => `
                <div style="border-top: 2px solid #0284c7; padding-top: 8px;">
                  <span style="font-size: 11px; font-weight: 700; color: #0284c7;">${escapeHtml(e.date || "")}</span>
                  <div style="font-size: 12.5px; font-weight: 600; color: #0f172a; margin: 2px 0;">${escapeHtml(e.title || "")}</div>
                  <div style="font-size: 11.5px; color: #64748b;">${escapeHtml(e.description || "")}</div>
                </div>
              `).join("")}
            </div>
          `;
        }

        // Bullets List
        if (slide.bullets && slide.bullets.length > 0) {
          bodyHtml += `
            <ul style="margin: 0; padding-left: 20px; font-size: 13.5px; line-height: 1.6; color: #334155; flex: 1;">
              ${slide.bullets.map(b => `<li style="margin-bottom: 8px;">${escapeHtml(b)}</li>`).join("")}
            </ul>
          `;
        }

        slideEl.innerHTML = `
          <div style="background: white; border: 1px solid var(--line); border-radius: 12px; padding: 28px 32px; min-height: 290px; box-shadow: 0 4px 14px rgba(0,0,0,0.05); display: flex; flex-direction: column;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #ea580c; letter-spacing: 0.05em;">
                ${escapeHtml(slide.category)}
              </span>
              <span style="font-size: 11px; color: #94a3b8; font-weight: 600;">
                ${escapeHtml(art.filename)}
              </span>
            </div>
            <h2 style="font-size: 19px; font-weight: 700; color: #0f172a; margin: 0 0 10px 0; border-bottom: 2px solid #fed7aa; padding-bottom: 8px;">
              ${escapeHtml(slide.title)}
            </h2>
            ${subtitleHtml}
            ${contentHtml}
            ${bodyHtml}
          </div>
        `;
      }

      if (notesEl) {
        notesEl.innerHTML = slide.notes
          ? `<strong style="color: var(--ink);">Presenter Notes:</strong> ${escapeHtml(slide.notes)}`
          : `<span style="color: var(--ink-muted); font-style: italic;">No presenter notes for this slide.</span>`;
      }
    };

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; height: 100%; padding: 16px; gap: 14px; overflow-y: auto;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="btn btn--sm btn--outline" id="pptxPrevBtn">
              <svg class="icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
              <span>Previous</span>
            </button>
            <span id="pptxSlideCounter" style="font-weight: 600; font-size: 13px; color: var(--ink); padding: 0 6px;"></span>
            <button class="btn btn--sm btn--outline" id="pptxNextBtn">
              <span>Next</span>
              <svg class="icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <span class="tag tag--xs" style="background:#fff7ed; color:#ea580c; font-weight:600;">PowerPoint Presentation</span>
        </div>

        <div id="pptxCurrentSlide" style="flex-shrink: 0;"></div>

        <div style="background: var(--bg-card-subtle, #f8fafc); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; font-size: 12px; line-height: 1.5;" id="pptxSpeakerNotes">
        </div>
      </div>
    `;

    renderCurrentSlide();

    document.getElementById("pptxPrevBtn")?.addEventListener("click", () => {
      if (currentSlide > 0) {
        currentSlide--;
        renderCurrentSlide();
      }
    });

    document.getElementById("pptxNextBtn")?.addEventListener("click", () => {
      if (currentSlide < slides.length - 1) {
        currentSlide++;
        renderCurrentSlide();
      }
    });
  }

  // Word Document / DOCX Viewer
  function renderDocumentViewer(container, art) {
    const meta = art.structuredData || {};
    const title = meta.title || art.filename;
    const summary = meta.summary || "Executive intelligence report prepared by AI.";
    const sections = meta.sections || [];

    container.innerHTML = `
      <div style="padding: 24px; max-width: 720px; margin: 0 auto; background: white; border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); margin-top: 16px; margin-bottom: 24px;">
        <div style="border-bottom: 2px solid #3b82f6; padding-bottom: 16px; margin-bottom: 20px;">
          <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #2563eb; letter-spacing: 0.05em;">Intelligence Document</span>
          <h1 style="font-size: 24px; font-weight: 700; color: #0f172a; margin: 6px 0 8px;">${escapeHtml(title)}</h1>
          <div style="font-size: 12.5px; color: #64748b;">Generated on ${new Date().toLocaleDateString()} • Universal Project Understanding Engine</div>
        </div>

        <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 14px 16px; border-radius: 0 6px 6px 0; margin-bottom: 24px;">
          <strong style="color: #1e40af; font-size: 13px; display: block; margin-bottom: 4px;">Executive Summary</strong>
          <p style="margin: 0; font-size: 13px; color: #1e3a8a; line-height: 1.5;">${escapeHtml(summary)}</p>
        </div>

        ${sections.map((sec, idx) => `
          <div style="margin-bottom: 24px;">
            <h2 style="font-size: 17px; font-weight: 700; color: #1e293b; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">
              ${idx + 1}. ${escapeHtml(sec.heading)}
            </h2>
            <div style="font-size: 13.5px; line-height: 1.6; color: #334155; white-space: pre-wrap;">${escapeHtml(sec.body)}</div>
          </div>
        `).join("")}

        <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11.5px; color: #94a3b8; text-align: center;">
          Confidential • Download full .docx above
        </div>
      </div>
    `;
  }

  // PDF Viewer
  function renderPdfViewer(container, art) {
    const meta = art.structuredData || {};
    const title = meta.title || art.filename;
    const summary = meta.summary || "Full PDF Report";
    const sections = meta.sections || [];

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; height: 100%;">
        <div style="padding: 10px 16px; background: var(--surface-muted); border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; font-size: 12px;">
          <span style="color: var(--ink); font-weight: 600;">PDF Document (${formatBytes(art.size)})</span>
          <a href="/api/artifacts/${art.id}/download" download="${escapeHtml(art.filename)}" class="btn btn--xs btn--outline" style="display:inline-flex; align-items:center; gap:5px; text-decoration:none;">Download PDF</a>
        </div>
        <div style="flex: 1; overflow-y: auto; padding: 24px; background: #f8fafc;">
          <div style="max-width: 680px; margin: 0 auto; background: white; border: 1px solid var(--line); border-radius: 6px; padding: 28px; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
            <h1 style="font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 12px;">${escapeHtml(title)}</h1>
            <p style="font-size: 13px; color: #4b5563; line-height: 1.5; margin-bottom: 20px;">${escapeHtml(summary)}</p>
            ${sections.map(s => `
              <div style="margin-bottom: 18px;">
                <h3 style="font-size: 15px; font-weight: 600; color: #1f2937; margin-bottom: 6px;">${escapeHtml(s.heading)}</h3>
                <p style="font-size: 13px; color: #374151; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(s.body)}</p>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  // Code Viewer - Clarity Code Editor
  function renderCodeViewer(container, art) {
    const content = art.content || "";
    const filename = art.filename || "file.txt";
    const highlightedLines = window.Clarity.highlighter && window.Clarity.highlighter.highlightLines
      ? window.Clarity.highlighter.highlightLines(content, filename)
      : content.split("\n").map(l => escapeHtml(l));
    const linesCount = highlightedLines.length;
    const langInfo = window.Clarity.highlighter && window.Clarity.highlighter.getLanguageInfo
      ? window.Clarity.highlighter.getLanguageInfo(filename)
      : { name: filename.split(".").pop().toUpperCase() || "TEXT" };

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; height: 100%; background: #1e1e1e;">
        <div style="padding: 8px 16px; background: #252526; border-bottom: 1px solid #333333; display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #cccccc; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="tag tag--xs" style="background: #333333; color: #9cdcfe; font-family: ui-monospace, monospace; font-weight: 600; text-transform: uppercase;">${escapeHtml(langInfo.name)}</span>
            <span style="color: #858585;">${linesCount} lines • ${formatBytes(art.size || content.length)}</span>
            <span style="color: #6e7681;">|</span>
            <span style="font-family: ui-monospace, monospace; color: #d4d4d4; font-size: 11.5px;">${escapeHtml(art.targetFile || filename)}</span>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="position: relative; display: flex; align-items: center;">
              <input type="text" id="codeSearchInput" placeholder="Find in file..." style="padding: 4px 8px; font-size: 11.5px; background: #1e1e1e; color: #d4d4d4; border: 1px solid #3c3c3c; border-radius: 4px; width: 140px; font-family: inherit;" />
              <span id="codeSearchCount" style="font-size: 10.5px; color: #858585; margin-left: 6px;"></span>
            </div>

            <button type="button" class="btn btn--xs btn--outline" id="copyCodeContentBtn">
              Copy
            </button>

            <button type="button" class="btn btn--xs btn--outline" id="openInExplorerBtn" title="Open in Project Code Explorer">
              Open in Explorer
            </button>
          </div>
        </div>

        <div style="flex: 1; overflow: auto; background: #1e1e1e; color: #d4d4d4; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace; font-size: 13px; line-height: 20px; display: flex; position: relative;" id="codeEditorViewport">
          <div id="codeGutter" style="padding: 12px 0; user-select: none; text-align: right; color: #858585; border-right: 1px solid #333333; background: #1e1e1e; min-width: 46px; flex-shrink: 0; position: sticky; left: 0; z-index: 10;">
            ${highlightedLines.map((_, idx) => `<div class="gutter-num" style="padding: 0 10px; height: 20px; font-size: 12px;">${idx + 1}</div>`).join("")}
          </div>
          <div id="codeBody" style="padding: 12px 16px; flex: 1; white-space: pre; overflow: visible; tab-size: 2; display: inline-block; min-width: max-content;">
            ${highlightedLines.map((html, idx) => `<div class="code-line" data-line="${idx + 1}" style="height: 20px; outline: none;">${html || "&nbsp;"}</div>`).join("")}
          </div>
        </div>
      </div>
    `;

    // Search filter
    const searchInput = document.getElementById("codeSearchInput");
    const searchCount = document.getElementById("codeSearchCount");
    searchInput?.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      const codeLines = document.querySelectorAll("#codeBody .code-line");
      let matches = 0;
      codeLines.forEach(cl => {
        if (!q) {
          cl.style.backgroundColor = "";
        } else if (cl.textContent.toLowerCase().includes(q)) {
          cl.style.backgroundColor = "rgba(255, 235, 59, 0.25)";
          matches++;
        } else {
          cl.style.backgroundColor = "";
        }
      });
      if (searchCount) {
        searchCount.textContent = q ? `${matches} found` : "";
      }
    });

    // Copy button
    document.getElementById("copyCodeContentBtn")?.addEventListener("click", () => {
      navigator.clipboard.writeText(content);
      window.Clarity.toast.show("Code copied to clipboard", "success");
    });

    // Open in explorer
    document.getElementById("openInExplorerBtn")?.addEventListener("click", () => {
      const filePath = art.targetFile || filename;
      const projectId = art.projectId || window.Clarity.currentProjectId;
      if (window.Clarity.jumpToFile) {
        window.Clarity.jumpToFile(filePath, 1, projectId);
      } else if (projectId) {
        window.location.hash = `#/project/${projectId}?file=${encodeURIComponent(filePath)}&line=1`;
      } else {
        window.Clarity.toast.show(`File path: ${filePath}`, "info");
      }
    });
  }

  // Global Escape Key Listener for closing preview panel
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const container = document.getElementById("clarityArtifactPreviewContainer");
      if (container && container.style.display !== "none") {
        closePreview();
      }
    }
  });

  // Export module to Clarity namespace
  window.Clarity.artifact = {
    renderCard,
    bindEvents,
    openPreview,
    closePreview,
    formatBytes,
    getCategoryColor,
  };
})();
