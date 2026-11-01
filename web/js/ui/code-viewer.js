// Clarity Professional AI Code Experience
// Clean Interactive Code Cells and Full-Featured Code Workspace

window.Clarity = window.Clarity || {};

(function () {
  // In-memory registry for exact raw code snippets across messages and cells
  const codeRegistry = new Map();
  let activeWorkspaceState = null;
  let workspaceElement = null;
  let isEventsInitialized = false;

  // SVG Icons
  const ICONS = {
    copy: '<svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    download: '<svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    expand: '<svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
    minimize: '<svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="10" y1="14" x2="3" y2="21"/></svg>',
    wrap: '<svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><path d="M3 12h15a3 3 0 0 1 0 6h-4"/><polyline points="16 16 14 18 16 20"/><line x1="3" y1="18" x2="9" y2="18"/></svg>',
    close: '<svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    file: '<svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  };

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getHighlighter() {
    return window.Clarity.highlighter || {
      getLanguageInfo: (l) => ({ id: l || "text", name: (l || "TEXT").toUpperCase(), ext: ".txt", mime: "text/plain" }),
      detectFilename: (l) => `file_${Date.now()}.txt`,
      renderLineNumberedHtml: (code) => escapeHtml(code),
      highlightCode: (code) => escapeHtml(code),
    };
  }

  // Register or update snippet in memory
  function registerSnippet(cellId, data) {
    if (!cellId) return;
    codeRegistry.set(cellId, {
      id: cellId,
      code: typeof data.code === "string" ? data.code : "",
      lang: data.lang || "plaintext",
      filename: data.filename || "file.txt",
      precedingText: data.precedingText || "",
      files: data.files || null,
      activeFileIndex: data.activeFileIndex || 0,
    });
  }

  function extractSnippetFromDom(cellEl) {
    if (!cellEl) return null;
    const cellId = cellEl.getAttribute("data-cell-id") || cellEl.id || ("codecell_" + Math.random().toString(36).substring(2, 9));

    // 1. Raw code from hidden textarea
    let rawCode = "";
    const rawTextarea = cellEl.querySelector(".code-cell__raw");
    if (rawTextarea && typeof rawTextarea.value === "string") {
      rawCode = rawTextarea.value;
    } else if (cellEl._rawCode) {
      rawCode = cellEl._rawCode;
    } else {
      // 2. Extract code from lines in DOM
      const lineEls = cellEl.querySelectorAll(".code-line__code");
      if (lineEls && lineEls.length > 0) {
        rawCode = Array.from(lineEls).map((el) => el.textContent).join("\n");
      } else {
        const codeEl = cellEl.querySelector("code, pre");
        if (codeEl) rawCode = codeEl.textContent;
      }
    }

    const lang = cellEl.getAttribute("data-lang") ||
      cellEl.querySelector(".code-cell__badge")?.textContent?.trim().toLowerCase() ||
      "plaintext";

    const filename = cellEl.getAttribute("data-filename") ||
      cellEl.querySelector(".code-cell__filename")?.textContent?.trim() ||
      `snippet.${lang === "python" ? "py" : (lang === "javascript" ? "js" : "txt")}`;

    const snippet = {
      id: cellId,
      code: rawCode,
      lang: lang,
      filename: filename,
      precedingText: "",
      files: null,
      activeFileIndex: 0,
    };

    if (cellId) {
      codeRegistry.set(cellId, snippet);
    }
    return snippet;
  }

  function getSnippet(cellId, fallbackEl = null) {
    if (cellId && codeRegistry.has(cellId)) {
      const s = codeRegistry.get(cellId);
      if (s && typeof s.code === "string") return s;
    }

    // DOM Fallback
    const cellEl = fallbackEl
      ? (fallbackEl.closest(".code-cell") || fallbackEl)
      : (cellId ? (document.getElementById(cellId) || document.querySelector(`[data-cell-id="${cellId}"]`)) : null);

    if (cellEl) {
      return extractSnippetFromDom(cellEl);
    }

    return null;
  }

  // Download pure source code file
  function downloadCode(filename, code, lang) {
    const highlighter = getHighlighter();
    const langInfo = highlighter.getLanguageInfo(lang || filename);
    const cleanFilename = filename || `code${langInfo.ext || ".txt"}`;
    const mime = langInfo.mime || "text/plain";

    try {
      const blob = new Blob([code || ""], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = cleanFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      if (window.Clarity.toast) {
        window.Clarity.toast.show(`Downloaded ${cleanFilename}`, "success");
      }
    } catch (err) {
      console.error("Failed to download code file", err);
      if (window.Clarity.toast) {
        window.Clarity.toast.show("Download failed", "error");
      }
    }
  }

  // Pure source code clipboard copy
  async function copyCode(rawCode, btnEl = null) {
    const code = String(rawCode || "");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
    } catch (err) {
      console.error("Failed to copy code", err);
    }

    if (btnEl) {
      btnEl.classList.add("code-cell__btn--copied");
      const origHtml = btnEl.innerHTML;
      btnEl.innerHTML = `${ICONS.check}<span>Copied ✓</span>`;
      setTimeout(() => {
        btnEl.classList.remove("code-cell__btn--copied");
        btnEl.innerHTML = origHtml;
      }, 2000);
    }

    if (window.Clarity.toast) {
      window.Clarity.toast.show("Code copied to clipboard", "success");
    }
  }

  // Render the interactive code cell for markdown (Clean view, no preview)
  function renderCell(options) {
    const {
      cellId = "cell_" + Math.random().toString(36).substring(2, 9),
      code = "",
      lang = "",
      filename = "",
      precedingText = "",
      isStreaming = false,
      files = null,
      activeFileIndex = 0,
    } = options;

    const highlighter = getHighlighter();
    let detectedFilename = filename || highlighter.detectFilename(lang, code, precedingText);
    const langInfo = highlighter.getLanguageInfo(lang || detectedFilename);

    // Guarantee that filename always includes a file extension
    if (detectedFilename && !detectedFilename.includes(".")) {
      detectedFilename += (langInfo.ext || ".txt");
    }

    // Save to in-memory store
    registerSnippet(cellId, {
      code,
      lang: langInfo.id,
      filename: detectedFilename,
      precedingText,
      files,
      activeFileIndex,
    });

    const linesCount = code ? code.split(/\r?\n/).length : 1;

    // Highlighting lines
    const lineNumberedHtml = highlighter.renderLineNumberedHtml(code, langInfo.id || langInfo.prism);

    // Multiple file tabs if present
    let tabsHtml = "";
    if (files && files.length > 1) {
      tabsHtml = `<div class="code-cell__tabs" role="tablist">` +
        files.map((f, i) => {
          const isActive = i === activeFileIndex;
          return `<button class="code-tab ${isActive ? "is-active" : ""}" type="button" role="tab" data-code-action="tab" data-cell-id="${cellId}" data-file-index="${i}">${ICONS.file}<span>${escapeHtml(f.name)}</span></button>`;
        }).join("") +
        `</div>`;
    }

    // Build clean Code File Card for chat with full syntax-highlighted code
    const isVeryLongFile = linesCount > 35;
    const extLabel = (langInfo.ext ? langInfo.ext.replace(/^\./, "") : langInfo.id || "txt").toUpperCase();

    return `
<div class="code-cell code-file-card" id="${cellId}" data-cell-id="${cellId}" data-lang="${escapeHtml(langInfo.id)}" data-filename="${escapeHtml(detectedFilename)}" data-streaming="${isStreaming ? "true" : "false"}">
  <textarea class="code-cell__raw" hidden aria-hidden="true" style="display:none !important;">${escapeHtml(code)}</textarea>
  ${tabsHtml}
  <div class="code-file-card__header">
    <div class="code-file-card__info">
      <div class="code-file-card__icon">${ICONS.file}</div>
      <div class="code-file-card__meta">
        <div class="code-file-card__title-row">
          <span class="code-file-card__filename" title="${escapeHtml(detectedFilename)}">${escapeHtml(detectedFilename)}</span>
          <span class="code-file-card__ext-badge">${escapeHtml(extLabel)}</span>
        </div>
        <span class="code-file-card__sub">${linesCount} lines</span>
      </div>
    </div>
    <div class="code-file-card__actions">
      <button class="code-file-card__open-btn" type="button" data-code-action="expand" data-cell-id="${cellId}" onclick="event.preventDefault(); event.stopPropagation(); window.Clarity.codeViewer.openWorkspace('${cellId}', 'code', this); return false;" title="Open code in resizable side panel (Click to view or drag left to resize)" aria-label="View code">
        ${ICONS.expand}
        <span>View</span>
      </button>
      <button class="code-cell__btn code-cell__btn--copy" type="button" data-code-action="copy" data-cell-id="${cellId}" title="Copy code" aria-label="Copy code">
        ${ICONS.copy}
        <span>Copy</span>
      </button>
      <button class="code-cell__btn code-cell__btn--download" type="button" data-code-action="download" data-cell-id="${cellId}" title="Download ${escapeHtml(detectedFilename)}" aria-label="Download file">
        ${ICONS.download}
        <span>Download</span>
      </button>
    </div>
  </div>
  <div class="code-cell__body code-file-card__body">
    <div class="code-cell__editor-wrap">
      ${lineNumberedHtml}
    </div>
  </div>
  ${isVeryLongFile ? `
  <div class="code-file-card__preview-bar" onclick="event.preventDefault(); event.stopPropagation(); window.Clarity.codeViewer.openWorkspace('${cellId}', 'code', this); return false;" title="Click to view full code in right side panel">
    <span class="code-file-card__preview-text">Showing snippet (${linesCount} lines)</span>
    <span class="code-file-card__view-link">Open in Resizable Side Panel (${linesCount} lines) →</span>
  </div>` : ""}
</div>`.trim();
  }

  // ---------- EXPANDED DEDICATED RIGHT-SIDE CODE VIEWER PANEL ----------
  function openWorkspace(cellIdOrSnippet, initialView = "code", triggerEl = null) {
    let snippet = null;
    if (cellIdOrSnippet && typeof cellIdOrSnippet === "object") {
      snippet = cellIdOrSnippet;
    } else {
      snippet = getSnippet(cellIdOrSnippet, triggerEl);
    }

    if (!snippet && triggerEl) {
      const cell = triggerEl.closest(".code-cell");
      if (cell) snippet = extractSnippetFromDom(cell);
    }

    if (!snippet && cellIdOrSnippet && typeof cellIdOrSnippet === "string") {
      const cell = document.getElementById(cellIdOrSnippet) || document.querySelector(`[data-cell-id="${cellIdOrSnippet}"]`);
      if (cell) snippet = extractSnippetFromDom(cell);
    }

    if (!snippet) {
      const anyCell = document.querySelector(".code-cell");
      if (anyCell) snippet = extractSnippetFromDom(anyCell);
    }

    if (!snippet) {
      console.warn("Could not find code cell to expand.");
      return;
    }

    // Set active state
    activeWorkspaceState = {
      cellId: snippet.id || (typeof cellIdOrSnippet === "string" ? cellIdOrSnippet : "snippet"),
      isFullscreen: false,
      isWrapped: false,
      ...snippet,
    };

    renderWorkspaceDom();
    bindWorkspaceDragAndResize();
  }

  let activeCleanupFn = null;

  function renderWorkspaceDom() {
    // Remove existing side panel if open
    const existingPanel = document.getElementById("clarityCodeSidePanel");
    if (existingPanel) {
      existingPanel.remove();
    }
    const existingBackdrop = document.getElementById("clarityCodeWorkspaceBackdrop");
    if (existingBackdrop) {
      existingBackdrop.remove();
    }

    const state = activeWorkspaceState;
    if (!state) return;

    const highlighter = getHighlighter();
    const langInfo = highlighter.getLanguageInfo(state.lang || state.filename);
    const codeStr = typeof state.code === "string" ? state.code : "";
    const linesCount = codeStr ? codeStr.split(/\r?\n/).length : 1;
    const charsCount = codeStr.length;

    // Calculate or retrieve stored panel width
    const savedW = localStorage.getItem("clarity_code_panel_width");
    let widthPx = savedW ? parseInt(savedW, 10) : 560;
    if (isNaN(widthPx) || widthPx < 320) widthPx = 560;
    const maxW = Math.max(360, Math.min(Math.floor(window.innerWidth * 0.9), window.innerWidth - 60));
    if (widthPx > maxW) widthPx = maxW;

    // Set body layout class & CSS variable
    document.body.classList.add("has-code-panel");
    document.body.style.setProperty("--code-panel-width", widthPx + "px");

    // Optional Backdrop for mobile or high-focus viewing
    const backdrop = document.createElement("div");
    backdrop.id = "clarityCodeWorkspaceBackdrop";
    backdrop.className = "code-workspace-backdrop";
    backdrop.onclick = () => closeWorkspace();
    document.body.appendChild(backdrop);

    const panel = document.createElement("div");
    panel.className = "code-side-panel" + (state.isFullscreen ? " is-fullscreen" : "") + (state.isWrapped ? " is-wrapped" : "");
    panel.id = "clarityCodeSidePanel";
    panel.style.width = widthPx + "px";

    // Resizer along left edge with visual grip handle
    const resizerHtml = `<div class="code-side-panel__resizer" id="wsResizeLeft" title="Drag to resize panel left or right" aria-label="Resize panel handle">
      <div class="code-side-panel__resizer-handle" aria-hidden="true"></div>
    </div>`;

    // Multi-file tabs if present
    let tabsHtml = "";
    if (state.files && state.files.length > 1) {
      tabsHtml = `<div class="code-workspace__tabs" role="tablist">` +
        state.files.map((f, i) => {
          const isActive = i === (state.activeFileIndex || 0);
          return `<button class="code-tab ${isActive ? "is-active" : ""}" type="button" role="tab" data-code-action="tab" data-cell-id="${escapeHtml(state.cellId)}" data-file-index="${i}">${ICONS.file}<span>${escapeHtml(f.name)}</span></button>`;
        }).join("") +
        `</div>`;
    }

    const extBadge = (langInfo.ext ? langInfo.ext.replace(/^\./, "") : langInfo.id || "txt").toUpperCase();

    // Header Toolbar
    const headerHtml = `
      <div class="code-workspace__header" id="workspaceHeader">
        <div class="code-workspace__header-left">
          <div class="code-workspace__title">
            ${ICONS.file}
            <span id="workspaceFilename">${escapeHtml(state.filename)}</span>
            <span class="code-workspace__badge">${escapeHtml(extBadge)}</span>
            <span style="font-size: 11.5px; color: var(--code-cell-muted, #8b949e); font-weight: normal;">(${linesCount} lines • ${charsCount} chars)</span>
          </div>
        </div>
        <div class="code-workspace__header-right">
          <button type="button" class="code-workspace__btn ${state.isWrapped ? "is-active" : ""}" data-ws-action="toggle-wrap" title="${state.isWrapped ? "Disable word wrap" : "Enable word wrap"}">
            ${ICONS.wrap}
            <span>${state.isWrapped ? "Unwrap" : "Wrap"}</span>
          </button>
          <button type="button" class="code-workspace__btn" data-ws-action="copy" title="Copy code to clipboard">
            ${ICONS.copy}
            <span>Copy</span>
          </button>
          <button type="button" class="code-workspace__btn" data-ws-action="download" title="Download source file">
            ${ICONS.download}
            <span>Download</span>
          </button>
          <button type="button" class="code-workspace__btn" data-ws-action="toggle-fullscreen" title="${state.isFullscreen ? "Exit full width" : "Full width"}">
            ${state.isFullscreen ? ICONS.minimize : ICONS.expand}
            <span>${state.isFullscreen ? "Restore" : "Full View"}</span>
          </button>
          <button type="button" class="code-workspace__close-btn" data-ws-action="close" title="Close panel (Esc)">
            ${ICONS.close}
          </button>
        </div>
      </div>
    `;

    // Highlighting lines
    const lineNumberedHtml = highlighter.renderLineNumberedHtml(codeStr, langInfo.id || langInfo.prism);

    const bodyHtml = `
      ${tabsHtml}
      <div class="code-workspace__main" id="workspaceMain">
        <div class="code-workspace__code-pane" id="workspaceCodePane">
          ${lineNumberedHtml}
        </div>
      </div>
    `;

    panel.innerHTML = resizerHtml + headerHtml + bodyHtml;
    document.body.appendChild(panel);
    workspaceElement = panel;

    // Esc key listener
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        closeWorkspace();
        window.removeEventListener("keydown", onKeyDown);
      }
    };
    window.addEventListener("keydown", onKeyDown);
  }

  function closeWorkspace() {
    if (activeCleanupFn) {
      activeCleanupFn();
      activeCleanupFn = null;
    }
    const panel = document.getElementById("clarityCodeSidePanel");
    if (panel) {
      panel.remove();
    }
    const backdrop = document.getElementById("clarityCodeWorkspaceBackdrop");
    if (backdrop) {
      backdrop.remove();
    }
    const shield = document.getElementById("clarityDragShield");
    if (shield) {
      shield.remove();
    }
    document.body.classList.remove("has-code-panel");
    document.body.classList.remove("is-resizing-code-panel");
    document.body.style.removeProperty("--code-panel-width");
    workspaceElement = null;
    activeWorkspaceState = null;
  }

  // Draggable Left Edge Resizer Handle with Full-screen Shield and Smooth RAF
  function bindWorkspaceDragAndResize() {
    if (activeCleanupFn) {
      activeCleanupFn();
      activeCleanupFn = null;
    }

    const panel = document.getElementById("clarityCodeSidePanel");
    const resizer = document.getElementById("wsResizeLeft");
    if (!panel || !resizer) return;

    let isResizing = false;
    let dragShield = null;
    let rafId = null;

    const onStart = (e) => {
      if (activeWorkspaceState && activeWorkspaceState.isFullscreen) return;
      e.preventDefault();
      e.stopPropagation();
      isResizing = true;
      resizer.classList.add("is-resizing");
      panel.classList.add("is-dragging");
      document.body.classList.add("is-resizing-code-panel");

      // Create invisible drag shield to capture mouse events even over iframes/pre/code
      dragShield = document.createElement("div");
      dragShield.id = "clarityDragShield";
      dragShield.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:999999;cursor:col-resize;user-select:none;-webkit-user-select:none;background:transparent;";
      document.body.appendChild(dragShield);
    };

    const updateWidth = (clientX) => {
      let newW = window.innerWidth - clientX;
      const minW = 280;
      const maxW = Math.max(360, window.innerWidth - 40);

      if (newW < minW) newW = minW;
      if (newW > maxW) newW = maxW;

      panel.style.width = newW + "px";
      document.body.style.setProperty("--code-panel-width", newW + "px");

      try {
        localStorage.setItem("clarity_code_panel_width", String(newW));
      } catch (err) {}
    };

    const onMove = (e) => {
      if (!isResizing) return;
      if (e.cancelable) e.preventDefault();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => updateWidth(clientX));
    };

    const onEnd = () => {
      if (!isResizing) return;
      isResizing = false;
      if (rafId) cancelAnimationFrame(rafId);
      resizer.classList.remove("is-resizing");
      panel.classList.remove("is-dragging");
      document.body.classList.remove("is-resizing-code-panel");
      if (dragShield && dragShield.parentNode) {
        dragShield.parentNode.removeChild(dragShield);
        dragShield = null;
      }
    };

    resizer.addEventListener("mousedown", onStart);
    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup", onEnd);

    resizer.addEventListener("touchstart", onStart, { passive: false });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);

    activeCleanupFn = () => {
      if (rafId) cancelAnimationFrame(rafId);
      resizer.removeEventListener("mousedown", onStart);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      resizer.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
      if (dragShield && dragShield.parentNode) {
        dragShield.parentNode.removeChild(dragShield);
      }
    };
  }

  // Global Delegated Event Handlers (Works seamlessly with streaming and re-renders)
  function initEvents() {
    if (isEventsInitialized) return;
    isEventsInitialized = true;

    const handleDocumentClick = (e) => {
      // 1. INLINE CODE CELL ACTIONS
      const cellBtn = e.target.closest("[data-code-action]");
      if (cellBtn) {
        const action = cellBtn.getAttribute("data-code-action");
        const cellId = cellBtn.getAttribute("data-cell-id");
        const cellEl = cellBtn.closest(".code-cell");
        const snippet = getSnippet(cellId, cellBtn);

        if (action === "copy") {
          e.preventDefault();
          e.stopPropagation();
          const code = snippet ? snippet.code : (cellEl?.querySelector(".code-cell__raw")?.value || cellEl?.querySelector(".code-line__code")?.textContent || cellEl?.querySelector("code")?.textContent || "");
          copyCode(code, cellBtn);
          return;
        }

        if (action === "download") {
          e.preventDefault();
          e.stopPropagation();
          if (snippet) {
            downloadCode(snippet.filename, snippet.code, snippet.lang);
          } else if (cellEl) {
            const fallbackSnippet = extractSnippetFromDom(cellEl);
            if (fallbackSnippet) {
              downloadCode(fallbackSnippet.filename, fallbackSnippet.code, fallbackSnippet.lang);
            }
          }
          return;
        }

        if (action === "expand") {
          e.preventDefault();
          e.stopPropagation();
          openWorkspace(cellId, "code", cellBtn);
          return;
        }

        if (action === "tab") {
          e.preventDefault();
          e.stopPropagation();
          const fileIndex = parseInt(cellBtn.getAttribute("data-file-index"), 10);
          if (snippet && snippet.files && snippet.files[fileIndex]) {
            const file = snippet.files[fileIndex];
            snippet.activeFileIndex = fileIndex;
            snippet.code = file.code;
            snippet.lang = file.lang;
            snippet.filename = file.name;

            // Re-render cell contents smoothly
            const cell = cellEl;
            if (cell) {
              const highlighter = getHighlighter();
              const langInfo = highlighter.getLanguageInfo(file.lang || file.name);

              // Update raw textarea
              const rawTa = cell.querySelector(".code-cell__raw");
              if (rawTa) rawTa.value = file.code;

              // Update badge & filename
              const badge = cell.querySelector(".code-cell__badge");
              if (badge) badge.textContent = langInfo.name;
              const fnEl = cell.querySelector(".code-cell__filename");
              if (fnEl) fnEl.innerHTML = `${ICONS.file} ${escapeHtml(file.name)}`;

              // Update tabs
              cell.querySelectorAll(".code-tab").forEach((tab, i) => {
                tab.classList.toggle("is-active", i === fileIndex);
              });

              // Update lines
              const editorWrap = cell.querySelector(".code-cell__editor-wrap");
              if (editorWrap) {
                editorWrap.innerHTML = highlighter.renderLineNumberedHtml(file.code, langInfo.id);
              }
            }
          }
          return;
        }
      }

      // 2. EXPANDED WORKSPACE ACTIONS
      const wsBtn = e.target.closest("[data-ws-action]");
      if (wsBtn) {
        const action = wsBtn.getAttribute("data-ws-action");

        if (action === "close") {
          e.preventDefault();
          e.stopPropagation();
          closeWorkspace();
          return;
        }

        if (action === "toggle-wrap") {
          e.preventDefault();
          e.stopPropagation();
          if (activeWorkspaceState) {
            activeWorkspaceState.isWrapped = !activeWorkspaceState.isWrapped;
            const ws = document.getElementById("clarityCodeSidePanel") || document.querySelector(".code-side-panel");
            if (ws) {
              ws.classList.toggle("is-wrapped", activeWorkspaceState.isWrapped);
            }
            wsBtn.classList.toggle("is-active", activeWorkspaceState.isWrapped);
            wsBtn.innerHTML = `${ICONS.wrap}<span>${activeWorkspaceState.isWrapped ? "Unwrap" : "Wrap"}</span>`;
            wsBtn.title = activeWorkspaceState.isWrapped ? "Disable word wrap" : "Enable word wrap";
          }
          return;
        }

        if (action === "toggle-fullscreen") {
          e.preventDefault();
          e.stopPropagation();
          if (activeWorkspaceState) {
            activeWorkspaceState.isFullscreen = !activeWorkspaceState.isFullscreen;
            const ws = document.getElementById("clarityCodeSidePanel") || document.querySelector(".code-side-panel");
            if (ws) {
              ws.classList.toggle("is-fullscreen", activeWorkspaceState.isFullscreen);
            }
            wsBtn.innerHTML = activeWorkspaceState.isFullscreen
              ? `${ICONS.minimize}<span>Restore</span>`
              : `${ICONS.expand}<span>Full View</span>`;
          }
          return;
        }

        if (action === "copy") {
          e.preventDefault();
          e.stopPropagation();
          if (activeWorkspaceState) {
            copyCode(activeWorkspaceState.code, wsBtn);
          }
          return;
        }

        if (action === "download") {
          e.preventDefault();
          e.stopPropagation();
          if (activeWorkspaceState) {
            downloadCode(
              activeWorkspaceState.filename,
              activeWorkspaceState.code,
              activeWorkspaceState.lang
            );
          }
          return;
        }
      }
    };

    // Attach to document directly so event delegation is universal and impervious to timing/replacement
    document.addEventListener("click", handleDocumentClick);
  }

  // Export module
  window.Clarity.codeViewer = {
    renderCell,
    openWorkspace,
    closeWorkspace,
    getSnippet,
    extractSnippetFromDom,
    copyCode,
    downloadCode,
    initEvents,
  };

  // Auto initialize event listeners
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initEvents);
    } else {
      initEvents();
    }
  }
})();
