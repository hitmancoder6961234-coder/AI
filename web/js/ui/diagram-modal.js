window.Clarity = window.Clarity || {};

(function () {
  let activeModalEl = null;
  let activeKeydownListener = null;

  /**
   * Opens a dedicated full-screen modal viewer for generated architecture diagrams.
   * @param {Object} options
   * @param {string} [options.title] - Diagram title
   * @param {string} [options.subtitle] - Subtitle or metadata description
   * @param {SVGElement} [options.svgElement] - Existing SVG DOM element to display
   * @param {string} [options.svgString] - Raw SVG string to render
   * @param {string} [options.filename] - Base filename for downloads (without extension)
   * @param {Function} [options.onClose] - Callback when modal is closed
   * @param {number} [options.initialZoom] - Initial scale (default: 1.0)
   */
  function openDiagramModalViewer(options) {
    options = options || {};
    closeDiagramModalViewer(); // Close any currently open instance

    const title = options.title || "Architecture Diagram";
    const subtitle = options.subtitle || "Full-screen interactive view • Pan & Zoom enabled";
    const baseFilename = (options.filename || "clarity_architecture_diagram").replace(/\.[^.]+$/, "");

    // Prepare SVG markup
    let rawSvg = options.svgString || "";
    if (!rawSvg && options.svgElement) {
      if (window.Clarity && window.Clarity.getStandaloneSvgString) {
        rawSvg = window.Clarity.getStandaloneSvgString(options.svgElement);
      } else {
        rawSvg = new XMLSerializer().serializeToString(options.svgElement);
      }
    }

    if (!rawSvg) {
      if (window.Clarity && window.Clarity.toast) {
        window.Clarity.toast.show("No diagram graphic available to preview", "warning");
      }
      return;
    }

    // Create Modal Element
    const modalEl = document.createElement("div");
    modalEl.className = "diagram-modal-viewer is-open";
    modalEl.setAttribute("role", "dialog");
    modalEl.setAttribute("aria-modal", "true");
    modalEl.setAttribute("aria-label", title);

    modalEl.innerHTML = `
      <div class="diagram-modal-header">
        <div class="diagram-modal-header-left">
          <button type="button" class="diagram-modal-back-btn" id="dmBackBtn" title="Back to Document / Project (Esc)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
              <line x1="9" y1="12" x2="20" y2="12"></line>
            </svg>
            <span>Back</span>
            <kbd class="diagram-modal-kbd">Esc</kbd>
          </button>
        </div>

        <div class="diagram-modal-header-center">
          <div class="diagram-modal-zoom-group">
            <button type="button" class="btn btn--xs btn--ghost" id="dmZoomOutBtn" title="Zoom Out (−)">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <span class="diagram-modal-zoom-label" id="dmZoomLabel">100%</span>
            <button type="button" class="btn btn--xs btn--ghost" id="dmZoomInBtn" title="Zoom In (+)">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button type="button" class="btn btn--xs btn--outline" id="dmFitBtn" title="Fit to Screen (0)">Fit</button>
            <button type="button" class="btn btn--xs btn--ghost" id="dmResetBtn" title="Reset Zoom (100%)">1:1</button>
          </div>
          <button type="button" class="btn btn--xs btn--outline" id="dmBgToggleBtn" title="Toggle Light / Dark / Grid Canvas Background" style="display:inline-flex; align-items:center; gap:5px; font-size:11.5px;">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
            <span>Canvas BG</span>
          </button>
        </div>

        <div class="diagram-modal-header-right">
          <button type="button" class="diagram-modal-dl-png" id="dmDownloadPngBtn" title="Download High-Res PNG graphic">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Download PNG</span>
          </button>
          <button type="button" class="diagram-modal-dl-jpg" id="dmDownloadJpgBtn" title="Download High-Quality JPG graphic">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Download JPG</span>
          </button>
          <button type="button" class="diagram-modal-close-icon-btn" id="dmCloseTopBtn" title="Close Fullscreen (Esc)" aria-label="Close modal">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <div class="diagram-modal-stage" id="dmStage">
        <div class="diagram-modal-instructions">
          <span>Drag to pan • Scroll to zoom • Double-click to fit • Press <strong>Esc</strong> to exit</span>
        </div>

        <div class="diagram-modal-svg-wrapper" id="dmSvgWrapper">
          ${rawSvg}
        </div>
      </div>
    `;

    document.body.appendChild(modalEl);
    activeModalEl = modalEl;

    // Save previous overflow style to restore on close
    const prevBodyOverflow = document.body ? document.body.style.overflow : "";
    if (document.body) {
      document.body.style.overflow = "hidden";
    }

    // Grab inner elements
    const stage = modalEl.querySelector("#dmStage");
    const wrapper = modalEl.querySelector("#dmSvgWrapper");
    const zoomLabel = modalEl.querySelector("#dmZoomLabel");
    const svgEl = wrapper ? wrapper.querySelector("svg") : null;

    if (svgEl && svgEl.style) {
      svgEl.style.width = "auto";
      svgEl.style.height = "auto";
      svgEl.style.maxWidth = "none";
      svgEl.style.maxHeight = "none";
      svgEl.style.display = "block";
    }

    // Zoom & Pan State
    let zoom = typeof options.initialZoom === "number" ? options.initialZoom : 1.0;
    let panX = 0;
    let panY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let bgState = 0; // 0: default theme surface, 1: white canvas, 2: dark canvas, 3: dotted grid

    function updateTransform() {
      if (!wrapper) return;
      wrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      if (zoomLabel) {
        zoomLabel.textContent = Math.round(zoom * 100) + "%";
      }
    }

    function fitToScreen() {
      if (!svgEl || !stage) {
        zoom = 1.0;
        panX = 0;
        panY = 0;
        updateTransform();
        return;
      }
      const stageRect = stage.getBoundingClientRect();
      const svgRect = svgEl.getBBox ? svgEl.getBBox() : svgEl.getBoundingClientRect();
      const svgW = svgRect.width || 800;
      const svgH = svgRect.height || 600;

      const scaleX = (stageRect.width - 80) / svgW;
      const scaleY = (stageRect.height - 80) / svgH;
      zoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.35), 2.5);
      zoom = Number(zoom.toFixed(2));
      panX = 0;
      panY = 0;
      updateTransform();
    }

    // Auto-fit on open
    setTimeout(fitToScreen, 50);

    // Zoom Controls
    modalEl.querySelector("#dmZoomInBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      zoom = Math.min(5.0, Number((zoom + 0.25).toFixed(2)));
      updateTransform();
    });

    modalEl.querySelector("#dmZoomOutBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      zoom = Math.max(0.2, Number((zoom - 0.25).toFixed(2)));
      updateTransform();
    });

    modalEl.querySelector("#dmFitBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      fitToScreen();
    });

    modalEl.querySelector("#dmResetBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      zoom = 1.0;
      panX = 0;
      panY = 0;
      updateTransform();
    });

    // Background toggle
    modalEl.querySelector("#dmBgToggleBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      bgState = (bgState + 1) % 4;
      stage.classList.remove("bg-white", "bg-dark", "bg-grid");
      if (bgState === 1) {
        stage.classList.add("bg-white");
      } else if (bgState === 2) {
        stage.classList.add("bg-dark");
      } else if (bgState === 3) {
        stage.classList.add("bg-grid");
      }
    });

    // Downloads
    modalEl.querySelector("#dmDownloadPngBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const targetSvg = wrapper.querySelector("svg");
      if (targetSvg && window.Clarity && window.Clarity.downloadPngDiagram) {
        window.Clarity.downloadPngDiagram(targetSvg, `${baseFilename}.png`);
      } else {
        window.Clarity?.toast?.show("Unable to export PNG graphic", "error");
      }
    });

    modalEl.querySelector("#dmDownloadJpgBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const targetSvg = wrapper.querySelector("svg");
      if (targetSvg && window.Clarity && window.Clarity.downloadJpgDiagram) {
        window.Clarity.downloadJpgDiagram(targetSvg, `${baseFilename}.jpg`);
      } else {
        window.Clarity?.toast?.show("Unable to export JPG graphic", "error");
      }
    });

    // Pan interactions
    stage.addEventListener("mousedown", (e) => {
      if (e.target.closest("button") || e.target.closest(".diagram-modal-header")) return;
      isDragging = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
      stage.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      updateTransform();
    });

    window.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        if (stage) stage.style.cursor = "grab";
      }
    });

    // Touch pan & pinch-to-zoom interactions
    let initialTouchPinchDist = null;
    let initialTouchZoom = 1;
    let isTouchPanning = false;

    stage.addEventListener("touchstart", (e) => {
      if (e.target.closest("button") || e.target.closest(".diagram-modal-header")) return;
      if (e.touches.length === 1) {
        isTouchPanning = true;
        startX = e.touches[0].clientX - panX;
        startY = e.touches[0].clientY - panY;
      } else if (e.touches.length === 2) {
        isTouchPanning = false;
        initialTouchZoom = zoom;
        initialTouchPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: false });

    stage.addEventListener("touchmove", (e) => {
      if (e.touches.length === 1 && isTouchPanning) {
        e.preventDefault();
        panX = e.touches[0].clientX - startX;
        panY = e.touches[0].clientY - startY;
        updateTransform();
      } else if (e.touches.length === 2 && initialTouchPinchDist) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (initialTouchPinchDist > 0) {
          const factor = dist / initialTouchPinchDist;
          const newZoom = Math.min(Math.max(initialTouchZoom * factor, 0.2), 5.0);
          zoom = Number(newZoom.toFixed(2));
          updateTransform();
        }
      }
    }, { passive: false });

    stage.addEventListener("touchend", (e) => {
      if (e.touches.length === 1) {
        isTouchPanning = true;
        startX = e.touches[0].clientX - panX;
        startY = e.touches[0].clientY - panY;
        initialTouchPinchDist = null;
      } else if (e.touches.length === 0) {
        isTouchPanning = false;
        initialTouchPinchDist = null;
      }
    });

    stage.addEventListener("touchcancel", () => {
      isTouchPanning = false;
      initialTouchPinchDist = null;
    });

    // Wheel zoom
    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const newZoom = Math.min(Math.max(zoom * zoomFactor, 0.2), 5.0);
      zoom = Number(newZoom.toFixed(2));
      updateTransform();
    }, { passive: false });

    // Double click to fit
    stage.addEventListener("dblclick", (e) => {
      if (e.target.closest("button") || e.target.closest(".diagram-modal-header")) return;
      fitToScreen();
    });

    // Close / Back Handlers
    function handleClose() {
      if (document.body) {
        document.body.style.overflow = prevBodyOverflow;
      }
      if (activeKeydownListener) {
        window.removeEventListener("keydown", activeKeydownListener);
        activeKeydownListener = null;
      }
      if (modalEl && modalEl.parentNode) {
        modalEl.classList.remove("is-open");
        setTimeout(() => {
          if (modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
        }, 150);
      }
      activeModalEl = null;
      if (typeof options.onClose === "function") {
        options.onClose();
      }
      if (window.Clarity && window.Clarity.toast) {
        window.Clarity.toast.show("Returned to normal view", "info");
      }
    }

    modalEl.querySelector("#dmBackBtn")?.addEventListener("click", handleClose);
    modalEl.querySelector("#dmCloseTopBtn")?.addEventListener("click", handleClose);

    // Keyboard Shortcuts
    activeKeydownListener = function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoom = Math.min(5.0, Number((zoom + 0.25).toFixed(2)));
        updateTransform();
      } else if (e.key === "-") {
        e.preventDefault();
        zoom = Math.max(0.2, Number((zoom - 0.25).toFixed(2)));
        updateTransform();
      } else if (e.key === "0" || e.key === "f" || e.key === "F") {
        e.preventDefault();
        fitToScreen();
      }
    };
    window.addEventListener("keydown", activeKeydownListener);

    if (window.Clarity && window.Clarity.toast) {
      window.Clarity.toast.show("Full-screen diagram viewer opened (Press Esc or click Back to exit)", "info");
    }
  }

  function closeDiagramModalViewer() {
    if (activeModalEl) {
      const backBtn = activeModalEl.querySelector("#dmBackBtn");
      if (backBtn) {
        backBtn.click();
      } else {
        if (activeModalEl.parentNode) {
          activeModalEl.parentNode.removeChild(activeModalEl);
        }
        activeModalEl = null;
      }
    }
  }

  function downloadSvgDirect(svgElementOrString, filename) {
    let svgStr = "";
    if (typeof svgElementOrString === "string") {
      svgStr = svgElementOrString;
    } else if (svgElementOrString) {
      if (window.Clarity && window.Clarity.getStandaloneSvgString) {
        svgStr = window.Clarity.getStandaloneSvgString(svgElementOrString);
      } else {
        svgStr = new XMLSerializer().serializeToString(svgElementOrString);
      }
    }
    if (!svgStr) {
      if (window.Clarity && window.Clarity.toast) window.Clarity.toast.show("No visual available to download", "warning");
      return;
    }
    const safeName = (filename || "clarity_visual").replace(/[^a-zA-Z0-9_\-]/g, "_") + ".svg";
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    if (window.Clarity && window.Clarity.toast) {
      window.Clarity.toast.show(`Downloaded ${safeName}`, "success");
    }
  }

  window.Clarity.downloadSvgDirect = downloadSvgDirect;
  window.Clarity.openDiagramModalViewer = openDiagramModalViewer;
  window.Clarity.openVisualFullView = openDiagramModalViewer;
  window.Clarity.closeDiagramModalViewer = closeDiagramModalViewer;
})();
