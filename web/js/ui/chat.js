window.Darkness = window.Darkness || {};
window.Darkness.ResponseDocumentBuilder = {
  build: function(text, opts) {
    if (window.Darkness.markdown && typeof window.Darkness.markdown.render === "function") {
      return window.Darkness.markdown.render(text, Object.assign({}, opts || {}, { __intercepted: true }));
    }
    return text || "";
  }
};

window.Darkness.uiChat = {
  _activeConversation: null,
  _isStreaming: false,
  _abortController: null,
  _attachedFiles: [],
  // No hardcoded model: the active model always comes from the backend registry.
  _activeModel: null,
  _firstMessagePending: false,
  _previewFile: null,
  _isPreviewOpen: false,

  init() {
    this._loadState();
  },

  _loadState() {
    this._activeConversation = window.Darkness.store.get("active_conversation", null);
    this._activeModel = window.Darkness.store.get("active_model", null);
    if (this._activeConversation) {
      this._attachedFiles = window.Darkness.store.get("chat_attachments_" + this._activeConversation, []);
    } else {
      this._attachedFiles = window.Darkness.store.get("chat_attachments_home_new", []);
    }
    window.Darkness.store.remove("current_project");
  },

  _saveState() {
    const key = this._activeConversation ? ("chat_attachments_" + this._activeConversation) : "chat_attachments_home_new";
    if (this._attachedFiles && this._attachedFiles.length > 0) {
      window.Darkness.store.set(key, this._attachedFiles);
    } else {
      window.Darkness.store.remove(key);
    }
    window.Darkness.store.remove("current_project");
    window.Darkness.store.set("active_model", this._activeModel);
  },

  /**
   * The model id sent to the backend. The selector's backend-synced selection
   * is authoritative; the locally cached value is only a fallback for the very
   * first paint. Never a hardcoded or display name.
   */
  _resolveModelId() {
    const fromSelector = window.Darkness.modelSelector && window.Darkness.modelSelector.activeId();
    return fromSelector || this._activeModel || null;
  },

  async startNewConversation() {
    this._stopStreaming();
    this._activeConversation = null;
    this._firstMessagePending = false;
    this._userScrolledUp = false;
    window.Darkness.store.remove("active_conversation");
    window.Darkness.store.remove("chat_attachments_home_new");
    window.Darkness.store.remove("chat_attachments");
    window.Darkness.store.remove("current_project");
    this._attachedFiles = [];
    this._currentProject = null;
    this._saveState();
    if (window.Darkness.composer && typeof window.Darkness.composer.clearAttachments === "function") {
      window.Darkness.composer.clearAttachments();
    }
    // Auto-close sidebar on mobile/drawer when starting a new chat
    if (window.Darkness.app && typeof window.Darkness.app.closeSidebar === "function") {
      window.Darkness.app.closeSidebar();
    }
    this.renderChat();
    setTimeout(() => {
      const input = document.getElementById("composerInput");
      if (input) input.focus();
    }, 50);
  },

  async loadConversation(cid) {
    this._stopStreaming();
    try {
      const data = await window.Darkness.api.get(`/api/conversations/${cid}`);
      this._activeConversation = cid;
      this._firstMessagePending = false;
      window.Darkness.store.set("active_conversation", cid);
      this.renderChat(data.messages);
    } catch (err) {
      this._isStreaming = false;
      this._syncComposerStreaming();
      if (err.status === 404 || (err.data && err.data.type === "not_found")) {
        window.Darkness.store.remove("active_conversation");
        window.Darkness.toast.show("Conversation not found. Starting new chat.", "warning");
        await this.startNewConversation();
      } else {
        window.Darkness.toast.show("Failed to load conversation", "danger");
      }
    }
  },

  async renderChat(messages) {
    try {
      this._stopStreaming();
      const main = document.getElementById("main");
      if (!main) return;

      const list = (messages && messages.length) ? messages : [];
      const html = this._renderChatHtml(list);
      main.innerHTML = html;

      const convEl = document.getElementById("conversationList");
      if (convEl) {
        this._bindScrollListener(convEl);
      }

      this._bindSuggestionChips();
      this._bindMainChatExportMenu();
      this._bindMessageControls();
      this._bindChatHeaderMenu();
      this._updateNewChatButton();
      this._updateComposer();
      this._updateExportVisibility();
      this._isStreaming = false;
      this._syncComposerStreaming();

      if (document.getElementById("darknessRobot")) {
        this.setRobotState("idle");
      }

      if (list.length > 0) {
        this._userScrolledUp = false;
        this._scrollToBottom(true);
        if (window.Darkness && window.Darkness.renderKaTeX) {
          window.Darkness.renderKaTeX(convEl || main);
        }
      }
    } catch (err) {
      console.error("renderChat error:", err);
      const main = document.getElementById("main");
      if (main) {
        main.innerHTML = '<div class="chat-shell"><section class="chat-panel"><div class="chat-empty"><div class="chat-empty__inner"><h1 class="chat-empty__title">Something went wrong</h1><p class="chat-empty__sub">Please refresh the page.</p></div></div></section></div>';
      }
    }
  },

  async _convertSvgToPngDataUrl(svgElement) {
    if (!svgElement) return null;

    // Clone the element and strip any emojis to prevent [X] box rendering on servers without emoji fonts
    const svgClone = svgElement.cloneNode(true);

    // Icon map for replacing emojis/keywords with high-quality vector inline SVGs inside flowchart nodes
    const iconMap = [
      {
        emojis: ["📱", "💬"],
        keywords: ["telegram", "channel", "group"],
        svg: `<svg xmlns="http://www.w3.org/2000/svg" class="diag-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e11d48" stroke-width="2.5" style="display:inline-block; vertical-align:middle; margin-right:5px; line-height:1;"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      },
      {
        emojis: ["🤖", "⚙️"],
        keywords: ["ai detection", "detection engine", "ai processing"],
        svg: `<svg xmlns="http://www.w3.org/2000/svg" class="diag-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2.5" style="display:inline-block; vertical-align:middle; margin-right:5px; line-height:1;"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 6v12M6 12h12" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      },
      {
        emojis: ["🔍", "📝"],
        keywords: ["nlp", "pattern", "matching"],
        svg: `<svg xmlns="http://www.w3.org/2000/svg" class="diag-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" style="display:inline-block; vertical-align:middle; margin-right:5px; line-height:1;"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      },
      {
        emojis: ["📷", "🖼️"],
        keywords: ["image", "ocr", "scanner"],
        svg: `<svg xmlns="http://www.w3.org/2000/svg" class="diag-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.5" style="display:inline-block; vertical-align:middle; margin-right:5px; line-height:1;"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`
      },
      {
        emojis: ["👤", "👥"],
        keywords: ["suspicious", "profiling", "user profiling"],
        svg: `<svg xmlns="http://www.w3.org/2000/svg" class="diag-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2.5" style="display:inline-block; vertical-align:middle; margin-right:5px; line-height:1;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
      },
      {
        emojis: ["⚠️", "▲"],
        keywords: ["risk", "analysis", "risk analysis"],
        svg: `<svg xmlns="http://www.w3.org/2000/svg" class="diag-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="2.5" style="display:inline-block; vertical-align:middle; margin-right:5px; line-height:1;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="9" x2="12" y2="13" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="17" x2="12.01" y2="17" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      },
      {
        emojis: ["🚨", "🔥"],
        keywords: ["alert & action", "action system", "alert and action"],
        svg: `<svg xmlns="http://www.w3.org/2000/svg" class="diag-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" style="display:inline-block; vertical-align:middle; margin-right:5px; line-height:1;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      },
      {
        emojis: ["📦", "🗄️"],
        keywords: ["log database", "database", "storage"],
        svg: `<svg xmlns="http://www.w3.org/2000/svg" class="diag-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" style="display:inline-block; vertical-align:middle; margin-right:5px; line-height:1;"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>`
      },
      {
        emojis: ["🖥️", "📊"],
        keywords: ["dashboard", "admin dashboard", "control panel"],
        svg: `<svg xmlns="http://www.w3.org/2000/svg" class="diag-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0891b2" stroke-width="2.5" style="display:inline-block; vertical-align:middle; margin-right:5px; line-height:1;"><rect x="2" y="3" width="20" height="14" rx="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="8" y1="21" x2="16" y2="21" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="17" x2="12" y2="21" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      },
      {
        emojis: ["🚫", "🔏"],
        keywords: ["auto-ban", "ban", "report user"],
        svg: `<svg xmlns="http://www.w3.org/2000/svg" class="diag-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e11d48" stroke-width="2.5" style="display:inline-block; vertical-align:middle; margin-right:5px; line-height:1;"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`
      },
      {
        emojis: ["🔔", "📣"],
        keywords: ["immediate", "authority alert", "authority"],
        svg: `<svg xmlns="http://www.w3.org/2000/svg" class="diag-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.5" style="display:inline-block; vertical-align:middle; margin-right:5px; line-height:1;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>`
      }
    ];

    try {
      svgClone.querySelectorAll("foreignObject div, foreignObject span, .nodeLabel").forEach(el => {
        const text = (el.textContent || "").toLowerCase().trim();
        const html = el.innerHTML || "";

        const match = iconMap.find(item => {
          const hasEmoji = item.emojis.some(em => html.includes(em));
          if (hasEmoji) return true;
          const hasKeyword = item.keywords.some(kw => text.includes(kw));
          return hasKeyword;
        });

        if (match) {
          if (!el.querySelector(".diag-icon")) {
            el.innerHTML = match.svg + el.innerHTML;
          }
        }
      });
    } catch (err) {
      console.warn("Error enriching flowchart SVGs with high-quality icons:", err);
    }

    const emojiRegex = /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F191}-\u{1F251}\u{1F004}\u{1F0CF}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{3030}\u{2B50}\u{2B55}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2b1b}\u{2b1c}\u{2b50}\u{2b55}\u{2194}-\u{2199}\u{21a9}-\u{21aa}\u{231a}-\u{231b}\u{23e9}-\u{23ec}\u{23f0}\u{23f3}\u{24c2}\u{25b6}\u{25c0}\u{2601}-\u{2604}\u{260e}\u{2611}\u{2614}-\u{2615}\u{2618}\u{261d}\u{2620}\u{2622}-\u{2623}\u{2626}\u{262a}\u{262e}-\u{262f}\u{2638}-\u{263a}\u{2640}\u{2642}\u{2648}-\u{2653}\u{265f}\u{2660}\u{2663}\u{2665}-\u{2666}\u{2668}\u{267b}\u{267f}\u{2692}-\u{2697}\u{2699}\u{269b}-\u{269c}\u{26a0}-\u{26a1}\u{26aa}-\u{26ab}\u{26b0}-\u{26b1}\u{26c4}-\u{26c5}\u{26c8}\u{26ce}-\u{26cf}\u{26d1}\u{26d3}-\u{26d4}\u{26e9}-\u{26ea}\u{26f0}-\u{26f5}\u{26f7}-\u{26fa}\u{26fd}\u{2702}\u{2705}\u{2708}-\u{270d}\u{270f}\u{2712}\u{2714}\u{2716}\u{271d}\u{2721}\u{2728}\u{2733}-\u{2734}\u{2744}\u{2747}\u{274c}\u{274e}\u{2753}-\u{2755}\u{2757}\u{2763}-\u{2764}\u{2795}-\u{2797}\u{27a1}\u{27b0}\u{27bf}\u{2934}-\u{2935}\u{2b05}-\u{2b07}\u{2b1b}-\u{2b1c}\u{2b50}\u{2b55}\u{303d}\u{3297}\u{3299}]/gu;

    // Process text-containing nodes inside the SVG
    svgClone.querySelectorAll("text, desc, tspan, title, div, span, p").forEach(node => {
      if (node.childNodes && node.childNodes.length > 0) {
        node.childNodes.forEach(child => {
          if (child.nodeType === Node.TEXT_NODE) {
            child.nodeValue = child.nodeValue.replace(emojiRegex, '').trim();
          }
        });
      }
      if (node.textContent) {
        node.textContent = node.textContent.replace(emojiRegex, '').trim();
      }
    });

    // 1. Generate standalone, self-contained SVG string with inlined styles
    let svgStr = "";
    if (window.Darkness && typeof window.Darkness.getStandaloneSvgString === "function") {
      try {
        svgStr = window.Darkness.getStandaloneSvgString(svgClone);
      } catch (e) {
        console.warn("getStandaloneSvgString error:", e);
      }
    }
    if (!svgStr) {
      try {
        if (!svgClone.getAttribute("xmlns")) svgClone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        svgStr = new XMLSerializer().serializeToString(svgClone);
      } catch (e) {
        return null;
      }
    }

    // 2. Try server-side @resvg/resvg-js rasterization first (/api/diagrams/render-image)
    try {
      const resp = await fetch("/api/diagrams/render-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          svg: svgStr,
          format: "png",
          width: 1600
        })
      });
      if (resp.ok) {
        const blob = await resp.blob();
        if (blob && blob.size > 100) {
          const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
          if (dataUrl) return dataUrl;
        }
      }
    } catch (err) {
      console.warn("Server-side SVG render error, falling back to client canvas:", err);
    }

    // 3. Client-side canvas rasterization fallback
    try {
      const bbox = svgElement.getBoundingClientRect();
      const width = Math.max(900, Math.round(bbox.width) * 2 || 1200);
      const height = Math.max(500, Math.round(bbox.height) * 2 || 700);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);

      const pngUrl = await new Promise((resolve) => {
        const img = new Image();
        const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        img.onload = () => {
          try {
            ctx.drawImage(img, 0, 0, width, height);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL("image/png"));
          } catch (e) {
            URL.revokeObjectURL(url);
            resolve(null);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(null);
        };
        img.src = url;
      });

      if (pngUrl) return pngUrl;
    } catch (clientErr) {
      console.warn("Client-side canvas rasterization failed:", clientErr);
    }

    // 4. Safe SVG data URL fallback if rasterization is unavailable
    try {
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
    } catch (_) {
      return null;
    }
  },

  async exportChatToPdf(options = {}) {
    const feed = options.feed || document.getElementById("conversationList") || document.getElementById("projectChatFeed");
    if (!feed) {
      if (window.Darkness && window.Darkness.toast) window.Darkness.toast.show("No chat to export.", "info");
      return;
    }

    if (feed.classList.contains("conversation--empty")) {
      if (window.Darkness && window.Darkness.toast) window.Darkness.toast.show("No chat to export.", "info");
      return;
    }

    let rawMsgs = Array.from(feed.querySelectorAll(".message, .project-chat-msg"));
    if (rawMsgs.length === 0) {
      rawMsgs = Array.from(feed.querySelectorAll(".msg"));
    }
    // Strict deduplication: remove duplicates and child elements contained inside other matched elements
    rawMsgs = rawMsgs.filter((el, idx, self) => {
      if (!el || self.indexOf(el) !== idx) return false;
      return !self.some(other => other !== el && other.contains(el));
    });
    const stateMsgs = window.Darkness?.state?.activeConversation?.messages;
    if (rawMsgs.length === 0 && (!stateMsgs || stateMsgs.length === 0)) {
      if (window.Darkness && window.Darkness.toast) window.Darkness.toast.show("No chat to export.", "info");
      return;
    }

    // Ensure PDF library is loaded
    if (!window.html2pdf) {
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      } catch (e) {
        if (window.Darkness && window.Darkness.toast) window.Darkness.toast.show("PDF library failed to load.", "danger");
        return;
      }
    }

    if (window.Darkness && window.Darkness.toast) {
      window.Darkness.toast.show("Exporting Chat to PDF...", "info");
    }

    // Capture project metadata
    let projectName = options.projectName || "";
    if (!projectName) {
      const cid = window.Darkness?.state?.activeConversation?.id;
      if (cid && window.Darkness?.state?.conversations) {
        const conv = window.Darkness.state.conversations.find(c => c.id === cid);
        if (conv && conv.project_id) {
          const proj = window.Darkness.state.projects?.find(p => p.id === conv.project_id);
          if (proj) projectName = proj.name;
        }
      }
    }

    // Loading overlay
    const loadingModal = document.createElement("div");
    loadingModal.id = "darkness-pdf-export-loading";
    loadingModal.style.cssText = "position:fixed; inset:0; background:rgba(15,23,42,0.7); backdrop-filter:blur(4px); z-index:100002; display:flex; align-items:center; justify-content:center; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
    loadingModal.innerHTML = `
      <div style="background:#ffffff; border:1px solid #e2e8f0; padding:28px 36px; border-radius:12px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.25); display:flex; flex-direction:column; align-items:center; gap:14px; min-width:300px; text-align:center; color:#0f172a;">
        <div class="spinner" style="width:32px; height:32px; border:3.5px solid #4f46e5; border-top-color:transparent; border-radius:50%; animation:spin 1s linear infinite;"></div>
        <div style="font-weight:700; font-size:16px; margin-top:4px;">Exporting Chat to PDF</div>
        <div style="font-size:12.5px; color:#64748b; line-height:1.4;">Rendering exact chat layout, markdown, syntax & diagrams...</div>
      </div>
    `;
    document.body.appendChild(loadingModal);

    // Controlled offscreen rendering host
    const host = document.createElement("div");
    host.id = "darkness-pdf-export-host";
    host.style.cssText = "position:fixed !important; top:0 !important; left:-9999px !important; width:794px !important; min-width:794px !important; max-width:794px !important; margin:0 !important; padding:0 !important; background:#ffffff !important; z-index:100001 !important; box-sizing:border-box !important; overflow:visible !important; pointer-events:none !important;";

    // High-fidelity print styles that strictly match the Chat UI presentation
    const styleTag = document.createElement("style");
    styleTag.textContent = `
      #darkness-pdf-export-host, #darkness-pdf-export-host * {
        box-sizing: border-box !important;
      }
      #darkness-pdf-export-host {
        background-color: #ffffff !important;
        color: #0f172a !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
        font-size: 13.5px !important;
        line-height: 1.65 !important;
      }
      #darkness-pdf-export-host .pdf-page {
        box-sizing: border-box !important;
        background-color: #ffffff !important;
      }
      
      /* Chat Message Structure */
      #darkness-pdf-export-host .message {
        width: 100% !important;
        display: flex !important;
        flex-direction: column !important;
        margin-bottom: 14px !important;
        page-break-inside: auto !important;
        break-inside: auto !important;
      }
      #darkness-pdf-export-host .message--user {
        align-items: flex-end !important;
      }
      #darkness-pdf-export-host .message--assistant {
        align-items: flex-start !important;
      }
      #darkness-pdf-export-host .message__row {
        display: flex !important;
        width: 100% !important;
      }
      #darkness-pdf-export-host .message--user .message__row {
        justify-content: flex-end !important;
      }
      #darkness-pdf-export-host .message__body {
        display: flex !important;
        flex-direction: column !important;
        min-width: 0 !important;
        width: 100% !important;
      }
      #darkness-pdf-export-host .message--user .message__body {
        align-items: flex-end !important;
        max-width: 88% !important;
      }
      #darkness-pdf-export-host .message--assistant .message__body {
        align-items: flex-start !important;
        max-width: 100% !important;
      }
      
      /* Message Author Header */
      #darkness-pdf-export-host .message__author-tag {
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.04em !important;
        margin-bottom: 5px !important;
        page-break-after: avoid !important;
        break-after: avoid !important;
      }
      #darkness-pdf-export-host .message--user .message__author-tag {
        color: #475569 !important;
        justify-content: flex-end !important;
      }
      #darkness-pdf-export-host .message--assistant .message__author-tag {
        color: #4f46e5 !important;
        justify-content: flex-start !important;
      }
      #darkness-pdf-export-host .message__author-dot {
        width: 6px !important;
        height: 6px !important;
        border-radius: 50% !important;
        display: inline-block !important;
      }
      #darkness-pdf-export-host .message--user .message__author-dot {
        background-color: #64748b !important;
      }
      #darkness-pdf-export-host .message--assistant .message__author-dot {
        background-color: #4f46e5 !important;
      }

      /* Chat Bubbles */
      #darkness-pdf-export-host .message__bubble {
        border-radius: 12px !important;
        padding: 14px 18px !important;
        line-height: 1.65 !important;
        font-size: 13.5px !important;
        word-break: break-word !important;
        box-sizing: border-box !important;
        page-break-inside: auto !important;
        break-inside: auto !important;
      }
      #darkness-pdf-export-host .message--user .message__bubble {
        background-color: #eef2ff !important;
        color: #1e1b4b !important;
        border: 1px solid #c7d2fe !important;
        border-bottom-right-radius: 4px !important;
        display: inline-block !important;
        max-width: 100% !important;
      }
      #darkness-pdf-export-host .message--assistant .message__bubble {
        background-color: #ffffff !important;
        color: #0f172a !important;
        border: 1px solid #e2e8f0 !important;
        border-bottom-left-radius: 4px !important;
        width: 100% !important;
      }

      /* Markdown & Chat Typography Hierarchy */
      #darkness-pdf-export-host .message__content {
        color: inherit !important;
        font-size: 13.5px !important;
        line-height: 1.65 !important;
        word-break: break-word !important;
      }
      #darkness-pdf-export-host .message--user .message__content {
        white-space: pre-wrap !important;
        color: #1e1b4b !important;
      }
      #darkness-pdf-export-host .message__content h1,
      #darkness-pdf-export-host .message__content h2,
      #darkness-pdf-export-host .message__content h3,
      #darkness-pdf-export-host .message__content h4,
      #darkness-pdf-export-host .message__content h5,
      #darkness-pdf-export-host .message__content h6 {
        margin: 14px 0 8px !important;
        font-weight: 600 !important;
        color: #0f172a !important;
        letter-spacing: -0.01em !important;
        line-height: 1.3 !important;
        page-break-after: avoid !important;
        break-after: avoid !important;
      }
      #darkness-pdf-export-host .message__content h1:first-child,
      #darkness-pdf-export-host .message__content h2:first-child,
      #darkness-pdf-export-host .message__content h3:first-child {
        margin-top: 0 !important;
      }
      #darkness-pdf-export-host .message__content h1 { font-size: 18px !important; font-weight: 700 !important; }
      #darkness-pdf-export-host .message__content h2 { font-size: 15.5px !important; font-weight: 700 !important; }
      #darkness-pdf-export-host .message__content h3 { font-size: 14px !important; font-weight: 600 !important; }
      #darkness-pdf-export-host .message__content h4 { font-size: 13px !important; font-weight: 600 !important; }
      #darkness-pdf-export-host .message__content h5 { font-size: 12px !important; font-weight: 600 !important; }
      #darkness-pdf-export-host .message__content h6 { font-size: 11.5px !important; color: #64748b !important; }
      
      #darkness-pdf-export-host .message__content p {
        margin: 8px 0 !important;
        color: #1e293b !important;
        line-height: 1.65 !important;
      }
      #darkness-pdf-export-host .message__content p:first-child { margin-top: 0 !important; }
      #darkness-pdf-export-host .message__content p:last-child { margin-bottom: 0 !important; }
      
      #darkness-pdf-export-host .message__content ul,
      #darkness-pdf-export-host .message__content ol {
        margin: 8px 0 8px 24px !important;
        padding: 0 !important;
        color: #1e293b !important;
        line-height: 1.65 !important;
      }
      #darkness-pdf-export-host .message__content li {
        margin: 3px 0 !important;
      }
      #darkness-pdf-export-host .message__content strong {
        font-weight: 700 !important;
        color: #0f172a !important;
      }
      #darkness-pdf-export-host .message__content em {
        font-style: italic !important;
      }
      #darkness-pdf-export-host .message__content blockquote {
        margin: 10px 0 !important;
        padding: 8px 14px !important;
        border-left: 3px solid #6366f1 !important;
        background: #f8fafc !important;
        border-radius: 0 6px 6px 0 !important;
        color: #334155 !important;
        font-style: normal !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      #darkness-pdf-export-host .message__content a {
        color: #2563eb !important;
        text-decoration: underline !important;
      }
      
      /* Tables */
      #darkness-pdf-export-host .table-wrapper {
        margin: 12px 0 !important;
        border-radius: 6px !important;
        border: 1px solid #cbd5e1 !important;
        overflow: hidden !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      #darkness-pdf-export-host table {
        width: 100% !important;
        border-collapse: collapse !important;
        font-size: 12px !important;
      }
      #darkness-pdf-export-host th,
      #darkness-pdf-export-host td {
        border: 1px solid #cbd5e1 !important;
        padding: 7px 12px !important;
        text-align: left !important;
      }
      #darkness-pdf-export-host th {
        background: #f1f5f9 !important;
        font-weight: 600 !important;
        color: #0f172a !important;
      }
      #darkness-pdf-export-host td {
        color: #334155 !important;
        background: #ffffff !important;
      }
      #darkness-pdf-export-host tr:nth-child(even) td {
        background: #f8fafc !important;
      }

      /* Inline Code */
      #darkness-pdf-export-host code:not(.pdf-code-content) {
        display: inline !important;
        padding: 2px 6px !important;
        background: #f1f5f9 !important;
        border-radius: 4px !important;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
        font-size: 11.5px !important;
        color: #be185d !important;
        border: 1px solid #e2e8f0 !important;
      }

      /* Code Blocks */
      #darkness-pdf-export-host .pdf-code-block {
        margin: 12px 0 !important;
        border-radius: 8px !important;
        background: #f8fafc !important;
        border: 1px solid #e2e8f0 !important;
        overflow: hidden !important;
        width: 100% !important;
        box-sizing: border-box !important;
        page-break-inside: auto !important;
        break-inside: auto !important;
      }
      #darkness-pdf-export-host .pdf-code-header {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        padding: 6px 12px !important;
        background: #f1f5f9 !important;
        border-bottom: 1px solid #e2e8f0 !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        color: #475569 !important;
      }
      #darkness-pdf-export-host .pdf-code-badge {
        background: #e2e8f0 !important;
        color: #0f172a !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        font-size: 10px !important;
        text-transform: uppercase !important;
        font-family: ui-monospace, monospace !important;
        font-weight: 700 !important;
      }
      #darkness-pdf-export-host .pdf-code-body {
        padding: 6px 0 !important;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
        font-size: 11.5px !important;
        line-height: 1.55 !important;
        color: #0f172a !important;
        background: #f8fafc !important;
        width: 100% !important;
        box-sizing: border-box !important;
      }
      #darkness-pdf-export-host .pdf-code-line {
        display: flex !important;
        width: 100% !important;
        box-sizing: border-box !important;
        padding: 0 10px !important;
        line-height: 1.55 !important;
      }
      #darkness-pdf-export-host .pdf-code-num {
        width: 32px !important;
        min-width: 32px !important;
        text-align: right !important;
        padding-right: 12px !important;
        color: #94a3b8 !important;
        user-select: none !important;
        box-sizing: border-box !important;
        font-size: 10.5px !important;
      }
      #darkness-pdf-export-host .pdf-code-content {
        flex: 1 !important;
        white-space: pre-wrap !important;
        word-break: break-all !important;
        color: #0f172a !important;
      }

      /* Syntax Tokens */
      #darkness-pdf-export-host .tk-comment { color: #64748b !important; font-style: italic !important; }
      #darkness-pdf-export-host .tk-string { color: #059669 !important; }
      #darkness-pdf-export-host .tk-keyword { color: #7c3aed !important; font-weight: 600 !important; }
      #darkness-pdf-export-host .tk-function { color: #2563eb !important; font-weight: 600 !important; }
      #darkness-pdf-export-host .tk-number { color: #d97706 !important; }
      #darkness-pdf-export-host .tk-operator { color: #0284c7 !important; }

      /* Images & Diagrams */
      #darkness-pdf-export-host .pdf-image-block {
        width: 100% !important;
        margin: 12px 0 !important;
        text-align: center !important;
        box-sizing: border-box !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      #darkness-pdf-export-host .pdf-image-block img {
        max-width: 100% !important;
        height: auto !important;
        object-fit: contain !important;
        display: block !important;
        margin: 0 auto !important;
        border-radius: 8px !important;
        border: 1px solid #e2e8f0 !important;
      }
      #darkness-pdf-export-host .pdf-diagram-block {
        width: 100% !important;
        margin: 12px 0 !important;
        text-align: center !important;
        box-sizing: border-box !important;
        background: #ffffff !important;
        border-radius: 8px !important;
        border: 1px solid #e2e8f0 !important;
        padding: 8px !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      #darkness-pdf-export-host .pdf-diagram-block img {
        max-width: 100% !important;
        height: auto !important;
        object-fit: contain !important;
        display: block !important;
        margin: 0 auto !important;
      }

      /* Semantic Callout Boxes in PDF */
      #darkness-pdf-export-host .answer-callout {
        margin: 12px 0 !important;
        padding: 10px 14px !important;
        border-radius: 8px !important;
        border: 1px solid #e2e8f0 !important;
        border-left: 4px solid #6366f1 !important;
        background: #f8fafc !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      #darkness-pdf-export-host .answer-callout__header {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        font-weight: 700 !important;
        font-size: 12px !important;
        margin-bottom: 4px !important;
      }
      #darkness-pdf-export-host .answer-callout__body {
        font-size: 12.5px !important;
        line-height: 1.55 !important;
        color: #1e293b !important;
      }
      #darkness-pdf-export-host .answer-callout--tip {
        border-left-color: #d97706 !important;
        background: #fffbeb !important;
        border-color: #fde68a !important;
      }
      #darkness-pdf-export-host .answer-callout--tip .answer-callout__header { color: #b45309 !important; }
      #darkness-pdf-export-host .answer-callout--warning {
        border-left-color: #dc2626 !important;
        background: #fef2f2 !important;
        border-color: #fecaca !important;
      }
      #darkness-pdf-export-host .answer-callout--warning .answer-callout__header { color: #b91c1c !important; }
      #darkness-pdf-export-host .answer-callout--success {
        border-left-color: #16a34a !important;
        background: #f0fdf4 !important;
        border-color: #bbf7d0 !important;
      }
      #darkness-pdf-export-host .answer-callout--success .answer-callout__header { color: #15803d !important; }
      #darkness-pdf-export-host .answer-callout--important {
        border-left-color: #0284c7 !important;
        background: #f0f9ff !important;
        border-color: #bae6fd !important;
      }
      #darkness-pdf-export-host .answer-callout--important .answer-callout__header { color: #0369a1 !important; }
      #darkness-pdf-export-host .answer-callout--example {
        border-left-color: #4f46e5 !important;
        background: #eef2ff !important;
        border-color: #c7d2fe !important;
      }
      #darkness-pdf-export-host .answer-callout--example .answer-callout__header { color: #3730a3 !important; }
      #darkness-pdf-export-host .answer-callout--formula {
        border-left-color: #7c3aed !important;
        background: #f5f3ff !important;
        border-color: #ddd6fe !important;
      }
      #darkness-pdf-export-host .answer-callout--formula .answer-callout__header { color: #6d28d9 !important; }

      /* Math & KaTeX rendering in PDF */
      #darkness-pdf-export-host .katex-display,
      #darkness-pdf-export-host .math-display {
        margin: 10px 0 !important;
        padding: 6px 10px !important;
        background: #f8fafc !important;
        border: 1px solid #e2e8f0 !important;
        border-radius: 6px !important;
        text-align: center !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      #darkness-pdf-export-host .math-inline {
        padding: 1px 3px !important;
        background: #f8fafc !important;
        border-radius: 3px !important;
      }
    `;
    host.appendChild(styleTag);

    const measurer = document.createElement("div");
    measurer.id = "darkness-pdf-measurer";
    measurer.style.cssText = "position:fixed !important; left:-9999px !important; top:0 !important; width:794px !important; min-width:794px !important; max-width:794px !important; visibility:hidden !important; pointer-events:none !important; box-sizing:border-box !important; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif !important;";
    document.body.appendChild(measurer);

    try {
      const now = new Date();
      const dateStr = now.toLocaleDateString() + " " + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const escapeHtml = (str) => String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

      // Await fonts readiness
      if (document.fonts && typeof document.fonts.ready !== "undefined") {
        await document.fonts.ready;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      }

      // Settle active generations
      if (feed.querySelector(".is-generating, .loading, .spinner")) {
        for (let j = 0; j < 50; j++) {
          if (!feed.querySelector(".is-generating, .loading, .spinner")) break;
          await new Promise(r => setTimeout(r, 100));
        }
      }

      // Settle images
      const feedImages = Array.from(feed.querySelectorAll("img"));
      await Promise.all(feedImages.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
          img.onload = resolve;
          img.onerror = resolve;
        });
      }));

      await new Promise(resolve => setTimeout(resolve, 200));

      // Handle fallback if DOM messages are empty but state exists
      if (rawMsgs.length === 0 && stateMsgs && stateMsgs.length > 0) {
        const dummyFeed = document.createElement("div");
        dummyFeed.style.display = "none";
        for (const m of stateMsgs) {
          const isU = m.role === "user";
          const el = document.createElement("div");
          el.className = isU ? "message message--user" : "message message--assistant";
          el.setAttribute("data-role", isU ? "user" : "assistant");
          const c = document.createElement("div");
          c.className = "message__content";
          if (isU) {
            c.innerHTML = `<p>${escapeHtml(m.content)}</p>`;
          } else {
            c.innerHTML = window.Darkness?.markdown ? window.Darkness.markdown.render(m.content) : `<p>${escapeHtml(m.content)}</p>`;
          }
          el.appendChild(c);
          dummyFeed.appendChild(el);
        }
        document.body.appendChild(dummyFeed);
        if (window.mermaid && typeof window.mermaid.run === "function") {
          try { await window.mermaid.run({ nodes: dummyFeed.querySelectorAll("pre.mermaid") }); } catch (_) {}
        }
        rawMsgs = Array.from(dummyFeed.querySelectorAll(".message"));
        setTimeout(() => dummyFeed.remove(), 1000);
      }

      // High-res element capture
      const captureElementToPng = async (mc) => {
        if (!mc || !window.html2canvas) return null;

        const controls = mc.querySelectorAll(".mermaid-controls, .mermaid-fullscreen-header");
        controls.forEach(ctrl => ctrl.style.setProperty("display", "none", "important"));

        const childNodes = Array.from(mc.querySelectorAll("*"));
        const savedChildStyles = childNodes.map(el => ({
          el,
          height: el.style.height,
          maxHeight: el.style.maxHeight,
          overflow: el.style.overflow,
          transform: el.style.transform,
          width: el.style.width,
          maxWidth: el.style.maxWidth
        }));

        const originalMcHeight = mc.style.height;
        const originalMcMaxHeight = mc.style.maxHeight;
        const originalMcOverflow = mc.style.overflow;
        const originalMcWidth = mc.style.width;
        const originalMcMaxWidth = mc.style.maxWidth;
        const originalMcTransform = mc.style.transform;

        mc.style.setProperty("height", "auto", "important");
        mc.style.setProperty("max-height", "none", "important");
        mc.style.setProperty("overflow", "visible", "important");
        mc.style.setProperty("width", "auto", "important");
        mc.style.setProperty("max-width", "none", "important");
        mc.style.setProperty("transform", "none", "important");

        childNodes.forEach(el => {
          if (!el.classList.contains("mermaid-controls") && !el.closest(".mermaid-controls")) {
            el.style.setProperty("transform", "none", "important");
            el.style.setProperty("overflow", "visible", "important");
            if (el.tagName && el.tagName.toLowerCase() !== "svg") {
              el.style.setProperty("height", "auto", "important");
              el.style.setProperty("max-height", "none", "important");
              el.style.setProperty("width", "auto", "important");
              el.style.setProperty("max-width", "none", "important");
            }
          }
        });

        const svg = mc.querySelector("svg");
        let origSvgW = "";
        let origSvgH = "";
        let origSvgMinW = "";
        let origSvgMinH = "";
        let origSvgOverflow = "";

        if (svg) {
          origSvgW = svg.style.width;
          origSvgH = svg.style.height;
          origSvgMinW = svg.style.minWidth;
          origSvgMinH = svg.style.minHeight;
          origSvgOverflow = svg.style.overflow;

          let trueW = 0;
          let trueH = 0;

          try {
            const bbox = svg.getBBox();
            if (bbox && bbox.width > 0 && bbox.height > 0) {
              trueW = Math.ceil(bbox.width + Math.max(0, bbox.x) + 40);
              trueH = Math.ceil(bbox.height + Math.max(0, bbox.y) + 40);
            }
          } catch (e) {}

          if (!trueW || !trueH) {
            const viewBox = svg.getAttribute("viewBox");
            if (viewBox) {
              const parts = viewBox.split(/\s+/).map(parseFloat);
              if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
                trueW = Math.ceil(parts[2] + 40);
                trueH = Math.ceil(parts[3] + 40);
              }
            }
          }

          if (!trueW || !trueH) {
            const rect = svg.getBoundingClientRect();
            trueW = Math.ceil(rect.width + 40);
            trueH = Math.ceil(rect.height + 40);
          }

          if (trueW > 0 && trueH > 0) {
            svg.style.setProperty("width", `${trueW}px`, "important");
            svg.style.setProperty("height", `${trueH}px`, "important");
            svg.style.setProperty("min-width", `${trueW}px`, "important");
            svg.style.setProperty("min-height", `${trueH}px`, "important");
            svg.style.setProperty("overflow", "visible", "important");

            mc.style.setProperty("width", `${trueW + 30}px`, "important");
            mc.style.setProperty("height", `${trueH + 30}px`, "important");
            mc.style.setProperty("min-width", `${trueW + 30}px`, "important");
            mc.style.setProperty("min-height", `${trueH + 30}px`, "important");
            mc.style.setProperty("padding", "15px", "important");
            mc.style.setProperty("background", "#ffffff", "important");
          }
        }

        try {
          const canvas = await window.html2canvas(mc, {
            scale: 2.5,
            backgroundColor: "#ffffff",
            useCORS: true,
            allowTaint: true,
            logging: false,
            imageTimeout: 15000,
          });
          return canvas.toDataURL("image/png");
        } catch (err) {
          console.warn("[Darkness Export] html2canvas live element capture fallback:", err);
          return null;
        } finally {
          mc.style.height = originalMcHeight;
          mc.style.maxHeight = originalMcMaxHeight;
          mc.style.overflow = originalMcOverflow;
          mc.style.width = originalMcWidth;
          mc.style.maxWidth = originalMcMaxWidth;
          mc.style.transform = originalMcTransform;

          savedChildStyles.forEach(item => {
            if (item.el && item.el.style) {
              item.el.style.height = item.height;
              item.el.style.maxHeight = item.maxHeight;
              item.el.style.overflow = item.overflow;
              item.el.style.transform = item.transform;
              item.el.style.width = item.width;
              item.el.style.maxWidth = item.maxWidth;
            }
          });

          if (svg) {
            svg.style.width = origSvgW;
            svg.style.height = origSvgH;
            svg.style.minWidth = origSvgMinW;
            svg.style.minHeight = origSvgMinH;
            svg.style.overflow = origSvgOverflow;
          }

          controls.forEach(ctrl => ctrl.style.removeProperty("display"));
        }
      };

      // Transform raw code block elements into expanded syntax-highlighted blocks
      const renderExpandedCodeBlock = (block) => {
        let rawCode = "";
        const rawTa = block.querySelector(".code-cell__raw");
        if (rawTa && typeof rawTa.value === "string" && rawTa.value.length > 0) {
          rawCode = rawTa.value;
        } else if (block._rawCode) {
          rawCode = block._rawCode;
        } else {
          const cellId = block.getAttribute("data-cell-id") || block.id;
          const snip = window.Darkness?.codeViewer?.getSnippet ? window.Darkness.codeViewer.getSnippet(cellId, block) : null;
          if (snip && typeof snip.code === "string" && snip.code.length > 0) {
            rawCode = snip.code;
          } else {
            const lineEls = block.querySelectorAll(".code-line__code");
            if (lineEls && lineEls.length > 0) {
              rawCode = Array.from(lineEls).map(el => el.textContent).join("\n");
            } else {
              const codeEl = block.querySelector("code, pre");
              rawCode = codeEl ? codeEl.textContent : block.textContent;
            }
          }
        }

        const lang = block.getAttribute("data-lang") ||
          block.querySelector(".code-cell__badge")?.textContent?.trim().toLowerCase() ||
          "plaintext";

        const filename = block.getAttribute("data-filename") ||
          block.querySelector(".code-cell__filename")?.textContent?.trim() ||
          "";

        const highlighter = window.Darkness?.highlighter;
        const langInfo = highlighter?.getLanguageInfo ? highlighter.getLanguageInfo(lang || filename) : { id: lang, name: (lang || "TEXT").toUpperCase() };

        const lines = rawCode.split("\n");
        const highlightedLines = (highlighter?.highlightLines)
          ? highlighter.highlightLines(rawCode, langInfo.id || lang)
          : lines.map(l => escapeHtml(l));

        const container = document.createElement("div");
        container.className = "pdf-code-block";

        const header = document.createElement("div");
        header.className = "pdf-code-header";
        header.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="pdf-code-badge">${escapeHtml(langInfo.name || lang)}</span>
            ${filename ? `<span style="font-weight:600; color:#1e293b;">${escapeHtml(filename)}</span>` : ""}
          </div>
          <span style="color:#64748b; font-size:10.5px;">${lines.length} line${lines.length === 1 ? '' : 's'}</span>
        `;

        const body = document.createElement("div");
        body.className = "pdf-code-body";

        highlightedLines.forEach((lineHtml, idx) => {
          const lineNum = idx + 1;
          const lineEl = document.createElement("div");
          lineEl.className = "pdf-code-line";
          lineEl.innerHTML = `
            <span class="pdf-code-num">${lineNum}</span>
            <span class="pdf-code-content">${lineHtml || "&nbsp;"}</span>
          `;
          body.appendChild(lineEl);
        });

        container.appendChild(header);
        container.appendChild(body);
        return container;
      };

      // Step 1: Pre-process each Chat Message into its exact Chat presentation
      const processedMessages = [];

      for (let i = 0; i < rawMsgs.length; i++) {
        const origEl = rawMsgs[i];
        const isUser = origEl.classList.contains("message--user") || origEl.classList.contains("project-chat-msg--user") || origEl.getAttribute("data-role") === "user";

        // Pre-rasterize live diagrams in this message
        let liveDiagrams = Array.from(origEl.querySelectorAll(".mermaid-container, pre.mermaid, .diagram-container, .recharts-wrapper, .chart-container, .d3-container"));
        liveDiagrams = liveDiagrams.filter(el => !liveDiagrams.some(other => other !== el && other.contains(el)));
        const rasterizedDiagrams = [];

        for (const mc of liveDiagrams) {
          let pngDataUrl = await captureElementToPng(mc);
          if (!pngDataUrl) {
            const svg = mc.querySelector("svg");
            if (svg) pngDataUrl = await this._convertSvgToPngDataUrl(svg);
          }
          if (pngDataUrl) rasterizedDiagrams.push({ original: mc, pngDataUrl });
        }

        let bodyClone = null;
        let userRawText = "";

        if (origEl.classList.contains("project-chat-msg")) {
          if (isUser) {
            userRawText = origEl.getAttribute("data-raw") || origEl.textContent.trim();
            bodyClone = document.createElement("div");
            bodyClone.className = "message__content";
            bodyClone.innerHTML = `<p>${escapeHtml(userRawText)}</p>`;
          } else {
            bodyClone = document.createElement("div");
            bodyClone.className = "message__content";
            const clonedInner = origEl.cloneNode(true);
            clonedInner.querySelectorAll(".file-jump-link").forEach(link => {
              const span = document.createElement("span");
              span.textContent = link.textContent;
              span.style.cssText = "color:#4f46e5; font-weight:600;";
              link.replaceWith(span);
            });
            bodyClone.innerHTML = clonedInner.innerHTML;
          }
        } else {
          const innerContent = origEl.querySelector(".message__content") || origEl.querySelector(".message__bubble") || origEl;
          bodyClone = innerContent.cloneNode(true);
        }

        // Clean out interactive-only UI controls
        bodyClone.querySelectorAll("button, .spinner, .message__controls, .message__status, .dropdown, .dropdown-menu, .explanation-badge, .copy-btn, .speaker-btn, .msg__actions, form, .mermaid-controls, .mermaid-fullscreen-header, .m-fullscreen-btn, .review-changes-btn, .apply-all-artifacts-btn, .download-all-artifacts-btn, .proj-att-remove, .code-cell__btn, .code-copy-btn, .code-cell__header div").forEach(el => el.remove());

        // Process attachments into high-res images
        bodyClone.querySelectorAll(".attachment-file-card").forEach(card => {
          const img = card.querySelector(".attachment-preview-img");
          if (img) {
            const wrapper = document.createElement("div");
            wrapper.className = "pdf-image-block";
            const newImg = document.createElement("img");
            newImg.src = img.src;
            newImg.alt = img.alt || "Uploaded Image";
            wrapper.appendChild(newImg);
            card.replaceWith(wrapper);
          }
        });

        // Process standard images
        bodyClone.querySelectorAll("img").forEach(img => {
          if (!img.classList.contains("user-menu__avatar") && !img.closest(".pdf-image-block") && !img.closest(".pdf-diagram-block")) {
            const wrapper = document.createElement("div");
            wrapper.className = "pdf-image-block";
            const newImg = img.cloneNode(true);
            wrapper.appendChild(newImg);
            img.replaceWith(wrapper);
          }
        });

        // Replace diagrams with high-res rasterized images
        let cloneDiagramList = Array.from(bodyClone.querySelectorAll(".mermaid-container, pre.mermaid, .diagram-container, .recharts-wrapper, .chart-container, .d3-container"));
        cloneDiagramList = cloneDiagramList.filter(el => !cloneDiagramList.some(other => other !== el && other.contains(el)));
        cloneDiagramList.forEach((cloneMc, idx) => {
          const match = rasterizedDiagrams[idx];
          const wrapper = document.createElement("div");
          wrapper.className = "pdf-diagram-block";

          if (match && match.pngDataUrl) {
            const img = document.createElement("img");
            img.src = match.pngDataUrl;
            img.alt = "Darkness Diagram";
            wrapper.appendChild(img);
          } else {
            const svgInClone = cloneMc.querySelector("svg");
            if (svgInClone) {
              svgInClone.style.maxWidth = "100%";
              svgInClone.style.width = "auto";
              svgInClone.style.height = "auto";
              svgInClone.style.display = "block";
              svgInClone.style.margin = "0 auto";
              wrapper.appendChild(svgInClone);
            }
          }
          cloneMc.replaceWith(wrapper);
        });

        // Replace any code cells with full-expanded syntax-highlighted code blocks
        const innerCodeCells = bodyClone.querySelectorAll(".code-cell, .code-block, pre:not(.mermaid)");
        innerCodeCells.forEach(cell => {
          const exp = renderExpandedCodeBlock(cell);
          cell.replaceWith(exp);
        });

        // Collect child elements of the message content
        let contentElements = bodyClone.children.length === 0 ? [bodyClone] : Array.from(bodyClone.children);

        processedMessages.push({
          role: isUser ? "user" : "assistant",
          authorName: isUser ? "You" : "Darkness AI",
          elements: contentElements
        });
      }

      // Ensure all images are loaded
      const allImages = [];
      processedMessages.forEach(msg => {
        msg.elements.forEach(el => {
          if (el.tagName === "IMG") allImages.push(el);
          el.querySelectorAll("img").forEach(img => allImages.push(img));
        });
      });

      await Promise.all(allImages.map(img => {
        if (img.complete && img.naturalWidth > 0) {
          const natW = img.naturalWidth || 800;
          const natH = img.naturalHeight || 600;
          const aspect = natW / natH;
          let renderW = Math.min(natW, 710);
          let renderH = renderW / aspect;
          if (renderH > 780) {
            renderH = 780;
            renderW = renderH * aspect;
          }
          img.style.setProperty("width", `${Math.round(renderW)}px`, "important");
          img.style.setProperty("height", `${Math.round(renderH)}px`, "important");
          img.style.setProperty("max-width", "100%", "important");
          return Promise.resolve();
        }
        return new Promise(resolve => {
          img.onload = () => {
            const natW = img.naturalWidth || 800;
            const natH = img.naturalHeight || 600;
            const aspect = natW / natH;
            let renderW = Math.min(natW, 710);
            let renderH = renderW / aspect;
            if (renderH > 780) {
              renderH = 780;
              renderW = renderH * aspect;
            }
            img.style.setProperty("width", `${Math.round(renderW)}px`, "important");
            img.style.setProperty("height", `${Math.round(renderH)}px`, "important");
            img.style.setProperty("max-width", "100%", "important");
            resolve();
          };
          img.onerror = resolve;
        });
      }));

      // Measurer container for accurate height budget calculation
      const testContainer = document.createElement("div");
      testContainer.style.cssText = "width:730px !important; min-width:730px !important; max-width:730px !important; box-sizing:border-box !important; padding:0 !important; margin:0 !important;";
      measurer.appendChild(testContainer);

      function measureElementHeight(el) {
        testContainer.innerHTML = "";
        const clone = el.cloneNode(true);
        testContainer.appendChild(clone);
        const h = clone.getBoundingClientRect().height || clone.offsetHeight || 30;
        testContainer.innerHTML = "";
        return h;
      }

      function createNewPdfPage(pageNum) {
        const page = document.createElement("div");
        page.className = "pdf-page";
        page.style.cssText = [
          "width: 794px !important",
          "min-width: 794px !important",
          "max-width: 794px !important",
          "height: 1115px !important",
          "min-height: 1115px !important",
          "max-height: 1115px !important",
          "overflow: hidden !important",
          "box-sizing: border-box !important",
          "padding: 24px 32px !important",
          "background: #ffffff !important",
          "display: flex !important",
          "flex-direction: column !important",
          "position: relative !important",
          "break-after: page !important",
          "page-break-after: always !important"
        ].join(";");

        const topSection = document.createElement("div");
        topSection.className = "pdf-page-top";
        topSection.style.cssText = "width: 100% !important; box-sizing: border-box !important;";

        if (pageNum === 1) {
          topSection.innerHTML = `
            <div style="border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 16px; width: 100%; box-sizing: border-box;">
              <div style="display: flex; justify-content: space-between; align-items: flex-end;">
                <div>
                  <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">${projectName ? escapeHtml(projectName) + ' — Study Notes' : 'Comprehensive Study Notes & Reference'}</h1>
                  <p style="margin: 3px 0 0 0; font-size: 11.5px; color: #64748b;">${projectName ? 'Topic / Codebase: ' + escapeHtml(projectName) + ' • ' : ''}Date: ${dateStr}</p>
                </div>
                <div style="font-size: 11px; font-weight: 600; color: #64748b;">
                  ${dateStr}
                </div>
              </div>
            </div>
          `;
        } else {
          topSection.innerHTML = `
            <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 7px; margin-bottom: 14px; width: 100%; box-sizing: border-box; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #64748b;">
              <span>${projectName ? escapeHtml(projectName) + ' &bull; ' : ''}Study Notes</span>
              <span>${dateStr}</span>
            </div>
          `;
        }

        const contentArea = document.createElement("div");
        contentArea.className = "pdf-page-content";
        contentArea.style.cssText = "width: 100% !important; flex: 1 !important; display: flex !important; flex-direction: column !important; gap: 0 !important; overflow: hidden !important; box-sizing: border-box !important;";

        const footer = document.createElement("div");
        footer.className = "pdf-page-footer";
        footer.style.cssText = "border-top: 1px solid #e2e8f0; padding-top: 8px; margin-top: auto; width: 100%; box-sizing: border-box; display: flex; justify-content: space-between; align-items: center; font-size: 10.5px; color: #64748b;";
        footer.innerHTML = `
          <span style="display:inline-flex; align-items:center; gap:6px; color:#475569; font-weight:500;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#4f46e5" stroke-width="2.5" style="display:inline-block; vertical-align:middle;"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
            Generated with Darkness AI
          </span>
          <span class="pdf-page-number">Page ${pageNum}</span>
        `;

        page.appendChild(topSection);
        page.appendChild(contentArea);
        page.appendChild(footer);

        return { page, contentArea, pageNum };
      }

      function buildMessageElement(role, authorName, innerContentElements, isContinuation = false) {
        const isUser = role === "user";
        const msgEl = document.createElement("div");
        msgEl.className = `message ${isUser ? 'message--user' : 'message--assistant'} ${isContinuation ? 'message--continuation' : ''}`;

        const row = document.createElement("div");
        row.className = "message__row";

        const body = document.createElement("div");
        body.className = "message__body";

        const authorTag = document.createElement("div");
        authorTag.className = "message__author-tag";
        let displayAuthor = authorName;
        if (!isUser && (/darkness/i.test(authorName) || !authorName)) {
          displayAuthor = "Study Notes & Explanation";
        } else if (isUser) {
          displayAuthor = "Topic / Question";
        }
        authorTag.innerHTML = `
          <span class="message__author-dot"></span>
          <span>${escapeHtml(displayAuthor)}${isContinuation ? ' (cont.)' : ''}</span>
        `;
        body.appendChild(authorTag);

        const bubble = document.createElement("div");
        bubble.className = "message__bubble";

        const contentDiv = document.createElement("div");
        contentDiv.className = "message__content";

        innerContentElements.forEach(el => contentDiv.appendChild(el));
        bubble.appendChild(contentDiv);
        body.appendChild(bubble);
        row.appendChild(body);
        msgEl.appendChild(row);

        return msgEl;
      }

      // Step 2: Accurate Chat-Flow Pagination
      const pages = [];
      let currentPageObj = createNewPdfPage(1);
      pages.push(currentPageObj);

      let currentPageUsedHeight = 0;

      for (let mIdx = 0; mIdx < processedMessages.length; mIdx++) {
        const msg = processedMessages[mIdx];
        const isUser = msg.role === "user";
        const elements = msg.elements;

        const maxPageContentHeight = pages.length === 1 ? 860 : 920;

        // For single-element or short user messages, measure whole bubble
        const fullMsgEl = buildMessageElement(msg.role, msg.authorName, elements.map(e => e.cloneNode(true)));
        const fullMsgHeight = measureElementHeight(fullMsgEl) + 12;

        if (currentPageUsedHeight + fullMsgHeight <= maxPageContentHeight) {
          currentPageObj.contentArea.appendChild(fullMsgEl);
          currentPageUsedHeight += fullMsgHeight;
        } else if (isUser || elements.length <= 1) {
          // If a short message doesn't fit on this page, start a fresh page
          if (currentPageUsedHeight > 0) {
            currentPageObj = createNewPdfPage(pages.length + 1);
            pages.push(currentPageObj);
            currentPageUsedHeight = 0;
          }
          currentPageObj.contentArea.appendChild(fullMsgEl);
          currentPageUsedHeight += fullMsgHeight;
        } else {
          // Multi-element assistant message: flow elements across pages
          let currentElementsChunk = [];
          let isCont = false;

          for (let eIdx = 0; eIdx < elements.length; eIdx++) {
            const el = elements[eIdx];

            // Check if this is a large code block that can be chunked across pages
            if (el.classList.contains("pdf-code-block") && el.querySelector(".pdf-code-body")) {
              const codeLines = Array.from(el.querySelectorAll(".pdf-code-line"));
              if (codeLines.length > 8) {
                // If there were previous elements in chunk, flush them first
                if (currentElementsChunk.length > 0) {
                  const partMsg = buildMessageElement(msg.role, msg.authorName, currentElementsChunk, isCont);
                  const partHeight = measureElementHeight(partMsg) + 12;
                  currentPageObj.contentArea.appendChild(partMsg);
                  currentPageUsedHeight += partHeight;
                  currentElementsChunk = [];
                  isCont = true;
                }

                const codeHeader = el.querySelector(".pdf-code-header");
                let lineChunk = [];
                let currentChunkHeight = 45; // code block header & padding overhead

                for (let lIdx = 0; lIdx < codeLines.length; lIdx++) {
                  const line = codeLines[lIdx];
                  const lineH = 19; // px per line

                  if (currentPageUsedHeight + currentChunkHeight + lineH <= maxPageContentHeight) {
                    lineChunk.push(line);
                    currentChunkHeight += lineH;
                  } else {
                    if (lineChunk.length > 0) {
                      const partCodeBlock = document.createElement("div");
                      partCodeBlock.className = "pdf-code-block";
                      if (codeHeader) partCodeBlock.appendChild(codeHeader.cloneNode(true));
                      const partCodeBody = document.createElement("div");
                      partCodeBody.className = "pdf-code-body";
                      lineChunk.forEach(l => partCodeBody.appendChild(l));
                      partCodeBlock.appendChild(partCodeBody);

                      const partMsg = buildMessageElement(msg.role, msg.authorName, [partCodeBlock], isCont);
                      currentPageObj.contentArea.appendChild(partMsg);
                      isCont = true;
                    }

                    // Start new page
                    currentPageObj = createNewPdfPage(pages.length + 1);
                    pages.push(currentPageObj);
                    currentPageUsedHeight = 0;

                    const contHeader = codeHeader ? codeHeader.cloneNode(true) : document.createElement("div");
                    if (contHeader) {
                      const badge = contHeader.querySelector(".pdf-code-badge");
                      if (badge && !badge.textContent.includes("(cont.)")) badge.textContent += " (cont.)";
                    }

                    lineChunk = [line];
                    currentChunkHeight = 45 + lineH;
                  }
                }

                if (lineChunk.length > 0) {
                  const partCodeBlock = document.createElement("div");
                  partCodeBlock.className = "pdf-code-block";
                  if (codeHeader) {
                    const contHeader = codeHeader.cloneNode(true);
                    if (pages.length > 1) {
                      const badge = contHeader.querySelector(".pdf-code-badge");
                      if (badge && !badge.textContent.includes("(cont.)")) badge.textContent += " (cont.)";
                    }
                    partCodeBlock.appendChild(contHeader);
                  }
                  const partCodeBody = document.createElement("div");
                  partCodeBody.className = "pdf-code-body";
                  lineChunk.forEach(l => partCodeBody.appendChild(l));
                  partCodeBlock.appendChild(partCodeBody);

                  const partMsg = buildMessageElement(msg.role, msg.authorName, [partCodeBlock], isCont);
                  const partHeight = measureElementHeight(partMsg) + 12;
                  currentPageObj.contentArea.appendChild(partMsg);
                  currentPageUsedHeight += partHeight;
                  isCont = true;
                }
                continue;
              }
            }

            // Normal element measurement
            const testMsg = buildMessageElement(msg.role, msg.authorName, [...currentElementsChunk, el.cloneNode(true)], isCont);
            const testHeight = measureElementHeight(testMsg) + 12;

            if (currentPageUsedHeight + testHeight <= maxPageContentHeight) {
              currentElementsChunk.push(el);
            } else {
              if (currentElementsChunk.length > 0) {
                const partMsg = buildMessageElement(msg.role, msg.authorName, currentElementsChunk, isCont);
                const partHeight = measureElementHeight(partMsg) + 12;
                currentPageObj.contentArea.appendChild(partMsg);
                currentPageUsedHeight += partHeight;
                isCont = true;
                currentElementsChunk = [];
              }

              // Start new page if there's already content on current page
              if (currentPageUsedHeight > 0) {
                currentPageObj = createNewPdfPage(pages.length + 1);
                pages.push(currentPageObj);
                currentPageUsedHeight = 0;
              }

              currentElementsChunk.push(el);
            }
          }

          if (currentElementsChunk.length > 0) {
            const partMsg = buildMessageElement(msg.role, msg.authorName, currentElementsChunk, isCont);
            const partHeight = measureElementHeight(partMsg) + 12;
            currentPageObj.contentArea.appendChild(partMsg);
            currentPageUsedHeight += partHeight;
          }
        }
      }

      // Step 3: Populate pages to wrapper layout
      const wrapper = document.createElement("div");
      wrapper.id = "darkness-pdf-export-wrapper";
      wrapper.style.cssText = "width:794px !important; min-width:794px !important; max-width:794px !important; margin:0 !important; padding:0 !important; background:#ffffff !important; box-sizing:border-box !important;";

      const totalPages = pages.length;
      pages.forEach((pObj, idx) => {
        const pageNum = idx + 1;
        const numEl = pObj.page.querySelector(".pdf-page-number");
        if (numEl) numEl.textContent = `Page ${pageNum} of ${totalPages}`;

        if (pageNum === totalPages) {
          pObj.page.style.setProperty("break-after", "avoid", "important");
          pObj.page.style.setProperty("page-break-after", "avoid", "important");
        }
        wrapper.appendChild(pObj.page);
      });

      host.appendChild(wrapper);
      document.body.appendChild(host);

      measurer.remove();

      if (document.fonts && typeof document.fonts.ready !== "undefined") {
        await document.fonts.ready;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      }

      // Step 4: Run html2pdf render pipeline
      const safeName = (projectName || "Darkness").replace(/[^a-zA-Z0-9_-]/g, '_') + "_chat_" + now.toISOString().split('T')[0] + ".pdf";

      const opt = {
        margin: 0,
        filename: safeName,
        image: { type: 'png' },
        html2canvas: {
          scale: 2.5,
          useCORS: true,
          allowTaint: true,
          letterRendering: true,
          logging: false,
          width: 794,
          windowWidth: 794,
          scrollX: 0,
          scrollY: 0,
          x: 0,
          y: 0
        },
        jsPDF: {
          unit: 'mm',
          format: 'a4',
          orientation: 'portrait',
          compress: true
        },
        pagebreak: { mode: 'css' }
      };

      await window.html2pdf().set(opt).from(wrapper).save();

      if (window.Darkness && window.Darkness.toast) {
        window.Darkness.toast.show("PDF export completed successfully", "success");
      }

      // Save PDF artifact to project context if available
      const pId = options.projectId || window.Darkness?.state?.activeConversation?.project_id;
      if (pId && window.Darkness?.api?.request) {
        try {
          const dataUriWorker = window.html2pdf().set(opt).from(wrapper);
          const pdfDataUri = await dataUriWorker.outputPdf('datauristring');
          const base64Data = pdfDataUri ? pdfDataUri.split(',')[1] : null;
          if (base64Data && pdfDataUri.startsWith("data:application/pdf")) {
            await window.Darkness.api.request('/api/projects/' + pId + '/artifacts', {
              method: 'POST',
              body: JSON.stringify({
                filename: safeName,
                category: 'pdf',
                description: 'Exported Chat Conversation',
                source: 'Chat Export',
                bufferBase64: base64Data
              })
            });
            if (window.renderProjectArtifactsTab && document.getElementById('projectArtifactsGrid')) {
              window.renderProjectArtifactsTab(document.getElementById('projectArtifactsGrid').parentElement, pId);
            }
          }
        } catch (_) {}
      }

    } catch (err) {
      console.error("PDF Export error:", err);
      if (window.Darkness && window.Darkness.toast) {
        window.Darkness.toast.show("Couldn't export the chat. Please try again.", "error");
      }
    } finally {
      if (document.body.contains(loadingModal)) loadingModal.remove();
      if (document.body.contains(host)) host.remove();
      if (document.body.contains(measurer)) measurer.remove();
    }
  },

  _bindMainChatExportMenu() {
    const exportBtn = document.getElementById("mainChatExportMenuBtn");
    const exportDropdown = document.getElementById("mainChatExportDropdown");
    const exportPdfBtn = document.getElementById("mainChatExportPdfBtn");
    const exportTextBtn = document.getElementById("mainChatExportTextBtn");
    const exportCancelBtn = document.getElementById("mainChatExportCancelBtn");

    if (exportBtn && exportDropdown) {
      exportBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        exportDropdown.style.display = exportDropdown.style.display === "none" ? "block" : "none";
      });

      if (!this._exportListenersBound) {
        document.addEventListener("click", (e) => {
          const drop = document.getElementById("mainChatExportDropdown");
          const btn = document.getElementById("mainChatExportMenuBtn");
          if (btn && drop && drop.style.display === "block" && !btn.contains(e.target) && !drop.contains(e.target)) {
            drop.style.display = "none";
          }
        });
        document.addEventListener("keydown", (e) => {
          const drop = document.getElementById("mainChatExportDropdown");
          if (e.key === "Escape" && drop && drop.style.display === "block") {
            drop.style.display = "none";
          }
        });
        this._exportListenersBound = true;
      }

      exportCancelBtn?.addEventListener("click", () => {
        exportDropdown.style.display = "none";
      });

      exportPdfBtn?.addEventListener("click", async () => {
        exportDropdown.style.display = "none";
        await this.exportChatToPdf({ feed: document.getElementById("conversationList") || document.getElementById("projectChatFeed") });
      });

      exportTextBtn?.addEventListener("click", () => {
        exportDropdown.style.display = "none";
        const feed = document.getElementById("conversationList") || document.getElementById("projectChatFeed");
        if (!feed) return;
        const msgs = feed.querySelectorAll(".message, .project-chat-msg");
        let text = "";
        msgs.forEach(m => {
          const isUser = m.classList.contains("message--user") || m.classList.contains("project-chat-msg--user");
          const role = isUser ? "User" : "Darkness Assistant";
          const body = m.querySelector(".message__body, .project-chat-msg-body")?.innerText || "";
          if (body.trim()) {
            text += `### ${role}\n\n${body.trim()}\n\n---\n\n`;
          }
        });
        if (text) {
          navigator.clipboard.writeText(text).then(() => {
            if (window.Darkness?.toast) window.Darkness.toast.show("Conversation copied as Markdown", "success");
          }).catch(() => {
            if (window.Darkness?.toast) window.Darkness.toast.show("Failed to copy conversation", "danger");
          });
        }
      });
    }
  },

  _updateExportVisibility() {
    const feed = document.getElementById("conversationList");
    const container = document.getElementById("mainChatExportContainer");
    const topContainer = document.getElementById("mainExportContainer");
    
    const hasMessages = feed && (feed.querySelectorAll(".message").length > 0 || !feed.classList.contains("conversation--empty"));
    
    if (container) {
      container.style.display = hasMessages ? "flex" : "none";
    }
    if (topContainer) {
      topContainer.hidden = !hasMessages;
    }
  },

  _bindSuggestionChips() {
    document.querySelectorAll("[data-suggestion]").forEach(chip => {
      chip.addEventListener("click", () => {
        const text = chip.getAttribute("data-suggestion");
        const input = document.getElementById("composerInput");
        if (input) {
          input.value = text;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.focus();

          // Optionally auto-send
          const sendBtn = document.getElementById("composerSend");
          if (sendBtn) {
              sendBtn.disabled = false;
              sendBtn.click();
          }
        }
      });
    });
  },

  async _bindChatHeaderMenu() {
    const container = document.getElementById("mainExportContainer");
    const menuBtn = document.getElementById("exportChatMainBtn");
    const dropdown = document.getElementById("exportChatMainDropdown");
    const cancelBtn = document.getElementById("exportChatMainCancelBtn");
    const pdfBtn = document.getElementById("exportChatMainPdfBtn");

    if (!container || !menuBtn || !dropdown || !pdfBtn) return;

    const messages = window.Darkness?.state?.activeConversation?.messages || [];
    if (messages.length > 0) {
        container.hidden = false;
    } else {
        container.hidden = true;
    }

    menuBtn.onclick = (e) => {
       e.stopPropagation();
       dropdown.style.display = dropdown.style.display === "none" ? "block" : "none";
    };
    cancelBtn.onclick = () => {
       dropdown.style.display = "none";
    };
    if (!container._menuListenersBound) {
        document.addEventListener("click", (e) => {
           const cont = document.getElementById("mainExportContainer");
           const drop = document.getElementById("exportChatMainDropdown");
           if (cont && drop && drop.style.display === "block" && !cont.contains(e.target)) {
               drop.style.display = "none";
           }
        });
        document.addEventListener("keydown", (e) => {
           const drop = document.getElementById("exportChatMainDropdown");
           if (e.key === "Escape" && drop && drop.style.display === "block") {
               drop.style.display = "none";
           }
        });
        container._menuListenersBound = true;
    }

    pdfBtn.onclick = async () => {
       dropdown.style.display = "none";
       await this.exportChatToPdf({
         feed: document.getElementById("conversationList") || document.getElementById("projectChatFeed")
       });
    };
  },

  _renderChatHtml(messages) {
    const isEmpty = !messages || messages.length === 0;
    const parts = ['<div class="chat-shell">'];
    parts.push('<section class="chat-panel" style="position: relative;">');
    parts.push(`
      <div id="chatProgressContainer" style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: transparent; z-index: 1001; pointer-events: none;">
        <div id="chatProgressBar" style="width: 0%; height: 100%; background: var(--accent, #5f5af6); transition: width 0.05s ease; border-radius: 0 100px 100px 0;"></div>
      </div>
    `);
    parts.push(`
      <div id="mainChatExportContainer" class="main-chat-export-bar" style="position: absolute; top: 12px; right: 14px; z-index: 100; display: ${isEmpty ? 'none' : 'flex'}; align-items: center;">
        <div style="position: relative;">
          <button class="btn btn--icon-sm btn--outline main-chat-export-btn" id="mainChatExportMenuBtn" type="button" title="Export conversation" aria-label="Export conversation" style="width:32px; height:32px; min-width:32px; padding:0; display:inline-flex; align-items:center; justify-content:center; background:var(--surface); border:1px solid var(--line); box-shadow:var(--shadow-sm); border-radius:var(--r-md); cursor:pointer; color:var(--ink-muted);">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
          <div id="mainChatExportDropdown" class="dropdown-menu" style="display:none; position:absolute; right:0; top:calc(100% + 4px); background:var(--surface); border:1px solid var(--line); border-radius:var(--r-md); box-shadow:var(--shadow-float); z-index:1000; min-width:165px; padding:4px;">
            <div style="padding:6px 10px; font-size:11px; font-weight:600; color:var(--ink-muted); text-transform:uppercase; border-bottom:1px solid var(--line); margin-bottom:4px;">Export conversation</div>
            <button class="dropdown-item" id="mainChatExportPdfBtn" type="button" style="width:100%; text-align:left; padding:8px 10px; background:transparent; border:none; color:var(--ink); font-size:13px; cursor:pointer; border-radius:var(--r-sm); display:flex; align-items:center; gap:8px;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span>Export as PDF</span>
            </button>
            <button class="dropdown-item" id="mainChatExportTextBtn" type="button" style="width:100%; text-align:left; padding:8px 10px; background:transparent; border:none; color:var(--ink); font-size:13px; cursor:pointer; border-radius:var(--r-sm); display:flex; align-items:center; gap:8px;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
              <span>Copy Markdown</span>
            </button>
            <button class="dropdown-item" id="mainChatExportCancelBtn" type="button" style="width:100%; text-align:left; padding:8px 10px; background:transparent; border:none; color:var(--ink-muted); font-size:13px; cursor:pointer; border-radius:var(--r-sm);">Cancel</button>
          </div>
        </div>
      </div>
    `);

    parts.push('<div class="conversation' + (isEmpty ? ' conversation--empty' : '') + '" id="conversationList">');
    if (isEmpty) {
      parts.push(this._renderEmptyState());
    } else {
      for (const msg of messages) {
        parts.push(this._renderMessage(msg));
      }
    }
    parts.push('</div>');
    parts.push('<div class="composer-outer"><div class="composer chat-composer" id="chatComposer"></div></div>');
    parts.push('</section>');
    parts.push('<aside class="preview-panel" id="filePreviewPanel" hidden></aside>');
    parts.push('</div>');
    return parts.join("");
  },

  _renderEmptyState() {
    let projName = "";
    let hasProj = false;
    let projId = "";

    let hasRag = false;
    let hasArch = false;
    let hasViva = false;
    let hasSecurity = false;

    const conv = window.Darkness?.state?.activeConversation;
    if (conv && conv.project_id) {
        projId = conv.project_id;
        const proj = window.Darkness?.state?.projects?.find(p => p.id === projId);
        if (proj) {
            projName = proj.name;
            hasProj = true;

            const analysis = window.Darkness?.state?.projectAnalyses?.[projId];
            if (analysis) {
                if (analysis.architecture && analysis.architecture.length > 0) hasArch = true;
                if (analysis.viva && analysis.viva.length > 0) hasViva = true;
                if (analysis.security && analysis.security.issues) hasSecurity = true;
                hasRag = true; // Assume RAG might be available or check actual status if known
            }
        }
    }

    const title = hasProj ? `What are you working on in ${window.Darkness.utils.escapeHtml(projName)}?` : 'What are you working on?';
    const sub = hasProj ? 'Ask me about your project, code, architecture, knowledge, or anything you\'re building.' : 'Ask me anything to get started.';

    let suggestionsHtml = '';
    if (hasProj) {
       suggestionsHtml += `<div class="chat-empty__suggestions" style="display:flex; flex-wrap:wrap; justify-content:center; gap:8px; margin-top:24px; max-width:600px; margin-left:auto; margin-right:auto;">`;
       suggestionsHtml += `<button class="btn btn--outline btn--sm" data-suggestion="Explain my project">Explain my project</button>`;
       if (hasArch) suggestionsHtml += `<button class="btn btn--outline btn--sm" data-suggestion="Explain the system architecture">Explain the system architecture</button>`;
       if (hasRag) suggestionsHtml += `<button class="btn btn--outline btn--sm" data-suggestion="Search my project knowledge">Search my project knowledge</button>`;
       if (hasSecurity) suggestionsHtml += `<button class="btn btn--outline btn--sm" data-suggestion="Check my project's security">Check my project's security</button>`;
       if (hasViva) suggestionsHtml += `<button class="btn btn--outline btn--sm" data-suggestion="Prepare me for the viva">Prepare me for the viva</button>`;
       suggestionsHtml += `</div>`;
    } else {
       suggestionsHtml = `
         <div class="chat-empty__suggestions" style="display:flex; flex-wrap:wrap; justify-content:center; gap:8px; margin-top:24px; max-width:600px; margin-left:auto; margin-right:auto;">
           <button class="btn btn--outline btn--sm" data-suggestion="Help me brainstorm an idea">Help me brainstorm an idea</button>
           <button class="btn btn--outline btn--sm" data-suggestion="Explain a complex topic">Explain a complex topic</button>
           <button class="btn btn--outline btn--sm" data-suggestion="Write a script for me">Write a script for me</button>
         </div>
       `;
    }

    return [
      '<div class="chat-empty" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; padding:20px; text-align:center;">',
      '<div class="chat-empty__inner" style="animation: fade-in 0.4s ease-out forwards;">',
            '<div class="darkness-robot" id="darknessRobot" data-state="idle">',
      '  <div class="darkness-robot__ring"></div>',
      '  <img src="/robot_asset.svg" class="darkness-robot__img" alt="Darkness Robot" />',
      '</div>',
      '<h1 class="chat-empty__title" style="font-size:28px; font-weight:700; color:var(--ink); margin-bottom:12px; letter-spacing:-0.02em;">' + title + '</h1>',
      '<p class="chat-empty__sub" style="font-size:15px; color:var(--ink-muted); max-width:480px; margin:0 auto; line-height:1.5;">' + sub + '</p>',
      suggestionsHtml,
      '</div>',
      '</div>',

    ].join("");
  },

  _renderAgentExecutionRowHtml(steps, currentStep, status, intent) {
    if (status === "done" || status === "completed") return "";

    let label = "Thinking…";
    const current = String(currentStep || "").toLowerCase();
    const intentUpper = String(intent || "").toUpperCase();

    if (intentUpper === "IMAGE_REQUEST" || intentUpper === "IMAGE_GENERATION") {
      label = "Creating image…";
    } else if (intentUpper === "PPT_GENERATION" || intentUpper === "PRESENTATION") {
      label = "Creating presentation…";
    } else if (intentUpper === "DOCX_GENERATION" || intentUpper === "DOCUMENT") {
      label = "Creating document…";
    } else if (intentUpper === "PDF_GENERATION") {
      label = "Generating PDF…";
    } else if (intentUpper === "XLSX_GENERATION" || intentUpper === "SPREADSHEET") {
      label = "Building spreadsheet…";
    } else if (
      intentUpper === "DIAGRAM_REQUEST" ||
      intentUpper === "FLOWCHART_REQUEST" ||
      intentUpper === "ARCHITECTURE_VISUAL_REQUEST" ||
      intentUpper === "WORKFLOW_REQUEST" ||
      intentUpper === "MINDMAP_REQUEST" ||
      intentUpper === "DIAGRAM_GENERATION"
    ) {
      label = "Preparing diagram…";
    } else if (intentUpper === "CHART_REQUEST" || intentUpper === "GRAPH_REQUEST" || intentUpper === "CHART_GENERATION" || intentUpper === "GRAPH_GENERATION") {
      label = "Generating chart…";
    } else if (intentUpper === "KNOWLEDGE_RAG" || intentUpper === "WEB_SEARCH") {
      label = "Searching documents…";
    } else if (intentUpper === "PROJECT_ANALYSIS") {
      label = "Analyzing project…";
    } else if (intentUpper === "CODE_GENERATION") {
      label = "Writing code…";
    } else if (intentUpper === "CODE_ANALYSIS" || intentUpper === "CODE_EXPLANATION") {
      label = "Analyzing code…";
    } else if (intentUpper === "PROBLEM_SOLVING") {
      label = "Calculating…";
    } else if (current.includes("analyz") || current.includes("search")) {
      label = "Searching documents…";
    } else if (current.includes("plan")) {
      label = "Thinking…";
    } else if (current.includes("generat") || current.includes("build") || current.includes("writ")) {
      label = "Generating response…";
    } else if (current.includes("render") || current.includes("validat")) {
      label = "Finalizing output…";
    }

    return `
      <div class="agent-transient-activity">
        <span class="agent-activity-spinner"></span>
        <span class="agent-activity-label">${window.Darkness.utils.escapeHtml(label)}</span>
      </div>
    `;
  },

  _updateAgentExecutionRow(msgId, steps, currentStep, status, intent) {
    const el = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (!el) return;
    const bubble = el.querySelector(".message__bubble");
    if (!bubble) return;
    let activityEl = bubble.querySelector(".agent-transient-activity") || bubble.querySelector(".agent-execution-row");

    if (status === "done" || status === "completed") {
      if (activityEl) activityEl.remove();
      return;
    }

    const newHtml = this._renderAgentExecutionRowHtml(steps, currentStep, status, intent);
    if (!newHtml) {
      if (activityEl) activityEl.remove();
      return;
    }

    if (activityEl) {
      activityEl.outerHTML = newHtml;
    } else {
      bubble.insertAdjacentHTML("afterbegin", newHtml);
    }
  },

  _renderMessage(msg) {
    const role = msg.role === "user" ? "user" : "assistant";
    const isStreaming = msg.streaming;
    const isError = msg.error;
    const bubbleClass = role === "assistant"
      ? (isError ? "message--assistant message--error" : "message--assistant")
      : "message--user";

    const isCodeExplanation = role === "assistant" && (
      msg.intent === "CODE_EXPLANATION" ||
      msg.intent === "code_explanation" ||
      msg.intent_type === "code_explanation" ||
      (msg.content && String(msg.content).includes("### What this file does"))
    );

    // Separate image artifacts from generic file artifacts
    const allArtifacts = (msg.artifacts && !isCodeExplanation) ? msg.artifacts : [];
    const imageArtifacts = allArtifacts.filter(a => a.category === "image" || (a.mimeType && a.mimeType.startsWith("image/")) || (a.filename && /\.(png|jpg|jpeg|webp|gif)$/i.test(a.filename)));
    const fileArtifacts = allArtifacts.filter(a => !imageArtifacts.includes(a));

    const rawContent = String(msg.content || "");
    const hasText = rawContent.trim().length > 0;
    const hasImages = imageArtifacts.length > 0 || rawContent.includes("<img") || /\!\[.*?\]\(.*?\)/.test(rawContent);
    const hasFiles = fileArtifacts.length > 0;

    const isEmpty = role === "assistant" && !hasText && !hasImages && !hasFiles && !isStreaming && !isError;

    const isFinished = !isStreaming || (msg.agent_state && (msg.agent_state.status === "done" || msg.agent_state.status === "completed"));
    const agentRowHtml = (isStreaming && !isFinished && msg.agent_state)
      ? this._renderAgentExecutionRowHtml(msg.agent_state.steps, msg.agent_state.currentStep, msg.agent_state.status, msg.agent_state.intent || msg.intent)
      : "";

    let contentHtml;
    if (isError) {
      contentHtml = '<div class="message__content message__content--error">' + this._renderErrorBlock(isError) + '</div>';
    } else if (isEmpty) {
      contentHtml = '<div class="message__content message__content--empty">No response generated.</div>';
    } else {
      try {
        let textToRender = rawContent;
        // If we have image artifacts, clean up duplicate raw markdown image syntax
        if (imageArtifacts.length > 0 && textToRender.includes("![")) {
          textToRender = textToRender.replace(/\!\[.*?\]\((?:data:|http|\/api\/).*?\)/g, "").trim();
        }

        const rendered = textToRender ? window.Darkness.markdown.render(textToRender, { __intercepted: true }) : "";
        contentHtml = '<div class="message__content">' + (rendered || "") + "</div>";
        setTimeout(() => {
          if (window.Darkness && window.Darkness.renderMermaid) {
            window.Darkness.renderMermaid();
          }
        }, 50);
      } catch (e) {
        contentHtml = '<div class="message__content"><p class="error-text">Failed to render message.</p></div>';
      }
    }

    // Inline Image Result Renderer
    let inlineImagesHtml = "";
    if (imageArtifacts.length > 0) {
      inlineImagesHtml = '<div class="message__inline-images" style="display:flex; flex-direction:column; gap:16px; margin-top:10px;">' +
        imageArtifacts.map(art => {
          const mime = art.mimeType || "image/png";
          const b64 = art.bufferBase64 || art.content;
          const url = art.id ? `/api/artifacts/${art.id}/download` : (b64 ? `data:${mime};base64,${b64}` : "");
          const title = art.description || art.filename || "Generated Image";
          const downloadFilename = art.filename || "generated_image.jpg";
          const artId = art.id || "";

          return `
            <div class="inline-image-card" style="max-width: 820px; width: 100%; border-radius: 12px; overflow: hidden; border: 1px solid var(--line); background: var(--surface); box-shadow: 0 4px 16px rgba(0,0,0,0.04); padding: 12px;">
              <div class="inline-image-wrapper" style="position: relative; border-radius: 8px; overflow: hidden; background: var(--surface-subtle, #18181b); display: flex; justify-content: center; align-items: center;">
                <img src="${url}" alt="${window.Darkness.utils.escapeHtml(title)}" class="inline-generated-img" loading="lazy" style="width: 100%; max-height: 560px; object-fit: contain; display: block; border-radius: 8px; cursor: zoom-in; transition: transform 0.15s ease;" data-img-url="${url}" data-img-title="${window.Darkness.utils.escapeHtml(title)}" />
              </div>
              <div class="inline-image-actions" style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; align-items: center; justify-content: flex-start;">
                <button type="button" class="btn btn--sm btn--outline image-lightbox-btn" data-img-url="${url}" data-img-title="${window.Darkness.utils.escapeHtml(title)}" style="font-size: 12px; display: inline-flex; align-items: center; gap: 5px; border-radius: 6px; padding: 5px 12px; font-weight: 500;">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                  <span>↗ Full View</span>
                </button>
                <a href="${url}" download="${downloadFilename}" class="btn btn--sm btn--outline image-download-btn" style="font-size: 12px; display: inline-flex; align-items: center; gap: 5px; border-radius: 6px; padding: 5px 12px; font-weight: 500; text-decoration: none; color: var(--ink);">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span>↓ Download</span>
                </a>
                <button type="button" class="btn btn--sm btn--outline image-regenerate-btn" data-art-id="${artId}" data-prompt="${window.Darkness.utils.escapeHtml(title)}" style="font-size: 12px; display: inline-flex; align-items: center; gap: 5px; border-radius: 6px; padding: 5px 12px; font-weight: 500;">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6"/><path d="M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                  <span>↻ Regenerate</span>
                </button>
              </div>
            </div>
          `;
        }).join("") + '</div>';
    }

    const attachmentsHtml = msg.attachments && msg.attachments.length
      ? '<div class="attachments">' + msg.attachments.map(att => {
          if (att.file_id || att.id) {
            return this._renderFileAttachment(att);
          }
          return this._renderAttachment(att);
        }).join("") + "</div>"
      : "";

    const fileArtifactsCount = fileArtifacts.length;
    let artifactsHtml = "";
    if (fileArtifactsCount > 0) {
      const artIds = fileArtifacts.map(a => a.id).filter(Boolean).join(",");
      const hasCode = fileArtifacts.some(a => a.category === "code" || (!a.bufferBase64 && a.content));
      const batchHeader = `
        <div class="artifacts-batch-header" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--surface-subtle, #f8fafc); border: 1px solid var(--line); border-radius: 10px; margin: 12px 0 8px; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 600; font-size: 13px; color: var(--ink); display: flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
              Generated Files (${fileArtifactsCount})
            </span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <button type="button" class="btn btn--sm btn--outline download-all-artifacts-btn" data-art-ids="${artIds}" style="font-size: 12px; display: inline-flex; align-items: center; gap: 5px;">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download All (.zip)
            </button>
            ${hasCode ? `
              <button type="button" class="btn btn--sm btn--ghost apply-all-artifacts-btn" data-art-ids="${artIds}" style="font-size: 12px; display: inline-flex; align-items: center; gap: 5px; color: var(--accent);">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                Apply All to Workspace
              </button>
            ` : ""}
          </div>
        </div>
      `;

      artifactsHtml = '<div class="message__artifacts">' +
        batchHeader +
        fileArtifacts.map(art => {
          return window.Darkness.artifact && window.Darkness.artifact.renderCard
            ? window.Darkness.artifact.renderCard(art)
            : "";
        }).join("") + '</div>';
    }

    const controls = role === "assistant" ? this._renderAssistantControls(msg, isStreaming, isError) : this._renderUserControls(msg);
    const statusDot = isStreaming ? '<div class="message__status status--streaming"></div>' : "";

    let actionsHtml = "";
    if (role === "assistant" && msg.suggested_actions && Array.isArray(msg.suggested_actions) && msg.suggested_actions.length > 0 && !isStreaming) {
      actionsHtml = `
        <div class="message__suggested-actions">
          ${msg.suggested_actions.map(act => `
            <button type="button" class="action-chip" data-action-prompt="${window.Darkness.utils.escapeHtml(act)}">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 8 16 12 12 16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
              <span>${window.Darkness.utils.escapeHtml(act)}</span>
            </button>
          `).join("")}
        </div>
      `;
    }

    if (role === "user") {
      return `<div class="message ${bubbleClass}" data-msg-id="${msg.id || ""}">
        <div class="message__row">
          <div class="message__body">
            <div class="message__bubble">
              ${contentHtml}
              ${inlineImagesHtml}
              ${attachmentsHtml}
              ${artifactsHtml}
            </div>
            ${controls}
          </div>
        </div>
      </div>`;
    }

    return `<div class="message ${bubbleClass}" data-msg-id="${msg.id || ""}">
      <div class="message__row">
        <div class="message__body">
          <div class="message__bubble">
            ${statusDot}
            ${agentRowHtml}
            ${contentHtml}
            ${inlineImagesHtml}
            ${attachmentsHtml}
            ${artifactsHtml}
            ${actionsHtml}
          </div>
          ${controls}
        </div>
      </div>
    </div>`;
  },

  _renderAssistantControls(msg, isStreaming, isError) {
    if (isStreaming) {
      return `<div class="message__controls"><button class="message-control message-control--icon" data-action="stop" type="button" title="Stop generation" aria-label="Stop generation">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
      </button></div>`;
    }
    if (isError) {
      return `<div class="message__controls message__controls--error">
        <button class="message-control message-control--icon" data-action="regenerate" type="button" title="Regenerate response" aria-label="Regenerate response">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
        </button>
        <button class="message-control message-control--icon" data-action="change-model" type="button" title="Change model" aria-label="Change model">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
        </button>
      </div>`;
    }
    const buttons = [
      `<button class="message-control message-control--read-aloud" data-action="read-aloud" type="button" title="Read explanation aloud" aria-label="Read explanation aloud">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
        <span>Read Aloud</span>
      </button>`,
      `<button class="message-control message-control--icon" data-action="copy" type="button" title="Copy response" aria-label="Copy response">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
      </button>`,
      `<button class="message-control message-control--icon" data-action="regenerate" type="button" title="Regenerate response" aria-label="Regenerate response">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
      </button>`,
    ];
    const playerBar = window.Darkness?.narrationSync
      ? window.Darkness.narrationSync.renderPlayerBarHtml(msg.id || "", "en")
      : `
      <div class="narration-player-bar" hidden data-player-msg-id="${msg.id || ""}">
        <div class="narration-player-left">
          <button type="button" class="narration-player-btn narration-player-btn--primary" data-player-action="play-pause" title="Play or Pause narration">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            <span>Pause</span>
          </button>
          <button type="button" class="narration-player-btn" data-player-action="stop" title="Stop speech">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
            <span>Stop</span>
          </button>
          <button type="button" class="narration-player-btn" data-player-action="replay" title="Replay explanation from start">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
            <span>Replay</span>
          </button>
          <select class="narration-speed-select" data-player-action="speed" title="Speed">
            <option value="0.75">0.75x</option>
            <option value="1.0" selected>1.0x</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="2.0">2.0x</option>
          </select>
          <select class="narration-voice-select" data-player-action="voice" title="Voice">
            <option value="">Default Voice</option>
          </select>
          <button type="button" class="narration-player-btn" data-player-action="preview" title="Preview selected voice">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            <span>Preview</span>
          </button>
          <span class="narration-player-status">Playing...</span>
        </div>
      </div>
    `;
    return `<div class="message__controls">${buttons.join("")}</div>${playerBar}`;
  },

  _renderUserControls(msg) {
    if (!msg.id || msg.streaming) return "";
    const buttons = [
      `<button class="message-control message-control--icon" data-action="edit" type="button" title="Edit message" aria-label="Edit message">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
      </button>`,
      `<button class="message-control message-control--icon" data-action="copy" type="button" title="Copy message" aria-label="Copy message">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
      </button>`,
    ];
    return `<div class="message__controls">${buttons.join("")}</div>`;
  },

  _controlBtn(action, label, icon) {
    return `<button class="message-control" data-action="${action}" type="button" title="${label}" aria-label="${label}"></button>`;
  },

  _renderAttachment(att) {
    const isImg = att.type === "image";
    const body = isImg
      ? '<img src="' + (att.url || "") + '" alt="' + (att.name || "attachment") + '" class="attachment-preview" />'
      : '<div class="attachment-file"><svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><span>' + (att.name || "file") + '</span></div>';
    return `<div class="attachment ${isImg ? "attachment-image" : "attachment-file"}">${body}</div>`;
  },

  _renderFileAttachment(att) {
    const name = att.name || "file";
    const fileId = att.file_id || att.id;
    const isPdf = att.type === "pdf" || (att.mime && att.mime.includes("pdf")) || /\.pdf$/i.test(name);
    const isImage = att.type === "image" || (att.mime && att.mime.startsWith("image/"));
    const icon = isImage
      ? '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'
      : (isPdf
        ? '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#ef4444" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>'
        : '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>');

    const previewHtml = isImage
      ? '<img src="/api/files/' + fileId + '/raw" alt="' + name + '" class="attachment-preview-img" />'
      : '';

    return [
      '<div class="attachment-file-card" data-file-id="' + fileId + '">',
        '<div class="attachment-file-card__icon">' + icon + '</div>',
        '<div class="attachment-file-card__info">',
          '<div class="attachment-file-card__name">' + window.Darkness.utils.escapeHtml(name) + '</div>',
          previewHtml,
        '</div>',
        '<div class="attachment-file-card__actions">',
          '<button type="button" class="btn btn--ghost btn--sm file-preview-btn" data-file-id="' + fileId + '" data-file-name="' + window.Darkness.utils.escapeHtml(name) + '" title="Preview">',
            '<svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 6v6l4 2"/></svg>',
            ' Preview',
          '</button>',
          '<a href="/api/files/' + fileId + '/raw" download="' + name + '" class="btn btn--ghost btn--sm" title="Download">',
            '<svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
            ' Download',
          '</a>',
        '</div>',
      '</div>'
    ].join("");
  },

  _updateNewChatButton() {
    const btn = document.getElementById("newChatBtn");
    if (btn) {
      btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span class="btn__text">New Chat</span>';
      btn.onclick = () => {
        if (this._isStreaming) {
          this._stopStreaming();
          return;
        }
        this.startNewConversation();
      };
    }
  },

  _updateComposer() {
    const container = document.getElementById("chatComposer");
    if (!container) return;
    this._attachedFiles = (this._attachedFiles || []).filter(a => a && a.id);
    window.Darkness.composer.mount(container, (value, attachments, think) => {
      this._attachedFiles = attachments || [];
      this.sendMessage(value, this._attachedFiles, undefined, think);
    }, this._resolveModelId(), this._attachedFiles);
    window.Darkness.composer.setStreaming(this._isStreaming, () => this._stopStreaming());
  },

  _openFilePreview(att) {
    this._previewFile = att;
    this._isPreviewOpen = true;
    this._renderPreviewPanel();
  },

  _closeFilePreview() {
    this._previewFile = null;
    this._isPreviewOpen = false;
    const previewPanel = document.getElementById("filePreviewPanel");
    if (previewPanel) previewPanel.hidden = true;
    document.body.classList.remove("has-preview");
  },

  openImageLightbox(url, title) {
    if (!url) return;
    const cleanTitle = title || "Generated Image";
    const bodyHtml = `
      <div style="display: flex; justify-content: center; align-items: center; padding: 16px; background: rgba(0,0,0,0.88); border-radius: 12px; min-height: 320px; max-height: 82vh; overflow: auto;">
        <img src="${url}" alt="${window.Darkness.utils.escapeHtml(cleanTitle)}" style="max-width: 100%; max-height: 78vh; object-fit: contain; border-radius: 8px; box-shadow: 0 12px 40px rgba(0,0,0,0.6);" />
      </div>
    `;
    const actionsHtml = `
      <a href="${url}" download="${cleanTitle.replace(/[^a-zA-Z0-9]/g, '_')}.jpg" class="btn btn--primary" style="display: inline-flex; align-items: center; gap: 6px; text-decoration: none;">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <span>Download High-Res</span>
      </a>
      <button type="button" class="btn btn--outline" data-modal-close="true">Close</button>
    `;
    if (window.Darkness.modal && window.Darkness.modal.open) {
      window.Darkness.modal.open(cleanTitle, bodyHtml, actionsHtml, { maxWidth: "88vw" });
    }
  },

  _renderPreviewPanel() {
    if (!this._previewFile) return;
    const att = this._previewFile;
    const fileName = att.name || "file";
    const fileId = att.file_id;
    const isImage = att.mime && att.mime.startsWith("image/");

    let contentHtml = "";
    if (isImage) {
      contentHtml = '<img src="/api/files/' + fileId + '/raw" alt="' + window.Darkness.utils.escapeHtml(fileName) + '" class="preview-image" />';
    } else {
      contentHtml = this._buildCodePreview(fileId, fileName, att.content || "");
    }

    const panel = document.getElementById("filePreviewPanel");
    if (!panel) return;

    const icon = isImage
      ? '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'
      : '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';

    panel.innerHTML = [
      '<div class="preview-header">',
        '<div class="preview-header__info">',
          '<span class="preview-header__icon">' + icon + '</span>',
          '<span class="preview-header__name">' + window.Darkness.utils.escapeHtml(fileName) + '</span>',
          '<span class="preview-header__meta">Python File • 2.1 KB</span>',
        '</div>',
        '<div class="preview-header__actions">',
          '<a href="/api/files/' + fileId + '/raw" download="' + window.Darkness.utils.escapeHtml(fileName) + '" class="btn btn--ghost btn--sm" title="Download">Download</a>',
          '<button class="btn btn--sm btn--outline" type="button" id="previewCloseBtn" title="Close preview (Esc)" aria-label="Close preview" style="display:inline-flex; align-items:center; gap:4px; font-weight:600; color:var(--ink);">',
            '<svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
            ' Close',
          '</button>',
        '</div>',
      '</div>',
      '<div class="preview-body">',
        '<div class="preview-code-wrapper">',
          contentHtml,
        '</div>',
      '</div>',
    ].join("");

    panel.hidden = false;
    document.body.classList.add("has-preview");

    document.getElementById("previewCloseBtn")?.addEventListener("click", () => this._closeFilePreview());
  },

  _buildCodePreview(fileId, fileName, content) {
    // Try to fetch file content from server
    let codeContent = content;
    // If content not passed directly, we rely on fetched data; for now use what we have
    const ext = (fileName || "").split(".").pop() || "txt";
    const langMap = {
      "py": "python", "js": "javascript", "jsx": "javascript",
      "ts": "typescript", "tsx": "typescript",
      "json": "json", "html": "html", "css": "css",
      "md": "markdown", "txt": "plaintext", "csv": "csv"
    };
    const langClass = langMap[ext] || "plaintext";

    const lines = codeContent.split("\n");
    const lineNumbers = lines.map((_, i) => (i + 1)).join("\n");

    return [
      '<div class="preview-code">',
        '<div class="preview-line-numbers">',
          '<pre><code class="language-plaintext">' + window.Darkness.utils.escapeHtml(lineNumbers) + '</code></pre>',
        '</div>',
        '<pre class="preview-source"><code class="language-' + langClass + '">' + window.Darkness.utils.escapeHtml(codeContent) + '</code></pre>',
      '</div>'
    ].join("");
  },

  _bindFilePreviewButtons() {
    document.querySelectorAll(".file-preview-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const fileId = btn.getAttribute("data-file-id");
        const fileName = btn.getAttribute("data-file-name");
        // Fetch content from server
        fetch(window.Darkness.api.base + "/api/files/" + fileId + "/raw")
          .then(r => r.text())
          .then(text => {
            this._previewFile = { file_id: fileId, name: fileName, content: text, mime: "text/plain" };
            this._openFilePreview(this._previewFile);
          })
          .catch(err => {
            // Fallback: try to get content from message attachments
            const msgEl = btn.closest(".message");
            if (msgEl) {
              const msgId = msgEl.getAttribute("data-msg-id");
              // Try to find content in the message
              this._previewFile = { file_id: fileId, name: fileName, content: "", mime: "text/plain" };
              this._openFilePreview(this._previewFile);
            }
          });
      });
    });
  },

  setRobotState(state) {
    const robot = document.getElementById("darknessRobot");
    if (!robot) return;

    // Check if we're trying to set idle but we are currently streaming
    if (state === "idle" && this._isStreaming) return;

    robot.setAttribute("data-state", state);

    if (state === "responding") {
      setTimeout(() => {
        if (robot.getAttribute("data-state") === "responding") {
          robot.setAttribute("data-state", "idle");
        }
      }, 1500);
    }

    // Clear existing look intervals
    if (this._robotLookInterval) clearInterval(this._robotLookInterval);
    if (this._robotLookTimeout) clearTimeout(this._robotLookTimeout);

    if (state === "idle" || state === "listening" || state === "thinking") {
      this._robotLookInterval = setInterval(() => {
        if (!document.getElementById("darknessRobot")) return clearInterval(this._robotLookInterval);

        const r = Math.random();
        let look = "none";
        if (r > 0.78) look = "left";
        else if (r > 0.56) look = "right";

        robot.setAttribute("data-look", look);

        if (look !== "none") {
          this._robotLookTimeout = setTimeout(() => {
            if (robot.getAttribute("data-state") === state) {
              robot.setAttribute("data-look", "none");
            }
          }, 800 + Math.random() * 1000);
        }
      }, 2800);
    } else {
      robot.setAttribute("data-look", "none");
    }
  },

  _syncComposerStreaming() {
    window.Darkness.composer.setStreaming(this._isStreaming, () => this._stopStreaming());
  },

  async sendMessage(content, attachments, explicitMode, think, selectedCodeContext) {
    if (!Array.isArray(attachments)) {
      attachments = [];
    }
    if (this._isStreaming) return;
    if (!this._activeConversation) {
      try {
        const defaultTitle = (content && content.trim()) || (attachments && attachments[0] && attachments[0].name) || "New Chat";
        const convData = await window.Darkness.api.post("/api/conversations", {
          title: defaultTitle,
          model_id: this._resolveModelId(),
        });
        this._activeConversation = convData.id;
        this._firstMessagePending = false;
        window.Darkness.store.set("active_conversation", convData.id);
        if (window.Darkness.uiSidebar) window.Darkness.uiSidebar.refresh();
        setTimeout(() => {
          const input = document.getElementById("composerInput");
          if (input) input.focus();
        }, 50);
      } catch (err) {
        window.Darkness.toast.show("Failed to create conversation: " + (err.message || "unknown"), "danger");
        return;
      }
    }
    const cid = this._activeConversation;
    if (!cid) {
      window.Darkness.toast.show("Could not start conversation: no conversation id.", "danger");
      return;
    }

    const hasImages = attachments && attachments.some(a => a.type === "image");
    if (hasImages) {
      const modelId = this._resolveModelId();
      const caps = window.Darkness.modelSelector && window.Darkness.modelSelector.getCapabilities(modelId);
      if (!caps || !caps.vision) {
        this._isStreaming = false;
        this._syncComposerStreaming();
        window.Darkness.toast.show("This model does not support image input. Please select a Vision-capable model.", "danger");
        return;
      }
    }

    this._isStreaming = true;
    this._syncComposerStreaming();
    let convEl = document.getElementById("conversationList");
    if (!convEl) {
      this.renderChat([]);
      convEl = document.getElementById("conversationList");
    }
    if (convEl) {
      convEl.classList.remove("conversation--empty");
      const empty = convEl.querySelector(".chat-empty");
      if (empty) empty.remove();
      this._bindScrollListener(convEl);
      this._updateExportVisibility();
    }
    if (!convEl) return;

    const userAttachments = attachments.map(att => {
      const isPdf = att.type === "pdf" || (att.mime && att.mime.includes("pdf")) || /\.pdf$/i.test(att.name || "");
      const isImage = att.type === "image" || (att.mime && att.mime.startsWith("image/"));
      return {
        id: att.id || att.file_id,
        file_id: att.file_id || att.id,
        type: isImage ? "image" : (isPdf ? "pdf" : "file"),
        name: att.name,
        size: att.size || 0,
        url: att.url,
        data: att.data,
        mime: att.mime,
        content: att.content || "",
      };
    });

    const userMsg = {
      role: "user",
      content: content || (userAttachments.length > 0 ? "Shared " + userAttachments.map(a => a.name).join(", ") : ""),
      attachments: userAttachments,
      id: "user_" + Date.now(),
    };

    const botMsg = {
      role: "assistant",
      content: "",
      id: "bot_" + Date.now(),
      streaming: true,
    };

    convEl.insertAdjacentHTML("beforeend", this._renderMessage(userMsg) + this._renderMessage(botMsg));
    this._bindMessageControls();
    this._userScrolledUp = false;
    this._scrollToBottom(true);

    const file_ids = attachments
      .map(a => a.file_id || a.id)
      .filter(Boolean);

    const projectId = attachments.find(a => a.type === "project")?.id || (this._activeConversation ? this._currentProject : null);

    const chosenMode = explicitMode || undefined;
    const resolvedFormat = chosenMode === "ppt" ? "pptx" : (chosenMode === "word" ? "docx" : (chosenMode === "excel" ? "xlsx" : (chosenMode === "file" ? "code" : chosenMode)));

    const activeProfessorMode = localStorage.getItem("darkness_professor_mode") || "normal";
    const userWantsReadAloud = /\b(read aloud|read it aloud|voice)\b/i.test(content);

    let requestBody = {
      message: content,
      model_id: this._resolveModelId(),
      file_ids,
      project_id: projectId,
      generation_mode: chosenMode,
      format: resolvedFormat,
      explicitFormat: resolvedFormat,
      think: !!think,
      selectedCodeContext: selectedCodeContext || undefined,
      professorMode: activeProfessorMode,
    };

    if (this._abortController) {
      this._abortController.abort();
    }
    this._abortController = new AbortController();

    this.setRobotState("thinking");

    try {
      const response = await fetch(window.Darkness.api.base + `/api/conversations/${cid}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: this._abortController.signal,
        credentials: "include",
      });

      if (!response.ok) {
        let detail = response.statusText;
        try {
          const txt = await response.text();
          if (txt) {
            try { detail = JSON.parse(txt).error || txt; } catch (e) { detail = txt; }
          }
        } catch (e) {}
        const err = new Error(detail);
        err.status = response.status;
        err.type = response.status === 404 ? "model_not_found" : (response.status === 401 || response.status === 403 ? "auth_error" : "http_error");
        throw err;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let botContent = "";
      let botAttachments = [];
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          sseBuffer += decoder.decode(value, { stream: true });
        }
        if (done) {
          if (value) {
            sseBuffer += decoder.decode(value, { stream: false });
          }
          const lines = sseBuffer.split("\n");
          sseBuffer = "";
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line === "data:") continue;
            if (!line.startsWith("data:")) continue;
            const jsonStr = line.slice(5).trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;
            try {
              const event = JSON.parse(jsonStr);
              if (event.error && event.error.type === "empty_response") {
                this._updateBotMessage(botMsg.id, "", false);
                this._isStreaming = false;
                this._syncComposerStreaming();
                this._saveState();
                this._bindMessageControls();
                this._scrollToBottom();
                if (this._firstMessagePending) {
                  this._firstMessagePending = false;
                }
                this._refreshSidebarAfterMessage();
                return;
              } else if (event.error) {
                this._updateBotMessage(botMsg.id, "", true, event.error);
                this._isStreaming = false;
                this._syncComposerStreaming();
                botMsg.streaming = false;
                botMsg.error = event.error;
                const errEl = document.querySelector(`[data-msg-id="${botMsg.id}"]`);
                if (errEl) {
                  errEl.innerHTML = this._renderMessage(botMsg);
                  this._bindMessageControls();
                  this._renderErrorActions(errEl, event.error, botMsg.id, false);
                }
                this._scrollToBottom();
                this.setRobotState("error");
                return;
              } else if (event.type === "agent_state") {
                botMsg.agent_state = event;
                if (event.intent) botMsg.intent = event.intent;
                this._updateAgentExecutionRow(botMsg.id, event.steps, event.currentStep, event.status, event.intent || botMsg.intent);
                this._scrollToBottom();
              } else if (event.done) {
                if (event.content) botContent += event.content;
                if (event.fullContent) botContent = event.fullContent;
                if (event.attachments) botAttachments = event.attachments;
                if (event.artifacts) {
                  botMsg.artifacts = event.artifacts;
                } else if (event.artifact) {
                  botMsg.artifacts = Array.isArray(event.artifact) ? event.artifact : [event.artifact];
                }
                if (event.intent) botMsg.intent = event.intent;
                if (event.suggested_actions || event.actions) {
                  botMsg.suggested_actions = event.suggested_actions || event.actions;
                }
                botMsg.content = botContent;
                botMsg.streaming = false;
                delete botMsg.agent_state;
                botMsg.attachments = botAttachments;
                const msgEl = document.querySelector(`[data-msg-id="${botMsg.id}"]`);
                if (msgEl) {
                  msgEl.querySelector(".agent-transient-activity")?.remove();
                  msgEl.querySelector(".agent-execution-row")?.remove();
                  msgEl.innerHTML = this._renderMessage(botMsg);
                  this._bindMessageControls();
                  this._scrollToBottom();
                }
                this._isStreaming = false;
                this._syncComposerStreaming();
                this._saveState();
                if (this._firstMessagePending) {
                  const trimmedTitle = userMsg.content.trim();
                  if (trimmedTitle) {
                    await this._updateConversationTitle(trimmedTitle);
                  }
                  this._firstMessagePending = false;
                }
                this._refreshSidebarAfterMessage();
                this.setRobotState("responding");
                return;
              } else if (event.artifacts || event.artifact) {
                botMsg.artifacts = event.artifacts || (Array.isArray(event.artifact) ? event.artifact : [event.artifact]);
                const msgEl = document.querySelector(`[data-msg-id="${botMsg.id}"]`);
                if (msgEl) {
                  msgEl.innerHTML = this._renderMessage(botMsg);
                  this._bindMessageControls();
                }
              } else if (event.content) {
                botContent += event.content;
                this._updateBotMessage(botMsg.id, botContent, true);
                this._scrollToBottom();
              }
            } catch (e) {
              console.warn("SSE parse error:", e.message, "for:", jsonStr.slice(0, 100));
            }
          }
          break;
        }
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line === "data:") continue;
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;
          try {
            const event = JSON.parse(jsonStr);
            if (event.error && event.error.type === "empty_response") {
              this._updateBotMessage(botMsg.id, "", false);
              this._isStreaming = false;
              this._syncComposerStreaming();
              this._saveState();
              this._bindMessageControls();
              this._scrollToBottom();
              if (this._firstMessagePending) {
                this._firstMessagePending = false;
              }
              this._refreshSidebarAfterMessage();
              return;
} else if (event.error) {
              this._updateBotMessage(botMsg.id, "", true, event.error);
              this._isStreaming = false;
              this._syncComposerStreaming();
              botMsg.streaming = false;
              botMsg.error = event.error;
              const errEl = document.querySelector(`[data-msg-id="${botMsg.id}"]`);
              if (errEl) {
                errEl.innerHTML = this._renderMessage(botMsg);
                this._bindMessageControls();
                this._renderErrorActions(errEl, event.error, botMsg.id, false);
              }
              this._scrollToBottom();
              return;
            } else if (event.type === "agent_state") {
              botMsg.agent_state = event;
              if (event.intent) botMsg.intent = event.intent;
              this._updateAgentExecutionRow(botMsg.id, event.steps, event.currentStep, event.status, event.intent || botMsg.intent);
              this._scrollToBottom();
            } else if (event.done) {
              if (event.content) botContent += event.content;
              if (event.fullContent) botContent = event.fullContent;
              if (event.attachments) botAttachments = event.attachments;
              if (event.artifacts) {
                botMsg.artifacts = event.artifacts;
              } else if (event.artifact) {
                botMsg.artifacts = Array.isArray(event.artifact) ? event.artifact : [event.artifact];
              }
              if (event.intent) botMsg.intent = event.intent;
              botMsg.content = botContent;
              botMsg.streaming = false;
              delete botMsg.agent_state;
              botMsg.attachments = botAttachments;
              const msgEl = document.querySelector(`[data-msg-id="${botMsg.id}"]`);
              if (msgEl) {
                msgEl.querySelector(".agent-transient-activity")?.remove();
                msgEl.querySelector(".agent-execution-row")?.remove();
                msgEl.innerHTML = this._renderMessage(botMsg);
                this._bindMessageControls();
                this._scrollToBottom();
                if (userWantsReadAloud || localStorage.getItem("darkness_auto_read_aloud") === "true") {
                  setTimeout(() => {
                    const targetMsgEl = document.querySelector(`[data-msg-id="${botMsg.id}"]`);
                    if (targetMsgEl && window.Darkness.narrationSync) {
                      window.Darkness.narrationSync.startReadAloud(botMsg.id, targetMsgEl);
                    }
                  }, 400);
                }
              }
              this._isStreaming = false;
              this._syncComposerStreaming();
              this._saveState();
              if (this._firstMessagePending) {
                const trimmedTitle = userMsg.content.trim();
                if (trimmedTitle) {
                  await this._updateConversationTitle(trimmedTitle);
                }
                this._firstMessagePending = false;
              }
              this._refreshSidebarAfterMessage();
              return;
            } else if (event.artifacts || event.artifact) {
              botMsg.artifacts = event.artifacts || (Array.isArray(event.artifact) ? event.artifact : [event.artifact]);
              const msgEl = document.querySelector(`[data-msg-id="${botMsg.id}"]`);
              if (msgEl) {
                msgEl.innerHTML = this._renderMessage(botMsg);
                this._bindMessageControls();
              }
            } else if (event.content) {
              botContent += event.content;
              this._updateBotMessage(botMsg.id, botContent, true);
              this._scrollToBottom();
            }
          } catch (e) {
            console.warn("SSE parse error:", e.message, "for:", jsonStr.slice(0, 100));
          }
        }
      }
} catch (err) {
      if (err.name === "AbortError") return;
      const errInfo = {
        message: err.message || "Connection failed",
        type: err.type || "network_error",
        status: err.status,
      };
      this._updateBotMessage(botMsg.id, errInfo.message, false, errInfo);
      this._isStreaming = false;
      this._syncComposerStreaming();
      botMsg.streaming = false;
      botMsg.error = errInfo;
      const errEl = document.querySelector(`[data-msg-id="${botMsg.id}"]`);
      if (errEl) {
        errEl.innerHTML = this._renderMessage(botMsg);
        this._bindMessageControls();
        this._renderErrorActions(errEl, errInfo, botMsg.id, false);
      }
      this._scrollToBottom();
    } finally {
      this._abortController = null;
    }
  },

  _updateBotMessage(msgId, content, isStreaming, error, attachments) {
    const el = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (!el) return;
    const streaming = isStreaming;
    el.classList.toggle("is-streaming", streaming);

    const contentEl = el.querySelector(".message__content");
    if (contentEl) {
      if (error) {
        contentEl.innerHTML = this._renderErrorBlock(error);
        contentEl.classList.add("message__content--error");
      } else {
        contentEl.classList.remove("message__content--error");
        if (!content && !streaming) {
          contentEl.innerHTML = '<div class="message__empty">No response generated.</div>';
        } else {
          let html = window.Darkness.markdown.render(content);
          if (streaming) html += '<span class="cursor"></span>';
          contentEl.innerHTML = html;

          if (!streaming && window.Darkness && window.Darkness.renderMermaid) {
            window.Darkness.renderMermaid(contentEl);
          }
          if (window.Darkness && window.Darkness.renderKaTeX) {
            window.Darkness.renderKaTeX(contentEl);
          }
        }
      }
    }

    const attachmentsContainer = el.querySelector(".message__attachments");
    if (attachments && attachments.length) {
      const attachmentsHtml = '<div class="attachments">' + attachments.map(att => this._renderFileAttachment(att)).join("") + "</div>";
      if (attachmentsContainer) {
        attachmentsContainer.innerHTML = attachmentsHtml;
      } else {
        const bubble = el.querySelector(".message__bubble");
        if (bubble) {
          bubble.insertAdjacentHTML("beforeend", attachmentsHtml);
        }
      }
    }

    const statusDot = el.querySelector(".message__status");
    if (statusDot) {
      if (error) {
        statusDot.className = "message__status status--error";
      } else if (streaming) {
        statusDot.className = "message__status status--streaming";
      } else {
        statusDot.style.display = "none";
      }
    }

    if (error) {
      el.classList.add("message--error");
    } else {
      el.classList.remove("message--error");
    }

    this._renderErrorActions(el, error, msgId, isStreaming);
  },

  _renderErrorBlock(error) {
    const e = error || {};
    const type = e.type || "chat_error";
    const friendly = this._friendlyError(type, e.message || "Something went wrong.");
    return [
      '<div class="error-block">',
      '<div class="error-block__icon" aria-hidden="true">',
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      '</div>',
      '<div class="error-block__body">',
      '<div class="error-block__title">' + window.Darkness.utils.escapeHtml(friendly.title) + '</div>',
      '<div class="error-block__detail">' + window.Darkness.utils.escapeHtml(friendly.detail) + '</div>',
      '</div>',
      '</div>'
    ].join("");
  },

  _friendlyError(type, raw) {
    const message = String(raw || "");
    if (type === "auth_error" || /invalid.*api key|api_key_invalid|permission_denied/i.test(message)) {
      return { title: "Authentication failed", detail: "The API key is invalid or missing. Update it in Models settings." };
    }
    if (type === "model_not_found" || /model .* not configured/i.test(message)) {
      return { title: "Model not available", detail: "The selected model is not configured. Open Models to choose or add one." };
    }
    if (/503|unavailable|high demand|spikes in demand|overloaded|capacity/i.test(message)) {
      return { title: "Model Provider High Demand", detail: message || "The AI model is temporarily experiencing high traffic spikes. Please click Retry in a few seconds." };
    }
    if (type === "http_error" || /HTTP 4\d\d|HTTP 5\d\d/.test(message)) {
      if (/400/.test(message)) return { title: "Request rejected", detail: "The model rejected the request. Check the model configuration or input." };
      if (/401|403/.test(message)) return { title: "Authentication failed", detail: "The API key is missing or invalid. Update it in Models." };
      if (/404/.test(message)) return { title: "Endpoint not found", detail: "The model URL or model ID is invalid. Check Models." };
      if (/429/.test(message)) return { title: "Rate limited", detail: "Too many requests. Wait a moment and try again." };
      if (/5\d\d/.test(message)) return { title: "Server error", detail: "The model provider returned a temporary error. Try again shortly." };
    }
    if (/image|vision|does not support.*image/i.test(message)) {
      return { title: "Model does not support images", detail: "This model cannot process images. Select a Vision-capable model (e.g. GPT-4o) to use image attachments." };
    }
    if (type === "network_error" || /failed to fetch|networkerror/i.test(message)) {
      return { title: "Connection failed", detail: "Could not reach the model. Check your network and try again." };
    }
    if (type === "abort") {
      return { title: "Stopped", detail: "Generation was stopped." };
    }
    return { title: "Unable to generate response", detail: message || "Try again or change the model." };
  },

  _renderErrorActions(msgEl, error, msgId, isStreaming) {
    if (!error) return;
    let bar = msgEl.querySelector(".message__error-actions");
    if (isStreaming) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "message__error-actions";
      const body = msgEl.querySelector(".message__body");
      if (body) body.appendChild(bar);
    }
    bar.innerHTML = "";
    const retry = document.createElement("button");
    retry.className = "btn btn--outline btn--sm";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => this._retry(msgId));
    bar.appendChild(retry);
  },

  _stopStreaming() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    this._isStreaming = false;
    this._syncComposerStreaming();
  },

  async _handleControl(action, msgId, convEl) {
    const msgEl = convEl.querySelector(`[data-msg-id="${msgId}"]`);
    if (!msgEl) return;
    const msg = {
      id: msgId,
      role: msgEl.classList.contains("message--user") ? "user" : "assistant",
      content: msgEl.querySelector(".message__content")?.textContent || "",
    };

    switch (action) {
      case "stop":
        this._stopStreaming();
        this._updateBotMessage(msgId, msg.content || "", false);
        break;
      case "copy":
        {
          const text = this._extractText(msgEl);
          try {
            await navigator.clipboard.writeText(text);
            window.Darkness.toast.show("Copied to clipboard", "success");
          } catch (e) {
            window.Darkness.toast.show("Copy failed", "danger");
          }
        }
        break;
      case "edit":
        if (msg.role === "user") this._handleEdit(msg, convEl);
        break;
      case "regenerate":
        await this._regenerate(msgId);
        break;
      case "retry":
        await this._retry(msgId);
        break;
      case "change-model":
        window.location.hash = "#/model";
        break;
      case "read-aloud":
        if (window.Darkness.narrationSync) {
          window.Darkness.narrationSync.toggleReadAloud(msgId, msgEl);
        }
        break;
    }
  },

  _extractText(element) {
    const content = element.querySelector(".message__content");
    if (!content) return "";
    const cells = content.querySelectorAll(".code-cell");
    if (cells.length > 0) {
      const clone = content.cloneNode(true);
      clone.querySelectorAll(".code-line__num, .code-cell__header, .code-cell__tabs, .code-cell__preview-wrap, .code-cell__footer").forEach(el => el.remove());
      return clone.textContent.trim();
    }
    const codeBlocks = content.querySelectorAll("pre code");
    if (codeBlocks.length > 0) {
      const texts = Array.from(codeBlocks).map(cb => cb.textContent);
      return texts.join("\n\n");
    }
    return content.textContent || "";
  },

  async _regenerate(msgId) {
    const cid = this._activeConversation;
    if (!cid) return;

    const msgs = await this._getMessagesFromDom();
    const botIndex = msgs.findIndex(m => m.id === msgId && m.role === "assistant");
    if (botIndex === -1) return;

    const toRemove = msgs.slice(botIndex);
    const convEl = document.getElementById("conversationList");
    for (const m of toRemove) {
      const el = convEl.querySelector(`[data-msg-id="${m.id}"]`);
      if (el) el.remove();
    }
    this._scrollToBottom();

    this._isStreaming = true;
    const botMsg = {
      role: "assistant",
      content: "",
      id: "bot_" + Date.now(),
      streaming: true,
    };
    convEl.insertAdjacentHTML("beforeend", this._renderMessage(botMsg));
    this._bindMessageControls();
    this._userScrolledUp = false;
    this._scrollToBottom(true);

    const userMsgs = msgs.filter(m => m.role === "user");
    const lastUser = userMsgs[userMsgs.length - 1];
    const file_ids = lastUser.attachments
      ? lastUser.attachments.filter(a => a.file_id).map(a => a.file_id)
      : [];

    const hasImages = lastUser.attachments && lastUser.attachments.some(a => a.type === "image");
    if (hasImages) {
      const modelId = this._resolveModelId();
      const caps = window.Darkness.modelSelector && window.Darkness.modelSelector.getCapabilities(modelId);
      if (!caps || !caps.vision) {
        this._isStreaming = false;
        this._syncComposerStreaming();
        window.Darkness.toast.show("This model does not support image input. Please select a Vision-capable model.", "danger");
        return;
      }
    }

    this._abortController = new AbortController();

    try {
      const response = await fetch(window.Darkness.api.base + `/api/conversations/${cid}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: this._resolveModelId(),
          file_ids,
          project_id: this._currentProject,
        }),
        signal: this._abortController.signal,
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let botContent = "";
      let botAttachments = [];
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          sseBuffer += decoder.decode(value, { stream: true });
        }
        if (done) {
          if (value) {
            sseBuffer += decoder.decode(value, { stream: false });
          }
          const lines = sseBuffer.split("\n");
          sseBuffer = "";
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line === "data:") continue;
            if (!line.startsWith("data:")) continue;
            const jsonStr = line.slice(5).trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;
            try {
              const event = JSON.parse(jsonStr);
              if (event.error && event.error.type === "empty_response") {
                this._updateBotMessage(botMsg.id, "", false);
                this._isStreaming = false;
                this._bindMessageControls();
                this._scrollToBottom();
                return;
} else if (event.error) {
                this._updateBotMessage(botMsg.id, "", false, event.error);
                this._isStreaming = false;
                botMsg.streaming = false;
                botMsg.error = event.error;
                const errEl = document.querySelector(`[data-msg-id="${botMsg.id}"]`);
                if (errEl) {
                  errEl.innerHTML = this._renderMessage(botMsg);
                  this._bindMessageControls();
                  this._renderErrorActions(errEl, event.error, botMsg.id, false);
                }
                return;
              } else if (event.done) {
                if (event.attachments) botAttachments = event.attachments;
                if (event.fullContent) botContent = event.fullContent;
                botMsg.content = botContent;
                botMsg.streaming = false;
                botMsg.attachments = botAttachments;
                const msgEl = document.querySelector(`[data-msg-id="${botMsg.id}"]`);
                if (msgEl) {
                  msgEl.innerHTML = this._renderMessage(botMsg);
                  this._bindMessageControls();
                  this._scrollToBottom();
                }
                this._isStreaming = false;
                return;
              } else if (event.content) {
                botContent += event.content;
                this._updateBotMessage(botMsg.id, botContent, true);
                this._scrollToBottom();
              }
            } catch (e) {}
          }
          break;
        }
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line === "data:") continue;
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;
          try {
            const event = JSON.parse(jsonStr);
            if (event.error && event.error.type === "empty_response") {
              this._updateBotMessage(botMsg.id, "", false);
              this._isStreaming = false;
              this._syncComposerStreaming();
              this._bindMessageControls();
              this._scrollToBottom();
              return;
} else if (event.error) {
              this._updateBotMessage(botMsg.id, "", false, event.error);
              this._isStreaming = false;
              this._syncComposerStreaming();
              botMsg.streaming = false;
              botMsg.error = event.error;
              const errEl = document.querySelector(`[data-msg-id="${botMsg.id}"]`);
              if (errEl) {
                errEl.innerHTML = this._renderMessage(botMsg);
                this._bindMessageControls();
                this._renderErrorActions(errEl, event.error, botMsg.id, false);
              }
              return;
            } else if (event.done) {
              if (event.attachments) botAttachments = event.attachments;
              if (event.fullContent) botContent = event.fullContent;
              botMsg.content = botContent;
              botMsg.streaming = false;
              botMsg.attachments = botAttachments;
              const msgEl = document.querySelector(`[data-msg-id="${botMsg.id}"]`);
              if (msgEl) {
                msgEl.innerHTML = this._renderMessage(botMsg);
                this._bindMessageControls();
                this._scrollToBottom();
              }
              this._isStreaming = false;
              return;
            } else if (event.content) {
              botContent += event.content;
              this._updateBotMessage(botMsg.id, botContent, true);
              this._scrollToBottom();
            }
          } catch (e) {}
        }
      }
} catch (err) {
      if (err.name === "AbortError") return;
      const errInfo = { message: err.message || "Connection failed", type: "network_error" };
      this._updateBotMessage(botMsg.id, errInfo.message, false, errInfo);
      this._isStreaming = false;
      this._syncComposerStreaming();
      botMsg.streaming = false;
      botMsg.error = errInfo;
      const errEl = document.querySelector(`[data-msg-id="${botMsg.id}"]`);
      if (errEl) {
        errEl.innerHTML = this._renderMessage(botMsg);
        this._bindMessageControls();
        this._renderErrorActions(errEl, errInfo, botMsg.id, false);
      }
    } finally {
      this._abortController = null;
    }
  },

  _retry(msgId) {
    const el = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (el && el.classList.contains("message--error")) {
      el.classList.remove("message--error");
      this._regenerate(msgId);
    }
  },

  _handleEdit(msg, convEl) {
    const msgEl = convEl.querySelector(`[data-msg-id="${msg.id}"]`);
    if (!msgEl) return;
    const bubble = msgEl.querySelector(".message__bubble");
    if (!bubble) return;

    if (msgEl.classList.contains("message--editing")) return;

    const originalAttachments = msg.attachments || [];
    const originalContent = (msgEl.querySelector(".message__content")?.textContent || "").trim();

    msgEl.classList.add("message--editing");

    const wrapper = document.createElement("div");
    wrapper.className = "edit-wrapper";
    wrapper.innerHTML = `
      <textarea class="edit-textarea" rows="1" aria-label="Edit message" placeholder="Edit your message..."></textarea>
      <div class="edit-buttons">
        <button class="btn btn--ghost btn--sm edit-btn-cancel" type="button" data-edit-action="cancel">Cancel</button>
        <button class="btn btn--primary btn--sm edit-btn-save" type="button" data-edit-action="save">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          Save &amp; Resend
        </button>
      </div>
    `;
    const textarea = wrapper.querySelector("textarea");
    textarea.value = msg.content || originalContent;

    const originalContentHtml = bubble.innerHTML;
    bubble.innerHTML = "";
    bubble.appendChild(wrapper);

    const autoResize = () => {
      textarea.style.height = "auto";
      textarea.style.height = Math.max(42, Math.min(textarea.scrollHeight, 400)) + "px";
    };

    textarea.addEventListener("input", autoResize);
    requestAnimationFrame(() => {
      autoResize();
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });

    const cleanup = () => {
      msgEl.classList.remove("message--editing");
      bubble.innerHTML = originalContentHtml;
    };

    const saveAndResend = async () => {
      const newValue = textarea.value.trim();
      if (!newValue) return;
      msgEl.classList.remove("message--editing");
      bubble.innerHTML = window.Darkness.markdown ? window.Darkness.markdown.render(newValue) : `<div class="message__content">${newValue}</div>`;
      if (window.Darkness && window.Darkness.renderMermaid) {
        window.Darkness.renderMermaid(bubble);
      } else if (window.mermaid) {
        try { window.mermaid.run({ querySelector: '.mermaid' }).catch(()=>{}); } catch(e) {}
      }

      // Remove all subsequent downstream messages in DOM
      let nextEl = msgEl.nextElementSibling;
      while (nextEl) {
        const toRemove = nextEl;
        nextEl = nextEl.nextElementSibling;
        toRemove.remove();
      }

      const cid = this._activeConversation;
      if (cid) {
        try {
          await window.Darkness.api.post("/api/conversations/" + cid + "/messages/" + msg.id + "/edit", { content: newValue });
        } catch (e) { /* best effort */ }
      }

      this._regenerateAfterEdit(newValue, originalAttachments, msgEl);
    };

    wrapper.querySelector('[data-edit-action="cancel"]').addEventListener("click", cleanup);
    wrapper.querySelector('[data-edit-action="save"]').addEventListener("click", saveAndResend);

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveAndResend();
      }
    });
  },

  async _regenerateAfterEdit(newValue, attachments, msgEl) {
    const cid = this._activeConversation;
    if (!cid) return;

    const convEl = document.getElementById("conversationList");
    if (!convEl) return;

    if (msgEl) {
      let nextEl = msgEl.nextElementSibling;
      while (nextEl) {
        const toRemove = nextEl;
        nextEl = nextEl.nextElementSibling;
        toRemove.remove();
      }
    }

    const botMsg = {
      role: "assistant",
      content: "",
      id: "bot_" + Date.now(),
      streaming: true,
    };

    const botHtml = this._renderMessage(botMsg);
    if (msgEl && msgEl.parentNode) {
      msgEl.insertAdjacentHTML("afterend", botHtml);
    } else {
      convEl.insertAdjacentHTML("beforeend", botHtml);
    }

    this._bindMessageControls();
    this._scrollToBottom();

    const file_ids = attachments.filter(a => a.file_id).map(a => a.file_id);
    const projectId = attachments.find(a => a.type === "project")?.id || this._currentProject;

    const hasImages = attachments.some(a => a.type === "image");
    if (hasImages) {
      const modelId = this._resolveModelId();
      const caps = window.Darkness.modelSelector && window.Darkness.modelSelector.getCapabilities(modelId);
      if (!caps || !caps.vision) {
        this._isStreaming = false;
        this._syncComposerStreaming();
        window.Darkness.toast.show("This model does not support image input. Please select a Vision-capable model.", "danger");
        return;
      }
    }

    this._isStreaming = true;
    this._syncComposerStreaming();
    this._abortController = new AbortController();

    try {
      const response = await fetch(window.Darkness.api.base + `/api/conversations/${cid}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: this._resolveModelId(),
          file_ids,
          project_id: projectId,
          think: this._thinkModeActive || false,
        }),
        signal: this._abortController.signal,
        credentials: "include",
      });
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const txt = await response.text();
          if (txt) { try { detail = JSON.parse(txt).error || txt; } catch (e) { detail = txt; } }
        } catch (e) {}
        const err = new Error(detail);
        err.status = response.status;
        err.type = response.status === 404 ? "model_not_found" : "http_error";
        throw err;
      }
      await this._consumeStream(response, botMsg);
    } catch (err) {
      if (err.name !== "AbortError") {
        this._updateBotMessage(botMsg.id, "", true, {
          message: err.message || "Error",
          type: err.type || "network_error",
          status: err.status,
        });
      }
    } finally {
      this._isStreaming = false;
      this._syncComposerStreaming();
      this._abortController = null;
    }
  },

  async _consumeStream(response, botMsg) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let botContent = "";
    let botAttachments = [];
    let sseBuffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (value) {
          sseBuffer += decoder.decode(value, { stream: false });
        }
        const lines = sseBuffer.split("\n");
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line === "data:") continue;
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;
          try {
            const event = JSON.parse(jsonStr);
            if (event.error && event.error.type === "empty_response") {
              this._updateBotMessage(botMsg.id, "", false);
              this._isStreaming = false;
              this._syncComposerStreaming();
              this._bindMessageControls();
              this._scrollToBottom();
              this._refreshSidebarAfterMessage();
              return;
} else if (event.error) {
              this._updateBotMessage(botMsg.id, event.error.message || "Error", false, event.error);
              this._isStreaming = false;
              this._syncComposerStreaming();
              botMsg.streaming = false;
              botMsg.error = event.error;
              const errEl = document.querySelector(`[data-msg-id="${botMsg.id}"]`);
              if (errEl) {
                errEl.innerHTML = this._renderMessage(botMsg);
                this._bindMessageControls();
                this._renderErrorActions(errEl, event.error, botMsg.id, false);
              }
              return;
            } else if (event.done) {
              if (event.attachments) botAttachments = event.attachments;
              if (event.fullContent) botContent = event.fullContent;
              botMsg.content = botContent;
              botMsg.streaming = false;
              botMsg.attachments = botAttachments;
              const msgEl = document.querySelector(`[data-msg-id="${botMsg.id}"]`);
              if (msgEl) {
                msgEl.innerHTML = this._renderMessage(botMsg);
                this._bindMessageControls();
                this._scrollToBottom();
              }
              this._isStreaming = false;
              this._refreshSidebarAfterMessage();
              return;
            } else if (event.content) {
              botContent += event.content;
              this._updateBotMessage(botMsg.id, botContent, true);
              this._scrollToBottom();
            }
          } catch (e) {
            console.warn("SSE parse error:", e.message, "for:", jsonStr.slice(0, 100));
          }
        }
        break;
      }
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() || "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line === "data:") continue;
        if (!line.startsWith("data:")) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;
        try {
          const event = JSON.parse(jsonStr);
          if (event.error && event.error.type === "empty_response") {
            this._updateBotMessage(botMsg.id, "", false);
            this._isStreaming = false;
            this._bindMessageControls();
            this._scrollToBottom();
            this._refreshSidebarAfterMessage();
            return;
} else if (event.error) {
            this._updateBotMessage(botMsg.id, event.error.message || "Error", false, event.error);
            this._isStreaming = false;
            botMsg.streaming = false;
            botMsg.error = event.error;
            const errEl = document.querySelector(`[data-msg-id="${botMsg.id}"]`);
            if (errEl) {
              errEl.innerHTML = this._renderMessage(botMsg);
              this._bindMessageControls();
              this._renderErrorActions(errEl, event.error, botMsg.id, false);
            }
            return;
          } else if (event.done) {
            if (event.attachments) botAttachments = event.attachments;
            if (event.fullContent) botContent = event.fullContent;
            botMsg.content = botContent;
            botMsg.streaming = false;
            botMsg.attachments = botAttachments;
            const msgEl = document.querySelector(`[data-msg-id="${botMsg.id}"]`);
            if (msgEl) {
              msgEl.innerHTML = this._renderMessage(botMsg);
              this._bindMessageControls();
              this._scrollToBottom();
            }
            this._isStreaming = false;
            this._refreshSidebarAfterMessage();
            return;
          } else if (event.content) {
            botContent += event.content;
            this._updateBotMessage(botMsg.id, botContent, true);
            this._scrollToBottom();
          }
        } catch (e) {
          console.warn("SSE parse error:", e.message, "for:", jsonStr.slice(0, 100));
        }
      }
    }
  },

  _replaceUserMessage(msgId, newContent, convEl) {
    const el = convEl.querySelector(`[data-msg-id="${msgId}"] .message__content`);
    if (el) {
      el.innerHTML = window.Darkness.markdown.render(newContent);
      if (window.Darkness && window.Darkness.renderMermaid) {
        window.Darkness.renderMermaid(el);
      } else if (window.mermaid) {
        try { window.mermaid.run({ querySelector: '.mermaid' }).catch(()=>{}); } catch(e) {}
      }
      if (window.Darkness && window.Darkness.renderKaTeX) {
        window.Darkness.renderKaTeX(el);
      }
    }
  },

  _getMessagesFromDom() {
    const convEl = document.getElementById("conversationList");
    if (!convEl) return [];
    const msgs = [];
    convEl.querySelectorAll(".message").forEach(el => {
      const id = el.getAttribute("data-msg-id");
      const role = el.classList.contains("message--user") ? "user" : "assistant";
      const contentEl = el.querySelector(".message__content");
      const content = contentEl ? contentEl.textContent || contentEl.innerText || "" : "";
      msgs.push({ id, role, content });
    });
    return msgs;
  },

  _bindMessageControls(containerId = "conversationList") {
    const convEl = document.getElementById(containerId);
    if (!convEl) return;

    // Interactive Action Chips
    convEl.querySelectorAll(".action-chip").forEach(btn => {
      btn.removeEventListener("click", btn._chipHandler);
      btn._chipHandler = (e) => {
        e.stopPropagation();
        const prompt = btn.getAttribute("data-action-prompt");
        if (!prompt || btn.disabled) return;

        const parent = btn.closest(".message__suggested-actions");
        if (parent) {
          parent.querySelectorAll(".action-chip").forEach(c => {
            c.disabled = true;
            c.style.opacity = "0.5";
            c.style.cursor = "not-allowed";
          });
        }

        this.sendMessage(prompt);
      };
      btn.addEventListener("click", btn._chipHandler);
    });

    convEl.querySelectorAll(".message-control").forEach(btn => {
      btn.removeEventListener("click", btn._handler);
      const action = btn.getAttribute("data-action");
      const msgEl = btn.closest(".message");
      const msgId = msgEl.getAttribute("data-msg-id");
      btn._handler = (e) => {
        e.stopPropagation();
        this._handleControl(action, msgId, convEl);
      };
      btn.addEventListener("click", btn._handler);
    });

    convEl.querySelectorAll("[data-player-action]").forEach(btn => {
      btn.removeEventListener("click", btn._playerHandler);
      btn._playerHandler = (e) => {
        e.stopPropagation();
        const pAction = btn.getAttribute("data-player-action");
        const bar = btn.closest(".narration-player-bar");
        const controller = window.Darkness.speechController;
        if (!controller) return;

        if (pAction === "play-pause") {
          const state = controller.getState();
          if (state === "playing") {
            controller.pause();
          } else if (state === "paused") {
            controller.resume();
          }
        } else if (pAction === "stop") {
          controller.stop();
        } else if (pAction === "replay") {
          controller.replay();
        } else if (pAction === "preview") {
          const vSel = bar ? bar.querySelector('[data-player-action="voice"]') : null;
          controller.previewVoice(vSel ? vSel.value : null);
        }
      };
      if (btn.tagName === "SELECT") {
        btn.onchange = (e) => {
          const act = btn.getAttribute("data-player-action");
          if (act === "speed") {
            window.Darkness.speechController?.setSpeed(e.target.value);
          } else if (act === "voice") {
            window.Darkness.speechController?.setVoice(e.target.value);
          }
        };
      } else {
        btn.addEventListener("click", btn._playerHandler);
      }
    });

    convEl.querySelectorAll(".code-copy").forEach(btn => {
      btn.removeEventListener("click", btn._handler);
      btn._handler = (e) => {
        e.stopPropagation();
        const codeEl = btn.closest(".code-block").querySelector("code");
        const text = codeEl ? codeEl.textContent : "";
        navigator.clipboard.writeText(text).then(() => {
          window.Darkness.toast.show("Code copied", "success");
        });
      };
      btn.addEventListener("click", btn._handler);
    });

    convEl.querySelectorAll(".code-download").forEach(btn => {
      btn.removeEventListener("click", btn._handler);
      btn._handler = (e) => {
        e.stopPropagation();
        const codeBlock = btn.closest(".code-block");
        const lang = codeBlock.querySelector("code").className.match(/language-(\w+)/)?.[1] || "txt";
        const code = codeBlock.querySelector("code").textContent;
        const blob = new Blob([code], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `snippet.${lang}`;
        a.click();
        URL.revokeObjectURL(url);
      };
      btn.addEventListener("click", btn._handler);
    });

    // Image Lightbox buttons
    convEl.querySelectorAll(".image-lightbox-btn, .inline-generated-img").forEach(btn => {
      btn.removeEventListener("click", btn._imgLbHandler);
      btn._imgLbHandler = (e) => {
        e.stopPropagation();
        const url = btn.getAttribute("data-img-url") || btn.getAttribute("src");
        const title = btn.getAttribute("data-img-title") || btn.getAttribute("alt") || "Generated Image";
        this.openImageLightbox(url, title);
      };
      btn.addEventListener("click", btn._imgLbHandler);
    });

    // Image Regenerate buttons
    convEl.querySelectorAll(".image-regenerate-btn").forEach(btn => {
      btn.removeEventListener("click", btn._imgRegenHandler);
      btn._imgRegenHandler = (e) => {
        e.stopPropagation();
        const promptText = btn.getAttribute("data-prompt") || "Create a photorealistic image";
        this.sendMessage(`Create a new photorealistic image: ${promptText}`, []);
      };
      btn.addEventListener("click", btn._imgRegenHandler);
    });

    // Preview buttons for file attachments
    convEl.querySelectorAll(".file-preview-btn").forEach(btn => {
      btn.removeEventListener("click", btn._handler);
      btn._handler = (e) => {
        e.stopPropagation();
        const fileId = btn.getAttribute("data-file-id");
        const fileName = btn.getAttribute("data-file-name");
        // Fetch file content for preview
        fetch(window.Darkness.api.base + "/api/files/" + fileId + "/raw")
          .then(r => r.text())
          .then(text => {
            this._previewFile = { file_id: fileId, name: fileName, content: text, mime: "text/plain" };
            this._openFilePreview(this._previewFile);
          })
          .catch(err => {
            this._previewFile = { file_id: fileId, name: fileName, content: "", mime: "text/plain" };
            this._openFilePreview(this._previewFile);
          });
      };
      btn.addEventListener("click", btn._handler);
    });

    if (window.Darkness.artifact && window.Darkness.artifact.bindEvents) {
      window.Darkness.artifact.bindEvents(convEl);
    }

    // Batch download all artifacts ZIP
    convEl.querySelectorAll(".download-all-artifacts-btn").forEach(btn => {
      btn.removeEventListener("click", btn._batchDlHandler);
      btn._batchDlHandler = async (e) => {
        e.preventDefault();
        const idsStr = btn.getAttribute("data-art-ids") || "";
        const artifactIds = idsStr.split(",").filter(Boolean);
        if (!artifactIds.length) return;

        btn.disabled = true;
        const origText = btn.innerHTML;
        btn.innerHTML = "<span>Creating ZIP...</span>";

        try {
          const resp = await fetch("/api/artifacts/download-zip", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ artifactIds }),
          });

          if (!resp.ok) {
            throw new Error(`Server returned HTTP ${resp.status}`);
          }

          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `artifacts-${Date.now()}.zip`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          window.Darkness.toast.show(`Downloaded ${artifactIds.length} files as ZIP archive`, "success");
        } catch (err) {
          console.error("ZIP download failed:", err);
          window.Darkness.toast.show("ZIP download failed: " + err.message, "danger");
        } finally {
          btn.disabled = false;
          btn.innerHTML = origText;
        }
      };
      btn.addEventListener("click", btn._batchDlHandler);
    });

    // Batch apply all code artifacts to workspace
    convEl.querySelectorAll(".apply-all-artifacts-btn").forEach(btn => {
      btn.removeEventListener("click", btn._batchApplyHandler);
      btn._batchApplyHandler = async (e) => {
        e.preventDefault();
        const idsStr = btn.getAttribute("data-art-ids") || "";
        const artifactIds = idsStr.split(",").filter(Boolean);
        if (!artifactIds.length) return;

        btn.disabled = true;
        const origText = btn.innerHTML;
        btn.innerHTML = "<span>Applying all...</span>";

        let appliedCount = 0;
        let errors = 0;

        for (const id of artifactIds) {
          try {
            await window.Darkness.api.post(`/api/artifacts/${id}/apply`, {});
            appliedCount++;
            // Update individual card if present
            const card = document.getElementById(`art_${id}`);
            if (card) {
              const applyBtn = card.querySelector(".art-apply-btn");
              if (applyBtn) {
                applyBtn.textContent = "✓ Applied";
                applyBtn.classList.add("btn--outline");
              }
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
            errors++;
          }
        }

        btn.innerHTML = `✓ ${appliedCount} Applied`;
        btn.classList.add("btn--outline");
        if (appliedCount > 0) {
          window.Darkness.toast.show(`Applied ${appliedCount} files to project workspace!`, "success");
        } else if (errors > 0) {
          window.Darkness.toast.show("Failed to apply files to workspace", "danger");
        }
      };
      btn.addEventListener("click", btn._batchApplyHandler);
    });

    convEl.querySelectorAll(".message").forEach(msgEl => {
      msgEl.classList.remove("message--active");
      this._postProcessMessage(msgEl);
    });

    const clearActiveState = (e) => {
      if (!e.target.closest(".message") || e.target.closest(".composer")) {
        // (the old code used an undeclared `activeMessage` variable and threw on every outside tap)
        convEl.querySelectorAll(".message--active").forEach((el) => el.classList.remove("message--active"));
      }
    };
    document.removeEventListener("touchstart", clearActiveState);
    document.addEventListener("touchstart", clearActiveState, { passive: true });
  },

  _postProcessMessage(messageEl) {
    if (!messageEl) return;

    const contentEl = messageEl.querySelector(".message__content");
    if (!contentEl) return;

    const preElements = contentEl.querySelectorAll("pre");
    preElements.forEach(pre => {
      if (pre.closest(".code-cell") || pre.closest(".code-block")) {
        return;
      }

      if (pre.parentNode && pre.parentNode.classList.contains("pre-copy-container")) {
        return;
      }

      const isMermaid = pre.classList.contains("mermaid");

      const wrapper = document.createElement("div");
      wrapper.className = "pre-copy-container";

      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "pre-copy-btn";
      copyBtn.setAttribute("aria-label", "Copy code");
      copyBtn.title = "Copy code";

      copyBtn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>

      `;

      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();

        let text = pre.textContent || "";
        if (isMermaid && pre._rawMermaidCode) {
          text = pre._rawMermaidCode;
        }

        navigator.clipboard.writeText(text).then(() => {
          copyBtn.classList.add("pre-copy-btn--copied");
          const origHtml = copyBtn.innerHTML;
          copyBtn.innerHTML = `
            <svg class="icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
            <span>Copied ✓</span>
          `;
          if (window.Darkness && window.Darkness.toast) {
            window.Darkness.toast.show("Code copied", "success");
          }
          setTimeout(() => {
            copyBtn.classList.remove("pre-copy-btn--copied");
            copyBtn.innerHTML = origHtml;
          }, 2000);
        }).catch(err => {
          console.error("Failed to copy code block", err);
        });
      });

      wrapper.appendChild(copyBtn);
    });
  },

  _refreshSidebarAfterMessage() {
    if (window.Darkness.uiSidebar) {
      window.Darkness.uiSidebar.loadConversations().then(() => {
        window.Darkness.uiSidebar.render();
      });
    }
  },

  async _updateConversationTitle(title) {
    const cid = this._activeConversation;
    if (!cid || !title) return;
    try {
      await window.Darkness.api.patch(`/api/conversations/${cid}/title`, { title });
    } catch (err) {
      console.error("Failed to update conversation title:", err);
    }
  },

  _userScrolledUp: false,

  _bindScrollListener(convEl) {
    if (!convEl || convEl._scrollBound) return;
    convEl._scrollBound = true;
    convEl.addEventListener("scroll", () => {
      const distanceFromBottom = convEl.scrollHeight - convEl.scrollTop - convEl.clientHeight;
      this._userScrolledUp = distanceFromBottom > 80;

      const scrollHeight = convEl.scrollHeight - convEl.clientHeight;
      const progressPercent = scrollHeight > 0 ? (convEl.scrollTop / scrollHeight) * 100 : 0;
      const progressBar = document.getElementById("chatProgressBar");
      if (progressBar) {
        progressBar.style.width = progressPercent + "%";
      }
    }, { passive: true });
  },

  _scrollToBottom(force = false) {
    const convEl = document.querySelector(".conversation");
    if (convEl) {
      if (!force && this._userScrolledUp) {
        return;
      }
      convEl.scrollTop = convEl.scrollHeight;
    }
  },

  setModel(modelId, options) {
    const opts = options || {};
    this._activeModel = modelId || null;
    if (opts.persist !== false) this._saveState();
    if (window.Darkness.uiTopbar) {
      window.Darkness.uiTopbar.updateModelChip();
    }
  },

  clearConversation() {
    const cid = this._activeConversation;
    if (cid) {
      window.Darkness.api.del(`/api/conversations/${cid}`).then(() => {
        this._activeConversation = null;
        window.Darkness.store.remove("active_conversation");
        this.renderChat([{ role: "assistant", content: "Chat cleared. Start a new conversation or pick one from the sidebar." }]);
      });
    }
  },

  attachProject(projectId) {
    this._currentProject = projectId;
    this._saveState();
  },
};

window.Darkness.exportChatToPdf = function(opts) {
  return window.Darkness.uiChat.exportChatToPdf(opts);
};

