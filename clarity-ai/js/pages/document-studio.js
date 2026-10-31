window.Clarity = window.Clarity || {};
window.Clarity.pages = window.Clarity.pages || {};

window.Clarity.pages["document-studio"] = async function renderDocumentStudio() {
  const main = document.getElementById("main");
  if (!main) return;

  // Document State
  let docTitle = "Untitled Document";
  let docContent = `<h1>1. Introduction</h1>
<p>Start writing or ask the AI assistant in the left chat panel to generate a beautifully formatted document for you. You can describe any topic, and the AI will craft structured sections, detailed paragraphs, tables, and lists exactly as requested.</p>
<h2>1.1 Quick Start Guide</h2>
<p>Type your prompt in the continuous task workspace on the left. For example: "Create a complete research report on renewable energy technologies." or "Draft a detailed business proposal for a mobile app development project."</p>`;

  let docOrientation = "portrait"; // portrait | landscape
  let docSize = "a4"; // a4 | letter
  let docMargins = "normal"; // normal | wide | narrow
  let currentPageIndex = 0;
  let zoomLevel = 100; // percent
  let isSideNavCollapsed = false;

  // AI Edit Mode & Real Content Selection State (Toggleable by user)
  let isAiEditMode = false;
  let activeDocumentSelection = null; // { targetId, targetType, selectedText, targetNode, range }

  // Chat History Store & Generation Control
  let chatHistory = [];
  let isGenerating = false;
  let activeAbortController = null;

  const savedHistory = localStorage.getItem("clarity_doc_chat_history");
  if (savedHistory) {
    try {
      chatHistory = JSON.parse(savedHistory);
    } catch (err) {}
  }

  function saveChatHistory() {
    localStorage.setItem("clarity_doc_chat_history", JSON.stringify(chatHistory));
  }

  // Version History Undo/Redo Stacks
  const undoStack = [];
  const redoStack = [];
  let isUnsaved = false;

  // LocalStorage Auto-recovery
  const savedDoc = localStorage.getItem("clarity_prompt_doc_save");
  if (savedDoc) {
    try {
      const parsed = JSON.parse(savedDoc);
      docTitle = parsed.title || docTitle;
      docContent = parsed.content || docContent;
      docOrientation = parsed.orientation || docOrientation;
      docSize = parsed.size || docSize;
      docMargins = parsed.margins || docMargins;
      currentPageIndex = Math.min(parsed.currentPageIndex || 0, getPages().length - 1);
    } catch (err) {}
  }

  function recordState() {
    undoStack.push({
      title: docTitle,
      content: docContent,
      orientation: docOrientation,
      size: docSize,
      margins: docMargins,
      currentPageIndex
    });
    redoStack.length = 0; // Clear redo stack on manual change
    isUnsaved = true;
    saveLocalDoc();
    updateWorkspaceHeaderStatus();
  }

  function saveLocalDoc() {
    localStorage.setItem("clarity_prompt_doc_save", JSON.stringify({
      title: docTitle,
      content: docContent,
      orientation: docOrientation,
      size: docSize,
      margins: docMargins,
      currentPageIndex
    }));
  }

  // Markdown to HTML Robust Parser for Studio Canvas & Exporters
  function convertMarkdownToHtml(md) {
    if (!md) return "";
    let raw = String(md).trim();

    let html = "";
    if (window.Clarity.markdown && typeof window.Clarity.markdown.render === "function") {
      try {
        html = window.Clarity.markdown.render(raw);
      } catch (e) {
        html = "";
      }
    }

    if (!html || !html.trim()) {
      html = raw;
    }

    // Convert any unparsed markdown headers and inline elements
    html = html
      .replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
      .replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
      .replace(/^#\s+(.+)$/gm, "<h1>$1</h1>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>");

    // Remove empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, "");

    // Apply clean single black line table styles
    html = html.replace(/<table/g, '<table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13.5px; border: none;"');
    html = html.replace(/<th>/g, '<th style="border: 1px solid #000000; padding: 8px 12px; background: var(--surface-muted, #f8fafc); font-weight: 600; text-align: left;">');
    html = html.replace(/<td>/g, '<td style="border: 1px solid #000000; padding: 8px 12px;">');

    // Wrap raw images in styled document figure containers
    html = html.replace(/<img\s+src=["']([^"']+)["']\s*\/?>/gi, (match, src) => {
      if (match.includes('class="doc-image-block"')) return match;
      return `<figure class="doc-image-block" style="text-align: center; margin: 20px 0;"><img src="${src}" alt="Document Figure" style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.1);" /></figure>`;
    });

    return html;
  }

  function extractTitleFromMarkdownOrHtml(raw) {
    if (!raw) return "";
    const h1Match = raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || raw.match(/^#\s+(.+)$/m);
    if (h1Match) {
      return h1Match[1].replace(/<[^>]+>/g, "").replace(/\*\*/g, "").replace(/^[0-9.]+\s*/, "").trim();
    }
    return "";
  }

  // Smart A4 Pagination Algorithm: splits continuous content into accurate A4 pages
  function paginateIntoA4Pages(rawHtml, orientation = "portrait", margins = "normal") {
    if (!rawHtml || !rawHtml.trim()) {
      return ["<p>Start writing or ask the AI assistant to generate a document for you.</p>"];
    }

    const isLandscape = orientation === "landscape";
    // Total A4 page dimensions at standard 96 DPI: 794px width x 1123px height in portrait
    // Top header (38px) + Bottom footer (38px) + Normal margins padding (48px top + 48px bottom = 96px)
    // Available content height: 1123 - 172 = 951px (approx 930px for safe breathing room)
    const maxPageHeight = isLandscape ? 620 : 930;

    // 1. First, split on any explicit manual page breaks
    const rawSegments = [];
    const tempContainer = document.createElement("div");
    tempContainer.innerHTML = rawHtml;

    let currentSegmentNodes = [];
    Array.from(tempContainer.childNodes).forEach(node => {
      const outerHtml = node.outerHTML || "";
      const isExplicitBreak = node.nodeType === Node.ELEMENT_NODE && (
        outerHtml.includes("page-break-after") ||
        outerHtml.includes("page-break-marker") ||
        node.style?.pageBreakAfter === "always" ||
        node.classList?.contains("page-break") ||
        node.classList?.contains("no-print")
      );

      if (isExplicitBreak) {
        if (currentSegmentNodes.length > 0) {
          rawSegments.push(currentSegmentNodes);
          currentSegmentNodes = [];
        }
      } else {
        currentSegmentNodes.push(node);
      }
    });

    if (currentSegmentNodes.length > 0) {
      rawSegments.push(currentSegmentNodes);
    }
    if (rawSegments.length === 0) {
      return ["<p>Start writing or ask the AI assistant to generate a document for you.</p>"];
    }

    const finalPages = [];

    // Helper: Estimate node height in pixels to fit A4 paper accurately
    function getEstimatedNodeHeight(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (!text) return 0;
        const lines = Math.max(1, Math.ceil(text.length / 85));
        return lines * 24 + 12;
      }
      const tag = (node.tagName || "").toLowerCase();
      if (tag === "h1") return 68;
      if (tag === "h2") return 54;
      if (tag === "h3") return 44;
      if (tag === "h4" || tag === "h5" || tag === "h6") return 36;
      if (tag === "p") {
        const text = node.textContent.trim();
        const lines = Math.max(1, Math.ceil(text.length / 85));
        return lines * 24 + 14;
      }
      if (tag === "ul" || tag === "ol") {
        const liCount = node.querySelectorAll ? node.querySelectorAll("li").length : 1;
        return Math.max(1, liCount) * 28 + 16;
      }
      if (tag === "table") {
        const rows = node.querySelectorAll ? node.querySelectorAll("tr").length : 2;
        return rows * 38 + 24;
      }
      if (tag === "img") return 260;
      if (tag === "blockquote") return 72;
      if (tag === "hr") return 20;

      const lines = Math.max(1, Math.ceil((node.textContent || "").length / 85));
      return Math.max(30, lines * 24 + 14);
    }

    // Helper: Recursively flatten wrapper container divs so inner headings/paragraphs are individually paginated
    function extractFlattenedBlockNodes(parent) {
      const blocks = [];
      Array.from(parent.childNodes).forEach(n => {
        if (n.nodeType === Node.TEXT_NODE) {
          if (n.textContent.trim().length > 0) blocks.push(n);
          return;
        }
        if (n.nodeType !== Node.ELEMENT_NODE) return;
        const tag = n.tagName.toLowerCase();
        const outerHtml = n.outerHTML || "";
        const isSpecialComponent = (
          n.classList?.contains("doc-image-block") ||
          n.classList?.contains("page-break-marker") ||
          n.classList?.contains("no-print") ||
          outerHtml.includes("page-break") ||
          tag === "table" ||
          tag === "figure" ||
          tag === "ul" ||
          tag === "ol"
        );

        if (["div", "section", "article", "main", "body"].includes(tag) && !isSpecialComponent) {
          const subBlocks = extractFlattenedBlockNodes(n);
          if (subBlocks.length > 0) {
            blocks.push(...subBlocks);
          } else {
            blocks.push(n);
          }
        } else {
          blocks.push(n);
        }
      });
      return blocks;
    }

    // Process each manual segment and auto-paginate when content exceeds A4 height
    rawSegments.forEach(segmentNodes => {
      const testDiv = document.createElement("div");
      segmentNodes.forEach(n => testDiv.appendChild(n.cloneNode(true)));
      const segmentHtml = testDiv.innerHTML.trim();
      if (!segmentHtml) return;

      const blockNodes = extractFlattenedBlockNodes(testDiv);

      let pageAccumulator = [];
      let currentHeight = 0;

      function flushPage() {
        if (pageAccumulator.length > 0) {
          const pageDiv = document.createElement("div");
          pageAccumulator.forEach(n => pageDiv.appendChild(n.cloneNode(true)));
          finalPages.push(pageDiv.innerHTML.trim());
          pageAccumulator = [];
          currentHeight = 0;
        }
      }

      blockNodes.forEach(node => {
        const nodeHeight = getEstimatedNodeHeight(node);
        const tag = (node.tagName || "").toLowerCase();
        const isHeading = tag === "h1" || tag === "h2" || tag === "h3";

        // Explicit HR or page break marker triggers page break
        if (tag === "hr" || node.classList?.contains("page-break-marker") || node.classList?.contains("page-break")) {
          flushPage();
          return;
        }

        // Major H1 section breaks start on fresh page if page already has content
        if (tag === "h1" && currentHeight > 160) {
          flushPage();
        }

        // Check if node is a list that can be cleanly split across A4 pages
        if ((tag === "ul" || tag === "ol") && (currentHeight + nodeHeight > maxPageHeight)) {
          const listItems = Array.from(node.querySelectorAll("li"));
          if (listItems.length > 2) {
            let currentList = document.createElement(tag);
            listItems.forEach(li => {
              const liHeight = 28;
              if (currentHeight + liHeight > maxPageHeight && currentList.children.length > 0) {
                pageAccumulator.push(currentList);
                flushPage();
                currentList = document.createElement(tag);
              }
              currentList.appendChild(li.cloneNode(true));
              currentHeight += liHeight;
            });
            if (currentList.children.length > 0) {
              pageAccumulator.push(currentList);
            }
            return;
          }
        }

        // Check if node is a table that can be cleanly split across A4 pages
        if (tag === "table" && (currentHeight + nodeHeight > maxPageHeight)) {
          const rows = Array.from(node.querySelectorAll("tr"));
          if (rows.length > 3) {
            const headerRow = node.querySelector("thead tr") || (rows[0].querySelector("th") ? rows[0] : null);
            let currentTable = document.createElement("table");
            currentTable.style.cssText = node.style.cssText;
            if (headerRow) currentTable.appendChild(headerRow.cloneNode(true));

            rows.slice(headerRow ? 1 : 0).forEach(tr => {
              const trHeight = 38;
              if (currentHeight + trHeight > maxPageHeight && currentTable.querySelectorAll("tr").length > (headerRow ? 1 : 0)) {
                pageAccumulator.push(currentTable);
                flushPage();
                currentTable = document.createElement("table");
                currentTable.style.cssText = node.style.cssText;
                if (headerRow) currentTable.appendChild(headerRow.cloneNode(true));
              }
              currentTable.appendChild(tr.cloneNode(true));
              currentHeight += trHeight;
            });
            if (currentTable.querySelectorAll("tr").length > (headerRow ? 1 : 0)) {
              pageAccumulator.push(currentTable);
            }
            return;
          }
        }

        // Heading orphan prevention: move heading to top of next page if near bottom
        const orphanRisk = isHeading && (currentHeight + nodeHeight + 90 > maxPageHeight);

        if (pageAccumulator.length > 0 && (currentHeight + nodeHeight > maxPageHeight || orphanRisk)) {
          flushPage();
        }

        pageAccumulator.push(node);
        currentHeight += nodeHeight;
      });

      flushPage();
    });

    return finalPages.length > 0 ? finalPages : ["<p>Start writing or ask the AI assistant to generate a document for you.</p>"];
  }

  // Parse HTML content into paginated A4 pages
  function getPages() {
    return paginateIntoA4Pages(docContent, docOrientation, docMargins);
  }

  // Save modified current page content back into docContent
  function saveActivePageContentToDoc(pageHtml) {
    const pages = getPages();
    pages[currentPageIndex] = pageHtml;
    docContent = pages.join('\n<div style="page-break-after: always;" class="no-print page-break-marker"></div>\n');
    isUnsaved = true;
    saveLocalDoc();
    updateWorkspaceHeaderStatus();
  }

  // Initial render
  function renderLayout() {
    main.innerHTML = `
      <div class="page prompt-workspace-container" style="display: flex; height: calc(100vh - 60px); background: var(--canvas); overflow: hidden; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; position: relative;">
        
        <!-- Mobile Backdrop for AI Chat Drawer & Pages Overview Drawer -->
        <div id="studioChatMobileBackdrop" class="studio-mobile-backdrop"></div>
        <div id="studioSideNavMobileBackdrop" class="studio-mobile-backdrop"></div>

        <!-- Left Panel: Prompt and AI controls -->
        <aside id="studioAiChatPanel" style="width: 360px; border-right: 1px solid var(--line); background: var(--surface); display: flex; flex-direction: column; flex-shrink: 0; padding: 0; overflow: hidden;">
          
          <!-- Mode Tabs (Studio Toggle) -->
          <div style="display: none !important; gap: 4px; background: var(--surface-muted); padding: 4px; border-radius: 8px;">
            <button class="btn btn--sm" id="tabDocStudio" style="flex: 1; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 6px; background: var(--surface); color: var(--accent); box-shadow: var(--shadow-sm); border: none;">
              📄 Document Studio
            </button>
            <button class="btn btn--sm" id="tabPresStudio" style="flex: 1; font-size: 12px; font-weight: 500; padding: 6px 12px; border-radius: 6px; background: transparent; color: var(--ink-muted); border: none;" onclick="location.hash='#/presentation-studio'">
              📊 Presentation
            </button>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; height: 48px; min-height: 48px; max-height: 48px; padding: 0 16px; border-bottom: 1px solid var(--line); box-sizing: border-box; flex-shrink: 0;">
            <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--ink-muted); letter-spacing: 0.05em;">AI Task Workspace</span>
            <div style="display: flex; align-items: center; gap: 6px;">
              <button class="btn btn--xs btn--ghost" id="btnClearChatHistory" style="font-size: 10px; color: var(--ink-soft); display: flex; align-items: center; gap: 4px; padding: 2px 6px; cursor: pointer; border-radius: 4px; border: 1px solid var(--line);" title="Reset conversation">
                🗑️ Clear
              </button>
              <button class="btn btn--xs btn--outline studio-mobile-only" id="btnMobileCloseChat" style="font-size: 11px; color: var(--ink); padding: 2px 8px; border-radius: 4px; font-weight: 600; border-color: var(--line-strong);" title="Close Chat Drawer">
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
                <input type="checkbox" id="toggleAiEditMode" style="cursor: pointer; width: 15px; height: 15px; accent-color: var(--accent);" />
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

              <div id="aiCreationStatusContainer" style="display: none; background: rgba(79,70,229,0.05); border: 1px solid rgba(79,70,229,0.15); border-radius: 8px; padding: 10px; flex-direction: column; gap: 6px;">
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                  <strong id="aiStatusTitle" style="color: var(--accent); display: flex; align-items: center; gap: 6px;">
                    <span class="spinner-small" style="width: 12px; height: 12px; border: 2px solid var(--accent); border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite;"></span>
                    AI Generation...
                  </strong>
                  <span id="aiStepProgress" style="color: var(--ink-muted); font-weight: 500;">Drafting...</span>
                </div>
                <p style="font-size: 11px; color: var(--ink-soft); margin: 0;" id="aiStatusSubtext">Grounding context and executing task...</p>
              </div>

              <div id="aiErrorBanner" style="display: none; background: rgba(239,68,68,0.05); border: 1px solid rgba(239,68,68,0.15); border-radius: 8px; padding: 10px; color: #ef4444; font-size: 11px; line-height: 1.45;">
                <strong>Task Failed:</strong> <span id="aiErrorMessage">Timeout trying to contact AI engine.</span>
              </div>

  <!-- Removed configStyle and configMargins -->

              <div style="display: none !important;">
                <select id="configOrientation">
                  <option value="portrait" ${docOrientation === "portrait" ? "selected" : ""}>Portrait</option>
                  <option value="landscape" ${docOrientation === "landscape" ? "selected" : ""}>Landscape</option>
                </select>
                <select id="aiDocPreset">
                  <option value="report">Project Evaluation</option>
                </select>
                <input type="text" id="docStudioTitle" value="${window.Clarity.utils.escapeHtml(docTitle)}" />
              </div>

              <div class="studio-chat-input-pill">
                <textarea id="aiDocCreatorPrompt" class="studio-chat-textarea" rows="1" placeholder="Ask to write..."></textarea>
                <button id="btnAiDocGenerate" type="button" style="background: var(--accent); color: white;" title="Send Request">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 2 15 22 11 13 2 9 22 2"/><line x1="22" y1="2" x2="11" y2="13"/></svg>
                </button>
              </div>
            </div>
          </div>

        </aside>

        <!-- Center Panel: Realistic Page Preview Canvas -->
        <main style="flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative;">
          
          <!-- Workspace Control Toolbar (Single Level 48px Header) -->
          <header class="workspace-nav">
            <div class="studio-header-title-box">
              <button class="studio-top-left-nav-btn" id="btnToggleSideNavTop" title="Toggle Pages Overview (Panel)" type="button">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
              </button>
              <span class="studio-header-title" id="headerTitle">Document Studio</span>
              <span id="unsavedDocBadge" class="studio-draft-badge" style="display: none !important;">Draft</span>
            </div>

            <!-- Secondary Tool Strip in Middle (Pagination, Undo/Redo, Zoom/Fit) -->
            <div class="studio-header-secondary">
              <!-- Pagination -->
              <div class="studio-tool-group">
                <button class="btn btn--xs btn--outline" id="btnPrevPage" style="padding: 4px;" title="Previous Page"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>
                <span style="font-size: 11px; font-weight: 600; color: var(--ink-soft); padding: 0 4px; white-space: nowrap;" id="labelPageCounter">Page 1 of 1</span>
                <button class="btn btn--xs btn--outline" id="btnNextPage" style="padding: 4px;" title="Next Page"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>
              </div>

              <div class="studio-tool-divider"></div>

              <!-- Undo/Redo -->
              <div class="studio-tool-group">
                <button class="btn btn--xs btn--ghost" id="btnUndo" title="Undo (Ctrl+Z)" style="padding: 4px; color: var(--ink-soft);"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg></button>
                <button class="btn btn--xs btn--ghost" id="btnRedo" title="Redo (Ctrl+Y)" style="padding: 4px; color: var(--ink-soft);"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg></button>
              </div>

              <div class="studio-tool-divider"></div>

              <!-- Zoom & Fit Controls -->
              <div class="studio-tool-group">
                <button class="btn btn--xs btn--ghost" id="btnZoomOut" title="Zoom Out" style="padding: 3px; color: var(--ink-soft);"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
                <button class="btn btn--xs btn--ghost" id="btnFitScreen" title="Fit to Screen width" style="font-size: 11px; font-weight: 600; color: var(--ink); padding: 0 4px; min-width: 38px; text-align: center;"><span id="labelZoom">100%</span></button>
                <button class="btn btn--xs btn--ghost" id="btnZoomIn" title="Zoom In" style="padding: 3px; color: var(--ink-soft);"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
              </div>

              <!-- Hidden button preserved for JS compatibility -->
              <button id="btnInsertPageBreak" style="display: none !important;"></button>
            </div>

            <!-- Primary Actions on Right -->
            <div class="studio-header-primary-actions">
              <button class="btn btn--xs btn--primary studio-mobile-toggle-chat" id="btnMobileToggleChat" title="Open AI Chat Drawer">
                💬 <span class="mobile-btn-text">AI Chat</span>
              </button>
              <!-- Unified Single Option: Export & Actions Dropdown (Icon Only) -->
              <div class="studio-actions-dropdown-container">
                <button class="btn btn--sm btn--primary studio-actions-btn" id="btnStudioActionsMenu" style="background: var(--accent); color: white;" title="Export & Document Actions" type="button">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </button>

                <div class="studio-actions-menu" id="studioActionsDropdown">
                  <button class="studio-dropdown-item" id="btnPdfExport" type="button">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent);"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    <div>
                      <div style="font-weight: 600; font-size: 12.5px; color: var(--ink);">Export as PDF</div>
                      <div style="font-size: 10px; color: var(--ink-muted);">Standard vector print PDF</div>
                    </div>
                  </button>

                  <button class="studio-dropdown-item" id="btnDocxExport" type="button">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="color: #2563eb;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8"/><path d="M8 17h6"/></svg>
                    <div>
                      <div style="font-weight: 600; font-size: 12.5px; color: var(--ink);">Export as Word (.docx)</div>
                      <div style="font-size: 10px; color: var(--ink-muted);">Editable Microsoft Word doc</div>
                    </div>
                  </button>

                  <div style="height: 1px; background: var(--line); margin: 4px 6px;"></div>

                  <button class="studio-dropdown-item studio-dropdown-item-danger" id="btnResetDocCanvas" type="button">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#ef4444" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    <div>
                      <div style="font-weight: 600; font-size: 12.5px; color: #ef4444;">Clear Document</div>
                      <div style="font-size: 10px; color: #ef4444; opacity: 0.85;">Reset all pages and content</div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </header>

          <!-- Core canvas outer wrapper (Centering paper) -->
          <div style="flex: 1; display: flex; flex-direction: column; overflow-y: auto; align-items: center; padding: 32px 16px; gap: 24px; scroll-behavior: smooth; position: relative;" id="documentCanvasWrapper">
            <!-- Dynamic Multi-Page A4 Sheet Flow -->
            <div id="documentPagesFlow" style="display: flex; flex-direction: column; align-items: center; gap: 32px; width: 100%; transform-origin: top center; transition: transform 0.15s ease-out;">
              <!-- Individual A4 pages will be populated dynamically -->
            </div>
          </div>

        </main>

        <!-- Right Panel: Side Page Thumbnail Navigator -->
        <aside id="documentSideNavigator" style="width: 240px; border-left: 1px solid var(--line); background: var(--surface); display: flex; flex-direction: column; flex-shrink: 0; box-sizing: border-box; overflow: hidden; z-index: 15;">
          <!-- Header Bar (Hidden from UI while retaining close/toggle functionality) -->
          <div style="display: none !important; padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--surface-muted); align-items: center; justify-content: space-between; flex-shrink: 0;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--ink-muted); letter-spacing: 0.05em; white-space: nowrap;">Pages Overview</span>
            </div>
            <button class="btn btn--xs btn--ghost" id="btnToggleSideNav" title="Close Panel" style="padding: 3px 6px; color: var(--ink-muted); font-size: 13px; font-weight: bold; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center;">✕</button>
          </div>
          
          <div id="pagesOverviewList" style="flex: 1; overflow-y: auto; scroll-snap-type: y mandatory; padding: 12px; display: flex; flex-direction: column; gap: 16px; align-items: center; width: 100%; box-sizing: border-box;">
            <!-- Dynamically populated page miniature thumbnails -->
          </div>

          <div style="padding: 12px; border-top: 1px solid var(--line); font-size: 11px; color: var(--ink-muted); display: flex; flex-direction: column; gap: 4px; background: var(--surface-muted); flex-shrink: 0;">
            <div style="display: flex; justify-content: space-between;">
              <span>Total words:</span>
              <strong id="statWordCount" style="color: var(--ink);">0</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>Read duration:</span>
              <strong id="statReadTime" style="color: var(--ink);">0 min</strong>
            </div>
          </div>
        </aside>

      </div>
    `;

    syncCanvasAndUI();
    bindEvents();
    renderChatMessages();
  }

  function formatStudioChatMessage(rawText) {
    if (!rawText) return "";
    let str = String(rawText).trim();

    if (window.Clarity && window.Clarity.markdown && typeof window.Clarity.markdown.render === "function") {
      try {
        const mdHtml = window.Clarity.markdown.render(str);
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
      const bg = isUser ? "rgba(79,70,229,0.08)" : "var(--surface-muted)";
      const border = isUser ? "1px solid rgba(79,70,229,0.15)" : "1px solid var(--line)";
      const align = isUser ? "flex-end" : "flex-start";
      const label = isUser ? "You" : "AI Assistant";
      const color = isUser ? "var(--accent)" : "var(--ink-muted)";
      
      let rawText = msg.text || "";

      // Extract image preview markup from assistant messages so image tags are not escaped
      let imageCardHtml = "";
      const imgMatch = rawText.match(/<div[^>]*><img[^>]+src=["']([^"']+)["'][^>]*><\/div>/i) ||
                       rawText.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);

      if (imgMatch) {
        const imgSrc = imgMatch[1];
        imageCardHtml = `<div style="margin-top: 8px; border-radius: 6px; overflow: hidden; border: 1px solid var(--line);"><img src="${imgSrc}" alt="Preview" style="width: 100%; max-height: 150px; object-fit: cover; display: block;" /></div>`;
        rawText = rawText.replace(/<div[^>]*><img[^>]+src=["']([^"']+)["'][^>]*><\/div>/gi, "").replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi, "").trim();
      }

      const renderedText = formatStudioChatMessage(rawText) + imageCardHtml;

      let proposalHtml = "";
      if (msg.proposedEdit) {
        const prop = msg.proposedEdit;
        const origEscaped = window.Clarity.utils && window.Clarity.utils.escapeHtml ? window.Clarity.utils.escapeHtml(prop.originalText) : prop.originalText;
        const propEscaped = window.Clarity.utils && window.Clarity.utils.escapeHtml ? window.Clarity.utils.escapeHtml(prop.proposedText) : prop.proposedText;

        if (prop.status === "pending") {
          proposalHtml = `
            <div class="proposed-diff-card" style="margin-top: 10px; border: 1px solid rgba(99,102,241,0.3); background: var(--surface); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; font-weight: 700; color: #4f46e5; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 4px;">
                  ✨ Proposed Edit: <span style="color: var(--ink-soft); text-transform: capitalize;">${prop.targetType || "Text"}</span>
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
                <button class="btn btn--xs btn--outline btn-discard-doc-edit" data-msg-idx="${index}" style="font-size: 11px; padding: 3px 10px; cursor: pointer;">✕ Discard</button>
                <button class="btn btn--xs btn--primary btn-apply-doc-edit" data-msg-idx="${index}" style="font-size: 11px; padding: 3px 12px; background: #4f46e5; border-color: #4f46e5; cursor: pointer; color: white; font-weight: 600;">✓ Apply Edit</button>
              </div>
            </div>
          `;
        } else if (prop.status === "applied") {
          proposalHtml = `
            <div style="margin-top: 8px; background: rgba(34, 197, 94, 0.08); border: 1px solid rgba(34, 197, 94, 0.25); border-radius: 6px; padding: 6px 8px; font-size: 11px; color: #16a34a; font-weight: 600; display: flex; align-items: center; gap: 4px;">
              <span>✓ Edit applied directly to document editor & preview.</span>
            </div>
          `;
        } else if (prop.status === "discarded") {
          proposalHtml = `
            <div style="margin-top: 8px; background: var(--surface-muted); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; font-size: 11px; color: var(--ink-muted); display: flex; align-items: center; gap: 4px;">
              <span>✕ Edit discarded. Original document content preserved.</span>
            </div>
          `;
        }
      }

      return `
        <div style="align-self: ${align}; max-width: 90%; display: flex; flex-direction: column; gap: 2px;">
          <span style="font-size: 10px; font-weight: 700; color: ${color}; text-transform: uppercase; letter-spacing: 0.05em; align-self: ${align};">${label}</span>
          <div style="background: ${bg}; border: ${border}; padding: 10px 12px; border-radius: 8px; line-height: 1.5; font-size: 12.5px; color: var(--ink); word-break: break-word;">
            ${renderedText}
            ${imageCardHtml}
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
    const generateBtn = document.getElementById("btnAiDocGenerate");

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
      titleEl.innerHTML = `<span class="spinner-small" style="width: 12px; height: 12px; border: 2px solid var(--accent); border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite;"></span> Thinking...`;
      progressEl.textContent = "Responding...";
      subtextEl.textContent = subtext || "AI Assistant is drafting a response...";
    } else if (status === "planning") {
      titleEl.innerHTML = `<span class="spinner-small" style="width: 12px; height: 12px; border: 2px solid var(--accent); border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite;"></span> Thinking/Planning`;
      progressEl.textContent = "Planning...";
      subtextEl.textContent = subtext || "Analyzing prompt context and structuring document updates.";
    } else if (status === "generating") {
      titleEl.innerHTML = `<span class="spinner-small" style="width: 12px; height: 12px; border: 2px solid var(--accent); border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite;"></span> Generating Content`;
      progressEl.textContent = "Writing...";
      subtextEl.textContent = subtext || "Drafting beautiful detailed document sections.";
    } else if (status === "updating") {
      titleEl.innerHTML = `<span class="spinner-small" style="width: 12px; height: 12px; border: 2px solid var(--accent); border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite;"></span> Updating Document`;
      progressEl.textContent = "Modifying...";
      subtextEl.textContent = subtext || "Applying selective edits onto active document sections.";
    } else if (status === "exporting") {
      titleEl.innerHTML = `<span class="spinner-small" style="width: 12px; height: 12px; border: 2px solid var(--accent); border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite;"></span> Exporting File`;
      progressEl.textContent = "Compiling...";
      subtextEl.textContent = subtext || "Packing OpenXML or Puppeteer PDF formats.";
    }
  }

  // Intercept and bind all interactives
  function bindEvents() {
    const titleInput = document.getElementById("docStudioTitle");
    const docCanvas = document.getElementById("wordEditorCanvas");
    const btnGenerate = document.getElementById("btnAiDocGenerate");
    const btnPdfExport = document.getElementById("btnPdfExport");
    const btnDocxExport = document.getElementById("btnDocxExport");
    const configOrientation = document.getElementById("configOrientation");
    const configMargins = document.getElementById("configMargins");

    // Title Sync
    if (titleInput) {
      titleInput.addEventListener("input", (e) => {
        docTitle = e.target.value;
        const hTitle = document.getElementById("headerPaperTitle");
        if (hTitle) hTitle.textContent = docTitle;
        saveLocalDoc();
      });
    }

    // Content Canvas Input sync back to page content
    if (docCanvas) {
      docCanvas.addEventListener("input", () => {
        saveActivePageContentToDoc(docCanvas.innerHTML);
        updateDocumentStats();
        renderPageThumbnails();
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
      autoFitToScreen();
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

    // Responsive resize auto-fit
    window.addEventListener("resize", () => {
      if (window.location.hash.includes("document-studio") && window.innerWidth <= 768) {
        autoFitToScreen();
      }
    });

    // Previous/Next page
    document.getElementById("btnPrevPage")?.addEventListener("click", () => {
      if (currentPageIndex > 0) {
        scrollToPage(currentPageIndex - 1);
      }
    });
    document.getElementById("btnNextPage")?.addEventListener("click", () => {
      const pages = getPages();
      if (currentPageIndex < pages.length - 1) {
        scrollToPage(currentPageIndex + 1);
      }
    });

    // Option Dropdowns Re-flow Page Sizing
    if (configOrientation) {
      configOrientation.addEventListener("change", (e) => {
        recordState();
        docOrientation = e.target.value;
        applyPageLayoutStyles();
      });
    }
    if (configMargins) {
      configMargins.addEventListener("change", (e) => {
        recordState();
        docMargins = e.target.value;
        applyPageLayoutStyles();
      });
    }

    // Undo/Redo Version actions
    document.getElementById("btnUndo")?.addEventListener("click", () => {
      if (undoStack.length > 0) {
        const state = undoStack.pop();
        redoStack.push({
          title: docTitle,
          content: docContent,
          orientation: docOrientation,
          size: docSize,
          margins: docMargins,
          currentPageIndex
        });
        applyState(state);
      }
    });
    document.getElementById("btnRedo")?.addEventListener("click", () => {
      if (redoStack.length > 0) {
        const state = redoStack.pop();
        undoStack.push({
          title: docTitle,
          content: docContent,
          orientation: docOrientation,
          size: docSize,
          margins: docMargins,
          currentPageIndex
        });
        applyState(state);
      }
    });

    // Reset Document Canvas Action (Clear Desk / Everything)
    const btnResetDoc = document.getElementById("btnResetDocCanvas");
    if (btnResetDoc) {
      btnResetDoc.addEventListener("click", () => {
        recordState();
        docContent = "<h1>Untitled Document</h1><p>Start writing or ask the AI to generate something new on any topic.</p>";
        currentPageIndex = 0;
        docTitle = "Untitled Document";
        try { localStorage.removeItem("clarity_document_draft"); } catch {}
        try { localStorage.removeItem("clarity_document_title"); } catch {}
        try { localStorage.removeItem("clarity_doc_chat_history"); } catch {}
        const docTitleInput = document.getElementById("docStudioTitle");
        if (docTitleInput) docTitleInput.value = "Untitled Document";
        const headerTitle = document.getElementById("headerTitle");
        if (headerTitle) headerTitle.textContent = "Document Studio";
        clearStudioChat();
        syncCanvasAndUI();
        const studioActionsDropdown = document.getElementById("studioActionsDropdown");
        if (studioActionsDropdown) studioActionsDropdown.classList.remove("active");
        const promptInput = document.getElementById("aiDocCreatorPrompt");
        if (promptInput) {
          promptInput.value = "";
          resizeDocPrompt();
        }
        if (window.Clarity.toast) window.Clarity.toast.show("Document cleared. Ready for a new topic!", "info");
      });
    }

    // Insert Page Break Action
    const btnPageBreak = document.getElementById("btnInsertPageBreak");
    if (btnPageBreak) {
      btnPageBreak.addEventListener("click", () => {
        const pagesFlow = document.getElementById("documentPagesFlow");
        if (!pagesFlow) return;

        const selection = window.getSelection();
        let targetContent = null;
        if (selection.rangeCount > 0) {
          const anchor = selection.anchorNode;
          targetContent = anchor ? (anchor.nodeType === Node.ELEMENT_NODE ? anchor.closest(".word-page-content") : anchor.parentElement?.closest(".word-page-content")) : null;
        }
        if (!targetContent) {
          targetContent = document.getElementById(`pageSheet_${currentPageIndex}`)?.querySelector(".word-page-content") || pagesFlow.querySelector(".word-page-content");
        }

        if (targetContent) {
          const pageBreakMarker = document.createElement("div");
          pageBreakMarker.style.cssText = "page-break-after: always;";
          pageBreakMarker.className = "no-print page-break-marker";

          let range;
          if (selection.rangeCount > 0 && targetContent.contains(selection.anchorNode)) {
            range = selection.getRangeAt(0);
          } else {
            range = document.createRange();
            range.selectNodeContents(targetContent);
            range.collapse(false);
          }
          range.insertNode(pageBreakMarker);

          // Update docContent and re-paginate into separate A4 sheets
          const allPageDivs = Array.from(pagesFlow.querySelectorAll(".word-page-content"));
          docContent = allPageDivs.map(el => el.innerHTML).join('\n<div style="page-break-after: always;" class="no-print page-break-marker"></div>\n');
          recordState();
          syncCanvasAndUI();
          scrollToPage(currentPageIndex + 1);
          if (window.Clarity.toast) window.Clarity.toast.show("Page break inserted. Created new A4 page.", "success");
        }
      });
    }

    // Keyboard shortcut for Page Break (Ctrl+Enter or Cmd+Enter)
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !e.shiftKey) {
        const activeEl = document.activeElement;
        const promptInput = document.getElementById("aiDocCreatorPrompt");
        if (activeEl === promptInput) return; // Do not trigger if user is submitting prompt
        const pagesFlow = document.getElementById("documentPagesFlow");
        if (pagesFlow && pagesFlow.contains(activeEl)) {
          e.preventDefault();
          const btn = document.getElementById("btnInsertPageBreak");
          if (btn) btn.click();
        }
      }
    });

    // Direct Suggestion Chips trigger prompt typing
    document.querySelectorAll(".suggestion-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const promptInput = document.getElementById("aiDocCreatorPrompt");
        if (promptInput) {
          promptInput.value = chip.dataset.prompt;
          promptInput.focus();
        }
      });
    });

    // AI Edit Mode Toggle & Selection Listeners
    const toggleAiEditMode = document.getElementById("toggleAiEditMode");
    const aiEditModeBadge = document.getElementById("aiEditModeBadge");

    function updateSelectionUi() {
      const box = document.getElementById("selectionPreviewContainer");
      if (!box) return;

      if (!activeDocumentSelection || !activeDocumentSelection.selectedText) {
        box.style.display = "none";
        box.innerHTML = "";
        return;
      }

      box.style.display = "block";
      const safeSnippet = window.Clarity.utils && window.Clarity.utils.escapeHtml 
        ? window.Clarity.utils.escapeHtml(activeDocumentSelection.selectedText) 
        : activeDocumentSelection.selectedText;

      box.innerHTML = `
        <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.35); border-radius: 6px; padding: 6px 8px; display: flex; flex-direction: column; gap: 3px; font-size: 11.5px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="font-weight: 700; color: #4f46e5; display: flex; align-items: center; gap: 4px;">
              🎯 Target: <span style="text-transform: capitalize; background: rgba(99, 102, 241, 0.15); padding: 1px 6px; border-radius: 4px;">${activeDocumentSelection.targetType}</span>
            </span>
            <button id="btnClearSelection" class="btn btn--xs btn--ghost" style="padding: 1px 5px; font-size: 10.5px; color: var(--ink-muted); cursor: pointer;" title="Clear Selection">✕ Clear</button>
          </div>
          <div style="color: var(--ink-soft); font-style: italic; font-size: 11px; max-height: 36px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            "${safeSnippet}"
          </div>
        </div>
      `;
      document.getElementById("btnClearSelection")?.addEventListener("click", () => {
        clearDocumentSelection();
      });
    }

    function clearDocumentSelection() {
      activeDocumentSelection = null;
      const sel = window.getSelection();
      if (sel) {
        try { sel.removeAllRanges(); } catch(e) {}
      }
      updateSelectionUi();
    }

    function handleDocumentCanvasSelection() {
      if (!isAiEditMode) return;
      const pagesFlow = document.getElementById("documentPagesFlow") || document.getElementById("documentCanvasWrapper");
      if (!pagesFlow) return;

      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        return;
      }

      const range = sel.getRangeAt(0);
      if (!pagesFlow.contains(range.commonAncestorContainer)) {
        return;
      }

      const selectedText = sel.toString().trim();
      if (!selectedText) return;

      let targetNode = range.commonAncestorContainer.nodeType === Node.TEXT_NODE 
        ? range.commonAncestorContainer.parentElement 
        : range.commonAncestorContainer;
      
      let targetType = "selection";
      if (targetNode) {
        const tag = targetNode.tagName ? targetNode.tagName.toLowerCase() : "";
        if (tag === "h1") targetType = "Heading 1";
        else if (tag === "h2") targetType = "Heading 2";
        else if (tag === "h3") targetType = "Heading 3";
        else if (tag === "p") targetType = "paragraph";
        else if (tag === "li") targetType = "list item";
        else if (tag === "td" || tag === "th") targetType = "table cell";
        else if (tag === "blockquote") targetType = "quote";
      }

      const targetId = `doc_el_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      if (targetNode && targetNode.setAttribute) {
        targetNode.setAttribute("data-clarity-target-id", targetId);
      }

      activeDocumentSelection = {
        targetId,
        targetType,
        selectedText,
        targetNode,
        range: range.cloneRange()
      };

      updateSelectionUi();
    }

    if (toggleAiEditMode) {
      toggleAiEditMode.addEventListener("change", (e) => {
        isAiEditMode = e.target.checked;
        if (aiEditModeBadge) {
          aiEditModeBadge.textContent = isAiEditMode ? "ON" : "OFF";
          aiEditModeBadge.style.background = isAiEditMode ? "#4f46e5" : "var(--surface)";
          aiEditModeBadge.style.color = isAiEditMode ? "#ffffff" : "var(--ink-muted)";
          aiEditModeBadge.style.borderColor = isAiEditMode ? "#4f46e5" : "var(--line)";
        }
        updateSelectionUi();
        if (window.Clarity.toast) {
          window.Clarity.toast.show(isAiEditMode ? "AI Edit Mode activated. Select text in canvas to edit." : "AI Edit Mode deactivated.", "info");
        }
      });
    }

    // Selection listener on document canvas
    document.addEventListener("selectionchange", () => {
      if (isAiEditMode && window.location.hash.includes("document-studio")) {
        handleDocumentCanvasSelection();
      }
    });

    // Apply & Discard Proposal Event Delegation
    document.addEventListener("click", (e) => {
      const applyBtn = e.target.closest(".btn-apply-doc-edit");
      if (applyBtn) {
        e.preventDefault();
        e.stopPropagation();
        const idx = parseInt(applyBtn.dataset.msgIdx, 10);
        applyDocumentProposal(idx);
        return;
      }

      const discardBtn = e.target.closest(".btn-discard-doc-edit");
      if (discardBtn) {
        e.preventDefault();
        e.stopPropagation();
        const idx = parseInt(discardBtn.dataset.msgIdx, 10);
        discardDocumentProposal(idx);
        return;
      }
    });

    function applyDocumentProposal(msgIndex) {
      const msg = chatHistory[msgIndex];
      if (!msg || !msg.proposedEdit || msg.proposedEdit.status !== "pending") return;

      const { proposedText, targetId, selectedText } = msg.proposedEdit;
      recordState();

      const pagesFlow = document.getElementById("documentPagesFlow");
      if (pagesFlow) {
        let replaced = false;
        if (targetId) {
          const el = pagesFlow.querySelector(`[data-clarity-target-id="${targetId}"]`);
          if (el) {
            el.innerHTML = proposedText;
            replaced = true;
          }
        }
        if (!replaced) {
          const allContents = Array.from(pagesFlow.querySelectorAll(".word-page-content"));
          for (const contentEl of allContents) {
            if (contentEl.innerHTML.includes(selectedText)) {
              contentEl.innerHTML = contentEl.innerHTML.replace(selectedText, proposedText);
              replaced = true;
              break;
            }
          }
        }
        if (!replaced && docContent.includes(selectedText)) {
          docContent = docContent.replace(selectedText, proposedText);
          replaced = true;
        }

        if (replaced) {
          const allPageDivs = Array.from(pagesFlow.querySelectorAll(".word-page-content"));
          if (allPageDivs.length > 0) {
            docContent = allPageDivs.map(el => el.innerHTML).join('\n<div style="page-break-after: always;" class="no-print page-break-marker"></div>\n');
          }
          saveLocalDoc();
          syncCanvasAndUI();
        }
      }

      msg.proposedEdit.status = "applied";
      saveChatHistory();
      renderChatMessages();
      clearDocumentSelection();

      if (window.Clarity.toast) window.Clarity.toast.show("Edit applied to document!", "success");
    }

    function discardDocumentProposal(msgIndex) {
      const msg = chatHistory[msgIndex];
      if (!msg || !msg.proposedEdit || msg.proposedEdit.status !== "pending") return;

      msg.proposedEdit.status = "discarded";
      saveChatHistory();
      renderChatMessages();
      clearDocumentSelection();

      if (window.Clarity.toast) window.Clarity.toast.show("Edit discarded.", "info");
    }

    // Right Side Navigator (Pages Overview) Clean Toggle Logic
    function setSideNavOpen(open) {
      const sideNav = document.getElementById("documentSideNavigator");
      const floatingBtn = document.getElementById("btnOpenSideNavFloating");
      const topNavBtn = document.getElementById("btnToggleSideNavTop");
      const sideBackdrop = document.getElementById("studioSideNavMobileBackdrop");
      if (!sideNav) return;

      const isMobile = window.innerWidth <= 768;
      isSideNavCollapsed = !open;

      if (isMobile) {
        if (open) {
          sideNav.classList.add("mobile-open");
          if (sideBackdrop) sideBackdrop.classList.add("active");
          if (topNavBtn) {
            topNavBtn.style.background = "var(--surface-muted)";
            topNavBtn.style.borderColor = "var(--accent)";
            topNavBtn.style.color = "var(--accent)";
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
            topNavBtn.style.borderColor = "var(--accent)";
            topNavBtn.style.color = "var(--accent)";
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
      btnToggleSideNav.addEventListener("click", () => setSideNavOpen(false));
    }

    const btnToggleSideNavTop = document.getElementById("btnToggleSideNavTop");
    if (btnToggleSideNavTop) {
      btnToggleSideNavTop.addEventListener("click", () => {
        const sideNav = document.getElementById("documentSideNavigator");
        const isMobile = window.innerWidth <= 768;
        const isOpen = isMobile 
          ? (sideNav && sideNav.classList.contains("mobile-open"))
          : (sideNav && !sideNav.classList.contains("collapsed") && sideNav.style.display !== "none");
        setSideNavOpen(!isOpen);
      });
    }

    const btnOpenSideNavFloating = document.getElementById("btnOpenSideNavFloating");
    if (btnOpenSideNavFloating) {
      btnOpenSideNavFloating.addEventListener("click", () => setSideNavOpen(true));
    }

    const sideNavMobileBackdrop = document.getElementById("studioSideNavMobileBackdrop");
    if (sideNavMobileBackdrop) {
      sideNavMobileBackdrop.addEventListener("click", () => setSideNavOpen(false));
    }

    // Mobile Phone Only: AI Chat Drawer Toggle Logic
    function setMobileChatOpen(open) {
      const chatPanel = document.getElementById("studioAiChatPanel");
      const backdrop = document.getElementById("studioChatMobileBackdrop");
      if (!chatPanel) return;

      if (open) {
        chatPanel.classList.add("mobile-open");
        if (backdrop) backdrop.classList.add("active");
      } else {
        chatPanel.classList.remove("mobile-open");
        if (backdrop) backdrop.classList.remove("active");
      }
    }

    const btnMobileToggleChat = document.getElementById("btnMobileToggleChat");
    if (btnMobileToggleChat) {
      btnMobileToggleChat.addEventListener("click", () => setMobileChatOpen(true));
    }

    const btnMobileCloseChat = document.getElementById("btnMobileCloseChat");
    if (btnMobileCloseChat) {
      btnMobileCloseChat.addEventListener("click", () => setMobileChatOpen(false));
    }

    const chatBackdrop = document.getElementById("studioChatMobileBackdrop");
    if (chatBackdrop) {
      chatBackdrop.addEventListener("click", () => setMobileChatOpen(false));
    }

    // Continuous AI Task Chat Handlers
    function clearStudioChat() {
      if (activeAbortController) {
        try { activeAbortController.abort(); } catch {}
        activeAbortController = null;
      }
      chatHistory.length = 0;
      chatHistory = [];
      try { localStorage.removeItem("clarity_doc_chat_history"); } catch {}
      try { localStorage.setItem("clarity_doc_chat_history", "[]"); } catch {}
      const container = document.getElementById("aiChatMessages");
      if (container) {
        container.innerHTML = "";
      }
      renderChatMessages();
      updateLoaderState("idle");
      if (window.Clarity.toast) window.Clarity.toast.show("Chat history cleared.", "success");
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
        const promptInput = document.getElementById("aiDocCreatorPrompt");
        if (promptInput) {
          promptInput.value = chip.dataset.prompt;
          resizeDocPrompt();
          promptInput.focus();
        }
      });
    });

    function resizeDocPrompt() {
      const pi = document.getElementById("aiDocCreatorPrompt");
      if (!pi) return;
      pi.style.height = "auto";
      const scrollH = pi.scrollHeight;
      const newH = Math.min(Math.max(scrollH, 24), 140);
      pi.style.height = newH + "px";
      pi.style.overflowY = scrollH > 140 ? "auto" : "hidden";
    }

    // Enter to Send & Shift+Enter to newline
    const promptInput = document.getElementById("aiDocCreatorPrompt");
    if (promptInput) {
      promptInput.addEventListener("input", resizeDocPrompt);
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
      const promptInput = document.getElementById("aiDocCreatorPrompt");
      if (!promptInput) return;
      const promptText = promptInput.value.trim();
      if (!promptText) return;

      if (isGenerating) {
        if (window.Clarity.toast) window.Clarity.toast.show("Please wait for the current task to finish or stop it.", "warning");
        return;
      }

      promptInput.value = "";
      resizeDocPrompt();

      // Hide errors
      const errBanner = document.getElementById("aiErrorBanner");
      if (errBanner) errBanner.style.display = "none";

      // 1. Add user prompt to history
      chatHistory.push({ role: "user", text: promptText });
      saveChatHistory();
      renderChatMessages();

      const q = promptText.toLowerCase().trim();

      // Check if it's a delete prompt
      if (/\b(?:delete|clear|wipe)\b.*\b(?:document|page|report)\b/i.test(q)) {
        recordState();
        docContent = "<h1>1. Document Cleared</h1><p>Start writing or ask the AI to generate something new.</p>";
        currentPageIndex = 0;
        syncCanvasAndUI();
        chatHistory.push({ role: "assistant", text: "The document has been cleared successfully. You can generate a new one or undo with Ctrl+Z." });
        saveChatHistory();
        renderChatMessages();
        if (window.Clarity.toast) window.Clarity.toast.show("Document cleared.", "info");
        return;
      }

      // Check if it's an export prompt
      if (/\b(?:export|download)\b.*\b(?:pdf|docx?)\b/i.test(q)) {
        chatHistory.push({ role: "assistant", text: "Initiating file export..." });
        saveChatHistory();
        renderChatMessages();
        if (q.includes("pdf")) {
          document.getElementById("btnPdfExport")?.click();
        } else {
          document.getElementById("btnDocxExport")?.click();
        }
        return;
      }

      // Check if it's a document generation request
      const isDocumentRequest = /\b(?:report|document|proposal|essay|paper|study|analysis|startup|business plan|project report)\b/i.test(q);

      // Check if it's a standalone Image Generation request
      const isImageRequest = !isDocumentRequest && (
        /\b(?:generate|create|add|make|draw|insert)\s+(?:a|an|the|this)?\s*(?:image|photo|illustration|picture|diagram|graphic|visual|render)\b/i.test(q) ||
        /\b(?:image|photo|illustration|picture|diagram|render)\s+of\b/i.test(q)
      );

      if (isImageRequest) {
        activeAbortController = new AbortController();
        updateLoaderState("generating", "Generating AI image asset...");
        try {
          const res = await fetch("/api/studio/generate-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: promptText,
              aspectRatio: "16:9",
              targetStudio: "document"
            }),
            signal: activeAbortController.signal
          });

          if (!res.ok) throw new Error("AI image generation request failed.");
          const data = await res.json();
          if (!data.imageUrl) throw new Error("No image was returned by AI provider.");

          recordState();
          const cleanCaption = promptText.length > 80 ? promptText.substring(0, 77) + "..." : promptText;
          const imgBlock = `
<figure class="doc-image-block" style="text-align: center; margin: 20px 0;">
  <img src="${data.imageUrl}" alt="${cleanCaption.replace(/"/g, '&quot;')}" style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.1);" />
  <figcaption style="font-size: 11.5px; color: var(--ink-muted); margin-top: 6px; font-style: italic;">Figure: ${cleanCaption}</figcaption>
</figure>`;

          docContent = docContent + "\n" + imgBlock;
          currentPageIndex = 0;
          syncCanvasAndUI();

          const assistantMsg = `I've generated the requested visual asset and inserted it into your document!\n\n<div style="margin-top: 8px; border-radius: 6px; overflow: hidden; border: 1px solid var(--line);"><img src="${data.imageUrl}" alt="Preview" style="width: 100%; max-height: 140px; object-fit: cover; display: block;" /></div>`;
          chatHistory.push({ role: "assistant", text: assistantMsg });
          saveChatHistory();
          renderChatMessages();

          if (window.Clarity.toast) window.Clarity.toast.show("Image generated and inserted into document!", "success");
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

      // 2. Real-time Gamma-Style Streaming AI Generation Engine
      activeAbortController = new AbortController();

      const isPlaceholderDoc = !docContent || docContent.includes("Start writing or ask the AI assistant") || docContent.includes("Untitled Document");
      const isNewTopicRequest = isPlaceholderDoc || isDocumentRequest || /\b(?:create|write|generate|draft|make)\s+(?:a|an)?\s*(?:new\s+)?(?:report|document|proposal|essay|paper|study|analysis)\b/i.test(q);

      updateLoaderState("generating", isNewTopicRequest ? "Connecting to document streaming engine..." : "Processing document update...");

      try {
        recordState();
        if (isNewTopicRequest) {
          docContent = "";
          currentPageIndex = 0;
        }

        const response = await fetch("/api/document/stream-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: promptText,
            history: chatHistory.slice(0, -1),
            currentMarkdown: docContent,
            isNewTopic: isNewTopicRequest
          }),
          signal: activeAbortController.signal
        });

        if (!response.ok || !response.body) {
          throw new Error("Streaming document generation endpoint unreachable.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedMarkdown = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data: ")) {
              try {
                const data = JSON.parse(trimmed.slice(6));
                if (data.type === "chunk" && data.text) {
                  accumulatedMarkdown += data.text;

                  // Dynamically update document title from # Title header
                  const titleExtracted = extractTitleFromMarkdownOrHtml(accumulatedMarkdown);
                  if (titleExtracted && titleExtracted.length > 2 && titleExtracted !== docTitle) {
                    docTitle = titleExtracted;
                    const docTitleInput = document.getElementById("docStudioTitle");
                    if (docTitleInput) docTitleInput.value = docTitle;
                    const headerTitle = document.getElementById("headerTitle");
                    if (headerTitle) headerTitle.textContent = docTitle;
                    try { localStorage.setItem("clarity_document_title", docTitle); } catch {}
                  }

                  // Convert markdown to clean DOM elements and update document state live
                  docContent = convertMarkdownToHtml(accumulatedMarkdown);
                  syncCanvasAndUI();

                  const pageCount = getPages().length;
                  updateLoaderState("generating", `Writing report sections (${pageCount} A4 ${pageCount === 1 ? 'page' : 'pages'})...`);
                } else if (data.type === "status") {
                  updateLoaderState("generating", data.message);
                } else if (data.type === "error") {
                  throw new Error(data.error || "Document generation encountered an error.");
                }
              } catch (parseErr) {
                if (parseErr.message && parseErr.message.includes("encountered")) throw parseErr;
              }
            }
          }
        }

        if (accumulatedMarkdown.trim()) {
          saveLocalDoc();
          chatHistory.push({
            role: "assistant",
            text: `I've generated a complete, structured document for **${docTitle}**! The report has been rendered as validated DOM elements and formatted across ${getPages().length} A4 pages.`
          });
          saveChatHistory();
          renderChatMessages();
          if (window.Clarity.toast) window.Clarity.toast.show("Document generated successfully!", "success");
          updateLoaderState("idle");
          return;
        }

        throw new Error("No stream content received from generator.");
      } catch (streamErr) {
        if (streamErr.name === "AbortError") {
          chatHistory.push({ role: "assistant", text: "Task was stopped by user." });
          saveChatHistory();
          renderChatMessages();
          if (window.Clarity.toast) window.Clarity.toast.show("Task stopped.", "warning");
          updateLoaderState("cancelled");
          return;
        }

        // Fallback to execute-instruction
        console.warn("[Document Studio] Streaming fallback to execute-instruction:", streamErr);
        updateLoaderState("thinking", "Processing document update...");

        try {
          const resExec = await fetch("/api/studio/execute-instruction", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              studioType: "document",
              prompt: promptText,
              history: chatHistory.slice(0, -1),
              currentState: {
                document: {
                  docTitle: docTitle,
                  currentPageIndex: currentPageIndex,
                  docContent: docContent
                },
                selectedElement: activeDocumentSelection ? {
                  id: activeDocumentSelection.targetId,
                  field: activeDocumentSelection.targetType,
                  selectedText: activeDocumentSelection.selectedText
                } : null
              },
              aiEditMode: isAiEditMode
            }),
            signal: activeAbortController.signal
          });

          if (!resExec.ok) {
            const errData = await resExec.json().catch(() => ({}));
            throw new Error(errData.error || "AI failed to process instruction.");
          }

          const data = await resExec.json();

          if (data.intent === "EXPORT") {
            chatHistory.push({ role: "assistant", text: data.replyText || "Initiating document export..." });
            saveChatHistory();
            renderChatMessages();
            if (data.exportFormat === "docx") {
              document.getElementById("btnDocxExport")?.click();
            } else {
              document.getElementById("btnPdfExport")?.click();
            }
            updateLoaderState("idle");
            return;
          }

          if (data.intent === "PROPOSE_SELECTION_EDIT" && data.proposedEdit) {
            chatHistory.push({
              role: "assistant",
              text: data.replyText || `I've prepared a proposed edit for the selected **${data.proposedEdit.field || "Content"}**. Review the comparison below and click **Apply Edit** to commit, or **Discard** to cancel.`,
              proposedEdit: data.proposedEdit
            });
            saveChatHistory();
            renderChatMessages();
            updateLoaderState("idle");
            return;
          }

          if ((data.intent === "EDIT_ARTIFACT" || data.intent === "CREATE_NEW") && data.updatedDocContent) {
            recordState();
            docContent = convertMarkdownToHtml(data.updatedDocContent);
            currentPageIndex = 0;
            if (data.updatedTitle) {
              docTitle = data.updatedTitle;
              const docTitleInput = document.getElementById("docStudioTitle");
              if (docTitleInput) docTitleInput.value = docTitle;
              const headerTitle = document.getElementById("headerTitle");
              if (headerTitle) headerTitle.textContent = docTitle;
              try { localStorage.setItem("clarity_document_title", docTitle); } catch {}
            }
            saveLocalDoc();
            syncCanvasAndUI();

            if (data.toast && window.Clarity.toast) {
              window.Clarity.toast.show(data.toast, "success");
            } else if (window.Clarity.toast) {
              window.Clarity.toast.show(data.intent === "CREATE_NEW" ? "Document created!" : "Document updated!", "success");
            }
          }

          chatHistory.push({
            role: "assistant",
            text: data.replyText || "Done! Applied changes to your document."
          });
          saveChatHistory();
          renderChatMessages();
          updateLoaderState("idle");
        } catch (execErr) {
          if (execErr.name === "AbortError") {
            chatHistory.push({ role: "assistant", text: "Task was stopped by user." });
            saveChatHistory();
            renderChatMessages();
            if (window.Clarity.toast) window.Clarity.toast.show("Task stopped.", "warning");
            updateLoaderState("cancelled");
          } else {
            console.error(execErr);
            if (errBanner) {
              errBanner.style.display = "block";
              const errSpan = document.getElementById("aiErrorMessage");
              if (errSpan) errSpan.textContent = execErr.message || "Failed to process instruction.";
            }
            chatHistory.push({ role: "assistant", text: `Error: ${execErr.message || "Failed to execute instruction."}` });
            saveChatHistory();
            renderChatMessages();
            updateLoaderState("failed");
          }
        }
      }
    }

    // Exporters click triggers
    if (btnPdfExport) {
      btnPdfExport.addEventListener("click", async () => {
        if (window.Clarity.toast) window.Clarity.toast.show("Generating professional vector PDF file...", "info");
        try {
          const response = await fetch("/api/document/export-pdf", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: docTitle,
              contentHtml: docContent,
              orientation: docOrientation,
              marginSize: docMargins
            })
          });

          if (!response.ok) throw new Error("Server PDF compilation failed.");

          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.style.display = "none";
          a.href = url;
          a.download = `${docTitle.toLowerCase().replace(/[^a-z0-9]/g, "_")}.pdf`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          if (window.Clarity.toast) window.Clarity.toast.show("PDF file downloaded successfully!", "success");
        } catch (err) {
          console.error(err);
          if (window.Clarity.toast) window.Clarity.toast.show("PDF export failed.", "danger");
        }
      });
    }

    if (btnDocxExport) {
      btnDocxExport.addEventListener("click", async () => {
        if (window.Clarity.toast) window.Clarity.toast.show("Compiling clean OpenXML package...", "info");
        try {
          const response = await fetch("/api/document/export-docx", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: docTitle,
              contentHtml: docContent,
              orientation: docOrientation,
              marginSize: docMargins
            })
          });

        if (!response.ok) throw new Error("Server DOCX packaging failed.");

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = `${docTitle.toLowerCase().replace(/[^a-z0-9]/g, "_")}.docx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        if (window.Clarity.toast) window.Clarity.toast.show("DOCX file downloaded successfully!", "success");
      } catch (err) {
        console.error(err);
        if (window.Clarity.toast) window.Clarity.toast.show("DOCX export failed.", "danger");
      }
    });
  }
}

  function applyZoom() {
    const wrapper = document.getElementById("documentCanvasWrapper");
    const pagesFlow = document.getElementById("documentPagesFlow");
    if (!pagesFlow || !wrapper) return;

    const scale = zoomLevel / 100;
    const paperWidth = docOrientation === "landscape" ? 1123 : 794;
    const paperHeight = docOrientation === "landscape" ? 794 : 1123;

    if (window.innerWidth <= 768) {
      pagesFlow.style.width = `${paperWidth}px`;
      pagesFlow.style.transformOrigin = "top left";
      pagesFlow.style.transform = `scale(${scale})`;

      const scaledWidth = paperWidth * scale;
      const leftMargin = Math.max(0, Math.round((wrapper.clientWidth - scaledWidth) / 2));
      pagesFlow.style.marginLeft = `${leftMargin}px`;
      pagesFlow.style.marginRight = `${leftMargin}px`;

      const heightDiff = (1 - scale) * paperHeight;
      const pageSheets = pagesFlow.querySelectorAll(".word-paper.page-sheet");
      pageSheets.forEach(sheet => {
        sheet.style.marginBottom = `-${Math.max(0, Math.round(heightDiff - 16))}px`;
      });
    } else {
      pagesFlow.style.width = "100%";
      pagesFlow.style.transform = `scale(${scale})`;
      pagesFlow.style.transformOrigin = "top center";
      pagesFlow.style.marginLeft = "auto";
      pagesFlow.style.marginRight = "auto";

      const pageSheets = pagesFlow.querySelectorAll(".word-paper.page-sheet");
      pageSheets.forEach(sheet => {
        sheet.style.marginBottom = "0px";
      });
    }

    const label = document.getElementById("labelZoom");
    if (label) label.textContent = `${zoomLevel}%`;
  }

  function autoFitToScreen() {
    const wrapper = document.getElementById("documentCanvasWrapper");
    const pagesFlow = document.getElementById("documentPagesFlow");
    if (!wrapper || !pagesFlow) return;

    const paperWidth = docOrientation === "landscape" ? 1123 : 794;
    const paperHeight = docOrientation === "landscape" ? 794 : 1123;

    if (window.innerWidth <= 768) {
      const availableWidth = Math.max(260, wrapper.clientWidth - 16);
      const fitScale = Math.min(1, Math.max(0.32, availableWidth / paperWidth));
      zoomLevel = Math.round(fitScale * 100);

      pagesFlow.style.width = `${paperWidth}px`;
      pagesFlow.style.transformOrigin = "top left";
      pagesFlow.style.transform = `scale(${fitScale})`;

      const scaledWidth = paperWidth * fitScale;
      const leftMargin = Math.max(0, Math.round((wrapper.clientWidth - scaledWidth) / 2));
      pagesFlow.style.marginLeft = `${leftMargin}px`;
      pagesFlow.style.marginRight = `${leftMargin}px`;

      const heightDiff = (1 - fitScale) * paperHeight;
      const pageSheets = pagesFlow.querySelectorAll(".word-paper.page-sheet");
      pageSheets.forEach(sheet => {
        sheet.style.marginBottom = `-${Math.max(0, Math.round(heightDiff - 16))}px`;
      });

      const label = document.getElementById("labelZoom");
      if (label) label.textContent = `${zoomLevel}%`;
    } else {
      zoomLevel = 100;
      pagesFlow.style.width = "100%";
      pagesFlow.style.transform = `scale(1)`;
      pagesFlow.style.transformOrigin = "top center";
      pagesFlow.style.marginLeft = "auto";
      pagesFlow.style.marginRight = "auto";

      const pageSheets = pagesFlow.querySelectorAll(".word-paper.page-sheet");
      pageSheets.forEach(sheet => {
        sheet.style.marginBottom = "0px";
      });

      const label = document.getElementById("labelZoom");
      if (label) label.textContent = "100%";
    }
  }

  function applyPageLayoutStyles() {
    saveLocalDoc();
    syncCanvasAndUI();
  }

  function applyState(state) {
    if (!state) return;
    docTitle = state.title;
    docContent = state.content;
    docOrientation = state.orientation;
    docSize = state.size;
    docMargins = state.margins;
    currentPageIndex = state.currentPageIndex;

    const titleInput = document.getElementById("docStudioTitle");
    if (titleInput) titleInput.value = docTitle;
    document.getElementById("configOrientation").value = docOrientation;
    const cm = document.getElementById("configMargins");
    if (cm) cm.value = docMargins;

    isUnsaved = true;
    saveLocalDoc();
    syncCanvasAndUI();
  }

  function updateWorkspaceHeaderStatus() {
    const statusLabel = document.getElementById("unsavedDocBadge");
    if (statusLabel) {
      statusLabel.textContent = isUnsaved ? "Draft Unsaved" : "Saved & Safe";
      statusLabel.style.color = isUnsaved ? "#ef4444" : "#22c55e";
      statusLabel.style.borderColor = isUnsaved ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)";
      statusLabel.style.background = isUnsaved ? "rgba(239,68,68,0.03)" : "rgba(34,197,94,0.03)";
    }
  }

  function updateDocumentStats() {
    const text = (docContent || "").replace(/<[^>]*>/g, " ");
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const readTime = Math.ceil(words / 200);

    const statWords = document.getElementById("statWordCount");
    if (statWords) statWords.textContent = words;
    const statRead = document.getElementById("statReadTime");
    if (statRead) statRead.textContent = `${readTime} min`;
  }

  function updateActivePageIndicators(totalPages) {
    const counter = document.getElementById("labelPageCounter");
    if (counter) counter.textContent = `Page ${currentPageIndex + 1} of ${totalPages}`;

    const lblTop = document.getElementById("lblToggleSideNavTop");
    if (lblTop) lblTop.textContent = `Pages (${totalPages})`;

    const lblFloat = document.getElementById("lblFloatingSideNav");
    if (lblFloat) lblFloat.textContent = `Pages (${totalPages})`;

    const thumbs = document.querySelectorAll(".page-miniature-thumb");
    thumbs.forEach(t => {
      const idx = parseInt(t.dataset.pageIndex, 10);
      if (idx === currentPageIndex) {
        t.style.borderColor = "var(--accent)";
        t.style.boxShadow = "0 0 0 2px rgba(79,70,229,0.18)";
      } else {
        t.style.borderColor = "var(--line-strong)";
        t.style.boxShadow = "var(--shadow-sm)";
      }
    });
  }

  function scrollToPage(index) {
    const pages = getPages();
    currentPageIndex = Math.max(0, Math.min(index, pages.length - 1));
    const targetSheet = document.getElementById(`pageSheet_${currentPageIndex}`);
    if (targetSheet) {
      targetSheet.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    updateActivePageIndicators(pages.length);
  }

  // Populate dynamic side page miniature thumbnails list with rich structured previews
  function renderPageThumbnails() {
    const container = document.getElementById("pagesOverviewList");
    if (!container) return;

    const pages = getPages();
    container.innerHTML = pages.map((pageHtml, idx) => {
      const isActive = idx === currentPageIndex;
      const activeStyle = isActive 
        ? "border: 2px solid #000000; box-shadow: 0 4px 12px rgba(0,0,0,0.12);" 
        : "border: 1px solid #000000; box-shadow: 0 1px 3px rgba(0,0,0,0.04);";

      return `
        <div class="page-miniature-thumb" data-page-index="${idx}" style="
          scroll-snap-align: start;
          scroll-snap-stop: always;
          width: 100%; 
          max-width: 200px; 
          height: 280px; 
          flex-shrink: 0;
          background: #ffffff; 
          border-radius: 6px; 
          cursor: pointer; 
          overflow: hidden; 
          position: relative; 
          padding: 10px 12px; 
          transition: all 0.15s ease-in-out;
          display: flex;
          flex-direction: column;
          color: #334155;
          user-select: none;
          box-sizing: border-box;
          ${activeStyle}
        ">
          <div style="font-weight: 700; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 6px; font-size: 8.5px; display: flex; justify-content: space-between; align-items: center; color: #0f172a; flex-shrink: 0;">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 105px;">${window.Clarity.utils.escapeHtml(docTitle || "Document")}</span>
            <span style="background: ${isActive ? "var(--accent)" : "rgba(79,70,229,0.1)"}; color: ${isActive ? "#ffffff" : "var(--accent)"}; padding: 1px 5px; border-radius: 3px; font-size: 8px; font-weight: 700;">Page ${idx + 1}</span>
          </div>
          <div class="mini-page-content-preview" style="
            flex: 1; 
            overflow: hidden; 
            opacity: 0.88; 
            pointer-events: none; 
            font-size: 6px; 
            line-height: 1.35; 
            color: #1e293b;
            word-break: break-word;
            padding-right: 2px;
          ">
            ${pageHtml}
          </div>
        </div>
      `;
    }).join("");

    container.querySelectorAll(".page-miniature-thumb").forEach(thumb => {
      thumb.addEventListener("click", () => {
        const idx = parseInt(thumb.dataset.pageIndex, 10);
        scrollToPage(idx);
      });
    });
  }

  // Sync canvas contents and render real multi-page A4 sheets (Zero Clarity logo/branding)
  function syncCanvasAndUI() {
    const pages = getPages();
    currentPageIndex = Math.max(0, Math.min(currentPageIndex, pages.length - 1));

    const wrapper = document.getElementById("documentCanvasWrapper");
    if (!wrapper) return;

    let pagesFlow = document.getElementById("documentPagesFlow");
    if (!pagesFlow) {
      wrapper.innerHTML = `<div id="documentPagesFlow" style="display: flex; flex-direction: column; align-items: center; gap: 32px; width: 100%; transform-origin: top center; transition: transform 0.15s ease-out;"></div>`;
      pagesFlow = document.getElementById("documentPagesFlow");
    }

    const isLandscape = docOrientation === "landscape";
    // Standard A4 dimensions at 96 DPI: 794px width x 1123px height
    const paperWidth = isLandscape ? 1123 : 794;
    const paperHeight = isLandscape ? 794 : 1123;
    const contentPadding = docMargins === "wide" ? "64px 72px" : docMargins === "narrow" ? "28px 34px" : "48px 56px";

    pagesFlow.innerHTML = pages.map((pageHtml, idx) => `
      <div class="word-paper a4 ${docOrientation} ${docMargins}-margins page-sheet" id="pageSheet_${idx}" data-page-index="${idx}" style="
        width: ${paperWidth}px;
        min-height: ${paperHeight}px;
        max-height: ${paperHeight}px;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        box-shadow: 0 4px 20px rgba(0,0,0,0.07);
        border-radius: 2px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        color: #111827;
        position: relative;
        overflow: hidden;
      ">
        <!-- Editable Page Content with Standard Normal A4 Margins -->
        <div class="word-page-content" id="${idx === currentPageIndex ? "wordEditorCanvas" : "wordEditorCanvas_" + idx}" data-page-index="${idx}" contenteditable="true" style="
          flex: 1;
          outline: none;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          font-size: 14.5px;
          line-height: 1.6;
          padding: ${contentPadding};
          box-sizing: border-box;
          overflow: hidden;
        ">
          ${pageHtml}
        </div>
      </div>
    `).join("");

    // Bind input and focus events on all page content areas
    pagesFlow.querySelectorAll(".word-page-content").forEach(contentArea => {
      contentArea.addEventListener("focus", () => {
        currentPageIndex = parseInt(contentArea.dataset.pageIndex, 10);
        updateActivePageIndicators(pages.length);
      });

      contentArea.addEventListener("input", () => {
        const allPageDivs = Array.from(pagesFlow.querySelectorAll(".word-page-content"));
        const combined = allPageDivs.map(el => el.innerHTML).join('\n<div style="page-break-after: always;" class="no-print page-break-marker"></div>\n');
        docContent = combined;
        isUnsaved = true;
        saveLocalDoc();
        updateWorkspaceHeaderStatus();
        updateDocumentStats();
        renderPageThumbnails();
      });
    });

    updateActivePageIndicators(pages.length);
    updateDocumentStats();
    renderPageThumbnails();
    if (window.innerWidth <= 768) {
      autoFitToScreen();
    } else {
      applyZoom();
    }
  }

  // Boot Trigger
  renderLayout();
  syncCanvasAndUI();
};
