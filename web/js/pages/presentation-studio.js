window.Darkness = window.Darkness || {};
window.Darkness.pages = window.Darkness.pages || {};

window.Darkness.pages["presentation-studio"] = async function renderPresentationStudio() {
  const main = document.getElementById("main");
  if (!main) return;

  // Slide Presentation State
  let presentationTitle = "Untitled Presentation";
  let activeSlideIndex = 0;
  let slideSize = "16:9"; // 16:9 | 4:3
  let activeTheme = "creative"; // creative | modern | classic
  let zoomLevel = 100; // percent
  let isSideNavCollapsed = false;

  // AI Edit Mode & Real Selection State
  let isAiEditMode = false;
  let activePresentationSelection = null; // { slideIndex, slideId, field: "title" | "content" | "image" | "slide", selectedText, imageUrl }

  let slides = [
    {
      id: "slide_1",
      title: "Untitled Presentation",
      content: "Use the AI Task Workspace chat panel on the left to generate beautiful slides.\nYou can enter any topic or request to get started.",
      layout: "title",
      notes: "Welcome slide. Prompt the AI assistant to populate structured content."
    }
  ];

  // Chat History Store & Generation Control
  let chatHistory = [];
  let isGenerating = false;
  let activeAbortController = null;

  const savedHistory = localStorage.getItem("darkness_pres_chat_history");
  if (savedHistory) {
    try {
      chatHistory = JSON.parse(savedHistory);
    } catch (err) {}
  }

  function saveChatHistory() {
    localStorage.setItem("darkness_pres_chat_history", JSON.stringify(chatHistory));
  }

  // Undo/Redo Version History Stack
  const undoStack = [];
  const redoStack = [];
  let isUnsaved = false;

  // LocalStorage Auto-recovery
  const savedPres = localStorage.getItem("darkness_prompt_pres_save");
  if (savedPres) {
    try {
      const parsed = JSON.parse(savedPres);
      presentationTitle = parsed.title || presentationTitle;
      slides = parsed.slides || slides;
      slideSize = parsed.size || slideSize;
      activeTheme = parsed.theme || activeTheme;
      activeSlideIndex = Math.min(parsed.activeIndex || 0, slides.length - 1);
    } catch (err) {}
  }

  function recordState() {
    undoStack.push({
      title: presentationTitle,
      slides: JSON.parse(JSON.stringify(slides)),
      size: slideSize,
      theme: activeTheme,
      activeIndex: activeSlideIndex
    });
    redoStack.length = 0; // Clear redo
    isUnsaved = true;
    saveLocalPres();
    updateWorkspaceHeaderStatus();
  }

  function saveLocalPres() {
    localStorage.setItem("darkness_prompt_pres_save", JSON.stringify({
      title: presentationTitle,
      slides: slides,
      size: slideSize,
      theme: activeTheme,
      activeIndex: activeSlideIndex
    }));
  }

  // Initial Workspace Render
  function renderLayout() {
    main.innerHTML = `
      <div class="page prompt-workspace-container" style="display: flex; height: calc(100vh - 60px); background: var(--canvas); overflow: hidden; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; position: relative;">
        
        <!-- Mobile Backdrop for AI Chat Drawer & Slides Overview Drawer -->
        <div id="presChatMobileBackdrop" class="studio-mobile-backdrop"></div>
        <div id="presSideNavMobileBackdrop" class="studio-mobile-backdrop"></div>

        <!-- Left Panel: Prompt and presentation AI controls -->
        <aside id="presentationAiChatPanel" style="width: 360px; border-right: 1px solid var(--line); background: var(--surface); display: flex; flex-direction: column; flex-shrink: 0; padding: 0; overflow: hidden;">
          
          <!-- Mode Tabs (Studio Toggle) -->
          <div style="display: none !important; gap: 4px; background: var(--surface-muted); padding: 4px; border-radius: 8px;">
            <button class="btn btn--sm" id="tabDocStudio" style="flex: 1; font-size: 12px; font-weight: 500; padding: 6px 12px; border-radius: 6px; background: transparent; color: var(--ink-muted); border: none;" onclick="location.hash='#/document-studio'">
              📄 Document
            </button>
            <button class="btn btn--sm" id="tabPresStudio" style="flex: 1; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 6px; background: var(--surface); color: #f43f5e; box-shadow: var(--shadow-sm); border: none;">
              📊 Presentation Studio
            </button>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; height: 48px; min-height: 48px; max-height: 48px; padding: 0 16px; border-bottom: 1px solid var(--line); box-sizing: border-box; flex-shrink: 0;">
            <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--ink-muted); letter-spacing: 0.05em;">AI Task Workspace</span>
            <div style="display: flex; align-items: center; gap: 6px;">
              <button class="btn btn--xs btn--ghost" id="btnClearChatHistory" style="font-size: 10px; color: var(--ink-soft); display: flex; align-items: center; gap: 4px; padding: 2px 6px; cursor: pointer; border-radius: 4px; border: 1px solid var(--line);" title="Reset conversation">
                🗑️ Clear
              </button>
              <button class="btn btn--xs btn--outline studio-mobile-only" id="btnMobileClosePresChat" style="font-size: 11px; color: var(--ink); padding: 2px 8px; border-radius: 4px; font-weight: 600; border-color: var(--line-strong);" title="Close Chat Drawer">
                ✕ Close
              </button>
            </div>
          </div>

          <div style="flex: 1; display: flex; flex-direction: column; padding: 14px 16px; gap: 12px; overflow: hidden;">
            <!-- AI Edit Mode Toggle Bar -->
            <div id="aiEditModeBar" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--surface-muted); border: 1px solid var(--line); border-radius: 8px; user-select: none;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 11.5px; font-weight: 700; color: var(--ink);">⚡ AI Edit Mode</span>
                <span id="aiEditModeBadge" style="font-size: 9.5px; font-weight: 700; padding: 1px 6px; border-radius: 10px; background: var(--surface); border: 1px solid var(--line); color: var(--ink-muted); text-transform: uppercase;">OFF</span>
              </div>
              <label style="position: relative; display: inline-flex; align-items: center; cursor: pointer; margin: 0;">
                <input type="checkbox" id="toggleAiEditMode" style="cursor: pointer; width: 15px; height: 15px; accent-color: #f43f5e;" />
              </label>
            </div>

            <!-- Chat messages area -->
            <div id="aiChatMessages" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding-right: 4px;">
              <!-- Rendered dynamically -->
            </div>

  <!-- Removed aiChatSuggestions -->

            <!-- Configuration & Multiline Input Area -->
            <div style="display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--line); padding-top: 10px;">
              
              <!-- Selection Target Preview Box -->
              <div id="selectionPreviewContainer" style="display: none;"></div>

              <div id="aiCreationStatusContainer" style="display: none; background: rgba(244,63,94,0.05); border: 1px solid rgba(244,63,94,0.15); border-radius: 8px; padding: 10px; flex-direction: column; gap: 6px;">
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                  <strong id="aiStatusTitle" style="color: #f43f5e; display: flex; align-items: center; gap: 6px;">
                    <span class="spinner-small" style="width: 12px; height: 12px; border: 2px solid #f43f5e; border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite;"></span>
                    Synthesizing Presentation...
                  </strong>
                  <span id="aiStepProgress" style="color: var(--ink-muted); font-weight: 500;">Drafting...</span>
                </div>
                <p style="font-size: 11px; color: var(--ink-soft); margin: 0;" id="aiStatusSubtext">Drafting slide layouts and speaker guides.</p>
              </div>

              <div id="aiErrorBanner" style="display: none; background: rgba(239,68,68,0.05); border: 1px solid rgba(239,68,68,0.15); border-radius: 8px; padding: 10px; color: #ef4444; font-size: 11px; line-height: 1.45;">
                <strong>Task Failed:</strong> <span id="aiErrorMessage">Error parsing JSON model structure.</span>
              </div>

  <!-- Removed slideThemeSelector and slideSizeSelector -->

              <div style="display: none !important;">
                <select id="aiSlidesCount">
                  <option value="6" selected>6 Slides</option>
                </select>
                <select id="slideLayoutSelector">
                  <option value="content" selected>Content</option>
                </select>
                <input type="text" id="presStudioTitle" value="${window.Darkness.utils.escapeHtml(presentationTitle)}" />
              </div>

              <div class="studio-chat-input-pill studio-chat-input-pill--pres">
                <textarea id="aiPresCreatorPrompt" class="studio-chat-textarea" rows="1" placeholder="Ask to write..."></textarea>
                <button id="btnAiPresGenerate" type="button" style="background: #f43f5e; color: white;" title="Send Request">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 2 15 22 11 13 2 9 22 2"/><line x1="22" y1="2" x2="11" y2="13"/></svg>
                </button>
              </div>
            </div>
          </div>

        </aside>

        <!-- Center Panel: Immersive Slide Preview -->
        <main style="flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative;">
          
          <!-- Workspace Control Toolbar (Single Level 48px Header) -->
          <header class="workspace-nav">
            <div class="studio-header-title-box">
              <button class="studio-top-left-nav-btn" id="btnToggleSideNavTop" title="Toggle Slides Overview (Panel)" style="color: #f43f5e; border-color: #f43f5e;" type="button">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
              </button>
              <span class="studio-header-title" id="headerTitle">Presentation Studio</span>
              <span id="unsavedPresBadge" class="studio-draft-badge" style="display: none !important;">Draft</span>
            </div>

            <!-- Secondary Tool Strip in Middle (Pagination, Undo/Redo, Zoom/Fit) -->
            <div class="studio-header-secondary">
              <!-- Pagination -->
              <div class="studio-tool-group">
                <button class="btn btn--xs btn--outline" id="btnPrevSlide" style="padding: 4px;" title="Previous Slide"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>
                <span style="font-size: 11px; font-weight: 600; color: var(--ink-soft); padding: 0 4px; white-space: nowrap;" id="labelSlideCounter">Slide 1 of 4</span>
                <button class="btn btn--xs btn--outline" id="btnNextSlide" style="padding: 4px;" title="Next Slide"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>
              </div>

              <div class="studio-tool-divider"></div>

              <!-- Undo / Redo -->
              <div class="studio-tool-group">
                <button class="btn btn--xs btn--ghost" id="btnPresUndo" style="padding: 4px;" title="Undo (Ctrl+Z)"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg></button>
                <button class="btn btn--xs btn--ghost" id="btnPresRedo" style="padding: 4px;" title="Redo (Ctrl+Y)"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg></button>
              </div>

              <div class="studio-tool-divider"></div>

              <!-- Zoom & Fit Controls -->
              <div class="studio-tool-group">
                <button class="btn btn--xs btn--ghost" id="btnZoomOut" title="Zoom Out" style="padding: 3px; color: var(--ink-soft);"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
                <button class="btn btn--xs btn--ghost" id="btnFitScreen" title="Fit to Screen width" style="font-size: 11px; font-weight: 600; color: var(--ink); padding: 0 4px; min-width: 38px; text-align: center;"><span id="labelZoom">100%</span></button>
                <button class="btn btn--xs btn--ghost" id="btnZoomIn" title="Zoom In" style="padding: 3px; color: var(--ink-soft);"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
              </div>
            </div>

            <!-- Primary Actions on Right -->
            <div class="studio-header-primary-actions">
              <button class="btn btn--xs btn--primary studio-mobile-toggle-chat" id="btnMobileTogglePresChat" style="background: #f43f5e;" title="Open AI Chat Drawer">
                💬 <span class="mobile-btn-text">AI Chat</span>
              </button>
              <!-- Presentation Play Mode -->
              <button class="btn btn--xs btn--outline" id="btnSlideshowStart" style="display: inline-flex; align-items: center; gap: 4px; border-color: #f43f5e; color: #f43f5e; font-weight: 600; padding: 4px 8px;">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span>Present</span>
              </button>
              <!-- Unified Single Option: Export & Actions Dropdown (Icon Only) -->
              <div class="studio-actions-dropdown-container">
                <button class="btn btn--sm btn--primary studio-actions-btn" id="btnStudioActionsMenu" style="background: #f43f5e; color: white;" title="Export & Slide Actions" type="button">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </button>

                <div class="studio-actions-menu" id="studioActionsDropdown">
                  <button class="studio-dropdown-item" id="btnPptxExport" type="button">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#f43f5e" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                    <div>
                      <div style="font-weight: 600; font-size: 12.5px; color: var(--ink);">Export as PowerPoint (.pptx)</div>
                      <div style="font-size: 10px; color: var(--ink-muted);">Standard PPTX slide deck</div>
                    </div>
                  </button>

                  <button class="studio-dropdown-item" id="btnPrintSlideDeck" type="button">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="color: #6366f1;"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                    <div>
                      <div style="font-weight: 600; font-size: 12.5px; color: var(--ink);">Print / Save as PDF</div>
                      <div style="font-size: 10px; color: var(--ink-muted);">Print dialog vector slides</div>
                    </div>
                  </button>

                  <div style="height: 1px; background: var(--line); margin: 4px 6px;"></div>

                  <button class="studio-dropdown-item studio-dropdown-item-danger" id="btnResetPresCanvas" type="button">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#ef4444" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    <div>
                      <div style="font-weight: 600; font-size: 12.5px; color: #ef4444;">Clear Slide Deck</div>
                      <div style="font-size: 10px; color: #ef4444; opacity: 0.85;">Reset all slides to blank</div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </header>

          <!-- Core canvas outer wrapper (Centering slide) -->
          <div style="flex: 1; display: flex; flex-direction: column; overflow-y: auto; align-items: center; padding: 40px 16px; gap: 24px; position: relative;" id="slideCanvasWrapper">
            
            <!-- Slide Canvas Board -->
            <div id="slidePaperPageCanvas" style="
              width: 800px; 
              height: 450px; 
              background: #ffffff; 
              border: 1px solid var(--line-strong); 
              box-shadow: 0 4px 16px rgba(0,0,0,0.08); 
              border-radius: 4px; 
              position: relative; 
              display: flex; 
              flex-direction: column; 
              padding: 40px; 
              box-sizing: border-box;
              transition: all 0.2s ease-out;
              transform-origin: top center;
            ">
              <!-- Active Theme top border line -->
              <div id="slideActiveThemeAccentLine" style="position: absolute; top: 0; left: 0; right: 0; height: 6px; background: var(--accent);"></div>

              <!-- Active Slide Title Box -->
              <div id="slideActiveTitleContainer" class="selectable-slide-object" data-field="title" style="border: 1px dashed transparent; border-radius: 4px; cursor: pointer; transition: border 0.15s; margin-bottom: 20px;">
                <h1 id="slideActiveTitleDisplay" style="font-size: 32px; font-weight: 700; color: #111827; margin: 0; outline: none; border: none; background: transparent;">Slide Title</h1>
              </div>

              <!-- Active Slide Content Body -->
              <div id="slideActiveContentContainer" class="selectable-slide-object" data-field="content" style="flex: 1; border: 1px dashed transparent; border-radius: 4px; cursor: pointer; transition: border 0.15s; min-height: 180px;">
                <div id="slideActiveContentDisplay" style="font-size: 18px; line-height: 1.6; color: #374151; white-space: pre-wrap; outline: none;" contenteditable="true">Slide bullet point list content.</div>
              </div>

              <div style="display: none !important; justify-content: space-between; font-size: 11px; color: #9ca3af; margin-top: auto; border-top: 1px dashed #e2e8f0; padding-top: 12px; user-select: none;">
                <span id="slideCounterFooter" style="display: none !important;">Slide 1 of 4</span>
                <span id="slideFooterTitle" style="display: none !important;">${presentationTitle}</span>
              </div>
            </div>

          </div>

        </main>

        <!-- Right Panel: Side Slide Thumbnail Navigator -->
        <aside id="presentationSideNavigator" style="width: 240px; border-left: 1px solid var(--line); background: var(--surface); display: flex; flex-direction: column; flex-shrink: 0; box-sizing: border-box; overflow: hidden; z-index: 15;">
          <!-- Header Bar (Hidden from UI while retaining close/toggle functionality) -->
          <div style="display: none !important; padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--surface-muted); align-items: center; justify-content: space-between; flex-shrink: 0;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--ink-muted); letter-spacing: 0.05em; white-space: nowrap;">Slides Overview</span>
            </div>
            <button class="btn btn--xs btn--ghost" id="btnToggleSideNav" title="Close Panel" style="padding: 3px 6px; color: var(--ink-muted); font-size: 13px; font-weight: bold; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center;">✕</button>
          </div>
          
          <div id="slidesOverviewList" style="flex: 1; overflow-y: auto; scroll-snap-type: y mandatory; padding: 12px; display: flex; flex-direction: column; gap: 16px; align-items: center; width: 100%; box-sizing: border-box;">
            <!-- Dynamically populated page miniature thumbnails -->
          </div>

          <div style="padding: 12px; border-top: 1px solid var(--line); font-size: 11px; color: var(--ink-muted); display: flex; flex-direction: column; gap: 4px; background: var(--surface-muted); flex-shrink: 0;">
            <div style="display: flex; justify-content: space-between;">
              <span>Total slides:</span>
              <strong id="statSlideCount" style="color: var(--ink);">0</strong>
            </div>
          </div>
        </aside>

      </div>
    `;

    syncSlideCanvasAndUI();
    bindEvents();
    renderChatMessages();
  }

  function formatStudioChatMessage(rawText) {
    if (!rawText) return "";
    let str = String(rawText).trim();

    if (window.Darkness && window.Darkness.markdown && typeof window.Darkness.markdown.render === "function") {
      try {
        const mdHtml = window.Darkness.markdown.render(str);
        if (mdHtml && mdHtml.trim()) return mdHtml;
      } catch (e) {}
    }

    const lines = str.split("\n");
    let inUl = false;
    let inOl = false;
    let htmlParts = [];

    lines.forEach(line => {
      let trimmed = line.trim();
      const bulletMatch = trimmed.match(/^[-*+]\s+(.+)$/);
      const numMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
      const hMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);

      if (bulletMatch) {
        if (inOl) { htmlParts.push("</ol>"); inOl = false; }
        if (!inUl) { htmlParts.push('<ul style="margin: 8px 0 8px 20px; padding-left: 0; list-style-type: disc;">'); inUl = true; }
        let content = bulletMatch[1]
          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.*?)\*/g, "<em>$1</em>");
        htmlParts.push(`<li style="margin-bottom: 5px; line-height: 1.6; color: var(--ink, #1e293b);">${content}</li>`);
      } else if (numMatch) {
        if (inUl) { htmlParts.push("</ul>"); inUl = false; }
        if (!inOl) { htmlParts.push('<ol style="margin: 8px 0 8px 20px; padding-left: 0;">'); inOl = true; }
        let content = numMatch[2]
          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.*?)\*/g, "<em>$1</em>");
        htmlParts.push(`<li style="margin-bottom: 5px; line-height: 1.6; color: var(--ink, #1e293b);">${content}</li>`);
      } else {
        if (inUl) { htmlParts.push("</ul>"); inUl = false; }
        if (inOl) { htmlParts.push("</ol>"); inOl = false; }

        if (hMatch) {
          const level = hMatch[1].length;
          const fontSz = level === 1 ? "15px" : level === 2 ? "14px" : "13.5px";
          let content = hMatch[2]
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
            .replace(/\*(.*?)\*/g, "<em>$1</em>");
          htmlParts.push(`<div style="font-weight: 700; font-size: ${fontSz}; margin-top: 10px; margin-bottom: 4px; color: var(--ink, #0f172a);">${content}</div>`);
        } else if (trimmed) {
          let content = trimmed
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
            .replace(/\*(.*?)\*/g, "<em>$1</em>");
          htmlParts.push(`<p style="margin: 0 0 6px 0; line-height: 1.6; color: var(--ink, #1e293b);">${content}</p>`);
        } else {
          htmlParts.push('<div style="height: 6px;"></div>');
        }
      }
    });

    if (inUl) htmlParts.push("</ul>");
    if (inOl) htmlParts.push("</ol>");

    return htmlParts.join("");
  }

  function renderChatMessages() {
    const container = document.getElementById("aiChatMessages");
    if (!container) return;

    if (chatHistory.length === 0) {
      container.innerHTML = "";
      return;
    }

    container.innerHTML = chatHistory.map((msg, index) => {
      const isUser = msg.role === "user";
      const bg = isUser ? "rgba(244,63,94,0.08)" : "var(--surface-muted)";
      const border = isUser ? "1px solid rgba(244,63,94,0.15)" : "1px solid var(--line)";
      const align = isUser ? "flex-end" : "flex-start";
      const label = isUser ? "You" : "Darkness AI";
      const color = isUser ? "#f43f5e" : "var(--ink-muted)";
      
      const renderedText = formatStudioChatMessage(msg.text);

      let proposalHtml = "";
      if (msg.proposedEdit) {
        const prop = msg.proposedEdit;
        const origEscaped = window.Darkness.utils && window.Darkness.utils.escapeHtml ? window.Darkness.utils.escapeHtml(prop.originalText || "") : (prop.originalText || "");
        const propEscaped = window.Darkness.utils && window.Darkness.utils.escapeHtml ? window.Darkness.utils.escapeHtml(prop.proposedText || "") : (prop.proposedText || "");

        if (prop.status === "pending") {
          if (prop.targetType === "image") {
            proposalHtml = `
              <div class="proposed-diff-card" style="margin-top: 10px; border: 1px solid rgba(244,63,94,0.35); background: var(--surface); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 11px; font-weight: 700; color: #f43f5e; text-transform: uppercase; letter-spacing: 0.05em;">
                    🖼️ Proposed Image Replacement: Slide ${prop.slideIndex + 1}
                  </span>
                  <span style="font-size: 10px; background: rgba(234, 179, 8, 0.15); color: #ca8a04; padding: 1px 6px; border-radius: 4px; font-weight: 600;">Pending Review</span>
                </div>
                <div style="border-radius: 6px; overflow: hidden; border: 1px solid var(--line); max-height: 140px;">
                  <img src="${prop.imageUrl}" alt="Proposed Visual" style="width: 100%; height: 100%; object-fit: cover; display: block;" />
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px;">
                  <button class="btn btn--xs btn--outline btn-discard-pres-edit" data-msg-idx="${index}" style="font-size: 11px; padding: 3px 10px; cursor: pointer;">✕ Discard</button>
                  <button class="btn btn--xs btn--primary btn-apply-pres-edit" data-msg-idx="${index}" style="font-size: 11px; padding: 3px 12px; background: #f43f5e; border-color: #f43f5e; cursor: pointer; color: white; font-weight: 600;">✓ Apply Image</button>
                </div>
              </div>
            `;
          } else {
            proposalHtml = `
              <div class="proposed-diff-card" style="margin-top: 10px; border: 1px solid rgba(244,63,94,0.35); background: var(--surface); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 11px; font-weight: 700; color: #f43f5e; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 4px;">
                    ✨ Proposed Edit: <span style="color: var(--ink-soft); text-transform: capitalize;">Slide ${prop.slideIndex + 1} ${prop.field || "Element"}</span>
                  </span>
                  <span style="font-size: 10px; background: rgba(234, 179, 8, 0.15); color: #ca8a04; padding: 1px 6px; border-radius: 4px; font-weight: 600;">Pending Review</span>
                </div>
                <div style="font-size: 11.5px; background: rgba(239, 68, 68, 0.06); border-left: 3px solid #ef4444; padding: 6px 8px; border-radius: 4px;">
                  <span style="font-size: 9.5px; font-weight: 700; color: #ef4444; display: block; letter-spacing: 0.04em;">ORIGINAL</span>
                  <div style="color: var(--ink-soft); margin-top: 2px; max-height: 80px; overflow-y: auto;">${origEscaped}</div>
                </div>
                <div style="font-size: 11.5px; background: rgba(34, 197, 94, 0.08); border-left: 3px solid #22c55e; padding: 6px 8px; border-radius: 4px;">
                  <span style="font-size: 9.5px; font-weight: 700; color: #16a34a; display: block; letter-spacing: 0.04em;">PROPOSED REPLACEMENT</span>
                  <div style="color: var(--ink); font-weight: 500; margin-top: 2px; max-height: 120px; overflow-y: auto;">${propEscaped}</div>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px;">
                  <button class="btn btn--xs btn--outline btn-discard-pres-edit" data-msg-idx="${index}" style="font-size: 11px; padding: 3px 10px; cursor: pointer;">✕ Discard</button>
                  <button class="btn btn--xs btn--primary btn-apply-pres-edit" data-msg-idx="${index}" style="font-size: 11px; padding: 3px 12px; background: #f43f5e; border-color: #f43f5e; cursor: pointer; color: white; font-weight: 600;">✓ Apply Edit</button>
                </div>
              </div>
            `;
          }
        } else if (prop.status === "applied") {
          proposalHtml = `
            <div style="margin-top: 8px; background: rgba(34, 197, 94, 0.08); border: 1px solid rgba(34, 197, 94, 0.25); border-radius: 6px; padding: 6px 8px; font-size: 11px; color: #16a34a; font-weight: 600; display: flex; align-items: center; gap: 4px;">
              <span>✓ Edit committed to Slide ${prop.slideIndex + 1} and navigator.</span>
            </div>
          `;
        } else if (prop.status === "discarded") {
          proposalHtml = `
            <div style="margin-top: 8px; background: var(--surface-muted); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; font-size: 11px; color: var(--ink-muted); display: flex; align-items: center; gap: 4px;">
              <span>✕ Edit discarded. Presentation slides preserved without changes.</span>
            </div>
          `;
        }
      }

      return `
        <div style="align-self: ${align}; max-width: 90%; display: flex; flex-direction: column; gap: 2px;">
          <span style="font-size: 10px; font-weight: 700; color: ${color}; text-transform: uppercase; letter-spacing: 0.05em; align-self: ${align};">${label}</span>
          <div style="background: ${bg}; border: ${border}; padding: 10px 12px; border-radius: 8px; line-height: 1.5; font-size: 12.5px; color: var(--ink); word-break: break-word;">
            ${renderedText}
            ${proposalHtml}
          </div>
        </div>
      `;
    }).join("");

    container.scrollTop = container.scrollHeight;
  }

  function updateLoaderState(status, subtext = "") {
    const container = document.getElementById("aiCreationStatusContainer");
    const titleEl = document.getElementById("aiStatusTitle");
    const subtextEl = document.getElementById("aiStatusSubtext");
    const progressEl = document.getElementById("aiStepProgress");
    const stopBtn = document.getElementById("btnStopTask");
    const generateBtn = document.getElementById("btnAiPresGenerate");

    if (!container) return;

    if (status === "idle" || status === "completed" || status === "failed" || status === "cancelled") {
      container.style.display = "none";
      if (stopBtn) {
        stopBtn.disabled = true;
        stopBtn.style.opacity = "0.5";
        stopBtn.style.cursor = "not-allowed";
      }
      if (generateBtn) {
        generateBtn.disabled = false;
      }
      isGenerating = false;
      return;
    }

    container.style.display = "flex";
    isGenerating = true;
    if (generateBtn) generateBtn.disabled = true;
    if (stopBtn) {
      stopBtn.disabled = false;
      stopBtn.style.opacity = "1";
      stopBtn.style.cursor = "pointer";
    }

    if (status === "chatting" || status === "thinking") {
      titleEl.innerHTML = `<span class="spinner-small" style="width: 12px; height: 12px; border: 2px solid #f43f5e; border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite;"></span> Thinking...`;
      progressEl.textContent = "Responding...";
      subtextEl.textContent = subtext || "Darkness AI is drafting a response...";
    } else if (status === "planning") {
      titleEl.innerHTML = `<span class="spinner-small" style="width: 12px; height: 12px; border: 2px solid #f43f5e; border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite;"></span> Thinking/Planning`;
      progressEl.textContent = "Planning...";
      subtextEl.textContent = subtext || "Analyzing presentation outline and organizing next steps.";
    } else if (status === "generating") {
      titleEl.innerHTML = `<span class="spinner-small" style="width: 12px; height: 12px; border: 2px solid #f43f5e; border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite;"></span> Generating Slides`;
      progressEl.textContent = "Writing...";
      subtextEl.textContent = subtext || "Synthesizing individual slides, notes, and visual layouts.";
    } else if (status === "updating") {
      titleEl.innerHTML = `<span class="spinner-small" style="width: 12px; height: 12px; border: 2px solid #f43f5e; border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite;"></span> Updating Slides`;
      progressEl.textContent = "Modifying...";
      subtextEl.textContent = subtext || "Applying changes and modifications onto active presentation slides.";
    } else if (status === "exporting") {
      titleEl.innerHTML = `<span class="spinner-small" style="width: 12px; height: 12px; border: 2px solid #f43f5e; border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite;"></span> Exporting File`;
      progressEl.textContent = "Compiling...";
      subtextEl.textContent = subtext || "Packing PowerPoint PPTX format.";
    }
  }

  // Intercept and bind all interactives
  function bindEvents() {
    const titleInput = document.getElementById("presStudioTitle");
    const activeContentDisplay = document.getElementById("slideActiveContentDisplay");
    const activeNotes = document.getElementById("slideActiveNotesArea");
    const btnGenerate = document.getElementById("btnAiPresGenerate");
    const btnPptxExport = document.getElementById("btnPptxExport");
    const themeSelect = document.getElementById("slideThemeSelector");
    const sizeSelect = document.getElementById("slideSizeSelector");
    const layoutSelect = document.getElementById("slideLayoutSelector");

    // Title Sync
    if (titleInput) {
      titleInput.addEventListener("input", (e) => {
        presentationTitle = e.target.value;
        const footerTitle = document.getElementById("slideFooterTitle");
        if (footerTitle) footerTitle.textContent = presentationTitle;
        saveLocalPres();
      });
    }

    // Content Display Input sync
    if (activeContentDisplay) {
      activeContentDisplay.addEventListener("input", () => {
        if (slides.length > 0) {
          slides[activeSlideIndex].content = activeContentDisplay.innerText;
          isUnsaved = true;
          saveLocalPres();
          updateWorkspaceHeaderStatus();
          renderSlideThumbnails();
        }
      });
    }

    // Notes Sync
    if (activeNotes) {
      activeNotes.addEventListener("input", () => {
        if (slides.length > 0) {
          slides[activeSlideIndex].notes = activeNotes.value;
          saveLocalPres();
        }
      });
    }

    // Option Dropdowns re-flow
    if (themeSelect) {
      themeSelect.addEventListener("change", (e) => {
        recordState();
        activeTheme = e.target.value;
        applyThemeStyles();
      });
    }
    if (sizeSelect) {
      sizeSelect.addEventListener("change", (e) => {
        recordState();
        slideSize = e.target.value;
        applySlideSizeStyles();
      });
    }
    if (layoutSelect) {
      layoutSelect.addEventListener("change", (e) => {
        recordState();
        if (slides.length > 0) {
          slides[activeSlideIndex].layout = e.target.value;
          syncSlideCanvasAndUI();
        }
      });
    }

    // Zoom & Fit Controls
    document.getElementById("btnZoomIn")?.addEventListener("click", () => {
      if (zoomLevel < 160) {
        zoomLevel += 10;
        applyZoom();
      }
    });
    document.getElementById("btnZoomOut")?.addEventListener("click", () => {
      if (zoomLevel > 30) {
        zoomLevel -= 10;
        applyZoom();
      }
    });
    document.getElementById("btnFitScreen")?.addEventListener("click", () => {
      autoFitMobileSlide();
    });

    // Studio Actions Dropdown (Export & Clear sub-options)
    const btnActionsMenu = document.getElementById("btnStudioActionsMenu");
    const actionsDropdown = document.getElementById("studioActionsDropdown");
    if (btnActionsMenu && actionsDropdown) {
      btnActionsMenu.addEventListener("click", (e) => {
        e.stopPropagation();
        actionsDropdown.classList.toggle("open");
      });
      document.addEventListener("click", (e) => {
        if (!actionsDropdown.contains(e.target) && e.target !== btnActionsMenu) {
          actionsDropdown.classList.remove("open");
        }
      });
      actionsDropdown.querySelectorAll(".studio-dropdown-item").forEach(item => {
        item.addEventListener("click", () => {
          actionsDropdown.classList.remove("open");
        });
      });
    }

    // Print slide deck dialog
    document.getElementById("btnPrintSlideDeck")?.addEventListener("click", () => {
      window.print();
    });

    // Responsive resize auto-fit
    window.addEventListener("resize", () => {
      if (window.location.hash.includes("presentation-studio") && window.innerWidth <= 768) {
        autoFitMobileSlide();
      }
    });

    // Previous/Next slide
    document.getElementById("btnPrevSlide")?.addEventListener("click", () => {
      if (activeSlideIndex > 0) {
        activeSlideIndex--;
        syncSlideCanvasAndUI();
      }
    });
    document.getElementById("btnNextSlide")?.addEventListener("click", () => {
      if (activeSlideIndex < slides.length - 1) {
        activeSlideIndex++;
        syncSlideCanvasAndUI();
      }
    });

    // Undo/Redo Version actions
    document.getElementById("btnUndo")?.addEventListener("click", () => {
      if (undoStack.length > 0) {
        const state = undoStack.pop();
        redoStack.push({
          title: presentationTitle,
          slides: JSON.parse(JSON.stringify(slides)),
          size: slideSize,
          theme: activeTheme,
          activeIndex: activeSlideIndex
        });
        applyState(state);
      }
    });
    document.getElementById("btnRedo")?.addEventListener("click", () => {
      if (redoStack.length > 0) {
        const state = redoStack.pop();
        undoStack.push({
          title: presentationTitle,
          slides: JSON.parse(JSON.stringify(slides)),
          size: slideSize,
          theme: activeTheme,
          activeIndex: activeSlideIndex
        });
        applyState(state);
      }
    });

    // Reset Presentation Canvas Action (Clear Desk / Everything)
    const btnResetPres = document.getElementById("btnResetPresCanvas");
    if (btnResetPres) {
      btnResetPres.addEventListener("click", () => {
        recordState();
        slides = [{
          id: "slide_1",
          title: "",
          subtitle: "",
          content: "Use the AI Task Workspace on the left to create a presentation on any topic.",
          layout: "title",
          notes: ""
        }];
        activeSlideIndex = 0;
        presentationTitle = "Untitled Presentation";
        try { localStorage.removeItem("darkness_presentation_draft"); } catch {}
        try { localStorage.removeItem("darkness_presentation_title"); } catch {}
        try { localStorage.removeItem("darkness_pres_chat_history"); } catch {}
        const presTitleInput = document.getElementById("presStudioTitle");
        if (presTitleInput) presTitleInput.value = "Untitled Presentation";
        const headerTitle = document.getElementById("headerTitle");
        if (headerTitle) headerTitle.textContent = "Presentation Studio";
        clearStudioChat();
        syncSlideCanvasAndUI();
        const studioActionsDropdown = document.getElementById("studioActionsDropdown");
        if (studioActionsDropdown) studioActionsDropdown.classList.remove("active");
        const promptInput = document.getElementById("aiPresCreatorPrompt");
        if (promptInput) {
          promptInput.value = "";
          resizePresPrompt();
        }
        if (window.Darkness.toast) window.Darkness.toast.show("Presentation cleared. Ready for a new topic!", "info");
      });
    }

    // Suggestion Chips
    document.querySelectorAll(".suggestion-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const promptInput = document.getElementById("aiPresCreatorPrompt");
        if (promptInput) {
          promptInput.value = chip.dataset.prompt;
          promptInput.focus();
        }
      });
    });

    // Right Side Navigator (Slides Overview) Clean Toggle Logic
    function setPresSideNavOpen(open) {
      const sideNav = document.getElementById("presentationSideNavigator");
      const floatingBtn = document.getElementById("btnOpenSideNavFloating");
      const topNavBtn = document.getElementById("btnToggleSideNavTop");
      const sideBackdrop = document.getElementById("presSideNavMobileBackdrop");
      if (!sideNav) return;

      const isMobile = window.innerWidth <= 768;
      isSideNavCollapsed = !open;

      if (isMobile) {
        if (open) {
          sideNav.classList.add("mobile-open");
          if (sideBackdrop) sideBackdrop.classList.add("active");
          if (topNavBtn) {
            topNavBtn.style.background = "var(--surface-muted)";
            topNavBtn.style.borderColor = "#f43f5e";
            topNavBtn.style.color = "#f43f5e";
          }
        } else {
          sideNav.classList.remove("mobile-open");
          if (sideBackdrop) sideBackdrop.classList.remove("active");
          if (topNavBtn) {
            topNavBtn.style.background = "var(--surface)";
            topNavBtn.style.borderColor = "var(--line-strong)";
            topNavBtn.style.color = "var(--ink)";
          }
        }
      } else {
        if (open) {
          sideNav.classList.remove("collapsed");
          sideNav.style.display = "flex";
          if (floatingBtn) floatingBtn.style.display = "none";
          if (topNavBtn) {
            topNavBtn.style.background = "var(--surface-muted)";
            topNavBtn.style.borderColor = "#f43f5e";
            topNavBtn.style.color = "#f43f5e";
          }
        } else {
          sideNav.classList.add("collapsed");
          sideNav.style.display = "none";
          if (floatingBtn) floatingBtn.style.display = "flex";
          if (topNavBtn) {
            topNavBtn.style.background = "var(--surface)";
            topNavBtn.style.borderColor = "var(--line-strong)";
            topNavBtn.style.color = "var(--ink)";
          }
        }
      }
    }

    const btnToggleSideNav = document.getElementById("btnToggleSideNav");
    if (btnToggleSideNav) {
      btnToggleSideNav.addEventListener("click", () => setPresSideNavOpen(false));
    }

    const btnToggleSideNavTop = document.getElementById("btnToggleSideNavTop");
    if (btnToggleSideNavTop) {
      btnToggleSideNavTop.addEventListener("click", () => {
        const sideNav = document.getElementById("presentationSideNavigator");
        const isMobile = window.innerWidth <= 768;
        const isOpen = isMobile
          ? (sideNav && sideNav.classList.contains("mobile-open"))
          : (sideNav && !sideNav.classList.contains("collapsed") && sideNav.style.display !== "none");
        setPresSideNavOpen(!isOpen);
      });
    }

    const btnOpenSideNavFloating = document.getElementById("btnOpenSideNavFloating");
    if (btnOpenSideNavFloating) {
      btnOpenSideNavFloating.addEventListener("click", () => setPresSideNavOpen(true));
    }

    const presSideNavMobileBackdrop = document.getElementById("presSideNavMobileBackdrop");
    if (presSideNavMobileBackdrop) {
      presSideNavMobileBackdrop.addEventListener("click", () => setPresSideNavOpen(false));
    }

    // Mobile Phone Only: AI Chat Drawer Toggle Logic
    function setPresMobileChatOpen(open) {
      const chatPanel = document.getElementById("presentationAiChatPanel");
      const backdrop = document.getElementById("presChatMobileBackdrop");
      if (!chatPanel) return;

      if (open) {
        chatPanel.classList.add("mobile-open");
        if (backdrop) backdrop.classList.add("active");
      } else {
        chatPanel.classList.remove("mobile-open");
        if (backdrop) backdrop.classList.remove("active");
      }
    }

    const btnMobileTogglePresChat = document.getElementById("btnMobileTogglePresChat");
    if (btnMobileTogglePresChat) {
      btnMobileTogglePresChat.addEventListener("click", () => setPresMobileChatOpen(true));
    }

    const btnMobileClosePresChat = document.getElementById("btnMobileClosePresChat");
    if (btnMobileClosePresChat) {
      btnMobileClosePresChat.addEventListener("click", () => setPresMobileChatOpen(false));
    }

    const presChatBackdrop = document.getElementById("presChatMobileBackdrop");
    if (presChatBackdrop) {
      presChatBackdrop.addEventListener("click", () => setPresMobileChatOpen(false));
    }

    // Continuous AI Task Chat Handlers
    function clearStudioChat() {
      if (activeAbortController) {
        try { activeAbortController.abort(); } catch {}
        activeAbortController = null;
      }
      chatHistory.length = 0;
      chatHistory = [];
      try { localStorage.removeItem("darkness_pres_chat_history"); } catch {}
      try { localStorage.setItem("darkness_pres_chat_history", "[]"); } catch {}
      const container = document.getElementById("aiChatMessages");
      if (container) {
        container.innerHTML = "";
      }
      renderChatMessages();
      updateLoaderState("idle");
      if (window.Darkness.toast) window.Darkness.toast.show("Chat history cleared.", "success");
    }

    const clearChatBtn = document.getElementById("btnClearChatHistory");
    if (clearChatBtn) {
      clearChatBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearStudioChat();
      };
    }

    document.addEventListener("click", (e) => {
      const clearBtn = e.target.closest("#btnClearChatHistory");
      if (clearBtn) {
        e.preventDefault();
        e.stopPropagation();
        clearStudioChat();
      }
    });

    const stopTaskBtn = document.getElementById("btnStopTask");
    if (stopTaskBtn) {
      stopTaskBtn.addEventListener("click", () => {
        if (activeAbortController) {
          activeAbortController.abort();
        }
      });
    }

    // Direct Suggestion Chips trigger prompt typing
    document.querySelectorAll(".suggestion-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const promptInput = document.getElementById("aiPresCreatorPrompt");
        if (promptInput) {
          promptInput.value = chip.dataset.prompt;
          resizePresPrompt();
          promptInput.focus();
        }
      });
    });

    function resizePresPrompt() {
      const pi = document.getElementById("aiPresCreatorPrompt");
      if (!pi) return;
      pi.style.height = "auto";
      const scrollH = pi.scrollHeight;
      const newH = Math.min(Math.max(scrollH, 24), 140);
      pi.style.height = newH + "px";
      pi.style.overflowY = scrollH > 140 ? "auto" : "hidden";
    }

    // Enter to Send & Shift+Enter to newline
    const promptInput = document.getElementById("aiPresCreatorPrompt");
    if (promptInput) {
      promptInput.addEventListener("input", resizePresPrompt);
      promptInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submitChatPrompt();
        }
      });
    }

    if (btnGenerate) {
      btnGenerate.addEventListener("click", () => {
        submitChatPrompt();
      });
    }

    async function submitChatPrompt() {
      const promptInput = document.getElementById("aiPresCreatorPrompt");
      if (!promptInput) return;
      const promptText = promptInput.value.trim();
      if (!promptText) return;

      if (isGenerating) {
        if (window.Darkness.toast) window.Darkness.toast.show("Please wait for the current task to finish or stop it.", "warning");
        return;
      }

      promptInput.value = "";
      resizePresPrompt();

      // Hide errors
      const errBanner = document.getElementById("aiErrorBanner");
      if (errBanner) errBanner.style.display = "none";

      // 1. Add user prompt to history
      chatHistory.push({ role: "user", text: promptText });
      saveChatHistory();
      renderChatMessages();

      const q = promptText.toLowerCase().trim();

      // Check if it's a delete prompt
      if (/\b(?:delete|clear|wipe)\b.*\b(?:presentation|slides?|deck)\b/i.test(q)) {
        recordState();
        slides = [{
          id: "slide_1",
          title: "New Slide Deck",
          content: "Ask AI to generate a brand new deck in the chat or use the editor to create slides.",
          layout: "title",
          notes: ""
        }];
        activeSlideIndex = 0;
        syncSlideCanvasAndUI();
        chatHistory.push({ role: "assistant", text: "The presentation slides have been cleared successfully. You can generate a new one or undo with Ctrl+Z." });
        saveChatHistory();
        renderChatMessages();
        if (window.Darkness.toast) window.Darkness.toast.show("Presentation cleared.", "info");
        return;
      }

      // Check if it's an export prompt
      if (/\b(?:export|download)\b.*\b(?:pptx?|presentation|deck|file)\b/i.test(q)) {
        chatHistory.push({ role: "assistant", text: "Initiating file export..." });
        saveChatHistory();
        renderChatMessages();
        document.getElementById("btnPptxExport")?.click();
        return;
      }

      // Check if it's an Image Generation request
      const isImageRequest = (
        /\b(?:generate|create|add|make|draw|insert)\b.*\b(?:image|photo|illustration|picture|diagram|graphic|visual|render)\b/i.test(q) ||
        /\b(?:image|photo|illustration|picture|diagram|render)\s+of\b/i.test(q)
      );

      if (isImageRequest) {
        activeAbortController = new AbortController();
        updateLoaderState("generating", "Generating AI slide image...");

        // Check if a specific slide number was requested
        let targetIdx = activeSlideIndex;
        const slideNumMatch = q.match(/\bslide\s*(?:#|number|\s)?\s*(\d+)\b/i);
        if (slideNumMatch) {
          const parsedNum = parseInt(slideNumMatch[1], 10);
          if (parsedNum >= 1 && parsedNum <= slides.length) {
            targetIdx = parsedNum - 1;
          }
        }

        try {
          const res = await fetch("/api/studio/generate-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: promptText,
              aspectRatio: "16:9",
              targetStudio: "presentation"
            }),
            signal: activeAbortController.signal
          });

          if (!res.ok) throw new Error("AI image generation request failed.");
          const data = await res.json();
          if (!data.imageUrl) throw new Error("No image was returned by AI provider.");

          recordState();
          if (slides[targetIdx]) {
            slides[targetIdx].imageUrl = data.imageUrl;
            activeSlideIndex = targetIdx;
          }
          syncSlideCanvasAndUI();

          const assistantMsg = `I've generated the requested visual asset and placed it on **Slide ${targetIdx + 1}**!\n\n<div style="margin-top: 8px; border-radius: 6px; overflow: hidden; border: 1px solid var(--line);"><img src="${data.imageUrl}" alt="Preview" style="width: 100%; max-height: 140px; object-fit: cover; display: block;" /></div>`;
          chatHistory.push({ role: "assistant", text: assistantMsg });
          saveChatHistory();
          renderChatMessages();

          if (window.Darkness.toast) window.Darkness.toast.show(`Image added to Slide ${targetIdx + 1}!`, "success");
          updateLoaderState("idle");
        } catch (err) {
          if (err.name === "AbortError") {
            chatHistory.push({ role: "assistant", text: "Image generation stopped." });
            saveChatHistory();
            renderChatMessages();
            updateLoaderState("cancelled");
          } else {
            console.error(err);
            chatHistory.push({ role: "assistant", text: `Error generating image: ${err.message || "Failed to generate image."}` });
            saveChatHistory();
            renderChatMessages();
            updateLoaderState("failed");
          }
        }
        return;
      }

      // 2. AI Studio Universal Executive Engine (Real Editing & Multi-Turn Intelligence)
      activeAbortController = new AbortController();
      updateLoaderState("thinking", isAiEditMode && activePresentationSelection ? "Synthesizing edit proposal..." : "Analyzing instruction and slide context...");

      try {
        const response = await fetch("/api/studio/execute-instruction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studioType: "presentation",
            prompt: promptText,
            history: chatHistory.slice(0, -1),
            currentState: {
              presentation: {
                presentationTitle: presentationTitle,
                activeSlideIndex: activeSlideIndex,
                slides: slides
              },
              selectedElement: activePresentationSelection ? {
                id: activePresentationSelection.targetId,
                field: activePresentationSelection.field,
                selectedText: activePresentationSelection.selectedText,
                slideIndex: activePresentationSelection.slideIndex
              } : null
            },
            aiEditMode: isAiEditMode
          }),
          signal: activeAbortController.signal
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "AI failed to process instruction.");
        }

        const data = await response.json();

        // 1. Export Trigger
        if (data.intent === "EXPORT") {
          chatHistory.push({ role: "assistant", text: data.replyText || "Initiating PowerPoint export..." });
          saveChatHistory();
          renderChatMessages();
          document.getElementById("btnPptxExport")?.click();
          updateLoaderState("idle");
          return;
        }

        // 2. Proposal (when in AI Edit Mode or proposed edit returned)
        if (data.intent === "PROPOSE_SELECTION_EDIT" && data.proposedEdit) {
          chatHistory.push({
            role: "assistant",
            text: data.replyText || `I've prepared a proposed edit for the selected **${data.proposedEdit.field || "Element"}** on **Slide ${(data.proposedEdit.slideIndex ?? activeSlideIndex) + 1}**. Review the comparison below and click **Apply Edit** to commit, or **Discard** to cancel.`,
            proposedEdit: data.proposedEdit
          });
          saveChatHistory();
          renderChatMessages();
          updateLoaderState("idle");
          return;
        }

        // 3. Artifact Mutation (Direct Edit or New Topic Creation)
        if (data.intent === "EDIT_ARTIFACT" || data.intent === "CREATE_NEW") {
          if (Array.isArray(data.updatedSlides) && data.updatedSlides.length > 0) {
            recordState();
            slides = data.updatedSlides;
            if (typeof data.activeSlideIndex === "number" && data.activeSlideIndex >= 0 && data.activeSlideIndex < slides.length) {
              activeSlideIndex = data.activeSlideIndex;
            }
            if (data.updatedTitle) {
              presentationTitle = data.updatedTitle;
              const presTitleInput = document.getElementById("presStudioTitle");
              if (presTitleInput) presTitleInput.value = presentationTitle;
              const headerTitle = document.getElementById("headerTitle");
              if (headerTitle) headerTitle.textContent = presentationTitle;
              try { localStorage.setItem("darkness_presentation_title", presentationTitle); } catch {}
            }
            saveLocalPres();
            syncSlideCanvasAndUI();

            if (data.toast && window.Darkness.toast) {
              window.Darkness.toast.show(data.toast, "success");
            } else if (window.Darkness.toast) {
              window.Darkness.toast.show(data.intent === "CREATE_NEW" ? "Presentation created!" : "Slide updated!", "success");
            }
          }
        }

        // 4. Record Assistant response in chat
        chatHistory.push({
          role: "assistant",
          text: data.replyText || (data.intent === "EDIT_ARTIFACT" ? "Done! Applied changes to your presentation." : "Understood.")
        });
        saveChatHistory();
        renderChatMessages();
        updateLoaderState("idle");
      } catch (err) {
        if (err.name === "AbortError") {
          chatHistory.push({ role: "assistant", text: "Task was cancelled." });
          saveChatHistory();
          renderChatMessages();
          if (window.Darkness.toast) window.Darkness.toast.show("Task stopped.", "warning");
          updateLoaderState("cancelled");
        } else {
          console.error(err);
          if (errBanner) {
            errBanner.style.display = "block";
            const errSpan = document.getElementById("aiErrorMessage");
            if (errSpan) errSpan.textContent = err.message || "Failed to process instruction.";
          }
          chatHistory.push({ role: "assistant", text: `Error: ${err.message || "Failed to execute instruction."}` });
          saveChatHistory();
          renderChatMessages();
          updateLoaderState("failed");
        }
      }
    }

    // Toggle AI Edit Mode and Element Selection
    const toggleAiEditMode = document.getElementById("toggleAiEditMode");
    const aiEditModeBadge = document.getElementById("aiEditModeBadge");

    function updatePresentationSelectionUi() {
      const box = document.getElementById("selectionPreviewContainer");
      if (!box) return;

      if (!isAiEditMode) {
        box.style.display = "none";
        return;
      }

      box.style.display = "block";
      if (activePresentationSelection && (activePresentationSelection.selectedText || activePresentationSelection.imageUrl)) {
        const safeSnippet = window.Darkness.utils && window.Darkness.utils.escapeHtml 
          ? window.Darkness.utils.escapeHtml(activePresentationSelection.selectedText || "Slide Image") 
          : (activePresentationSelection.selectedText || "Slide Image");

        box.innerHTML = `
          <div style="background: rgba(244, 63, 94, 0.08); border: 1px solid rgba(244, 63, 94, 0.35); border-radius: 6px; padding: 6px 8px; display: flex; flex-direction: column; gap: 3px; font-size: 11.5px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-weight: 700; color: #f43f5e; display: flex; align-items: center; gap: 4px;">
                🎯 Target: <span style="text-transform: capitalize; background: rgba(244, 63, 94, 0.15); padding: 1px 6px; border-radius: 4px;">Slide ${activePresentationSelection.slideIndex + 1} ${activePresentationSelection.field}</span>
              </span>
              <button id="btnClearPresSelection" class="btn btn--xs btn--ghost" style="padding: 1px 5px; font-size: 10.5px; color: var(--ink-muted); cursor: pointer;" title="Clear Selection">✕ Clear</button>
            </div>
            <div style="color: var(--ink-soft); font-style: italic; font-size: 11px; max-height: 36px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              "${safeSnippet}"
            </div>
          </div>
        `;
        document.getElementById("btnClearPresSelection")?.addEventListener("click", () => {
          clearPresentationSelection();
        });
      } else {
        box.innerHTML = `
          <div style="background: var(--surface-muted); border: 1px dashed var(--line-strong); border-radius: 6px; padding: 6px 8px; font-size: 11px; color: var(--ink-muted); display: flex; align-items: center; gap: 6px;">
            <span>💡 Click any slide title, content block, card, or text in the canvas to edit with AI.</span>
          </div>
        `;
      }
    }

    function clearPresentationSelection() {
      activePresentationSelection = null;
      document.querySelectorAll(".pres-element-selected").forEach(el => el.classList.remove("pres-element-selected"));
      updatePresentationSelectionUi();
    }

    if (toggleAiEditMode) {
      toggleAiEditMode.addEventListener("change", (e) => {
        isAiEditMode = e.target.checked;
        if (aiEditModeBadge) {
          aiEditModeBadge.textContent = isAiEditMode ? "ON" : "OFF";
          aiEditModeBadge.style.background = isAiEditMode ? "#f43f5e" : "var(--surface)";
          aiEditModeBadge.style.color = isAiEditMode ? "#ffffff" : "var(--ink-muted)";
          aiEditModeBadge.style.borderColor = isAiEditMode ? "#f43f5e" : "var(--line)";
        }
        updatePresentationSelectionUi();
        if (window.Darkness.toast) {
          window.Darkness.toast.show(isAiEditMode ? "AI Edit Mode activated. Click a slide element to target it." : "AI Edit Mode deactivated.", "info");
        }
      });
    }

    // Canvas click delegation for element selection in AI Edit Mode
    document.addEventListener("click", (e) => {
      if (!isAiEditMode) return;
      const canvasWrapper = document.getElementById("slideCanvasWrapper");
      if (!canvasWrapper || !canvasWrapper.contains(e.target)) return;

      const titleEl = e.target.closest("#slideActiveTitleContainer, #slideActiveTitleDisplay");
      const contentEl = e.target.closest("#slideActiveContentContainer, #slideActiveContentDisplay");
      const imgEl = e.target.closest("img");
      const cardEl = e.target.closest(".selectable-slide-object, [data-field]");

      let field = "content";
      let selectedText = "";
      let targetNode = null;

      if (titleEl) {
        field = "title";
        selectedText = slides[activeSlideIndex]?.title || "";
        targetNode = titleEl;
      } else if (imgEl) {
        field = "image";
        selectedText = "Slide Image Asset";
        targetNode = imgEl;
      } else if (cardEl) {
        field = cardEl.dataset.field || "card";
        selectedText = cardEl.innerText || "";
        targetNode = cardEl;
      } else if (contentEl) {
        field = "content";
        selectedText = slides[activeSlideIndex]?.content || "";
        targetNode = contentEl;
      }

      if (targetNode) {
        document.querySelectorAll(".pres-element-selected").forEach(el => el.classList.remove("pres-element-selected"));
        targetNode.classList.add("pres-element-selected");
        activePresentationSelection = {
          slideIndex: activeSlideIndex,
          slideId: slides[activeSlideIndex]?.id || `slide_${activeSlideIndex + 1}`,
          field,
          selectedText,
          targetNode,
          targetId: `pres_target_${Date.now()}`
        };
        updatePresentationSelectionUi();
      }
    });

    // Apply & Discard Proposal Event Delegation for Presentation Studio
    document.addEventListener("click", (e) => {
      const applyBtn = e.target.closest(".btn-apply-pres-edit");
      const discardBtn = e.target.closest(".btn-discard-pres-edit");

      if (applyBtn) {
        const msgIdx = parseInt(applyBtn.dataset.msgIdx, 10);
        const msg = chatHistory[msgIdx];
        if (msg && msg.proposedEdit && msg.proposedEdit.status === "pending") {
          const prop = msg.proposedEdit;
          const targetSlide = slides[prop.slideIndex];
          if (targetSlide) {
            recordState();
            if (prop.field === "title") {
              targetSlide.title = prop.proposedText;
            } else if (prop.field === "image") {
              targetSlide.imageUrl = prop.imageUrl;
            } else {
              targetSlide.content = prop.proposedText;
            }
            prop.status = "applied";
            saveLocalPres();
            syncSlideCanvasAndUI();
            saveChatHistory();
            renderChatMessages();
            if (window.Darkness.toast) window.Darkness.toast.show(`Edit applied to Slide ${prop.slideIndex + 1}!`, "success");
          }
        }
      }

      if (discardBtn) {
        const msgIdx = parseInt(discardBtn.dataset.msgIdx, 10);
        const msg = chatHistory[msgIdx];
        if (msg && msg.proposedEdit && msg.proposedEdit.status === "pending") {
          msg.proposedEdit.status = "discarded";
          saveChatHistory();
          renderChatMessages();
          if (window.Darkness.toast) window.Darkness.toast.show("Proposed edit discarded.", "info");
        }
      }
    });

    // Context slide elements click-selection
    // Slideshow Start trigger
    document.getElementById("btnSlideshowStart")?.addEventListener("click", startFullSlideshow);

    // Export PPTX Click handler
    if (btnPptxExport) {
      btnPptxExport.addEventListener("click", async () => {
        if (window.Darkness.toast) window.Darkness.toast.show("Packing OpenXML PowerPoint file...", "info");
        try {
          const response = await fetch("/api/presentation/export-pptx", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: presentationTitle,
              slides: slides,
              size: slideSize,
              themeColor: activeTheme
            })
          });

        if (!response.ok) throw new Error("Server PowerPoint compilation failed.");

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = `${presentationTitle.toLowerCase().replace(/[^a-z0-9]/g, "_")}.pptx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        if (window.Darkness.toast) window.Darkness.toast.show("PowerPoint slide deck downloaded successfully!", "success");
      } catch (err) {
        console.error(err);
        if (window.Darkness.toast) window.Darkness.toast.show("PowerPoint export failed.", "danger");
      }
    });
  }
}

  function applyZoom() {
    const wrapper = document.getElementById("slideCanvasWrapper") || document.getElementById("presentationCanvasWrapper");
    const canvas = document.getElementById("slidePaperPageCanvas");
    if (!canvas || !wrapper) return;

    const scale = zoomLevel / 100;
    const baseWidth = slideSize === "4:3" ? 720 : 800;
    const baseHeight = slideSize === "4:3" ? 540 : 450;

    if (window.innerWidth <= 768) {
      canvas.style.transformOrigin = "top left";
      canvas.style.transform = `scale(${scale})`;

      const scaledWidth = baseWidth * scale;
      const leftMargin = Math.max(0, Math.round((wrapper.clientWidth - scaledWidth) / 2));
      canvas.style.marginLeft = `${leftMargin}px`;
      canvas.style.marginRight = `${leftMargin}px`;

      const heightDiff = (1 - scale) * baseHeight;
      canvas.style.marginBottom = `-${Math.max(0, Math.round(heightDiff - 16))}px`;
    } else {
      canvas.style.transform = `scale(${scale})`;
      canvas.style.transformOrigin = "top center";
      canvas.style.marginLeft = "auto";
      canvas.style.marginRight = "auto";
      canvas.style.marginBottom = "0px";
    }

    const label = document.getElementById("labelZoom");
    if (label) label.textContent = `${zoomLevel}%`;
  }

  function autoFitMobileSlide() {
    const wrapper = document.getElementById("slideCanvasWrapper") || document.getElementById("presentationCanvasWrapper");
    const canvas = document.getElementById("slidePaperPageCanvas");
    if (!wrapper || !canvas) return;

    const baseWidth = slideSize === "4:3" ? 720 : 800;
    const baseHeight = slideSize === "4:3" ? 540 : 450;

    if (window.innerWidth <= 768) {
      const availableWidth = Math.max(260, wrapper.clientWidth - 16);
      const fitScale = Math.min(1, Math.max(0.3, availableWidth / baseWidth));
      zoomLevel = Math.round(fitScale * 100);

      canvas.style.transformOrigin = "top left";
      canvas.style.transform = `scale(${fitScale})`;

      const scaledWidth = baseWidth * fitScale;
      const leftMargin = Math.max(0, Math.round((wrapper.clientWidth - scaledWidth) / 2));
      canvas.style.marginLeft = `${leftMargin}px`;
      canvas.style.marginRight = `${leftMargin}px`;

      const heightDiff = (1 - fitScale) * baseHeight;
      canvas.style.marginBottom = `-${Math.max(0, Math.round(heightDiff - 16))}px`;

      const label = document.getElementById("labelZoom");
      if (label) label.textContent = `${zoomLevel}%`;
    } else {
      zoomLevel = 100;
      canvas.style.transform = `scale(1)`;
      canvas.style.transformOrigin = "top center";
      canvas.style.marginLeft = "auto";
      canvas.style.marginRight = "auto";
      canvas.style.marginBottom = "0px";

      const label = document.getElementById("labelZoom");
      if (label) label.textContent = "100%";
    }
  }

  function applySlideSizeStyles() {
    const canvas = document.getElementById("slidePaperPageCanvas");
    if (!canvas) return;

    if (slideSize === "4:3") {
      canvas.style.width = "720px";
      canvas.style.height = "540px";
    } else {
      canvas.style.width = "800px";
      canvas.style.height = "450px";
    }
    saveLocalPres();
    renderSlideThumbnails();
  }

  function applyThemeStyles() {
    const accentLine = document.getElementById("slideActiveThemeAccentLine");
    if (!accentLine) return;

    const themeHex = activeTheme === "modern" ? "#0f172a" : activeTheme === "creative" ? "#f43f5e" : "#1e3a8a";
    accentLine.style.background = themeHex;
    saveLocalPres();
    renderSlideThumbnails();
  }

  function applyState(state) {
    if (!state) return;
    presentationTitle = state.title;
    slides = state.slides;
    slideSize = state.size;
    activeTheme = state.theme;
    activeSlideIndex = state.activeIndex;

    document.getElementById("presStudioTitle").value = presentationTitle;
    const themeSel = document.getElementById("slideThemeSelector");
    if (themeSel) themeSel.value = activeTheme;
    const sizeSel = document.getElementById("slideSizeSelector");
    if (sizeSel) sizeSel.value = slideSize;

    isUnsaved = true;
    saveLocalPres();
    syncSlideCanvasAndUI();
  }

  function updateWorkspaceHeaderStatus() {
    const statusLabel = document.getElementById("unsavedPresBadge");
    if (statusLabel) {
      statusLabel.textContent = isUnsaved ? "Draft Unsaved" : "Saved & Safe";
      statusLabel.style.color = isUnsaved ? "#ef4444" : "#22c55e";
      statusLabel.style.borderColor = isUnsaved ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)";
      statusLabel.style.background = isUnsaved ? "rgba(239,68,68,0.03)" : "rgba(34,197,94,0.03)";
    }
  }

  // Play full slideshow mode
  function startFullSlideshow() {
    let currentShowIdx = activeSlideIndex;
    let presentationOverlay = document.createElement("div");
    presentationOverlay.id = "slideshowOverlay";
    presentationOverlay.style = "position:fixed; top:0; left:0; right:0; bottom:0; background:#000000; z-index:99999; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#fff; font-family:sans-serif;";

    function renderShowSlide() {
      const s = slides[currentShowIdx];
      const themeHex = activeTheme === "modern" ? "#0f172a" : activeTheme === "creative" ? "#f43f5e" : "#1e3a8a";
      const bgFill = s.layout === "title" ? themeHex : s.layout === "section" ? "#1e293b" : "#ffffff";
      const textHex = s.layout === "title" || s.layout === "section" ? "#ffffff" : "#111827";

      presentationOverlay.innerHTML = `
        <!-- Slide Stage -->
        <div style="
          width: ${slideSize === "4:3" ? "960px" : "1200px"}; 
          height: ${slideSize === "4:3" ? "720px" : "675px"}; 
          background: ${bgFill}; 
          color: ${textHex}; 
          box-shadow: 0 10px 40px rgba(0,0,0,0.5); 
          border-radius: 8px; 
          display: flex; 
          flex-direction: column; 
          padding: 60px 70px; 
          box-sizing: border-box;
          position: relative;
        ">
          <h1 style="font-size: 38px; font-weight: 700; margin: 0 0 24px; border:none; background:transparent;">${window.Darkness.utils && window.Darkness.utils.escapeHtml ? window.Darkness.utils.escapeHtml(s.title || "") : (s.title || "")}</h1>
          <div style="flex: 1; overflow-y: auto; color: ${textHex};">${renderSlideBodyHtml(s, themeHex)}</div>
          
          <div style="display:flex; justify-content:space-between; font-size: 14px; color: #9ca3af; margin-top: auto; padding-top: 16px;">
            <span>Slide ${currentShowIdx + 1} of ${slides.length}</span>
            <span>${presentationTitle}</span>
          </div>
        </div>

        <!-- Helper navigation bar -->
        <div style="position: absolute; bottom: 20px; display: flex; align-items: center; gap: 20px; background: rgba(255,255,255,0.1); padding: 8px 16px; border-radius: 20px; font-size: 12px; color: #ccc;">
          <button class="btn btn--xs btn--ghost" id="showPrevBtn" style="color:#fff;">← Prev</button>
          <span>Use Arrow Keys / Space</span>
          <button class="btn btn--xs btn--ghost" id="showNextBtn" style="color:#fff;">Next →</button>
          <button class="btn btn--xs btn--outline" id="showExitBtn" style="color:#f43f5e; border-color:#f43f5e;">Exit (Esc)</button>
        </div>
      `;

      document.getElementById("showPrevBtn")?.addEventListener("click", prevSlide);
      document.getElementById("showNextBtn")?.addEventListener("click", nextSlide);
      document.getElementById("showExitBtn")?.addEventListener("click", exitSlideshow);
    }

    function nextSlide() {
      if (currentShowIdx < slides.length - 1) {
        currentShowIdx++;
        renderShowSlide();
      }
    }

    function prevSlide() {
      if (currentShowIdx > 0) {
        currentShowIdx--;
        renderShowSlide();
      }
    }

    function exitSlideshow() {
      document.removeEventListener("keydown", handleShowKey);
      presentationOverlay.remove();
    }

    function handleShowKey(e) {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Spacebar") nextSlide();
      if (e.key === "ArrowLeft") prevSlide();
      if (e.key === "Escape") exitSlideshow();
    }

    document.addEventListener("keydown", handleShowKey);
    document.body.appendChild(presentationOverlay);
    renderShowSlide();
  }

  // Helper to render rich markdown & styling
  function renderRichSlideContent(text) {
    if (!text) return "";
    return text
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br/>");
  }

  // Render comprehensive layout structures (cards, grids, process flow, comparison tables, stats, title)
  function renderSlideBodyHtml(current, themeHex) {
    if (!current) return "";
    const layout = (current.layout || "content").toLowerCase();

    // 1. TITLE SLIDE
    if (layout === "title") {
      const subtitle = current.subtitle || "";
      return `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; padding: 20px 10px; gap: 16px;">
          ${subtitle ? `<div style="font-size: 18px; font-weight: 600; color: ${themeHex}; letter-spacing: 0.02em;">${renderRichSlideContent(subtitle)}</div>` : ""}
          <div id="slideActiveContentDisplay" style="font-size: 16px; line-height: 1.6; color: #4b5563; max-width: 650px; outline: none; border-radius: 4px; padding: 4px;" contenteditable="true">
            ${renderRichSlideContent(current.content || "Presented by the Core Team")}
          </div>
          ${current.imageUrl ? `
            <div style="margin-top: 10px; border-radius: 8px; overflow: hidden; max-height: 140px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); position: relative;">
              <img src="${current.imageUrl}" alt="Title visual" style="max-height: 140px; width: auto; object-fit: cover;" />
              <button id="btnRemoveSlideImg" title="Remove image" style="position: absolute; top: 6px; right: 6px; background: rgba(0,0,0,0.65); color: white; border: none; border-radius: 50%; width: 20px; height: 20px; cursor: pointer; font-size: 10px;">✕</button>
            </div>
          ` : ""}
        </div>
      `;
    }

    // 2. MULTI-CARD LAYOUT (e.g. 2, 3, or 4 visual cards)
    if (layout === "cards" || (current.cards && Array.isArray(current.cards) && current.cards.length > 0)) {
      let cards = current.cards || [];
      if (!Array.isArray(cards) || cards.length === 0) {
        const rawItems = (current.content || "").split(/\n\n+|\n(?=[-•*]|\d+\.)/).map(s => s.trim()).filter(Boolean);
        cards = rawItems.map(item => {
          const colonIdx = item.indexOf(":");
          if (colonIdx > 0 && colonIdx < 40) {
            return {
              title: item.slice(0, colonIdx).replace(/^[-•*\d.]+\s*/, "").trim(),
              description: item.slice(colonIdx + 1).trim()
            };
          }
          const lines = item.split("\n");
          return {
            title: lines[0].replace(/^[-•*\d.]+\s*/, "").trim(),
            description: lines.slice(1).join(" ").trim() || lines[0]
          };
        });
      }

      const cardCols = cards.length <= 2 ? "repeat(2, 1fr)" : cards.length === 3 ? "repeat(3, 1fr)" : "repeat(4, 1fr)";
      const cardsHtml = cards.slice(0, 4).map((c, i) => `
        <div style="background: var(--surface-muted, #f8fafc); border: 1px solid var(--line, #e2e8f0); border-top: 3px solid ${themeHex}; border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.04);">
          <div style="font-weight: 700; font-size: 14px; color: #1e293b;">${window.Darkness.utils && window.Darkness.utils.escapeHtml ? window.Darkness.utils.escapeHtml(c.title || `Point ${i + 1}`) : (c.title || `Point ${i + 1}`)}</div>
          <div style="font-size: 12.5px; line-height: 1.5; color: #475569;">${renderRichSlideContent(c.description || c.text || "")}</div>
        </div>
      `).join("");

      return `
        <div style="display: flex; flex-direction: column; gap: 14px; height: 100%;">
          <div style="display: grid; grid-template-columns: ${cardCols}; gap: 12px; flex: 1; align-items: stretch;">
            ${cardsHtml}
          </div>
          <div id="slideActiveContentDisplay" style="display: none;" contenteditable="true">${renderRichSlideContent(current.content || "")}</div>
        </div>
      `;
    }

    // 3. PROCESS / STEP DIAGRAM LAYOUT
    if (layout === "process" || (current.steps && Array.isArray(current.steps) && current.steps.length > 0)) {
      let steps = current.steps || [];
      if (!Array.isArray(steps) || steps.length === 0) {
        const lines = (current.content || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
        steps = lines.map((l, sIdx) => ({
          step: sIdx + 1,
          title: l.replace(/^[-•*\d.]+\s*/, "").split(":")[0] || `Step ${sIdx + 1}`,
          description: l.split(":")[1] || l
        }));
      }

      const isTwoRows = steps.length > 4;
      const cols = isTwoRows ? Math.ceil(steps.length / 2) : steps.length;
      const stepsHtml = steps.slice(0, 6).map((st, i) => `
        <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 6px; position: relative;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: ${themeHex}; color: white; border-radius: 50%; font-size: 11px; font-weight: 700;">${st.step || (i + 1)}</span>
            <strong style="font-size: 13px; color: #1e293b;">${window.Darkness.utils && window.Darkness.utils.escapeHtml ? window.Darkness.utils.escapeHtml(st.title || `Step ${i + 1}`) : (st.title || `Step ${i + 1}`)}</strong>
          </div>
          <div style="font-size: 11.5px; line-height: 1.45; color: #475569;">${renderRichSlideContent(st.description || "")}</div>
        </div>
      `).join("");

      return `
        <div style="display: flex; flex-direction: column; gap: 12px; height: 100%;">
          <div style="display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 10px; flex: 1; align-items: stretch;">
            ${stepsHtml}
          </div>
          <div id="slideActiveContentDisplay" style="display: none;" contenteditable="true">${renderRichSlideContent(current.content || "")}</div>
        </div>
      `;
    }

    // 4. GRID LAYOUT (e.g. Products / Services)
    if (layout === "grid") {
      let items = current.cards || [];
      if (!items || items.length === 0) {
        const lines = (current.content || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
        items = lines.map((l, gIdx) => ({
          title: l.split(":")[0]?.replace(/^[-•*\d.]+\s*/, "") || `Item ${gIdx + 1}`,
          description: l.split(":")[1] || l
        }));
      }

      const gridHtml = items.slice(0, 6).map((it, i) => `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 4px;">
          <div style="font-size: 13px; font-weight: 700; color: ${themeHex};">${window.Darkness.utils && window.Darkness.utils.escapeHtml ? window.Darkness.utils.escapeHtml(it.title || `Item ${i + 1}`) : (it.title || `Item ${i + 1}`)}</div>
          <div style="font-size: 11.5px; line-height: 1.45; color: #475569;">${renderRichSlideContent(it.description || it.text || "")}</div>
        </div>
      `).join("");

      return `
        <div style="display: grid; grid-template-columns: repeat(${items.length <= 4 ? 2 : 3}, 1fr); gap: 12px; height: 100%; align-items: stretch;">
          ${gridHtml}
          <div id="slideActiveContentDisplay" style="display: none;" contenteditable="true">${renderRichSlideContent(current.content || "")}</div>
        </div>
      `;
    }

    // 5. COMPARISON OR TABLE LAYOUT
    if (layout === "comparison" || layout === "table" || current.tableData) {
      let tHeaders = ["Parameter", "Sunfuel Solar", "Traditional EPC"];
      let tRows = [];

      if (current.tableData && Array.isArray(current.tableData.headers)) {
        tHeaders = current.tableData.headers;
        tRows = current.tableData.rows || [];
      } else {
        const lines = (current.content || "").split("\n").map(s => s.trim()).filter(Boolean);
        lines.forEach(line => {
          if (line.includes("|")) {
            const parts = line.split("|").map(p => p.trim()).filter(Boolean);
            if (parts.length >= 2 && !line.includes("---")) {
              if (tRows.length === 0 && tHeaders.length === 0) tHeaders = parts;
              else tRows.push(parts);
            }
          } else if (line.includes(":")) {
            const parts = line.split(":");
            tRows.push([parts[0].replace(/^[-•*]\s*/, ""), parts[1] || "", "Standard"]);
          }
        });
      }

      if (tRows.length === 0) {
        tRows = [
          ["Installation Speed", "2-3 Weeks Turnkey", "2-4 Months"],
          ["Cost Efficiency", "25-30% Lower Overhead", "Standard High Markup"],
          ["IoT Remote Diagnostics", "Real-time 24/7 Portal", "Manual Inspection"],
          ["Performance Warranty", "25 Years Tier-1 Guarantee", "Limited Standard"]
        ];
      }

      const tableHtml = `
        <div style="overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
          <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 12px;">
            <thead>
              <tr style="background: ${themeHex}; color: #ffffff;">
                ${tHeaders.map(h => `<th style="padding: 8px 12px; font-weight: 700; border-bottom: 1px solid #cbd5e1;">${window.Darkness.utils && window.Darkness.utils.escapeHtml ? window.Darkness.utils.escapeHtml(h) : h}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${tRows.map((r, rIdx) => `
                <tr style="background: ${rIdx % 2 === 0 ? "#ffffff" : "#f8fafc"}; border-bottom: 1px solid #e2e8f0;">
                  ${r.map((c, cIdx) => `
                    <td style="padding: 8px 12px; color: ${cIdx === 1 ? themeHex : "#374151"}; font-weight: ${cIdx === 0 || cIdx === 1 ? 600 : 400};">
                      ${window.Darkness.utils && window.Darkness.utils.escapeHtml ? window.Darkness.utils.escapeHtml(c) : c}
                    </td>
                  `).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;

      return `
        <div style="display: flex; flex-direction: column; gap: 10px; height: 100%;">
          ${tableHtml}
          <div id="slideActiveContentDisplay" style="display: none;" contenteditable="true">${renderRichSlideContent(current.content || "")}</div>
        </div>
      `;
    }

    // 6. STATS / METRIC CALLOUT LAYOUT
    if (layout === "stats" || (current.stats && Array.isArray(current.stats))) {
      const stats = current.stats || [
        { value: "50MW+", label: "Solar Capacity Installed" },
        { value: "35%", label: "Average Client ROI" },
        { value: "10k+", label: "Happy Customers" }
      ];

      const statsHtml = stats.map(st => `
        <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 18px; text-align: center; display: flex; flex-direction: column; justify-content: center; gap: 6px;">
          <div style="font-size: 28px; font-weight: 800; color: ${themeHex};">${st.value}</div>
          <div style="font-size: 12px; font-weight: 500; color: #475569;">${st.label}</div>
        </div>
      `).join("");

      return `
        <div style="display: grid; grid-template-columns: repeat(${Math.min(stats.length, 4)}, 1fr); gap: 14px; height: 100%; align-items: center;">
          ${statsHtml}
          <div id="slideActiveContentDisplay" style="display: none;" contenteditable="true">${renderRichSlideContent(current.content || "")}</div>
        </div>
      `;
    }

    // 7. DEFAULT CONTENT LAYOUT (WITH OPTIONAL IMAGE)
    if (current.imageUrl) {
      return `
        <div style="display: flex; gap: 20px; align-items: flex-start; height: 100%;">
          <div id="slideActiveContentDisplay" style="flex: 1.2; font-size: 16px; line-height: 1.6; color: #374151; white-space: pre-wrap; outline: none;" contenteditable="true">${renderRichSlideContent(current.content || "")}</div>
          <div style="flex: 0.9; text-align: center; position: relative; max-width: 45%;">
            <img src="${current.imageUrl}" alt="Slide Visual" style="width: 100%; max-height: 220px; object-fit: cover; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.12);" />
            <button id="btnRemoveSlideImg" title="Remove image" style="position: absolute; top: 6px; right: 6px; background: rgba(0,0,0,0.65); color: white; border: none; border-radius: 50%; width: 22px; height: 22px; cursor: pointer; font-size: 11px; display: flex; align-items: center; justify-content: center; transition: background 0.15s;">✕</button>
          </div>
        </div>
      `;
    }

    return `
      <div id="slideActiveContentDisplay" style="font-size: 17px; line-height: 1.6; color: #374151; white-space: pre-wrap; outline: none;" contenteditable="true">${renderRichSlideContent(current.content || "")}</div>
    `;
  }

  // Populate side slide miniatures thumbnails list with 1-page full card snap view
  function renderSlideThumbnails() {
    const container = document.getElementById("slidesOverviewList");
    if (!container) return;

    container.innerHTML = slides.map((slide, idx) => {
      const isActive = idx === activeSlideIndex;
      const activeStyle = isActive 
        ? "border: 2px solid #000000; box-shadow: 0 4px 12px rgba(0,0,0,0.12);" 
        : "border: 1px solid #000000; box-shadow: 0 1px 3px rgba(0,0,0,0.04);";
      const themeHex = activeTheme === "modern" ? "#0f172a" : activeTheme === "creative" ? "#f43f5e" : "#1e3a8a";
      const fillBg = slide.layout === "title" ? themeHex : "var(--surface)";
      const textCol = slide.layout === "title" ? "#ffffff" : "var(--ink)";
      const cleanContent = (slide.content || "").replace(/<[^>]*>?/gm, '');

      return `
        <div class="slide-miniature-thumb" data-slide-index="${idx}" style="
          scroll-snap-align: start;
          scroll-snap-stop: always;
          width: 100%; 
          max-width: 200px; 
          height: 200px; 
          flex-shrink: 0;
          background: ${fillBg}; 
          border-radius: 6px; 
          cursor: pointer; 
          overflow: hidden; 
          position: relative; 
          padding: 10px 12px; 
          transition: all 0.15s ease-in-out;
          display: flex;
          flex-direction: column;
          color: ${textCol};
          user-select: none;
          box-sizing: border-box;
          ${activeStyle}
        ">
          <div style="font-weight: 700; border-bottom: 1px solid rgba(0,0,0,0.1); padding-bottom: 4px; margin-bottom: 6px; font-size: 9.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
            <span style="overflow: hidden; text-overflow: ellipsis; max-width: 120px;">${window.Darkness.utils.escapeHtml(slide.title || ("Slide " + (idx + 1)))}</span>
            <span style="background: ${isActive ? "#f43f5e" : "rgba(244,63,94,0.1)"}; color: ${isActive ? "#ffffff" : "#f43f5e"}; padding: 1px 5px; border-radius: 3px; font-size: 8px; font-weight: 700;">Slide ${idx + 1}</span>
          </div>
          <div style="flex: 1; overflow: hidden; opacity: 0.85; white-space: normal; text-align: left; font-size: 8.5px; line-height: 1.4; word-break: break-word;">
            ${window.Darkness.utils.escapeHtml(cleanContent.substring(0, 220))}
          </div>
        </div>
      `;
    }).join("");

    container.querySelectorAll(".slide-miniature-thumb").forEach(thumb => {
      thumb.addEventListener("click", () => {
        activeSlideIndex = parseInt(thumb.dataset.slideIndex);
        syncSlideCanvasAndUI();
      });
    });
  }

  // Sync current slide to editor canvas
  function syncSlideCanvasAndUI() {
    if (slides.length === 0) return;
    const current = slides[activeSlideIndex];
    if (!current) return;

    const themeHex = activeTheme === "modern" ? "#0f172a" : activeTheme === "creative" ? "#f43f5e" : "#1e3a8a";

    document.getElementById("slideActiveTitleDisplay").innerHTML = renderRichSlideContent(current.title || "");
    
    const contentContainer = document.getElementById("slideActiveContentContainer");
    if (contentContainer) {
      contentContainer.innerHTML = renderSlideBodyHtml(current, themeHex);

      const removeBtn = document.getElementById("btnRemoveSlideImg");
      if (removeBtn) {
        removeBtn.onclick = (e) => {
          e.stopPropagation();
          recordState();
          delete current.imageUrl;
          saveLocalPres();
          syncSlideCanvasAndUI();
          if (window.Darkness.toast) window.Darkness.toast.show("Slide image removed.", "info");
        };
      }

      // Re-bind editable input sync
      const activeContentDisplay = document.getElementById("slideActiveContentDisplay");
      if (activeContentDisplay) {
        activeContentDisplay.addEventListener("input", () => {
          if (slides.length > 0) {
            slides[activeSlideIndex].content = activeContentDisplay.innerText;
            isUnsaved = true;
            saveLocalPres();
            updateWorkspaceHeaderStatus();
            renderSlideThumbnails();
          }
        });
      }
    }

    const notesArea = document.getElementById("slideActiveNotesArea");
    if (notesArea) {
      notesArea.value = current.notes || "";
    }
    document.getElementById("slideLayoutSelector").value = current.layout || "content";

    // Counter footers sync
    document.getElementById("labelSlideCounter").textContent = `Slide ${activeSlideIndex + 1} of ${slides.length}`;
    const scf = document.getElementById("slideCounterFooter");
    if (scf) scf.textContent = `Slide ${activeSlideIndex + 1} of ${slides.length}`;
    const sft = document.getElementById("slideFooterTitle");
    if (sft) sft.textContent = presentationTitle;
    document.getElementById("statSlideCount").textContent = slides.length;

    const lblTop = document.getElementById("lblToggleSideNavTop");
    if (lblTop) lblTop.textContent = `Slides (${slides.length})`;
    const lblFloat = document.getElementById("lblFloatingSideNav");
    if (lblFloat) lblFloat.textContent = `Slides (${slides.length})`;

    applySlideSizeStyles();
    applyThemeStyles();
    renderSlideThumbnails();
    if (window.innerWidth <= 768) {
      autoFitMobileSlide();
    } else {
      applyZoom();
    }
  }

  // Boot Trigger
  renderLayout();
};
