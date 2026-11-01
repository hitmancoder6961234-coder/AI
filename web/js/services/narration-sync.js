// Clarity Narration Segmenter & Synchronized Highlighting Engine
// Maps rendered educational explanations, code blocks, and math to readable verbal segments and synchronized visual focus across Project Assistant, Home Chat, and Knowledge Chat.

(function () {
  window.Clarity = window.Clarity || {};

  class NarrationSegmenter {
    /**
     * Converts a mathematical LaTeX expression into clean, conversational spoken text
     * @param {string} latex 
     */
    static naturalizeMath(latex) {
      if (!latex) return "";
      let s = String(latex);

      // Clean delimiters
      s = s.replace(/\$\$|\$/g, "");

      // Common LaTeX replacements
      s = s.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "$1 divided by $2");
      s = s.replace(/\\sqrt\{([^}]+)\}/g, "square root of $1");
      s = s.replace(/\\cdot|\\times/g, " times ");
      s = s.replace(/\\div/g, " divided by ");
      s = s.replace(/\\pm/g, " plus or minus ");
      s = s.replace(/\\leq|\\le/g, " less than or equal to ");
      s = s.replace(/\\geq|\\ge/g, " greater than or equal to ");
      s = s.replace(/\\neq|\\ne/g, " not equal to ");
      s = s.replace(/\\approx/g, " approximately ");
      s = s.replace(/\\infty/g, " infinity ");
      s = s.replace(/\\sum_\{([^}]+)\}\^\{([^}]+)\}/g, "sum from $1 to $2 of ");
      s = s.replace(/\\sum/g, "sum of ");
      s = s.replace(/\\prod/g, "product of ");
      s = s.replace(/\\int/g, "integral of ");
      s = s.replace(/\\log_\{([^}]+)\}/g, "log base $1 of ");
      s = s.replace(/\\ln/g, "natural log of ");
      s = s.replace(/\\boxed\{([^}]+)\}/g, "final answer: $1");

      // Super/sub-scripts
      s = s.replace(/\^2\b/g, " squared ");
      s = s.replace(/\^3\b/g, " cubed ");
      s = s.replace(/\^\{([^}]+)\}/g, " to the power of $1 ");
      s = s.replace(/\^([a-zA-Z0-9])/g, " to the power of $1 ");
      s = s.replace(/_\{([^}]+)\}/g, " sub $1 ");
      s = s.replace(/_([a-zA-Z0-9])/g, " sub $1 ");

      // Greek letters & notations
      s = s.replace(/\\Theta/g, "Big Theta");
      s = s.replace(/\\Omega/g, "Big Omega");
      s = s.replace(/\\alpha/g, "alpha");
      s = s.replace(/\\beta/g, "beta");
      s = s.replace(/\\gamma/g, "gamma");
      s = s.replace(/\\delta/g, "delta");
      s = s.replace(/\\pi/g, "pi");
      s = s.replace(/\\lambda/g, "lambda");
      s = s.replace(/\\sigma/g, "sigma");
      s = s.replace(/\\dots|\\cdots/g, "and so on");

      // Clean remaining backslashes
      s = s.replace(/\\[a-zA-Z]+/g, " ");
      s = s.replace(/[\{\}]/g, "");
      s = s.replace(/\s+/g, " ").trim();
      return s;
    }

    /**
     * Converts a line of source code into natural spoken text (human professor reading)
     * @param {string} codeLine 
     * @returns {string}
     */
    static naturalizeCode(codeLine) {
      if (!codeLine) return "";
      let s = String(codeLine).trim();

      // Comments
      if (s.startsWith("//") || s.startsWith("#")) {
        return "Comment: " + s.replace(/^(\/\/|#)\s*/, "");
      }

      // Readable operators
      s = s.replace(/===|==/g, " equals ");
      s = s.replace(/!==|!=/g, " is not equal to ");
      s = s.replace(/<=/g, " is less than or equal to ");
      s = s.replace(/>=/g, " is greater than or equal to ");
      s = s.replace(/=>/g, " arrow ");
      s = s.replace(/&&/g, " and ");
      s = s.replace(/\|\|/g, " or ");
      s = s.replace(/\+\+/g, " increment ");
      s = s.replace(/--/g, " decrement ");
      s = s.replace(/\+=/g, " plus equals ");
      s = s.replace(/-=/g, " minus equals ");
      s = s.replace(/const\s+/g, "constant ");
      s = s.replace(/let\s+/g, "variable ");
      s = s.replace(/var\s+/g, "variable ");
      s = s.replace(/function\s+/g, "function ");
      s = s.replace(/return\s+/g, "return ");
      s = s.replace(/import\s+/g, "import ");
      s = s.replace(/export\s+/g, "export ");
      s = s.replace(/async\s+/g, "async ");
      s = s.replace(/await\s+/g, "await ");

      // Split camelCase & snake_case identifiers into separate words for natural phonetics
      s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
      s = s.replace(/_/g, " ");

      // Remove distracting brackets and semicolons
      s = s.replace(/[{};]/g, " ");
      s = s.replace(/\s+/g, " ").trim();
      return s;
    }

    /**
     * Cleans raw text for speech (expands common programming abbreviations, removes markdown markers)
     * @param {string} text 
     */
    static cleanTextForSpeech(text) {
      if (!text) return "";
      let s = String(text);

      // Remove raw Markdown headings and bold/italic markers if any leaked
      s = s.replace(/#{1,6}\s+/g, "");
      s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
      s = s.replace(/\*([^*]+)\*/g, "$1");
      s = s.replace(/__([^_]+)__/g, "$1");
      s = s.replace(/`([^`]+)`/g, "$1");

      // Expand common math & technical abbreviations for natural speech
      s = s.replace(/\bO\(1\)/g, "Big O of 1");
      s = s.replace(/\bO\(n\)/g, "Big O of n");
      s = s.replace(/\bO\(n\^2\)/g, "Big O of n squared");
      s = s.replace(/\bO\(log\s*n\)/gi, "Big O of log n");
      s = s.replace(/\bO\(n\s*log\s*n\)/gi, "Big O of n log n");
      s = s.replace(/\bi\.e\./gi, "that is");
      s = s.replace(/\be\.g\./gi, "for example");
      s = s.replace(/\betc\./gi, "etcetera");
      s = s.replace(/\bvs\./gi, "versus");
      s = s.replace(/\bAI\b/g, "A.I.");
      s = s.replace(/\bAPI\b/g, "A.P.I.");
      s = s.replace(/\bUI\b/g, "U.I.");
      s = s.replace(/\bUX\b/g, "U.X.");
      s = s.replace(/\bHTML\b/g, "H.T.M.L.");
      s = s.replace(/\bCSS\b/g, "C.S.S.");
      s = s.replace(/\bJS\b/g, "JavaScript");
      s = s.replace(/\bTS\b/g, "TypeScript");
      s = s.replace(/\bSQL\b/g, "Sequel");

      // Remove URLs
      s = s.replace(/https?:\/\/\S+/g, "link");
      s = s.replace(/\s+/g, " ").trim();
      return s;
    }

    /**
     * Segments a message container into semantic readable sections with language tagging
     * @param {HTMLElement} container 
     * @returns {Array<{text: string, element: HTMLElement, type: string, lineIndex?: number, lang?: string, tag?: string}>}
     */
    static segmentContainer(container) {
      if (!container) return [];
      const segments = [];

      // Find all top-level semantic content nodes
      const elements = Array.from(container.querySelectorAll(
        "h1, h2, h3, h4, p, li, blockquote, .code-cell, pre, .katex-display, .math-display, tr, .project-chat-diagram-box, .code-change-proposal"
      ));

      if (elements.length === 0) {
        // Fallback if no matching sub-elements found
        const text = NarrationSegmenter.cleanTextForSpeech(container.textContent || "");
        if (text) {
          const detected = window.Clarity?.LanguageDetector?.detect(text) || { lang: "en", tag: "en-US" };
          segments.push({
            text,
            element: container,
            type: "paragraph",
            lang: detected.lang,
            tag: detected.tag
          });
        }
        return segments;
      }

      elements.forEach((el) => {
        // Skip hidden elements, buttons, control bars, or edit textareas
        if (
          el.closest(".project-chat-msg-actions") ||
          el.closest(".project-chat-edit-wrapper") ||
          el.closest(".message__controls") ||
          el.closest(".narration-player-bar") ||
          el.closest(".code-file-card__actions") ||
          el.closest(".code-cell__actions") ||
          el.closest("button") ||
          el.closest("nav") ||
          el.hasAttribute("hidden") ||
          el.style.display === "none"
        ) {
          return;
        }

        // Avoid duplicate parent/child additions
        if (el.tagName === "P" && el.closest("li")) {
          return;
        }

        const tag = el.tagName.toLowerCase();

        // 1. Math Display Formulas
        if (el.classList.contains("katex-display") || el.classList.contains("math-display")) {
          const rawMath = el.getAttribute("data-raw-math") || el.textContent || "";
          const natural = NarrationSegmenter.naturalizeMath(rawMath);
          if (natural) {
            segments.push({
              text: "Formula: " + natural,
              element: el,
              type: "math",
              lang: "en",
              tag: "en-US",
            });
          }
          return;
        }

        // 2. Code Cells or Preformatted Code Blocks
        if (el.classList.contains("code-cell") || tag === "pre") {
          if (tag === "pre" && el.closest(".code-cell")) return;
          if (el.classList.contains("mermaid")) {
            segments.push({
              text: "Visual architecture and workflow diagram.",
              element: el,
              type: "diagram",
              lang: "en",
              tag: "en-US",
            });
            return;
          }

          const filename = el.getAttribute("data-filename") || el.querySelector(".code-file-card__filename")?.textContent?.trim() || "code snippet";
          const codeLines = el.querySelectorAll(".code-line, tr");
          if (codeLines.length > 0) {
            segments.push({
              text: `Code file ${filename}:`,
              element: el,
              type: "code-header",
              lang: "en",
              tag: "en-US"
            });
            codeLines.forEach((lineEl, idx) => {
              const codeText = NarrationSegmenter.naturalizeCode(lineEl.textContent || "");
              if (codeText.length > 0) {
                segments.push({
                  text: codeText,
                  element: lineEl,
                  type: "code",
                  lineIndex: idx + 1,
                  lang: "en",
                  tag: "en-US"
                });
              }
            });
          } else {
            const rawCode = el.textContent || "";
            const lines = rawCode.split("\n").map(l => NarrationSegmenter.naturalizeCode(l)).filter(l => l.length > 0);
            segments.push({
              text: `Code block ${filename}: ` + lines.slice(0, 5).join(". "),
              element: el,
              type: "code",
              lang: "en",
              tag: "en-US"
            });
          }
          return;
        }

        // 3. Standard Headings, Paragraphs, Lists, Blockquotes
        let raw = el.textContent || "";
        raw = raw.replace(/\s+/g, " ").trim();
        const cleaned = NarrationSegmenter.cleanTextForSpeech(raw);

        if (cleaned.length > 0) {
          const detected = window.Clarity?.LanguageDetector?.detect(cleaned) || { lang: "en", tag: "en-US" };

          // Split long paragraphs into sentences for responsive visual highlighting
          if (tag === "p" && cleaned.length > 160) {
            const sentences = cleaned.match(/[^.!?।]+[.!?।]+(\s|$)/g) || [cleaned];
            sentences.forEach((sentence) => {
              const sTrim = sentence.trim();
              if (sTrim) {
                const sLang = window.Clarity?.LanguageDetector?.detect(sTrim) || detected;
                segments.push({
                  text: sTrim,
                  element: el,
                  type: "paragraph",
                  lang: sLang.lang,
                  tag: sLang.tag,
                });
              }
            });
          } else {
            segments.push({
              text: cleaned,
              element: el,
              type: tag.startsWith("h") ? "heading" : tag === "li" ? "list-item" : "paragraph",
              lang: detected.lang,
              tag: detected.tag,
            });
          }
        }
      });

      return segments;
    }
  }

  class NarrationSync {
    constructor() {
      this.controller = window.Clarity.speechController;
      this.currentActiveElement = null;
      this.currentCodeLineElement = null;
      this.activeMessageId = null;

      this._bindController();
    }

    _bindController() {
      if (!this.controller) return;

      this.controller.on("segment-start", (data) => {
        const { msgId, segment, lang } = data;
        this.activeMessageId = msgId;
        this.highlightSegment(msgId, segment, lang);
      });

      this.controller.on("segment-end", () => {
        // Smooth transition
      });

      this.controller.on("playback-stopped", () => {
        this.clearHighlights();
      });

      this.controller.on("state-change", ({ state, msgId }) => {
        if (msgId) {
          this._updateMessageControlState(msgId, state);
        }
      });
    }

    highlightSegment(msgId, seg, segLang) {
      if (!seg) return;

      // Clear previous section highlight
      if (this.currentActiveElement && this.currentActiveElement !== seg.element) {
        this.currentActiveElement.classList.remove("narration-active-segment", "narration-paused");
      }
      if (this.currentCodeLineElement && this.currentCodeLineElement !== seg.element) {
        this.currentCodeLineElement.classList.remove("narration-active-code-line");
      }

      const el = seg.element;
      if (el) {
        el.classList.add("narration-active-segment");
        this.currentActiveElement = el;

        if (seg.type === "code" || seg.lineIndex) {
          el.classList.add("narration-active-code-line");
          this.currentCodeLineElement = el;

          if (window.Clarity.visualLearningPanel && typeof window.Clarity.visualLearningPanel.highlightLine === "function") {
            window.Clarity.visualLearningPanel.highlightLine(seg.lineIndex);
          }
        }

        try {
          const rect = el.getBoundingClientRect();
          const isInView = rect.top >= 80 && rect.bottom <= (window.innerHeight - 100);
          if (!isInView) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        } catch (e) {}
      }

      this._updateMessageControlState(msgId, "playing", segLang);
    }

    clearHighlights() {
      document.querySelectorAll(".narration-active-segment, .narration-paused").forEach((el) => {
        el.classList.remove("narration-active-segment", "narration-paused");
      });
      document.querySelectorAll(".narration-active-code-line").forEach((el) => {
        el.classList.remove("narration-active-code-line");
      });
      this.currentActiveElement = null;
      this.currentCodeLineElement = null;

      if (this.activeMessageId) {
        this._updateMessageControlState(this.activeMessageId, "stopped");
      }
    }

    _updateMessageControlState(msgId, state, segLang) {
      if (!msgId) return;
      const msgEl = document.querySelector(`[data-msg-id="${msgId}"]`);
      if (!msgEl) return;

      const playerBar = msgEl.querySelector(".narration-player-bar");
      const readAloudBtn = msgEl.querySelector('[data-action="read-aloud"]') || msgEl.querySelector(".project-chat-action-read-aloud");

      if (state === "playing" || state === "paused") {
        if (readAloudBtn) readAloudBtn.classList.add("is-active");
        if (playerBar) {
          playerBar.hidden = false;
          playerBar.style.display = "flex";

          const playPauseBtn = playerBar.querySelector('[data-player-action="play-pause"]');
          if (playPauseBtn) {
            playPauseBtn.setAttribute("data-state", state);
            playPauseBtn.innerHTML = state === "playing"
              ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg><span>Pause</span>'
              : '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Resume</span>';
          }

          const statusText = playerBar.querySelector(".narration-player-status");
          if (statusText) {
            const langName = (segLang && segLang.name) || (this.controller.detectedLanguage && this.controller.detectedLanguage.name) || "Natural Voice";
            statusText.textContent = state === "playing" ? `Speaking in ${langName}...` : "Paused";
          }

          const voiceSelect = playerBar.querySelector('[data-player-action="voice"]');
          if (voiceSelect && voiceSelect.children.length <= 1) {
            const detectedCode = (segLang && segLang.lang) || (this.controller.detectedLanguage && this.controller.detectedLanguage.lang) || "en";
            const candidateVoices = this.controller.getVoicesForLanguage(detectedCode);
            if (candidateVoices.length > 0) {
              voiceSelect.innerHTML = candidateVoices.map((v) => {
                const isSel = v.voiceURI === this.controller.activeVoiceUri || v.name === this.controller.activeVoiceUri;
                const cleanName = v.name.replace(/Microsoft |Google |English |Hindi |Marathi /gi, "").trim() + ` (${v.lang})`;
                return `<option value="${window.Clarity.utils.escapeHtml(v.voiceURI)}" ${isSel ? "selected" : ""}>${window.Clarity.utils.escapeHtml(cleanName)}</option>`;
              }).join("");
            }
          }
        }
      } else {
        if (readAloudBtn) readAloudBtn.classList.remove("is-active");
        if (playerBar) {
          playerBar.hidden = true;
          playerBar.style.display = "none";
        }
      }
    }

    toggleReadAloud(msgId, messageEl) {
      if (!this.controller.isSupported()) {
        if (window.Clarity.toast) {
          window.Clarity.toast.show("Voice narration is not supported in this browser.", "warning");
        }
        return;
      }

      if (this.controller.getActiveMessageId() === msgId) {
        const state = this.controller.getState();
        if (state === "playing") {
          this.controller.pause();
          this._updateMessageControlState(msgId, "paused");
        } else if (state === "paused") {
          this.controller.resume();
          this._updateMessageControlState(msgId, "playing");
        } else {
          this.startReadAloud(msgId, messageEl);
        }
        return;
      }

      this.startReadAloud(msgId, messageEl);
    }

    startReadAloud(msgId, messageEl) {
      if (!messageEl) {
        messageEl = document.querySelector(`[data-msg-id="${msgId}"]`);
      }
      if (!messageEl) return;

      const contentEl = messageEl.querySelector(".project-chat-msg-body") || messageEl.querySelector(".message__content") || messageEl;
      const segments = NarrationSegmenter.segmentContainer(contentEl);

      if (!segments.length) {
        if (window.Clarity.toast) {
          window.Clarity.toast.show("No readable text found in this response.", "info");
        }
        return;
      }

      if (!messageEl.querySelector(".narration-player-bar")) {
        const tempDiv = document.createElement("div");
        const detectedTag = segments[0]?.tag || "en-US";
        tempDiv.innerHTML = this.renderPlayerBarHtml(msgId, detectedTag);
        const playerBarEl = tempDiv.firstElementChild;
        if (playerBarEl) {
          messageEl.appendChild(playerBarEl);
          this.bindPlayerBarEvents(playerBarEl, msgId);
        }
      }

      const voiceSelect = messageEl.querySelector('[data-player-action="voice"]');
      const preferredVoice = voiceSelect ? voiceSelect.value : null;

      this.controller.play(msgId, segments, 0, preferredVoice);
      this._updateMessageControlState(msgId, "playing", this.controller.detectedLanguage);

      if (window.Clarity.toast) {
        const langName = this.controller.detectedLanguage?.name || "English";
        window.Clarity.toast.show(`AI Professor reading explanation in ${langName}`, "info");
      }
    }

    renderPlayerBarHtml(msgId, detectedLangTag = "en") {
      const currentSpeed = this.controller.getSpeed() || 1.0;
      const voices = this.controller.getVoicesForLanguage(detectedLangTag);
      const voiceOptions = voices.map((v) => {
        const cleanName = v.name.replace(/Microsoft |Google /gi, "").trim();
        return `<option value="${window.Clarity.utils.escapeHtml(v.voiceURI)}">${window.Clarity.utils.escapeHtml(cleanName)} (${v.lang})</option>`;
      }).join("");

      return `
        <div class="narration-player-bar" hidden style="display:none;" data-player-msg-id="${msgId}">
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
            <select class="narration-speed-select" data-player-action="speed" title="Playback Speed">
              <option value="0.75" ${currentSpeed === 0.75 ? "selected" : ""}>0.75x</option>
              <option value="1.0" ${currentSpeed === 1.0 ? "selected" : ""}>1.0x</option>
              <option value="1.25" ${currentSpeed === 1.25 ? "selected" : ""}>1.25x</option>
              <option value="1.5" ${currentSpeed === 1.5 ? "selected" : ""}>1.5x</option>
              <option value="2.0" ${currentSpeed === 2.0 ? "selected" : ""}>2.0x</option>
            </select>
            <select class="narration-voice-select" data-player-action="voice" title="Select Voice">
              ${voiceOptions || '<option value="">Default Voice</option>'}
            </select>
            <button type="button" class="narration-player-btn" data-player-action="preview" title="Preview selected voice">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
              <span>Preview</span>
            </button>
            <span class="narration-player-status">Playing...</span>
          </div>
        </div>
      `;
    }

    bindPlayerBarEvents(container, msgId) {
      if (!container) return;

      container.querySelectorAll("[data-player-action]").forEach((btn) => {
        if (btn._playerBound) return;
        btn._playerBound = true;

        if (btn.tagName === "SELECT") {
          btn.addEventListener("change", (e) => {
            e.stopPropagation();
            const action = btn.getAttribute("data-player-action");
            if (action === "speed") {
              this.controller.setSpeed(btn.value);
            } else if (action === "voice") {
              this.controller.setVoice(btn.value);
            }
          });
        } else {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const action = btn.getAttribute("data-player-action");
            if (action === "play-pause") {
              const state = this.controller.getState();
              if (state === "playing") {
                this.controller.pause();
                this._updateMessageControlState(msgId, "paused");
              } else if (state === "paused") {
                this.controller.resume();
                this._updateMessageControlState(msgId, "playing");
              } else {
                this.startReadAloud(msgId, container.closest(`[data-msg-id="${msgId}"]`));
              }
            } else if (action === "stop") {
              this.controller.stop();
            } else if (action === "replay") {
              this.controller.replay();
            } else if (action === "preview") {
              const playerBar = btn.closest(".narration-player-bar");
              const voiceSelect = playerBar ? playerBar.querySelector('[data-player-action="voice"]') : null;
              const voiceUri = voiceSelect ? voiceSelect.value : null;
              if (voiceUri) {
                this.controller.previewVoice(voiceUri);
              } else {
                this.controller.previewVoice(this.controller.selectedVoiceUri);
              }
            }
          });
        }
      });
    }
  }

  window.Clarity.NarrationSegmenter = NarrationSegmenter;
  window.Clarity.narrationSync = new NarrationSync();
})();
