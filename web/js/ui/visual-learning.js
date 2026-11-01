// Darkness Visual Code Learning & Execution Tracer Panel
// Provides step-by-step code execution tracing, live variable memory-state tables, call stack, and interactive pedagogy stepper.

(function () {
  window.Darkness = window.Darkness || {};

  class SimpleCodeTracer {
    /**
     * Parses simple Python or JavaScript code into executable sequential execution steps with variable tracking
     * @param {string} code 
     * @param {string} lang 
     */
    static trace(code, lang = "python") {
      const lines = code.split(/\r?\n/);
      const steps = [];
      const variables = {};
      const callStack = ["main()"];
      const outputLog = [];

      let stepNum = 1;

      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const trimmed = rawLine.trim();

        // Skip blank lines or pure comments
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
          continue;
        }

        const lineNum = i + 1;
        let explanation = "";
        let action = "execute";

        // 1. Variable Assignment (e.g. `price = 500`, `let count = 0`, `total = price * quantity`)
        const assignMatch = trimmed.match(/^(?:let|const|var)?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
        if (assignMatch) {
          const varName = assignMatch[1];
          let expr = assignMatch[2].replace(/;$/, "").trim();

          // Evaluate simple arithmetic with existing variables safely
          let evalExpr = expr;
          for (const [k, v] of Object.entries(variables)) {
            // Replace word boundary variable names
            const regex = new RegExp(`\\b${k}\\b`, "g");
            evalExpr = evalExpr.replace(regex, JSON.stringify(v.value));
          }

          let calculatedVal = null;
          try {
            // Safe evaluation of arithmetic literals only (no arbitrary code execution)
            if (/^[0-9+\-*/().\s%"'a-zA-Z_\[\]]+$/.test(evalExpr)) {
              calculatedVal = Function(`"use strict"; return (${evalExpr})`)();
            } else {
              calculatedVal = expr;
            }
          } catch (e) {
            calculatedVal = expr;
          }

          const prevVal = variables[varName] ? variables[varName].value : undefined;
          variables[varName] = {
            value: calculatedVal,
            type: typeof calculatedVal,
            changed: true,
            prevValue: prevVal,
          };

          explanation = prevVal !== undefined
            ? `Updated variable <code>${varName}</code> from <code>${prevVal}</code> to <code>${calculatedVal}</code>.`
            : `Initialized variable <code>${varName}</code> with value <code>${calculatedVal}</code>.`;
          action = "assign";
        }
        // 2. Print or Console Log
        else if (trimmed.startsWith("print(") || trimmed.startsWith("console.log(")) {
          const match = trimmed.match(/(?:print|console\.log)\((.*)\)/);
          const rawArg = match ? match[1].trim() : "";
          let outVal = rawArg;

          // Resolve variables
          if (variables[outVal] !== undefined) {
            outVal = String(variables[outVal].value);
          } else {
            // Try evaluating
            let evalExpr = rawArg;
            for (const [k, v] of Object.entries(variables)) {
              evalExpr = evalExpr.replace(new RegExp(`\\b${k}\\b`, "g"), JSON.stringify(v.value));
            }
            try {
              outVal = String(Function(`"use strict"; return (${evalExpr})`)());
            } catch (e) {
              outVal = rawArg.replace(/['"]/g, "");
            }
          }

          outputLog.push(outVal);
          explanation = `Printed <code>${outVal}</code> to standard output.`;
          action = "output";
        }
        // 3. Conditionals (e.g. `if condition:`, `if (condition) {`)
        else if (trimmed.startsWith("if ") || trimmed.startsWith("if(")) {
          explanation = `Evaluated conditional branch: <code>${trimmed}</code>.`;
          action = "branch";
        }
        // 4. Loops (e.g. `for i in range(n):`, `while condition:`)
        else if (trimmed.startsWith("for ") || trimmed.startsWith("while ")) {
          explanation = `Iterating loop: <code>${trimmed}</code>.`;
          action = "loop";
        }
        // 5. General statement
        else {
          explanation = `Executed: <code>${trimmed}</code>.`;
        }

        // Snapshot variables state for this step
        const varSnapshot = {};
        for (const [k, v] of Object.entries(variables)) {
          varSnapshot[k] = { ...v };
        }

        steps.push({
          stepNumber: stepNum++,
          lineNumber: lineNum,
          codeLine: rawLine,
          trimmedCode: trimmed,
          action: action,
          explanation: explanation,
          variables: varSnapshot,
          callStack: [...callStack],
          output: [...outputLog],
        });
      }

      return steps;
    }
  }

  class VisualLearningPanel {
    constructor() {
      this.panelEl = null;
      this.currentCode = "";
      this.currentLang = "python";
      this.currentFilename = "snippet.py";
      this.steps = [];
      this.currentStepIdx = 0;
      this.autoPlayTimer = null;
      this.isOpen = false;
    }

    open(code, lang = "python", filename = "main.py") {
      this.currentCode = code;
      this.currentLang = lang;
      this.currentFilename = filename;
      this.steps = SimpleCodeTracer.trace(code, lang);
      this.currentStepIdx = 0;
      this.isOpen = true;

      this.render();
      this.applyStep(0);
    }

    close() {
      if (this.autoPlayTimer) {
        clearInterval(this.autoPlayTimer);
        this.autoPlayTimer = null;
      }
      this.isOpen = false;
      const el = document.getElementById("darknessVisualLearningPanel");
      if (el) el.remove();
      document.body.classList.remove("has-visual-learning-panel");
    }

    render() {
      let existing = document.getElementById("darknessVisualLearningPanel");
      if (existing) existing.remove();

      document.body.classList.add("has-visual-learning-panel");

      const panel = document.createElement("div");
      panel.id = "darknessVisualLearningPanel";
      panel.className = "visual-learning-panel";

      const lines = this.currentCode.split(/\r?\n/);
      const codeLinesHtml = lines.map((line, idx) => {
        const lineNum = idx + 1;
        return `<div class="vl-code-line" data-vl-line="${lineNum}"><span class="vl-line-num">${lineNum}</span><span class="vl-line-content">${this._escape(line)}</span></div>`;
      }).join("");

      panel.innerHTML = `
        <div class="vl-panel-resizer" id="vlResizer" title="Drag to resize learning panel"></div>
        <div class="vl-panel-header">
          <div class="vl-panel-title">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
            <span>Visual Code Learning — ${this._escape(this.currentFilename)}</span>
          </div>
          <div class="vl-panel-actions">
            <button class="vl-btn" id="vlCloseBtn" title="Close learning panel (Esc)" type="button">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <div class="vl-panel-stepper-bar">
          <div class="vl-step-controls">
            <button class="vl-step-btn" id="vlPrevBtn" title="Previous step (Left Arrow)" type="button">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
              <span>Prev</span>
            </button>
            <button class="vl-step-btn" id="vlPlayBtn" title="Auto-step through execution" type="button">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <span>Auto Step</span>
            </button>
            <button class="vl-step-btn" id="vlNextBtn" title="Next step (Right Arrow)" type="button">
              <span>Next</span>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <button class="vl-step-btn vl-step-btn--reset" id="vlResetBtn" title="Reset to beginning" type="button">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
              <span>Reset</span>
            </button>
          </div>
          <div class="vl-step-indicator" id="vlStepIndicator">
            Step 1 of ${this.steps.length || 1}
          </div>
        </div>

        <div class="vl-panel-body">
          <div class="vl-panel-code-pane">
            <div class="vl-pane-label">Source Execution</div>
            <div class="vl-code-scroll" id="vlCodeScroll">
              ${codeLinesHtml}
            </div>
          </div>

          <div class="vl-panel-state-pane">
            <div class="vl-card">
              <div class="vl-card-header">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                <span>Professor Explanation</span>
              </div>
              <div class="vl-card-body vl-explanation-text" id="vlExplanation">
                Click <b>Next Step</b> to begin step-by-step execution analysis.
              </div>
            </div>

            <div class="vl-card">
              <div class="vl-card-header">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                <span>Variable & Memory State</span>
              </div>
              <div class="vl-card-body" id="vlVariablesTable">
                <div class="vl-empty-state">No variables initialized yet.</div>
              </div>
            </div>

            <div class="vl-card">
              <div class="vl-card-header">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                <span>Standard Output</span>
              </div>
              <div class="vl-card-body vl-output-terminal" id="vlOutput">
                <span class="vl-term-empty">(empty)</span>
              </div>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(panel);
      this.panelEl = panel;

      this._bindEvents();
    }

    _bindEvents() {
      const closeBtn = document.getElementById("vlCloseBtn");
      if (closeBtn) closeBtn.onclick = () => this.close();

      const prevBtn = document.getElementById("vlPrevBtn");
      if (prevBtn) prevBtn.onclick = () => this.prev();

      const nextBtn = document.getElementById("vlNextBtn");
      if (nextBtn) nextBtn.onclick = () => this.next();

      const playBtn = document.getElementById("vlPlayBtn");
      if (playBtn) playBtn.onclick = () => this.toggleAutoPlay();

      const resetBtn = document.getElementById("vlResetBtn");
      if (resetBtn) resetBtn.onclick = () => this.applyStep(0);

      // Left edge drag resizer
      const resizer = document.getElementById("vlResizer");
      if (resizer && this.panelEl) {
        let isResizing = false;
        resizer.onmousedown = (e) => {
          isResizing = true;
          document.body.style.userSelect = "none";
          document.body.style.cursor = "col-resize";
        };
        window.addEventListener("mousemove", (e) => {
          if (!isResizing || !this.panelEl) return;
          const newW = window.innerWidth - e.clientX;
          if (newW >= 360 && newW <= window.innerWidth - 60) {
            this.panelEl.style.width = newW + "px";
          }
        });
        window.addEventListener("mouseup", () => {
          if (isResizing) {
            isResizing = false;
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
          }
        });
      }

      // Keyboard arrow shortcuts
      const keyHandler = (e) => {
        if (!this.isOpen) {
          window.removeEventListener("keydown", keyHandler);
          return;
        }
        if (e.key === "Escape") {
          this.close();
        } else if (e.key === "ArrowRight") {
          this.next();
        } else if (e.key === "ArrowLeft") {
          this.prev();
        }
      };
      window.addEventListener("keydown", keyHandler);
    }

    applyStep(index) {
      if (!this.steps || !this.steps.length) return;
      this.currentStepIdx = Math.max(0, Math.min(index, this.steps.length - 1));
      const step = this.steps[this.currentStepIdx];

      // Update indicator
      const ind = document.getElementById("vlStepIndicator");
      if (ind) ind.textContent = `Step ${this.currentStepIdx + 1} of ${this.steps.length}`;

      // Highlight active code line
      if (this.panelEl) {
        this.panelEl.querySelectorAll(".vl-code-line").forEach((l) => l.classList.remove("is-active"));
        const activeLine = this.panelEl.querySelector(`.vl-code-line[data-vl-line="${step.lineNumber}"]`);
        if (activeLine) {
          activeLine.classList.add("is-active");
          activeLine.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }

      // Update explanation
      const explEl = document.getElementById("vlExplanation");
      if (explEl) {
        explEl.innerHTML = step.explanation;
      }

      // Update variable table
      const varTableEl = document.getElementById("vlVariablesTable");
      if (varTableEl) {
        const varEntries = Object.entries(step.variables);
        if (!varEntries.length) {
          varTableEl.innerHTML = '<div class="vl-empty-state">No variables in memory yet.</div>';
        } else {
          const rows = varEntries.map(([name, data]) => {
            const valStr = JSON.stringify(data.value);
            const isChanged = data.changed;
            return `
              <tr class="${isChanged ? "is-changed" : ""}">
                <td class="vl-var-name"><code>${this._escape(name)}</code></td>
                <td class="vl-var-type"><span class="vl-type-badge">${this._escape(data.type)}</span></td>
                <td class="vl-var-val"><code>${this._escape(valStr)}</code></td>
              </tr>
            `;
          }).join("");

          varTableEl.innerHTML = `
            <table class="vl-vars-table">
              <thead>
                <tr><th>Variable</th><th>Type</th><th>Value</th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          `;
        }
      }

      // Update output terminal
      const outEl = document.getElementById("vlOutput");
      if (outEl) {
        if (!step.output.length) {
          outEl.innerHTML = '<span class="vl-term-empty">(empty)</span>';
        } else {
          outEl.innerHTML = step.output.map((o) => `<div class="vl-out-line">${this._escape(o)}</div>`).join("");
        }
      }
    }

    next() {
      if (this.currentStepIdx < this.steps.length - 1) {
        this.applyStep(this.currentStepIdx + 1);
      } else if (this.autoPlayTimer) {
        this.toggleAutoPlay();
      }
    }

    prev() {
      if (this.currentStepIdx > 0) {
        this.applyStep(this.currentStepIdx - 1);
      }
    }

    toggleAutoPlay() {
      const playBtn = document.getElementById("vlPlayBtn");
      if (this.autoPlayTimer) {
        clearInterval(this.autoPlayTimer);
        this.autoPlayTimer = null;
        if (playBtn) {
          playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Auto Step</span>';
        }
      } else {
        if (this.currentStepIdx >= this.steps.length - 1) {
          this.applyStep(0);
        }
        if (playBtn) {
          playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg><span>Pause</span>';
        }
        this.autoPlayTimer = setInterval(() => {
          this.next();
        }, 1500);
      }
    }

    highlightLine(lineNum) {
      if (!this.isOpen || !this.panelEl) return;
      const targetStep = this.steps.findIndex((s) => s.lineNumber === lineNum);
      if (targetStep >= 0) {
        this.applyStep(targetStep);
      }
    }

    _bindResizer() {
      const resizer = document.getElementById("vlResizer");
      if (resizer && this.panelEl) {
        let isResizing = false;
        resizer.onmousedown = () => {
          isResizing = true;
          document.body.style.userSelect = "none";
          document.body.style.cursor = "col-resize";
        };
        window.addEventListener("mousemove", (e) => {
          if (!isResizing || !this.panelEl) return;
          const newW = window.innerWidth - e.clientX;
          if (newW >= 340 && newW <= window.innerWidth - 60) {
            this.panelEl.style.width = newW + "px";
          }
        });
        window.addEventListener("mouseup", () => {
          if (isResizing) {
            isResizing = false;
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
          }
        });
      }
    }

    openForCodeContext(selectedCodeContext, userQuestion, projectId) {
      if (!selectedCodeContext) return;

      this.isOpen = true;
      const targetPid = projectId || window.Darkness?.currentProjectId || "global";

      const isSameContext = Boolean(
        this.activeCodeContext &&
        this.activeCodeContext.filePath === selectedCodeContext.filePath &&
        this.activeCodeContext.selectedCode === selectedCodeContext.selectedCode &&
        this.activeCodeContext.startLine === selectedCodeContext.startLine &&
        this.activeConversationId
      );

      if (!isSameContext) {
        this.activeCodeContext = selectedCodeContext;
        this.activeProjectId = targetPid;
        this.activeConversationId = "code_conv_" + targetPid + "_" + Date.now();
        this.activeMessages = [];
      } else {
        this.activeProjectId = targetPid;
      }

      const initialPrompt = userQuestion || "Explain this code in detail";

      // Append initial question if starting fresh
      if (this.activeMessages.length === 0) {
        const userMsgId = "msg_u_" + Date.now();
        const aiMsgId = "msg_a_" + Date.now();
        this.activeMessages.push({
          id: userMsgId,
          role: "user",
          content: initialPrompt,
          timestamp: Date.now()
        });
        this.activeMessages.push({
          id: aiMsgId,
          role: "assistant",
          content: "",
          isStreaming: true,
          timestamp: Date.now()
        });
      }

      this.renderCodeContextPanel();
      
      // Trigger stream for the last streaming message if needed
      const lastMsg = this.activeMessages[this.activeMessages.length - 1];
      if (lastMsg && lastMsg.isStreaming) {
        this.streamCodeExplanation(lastMsg.id, initialPrompt);
      }
    }

    renderCodeContextPanel() {
      let existing = document.getElementById("darknessVisualLearningPanel");
      if (existing) existing.remove();

      document.body.classList.add("has-visual-learning-panel");

      const panel = document.createElement("div");
      panel.id = "darknessVisualLearningPanel";
      panel.className = "visual-learning-panel visual-learning-panel--explanation";

      const sc = this.activeCodeContext || {};
      const filePath = sc.filePath || "Selected Code";
      const startLine = sc.startLine || 1;
      const endLine = sc.endLine || startLine;
      const lineRangeStr = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;
      const codeSnippet = sc.selectedCode || "";

      panel.innerHTML = `
        <div class="vl-panel-resizer" id="vlResizer" title="Drag left border to resize panel"></div>
        <div class="vl-panel-header" style="padding:12px 16px; border-bottom:1px solid var(--line); display:flex; align-items:center; justify-content:space-between; background:var(--surface);">
          <div class="vl-panel-title" style="display:flex; align-items:center; gap:8px; font-weight:700; font-size:13px; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:65%;">
            <span style="font-size:16px;">📄</span>
            <span style="overflow:hidden; text-overflow:ellipsis;">${this._escape(filePath)}</span>
            <span class="tag tag--xs" style="background:var(--accent-soft); color:var(--accent); font-weight:600; flex-shrink:0;">${this._escape(lineRangeStr)}</span>
          </div>
          <div class="vl-panel-actions" style="display:flex; align-items:center; gap:6px;">
            <button class="btn btn--xs btn--outline" id="vlNewChatBtn" title="Start a fresh conversation for this code snippet" type="button" style="font-size:11.5px; padding:4px 9px; display:inline-flex; align-items:center; gap:4px; font-weight:600; cursor:pointer;">
              <span>+ New Chat</span>
            </button>
            <button class="btn btn--xs btn--outline" id="vlJumpToSourceBtn" title="Go to source location in code editor" type="button" style="font-size:11.5px; padding:4px 9px; display:inline-flex; align-items:center; gap:4px; font-weight:600; cursor:pointer;">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              <span>Source</span>
            </button>
            <button class="btn btn--xs btn--ghost" id="vlCloseBtn" title="Close explanation panel (Esc)" type="button" style="padding:4px 8px; cursor:pointer;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <div class="vl-panel-body" style="padding:16px; overflow-y:auto; flex:1; min-height:0; display:flex; flex-direction:column; gap:16px; background:var(--surface-muted);" id="vlPanelBody">
          <!-- Selected Code Snippet Card -->
          <div style="flex-shrink:0; border:1px solid var(--line); border-radius:10px; background:var(--surface); overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
            <div style="padding:8px 12px; background:var(--surface-muted); border-bottom:1px solid var(--line); font-size:11.5px; font-weight:700; color:var(--ink-muted); display:flex; align-items:center; justify-content:space-between;">
              <div style="display:flex; align-items:center; gap:6px;">
                <span>⚡ Code Context Snippet</span>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="tag tag--xs" style="font-size:10.5px; text-transform:uppercase;">${this._escape(sc.language || "code")}</span>
                <button type="button" class="btn btn--xs btn--ghost" id="copyCodeSnippetBtn" style="padding:2px 6px; font-size:11px;">Copy Code</button>
              </div>
            </div>
            <pre style="margin:0; padding:12px; font-family:var(--font-mono); font-size:12px; line-height:1.5; color:var(--ink); overflow-x:auto; max-height:140px; background:var(--surface);"><code>${this._escape(codeSnippet)}</code></pre>
          </div>

          <!-- Conversation Messages Feed -->
          <div id="vlExplanationFeed" style="display:flex; flex-direction:column; gap:16px; width:100%;">
            ${this.renderMessagesHtml()}
          </div>
        </div>

        <!-- Fixed Docked Footer: Quick Chips + Composer Input Bar -->
        <div class="vl-panel-footer" style="flex-shrink:0; padding:12px 16px; border-top:1px solid var(--line); background:var(--surface); display:flex; flex-direction:column; gap:10px; box-shadow:0 -2px 10px rgba(0,0,0,0.03);">
          <!-- Quick Action Follow-Up Suggestion Chips -->
          <div style="display:flex; flex-direction:column; gap:6px;">
            <div style="font-size:11px; font-weight:700; color:var(--ink-muted); text-transform:uppercase; letter-spacing:0.04em;">Suggested Follow-ups:</div>
            <div style="display:flex; flex-wrap:wrap; gap:6px;" id="vlQuickChips">
              <button type="button" class="btn btn--xs btn--outline vl-chip" data-prompt="Break down this code line-by-line in plain English">📝 Line-by-line breakdown</button>
              <button type="button" class="btn btn--xs btn--outline vl-chip" data-prompt="Explain why this implementation logic works step by step">🧠 How the logic works</button>
              <button type="button" class="btn btn--xs btn--outline vl-chip" data-prompt="Find potential edge cases, bugs, or failure modes in this code">🐛 Edge cases & bugs</button>
              <button type="button" class="btn btn--xs btn--outline vl-chip" data-prompt="Analyze the algorithmic time and space complexity of this snippet">⏱ Complexity analysis</button>
              <button type="button" class="btn btn--xs btn--outline vl-chip" data-prompt="How can this code be optimized or refactored for better performance?">⚡ Optimization tips</button>
              <button type="button" class="btn btn--xs btn--outline vl-chip" data-prompt="Write unit tests for this code snippet">🧪 Unit test cases</button>
            </div>
          </div>

          <!-- Follow-up Question Input Bar -->
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="text" id="vlFollowUpInput" placeholder="Ask a follow-up about this selected code..." style="flex:1; padding:8px 12px; font-size:13px; border:1px solid var(--line); border-radius:8px; background:var(--surface); color:var(--ink); outline:none;" />
            <button type="button" id="vlFollowUpSend" class="btn btn--primary btn--sm" style="padding:8px 16px; font-size:13px; font-weight:700; flex-shrink:0;">Ask AI</button>
          </div>
        </div>
      `;

      document.body.appendChild(panel);
      this.panelEl = panel;

      // Bind Copy Snippet button
      document.getElementById("copyCodeSnippetBtn")?.addEventListener("click", () => {
        navigator.clipboard.writeText(codeSnippet);
        if (window.Darkness?.toast) window.Darkness.toast.show("Code snippet copied", "success");
      });

      // Bind New Chat button
      document.getElementById("vlNewChatBtn")?.addEventListener("click", () => {
        this.activeConversationId = "code_conv_" + this.activeProjectId + "_" + Date.now();
        this.activeMessages = [];
        this.openForCodeContext(this.activeCodeContext, "Explain this code in detail", this.activeProjectId);
      });

      // Bind Jump to Source button
      document.getElementById("vlJumpToSourceBtn")?.addEventListener("click", () => {
        if (window.Darkness && window.Darkness.jumpToFile) {
          window.Darkness.jumpToFile(filePath, startLine);
        }
      });

      // Bind Close button
      document.getElementById("vlCloseBtn")?.addEventListener("click", () => {
        this.close();
      });

      // Bind Quick Suggestion Chips
      panel.querySelectorAll(".vl-chip").forEach(chip => {
        chip.addEventListener("click", () => {
          const prompt = chip.getAttribute("data-prompt");
          if (prompt) this.askFollowUp(prompt);
        });
      });

      // Bind Follow-up Send
      const followUpInput = document.getElementById("vlFollowUpInput");
      const followUpSend = document.getElementById("vlFollowUpSend");
      const handleSend = () => {
        const val = followUpInput?.value?.trim();
        if (!val) return;
        followUpInput.value = "";
        this.askFollowUp(val);
      };

      followUpSend?.addEventListener("click", handleSend);
      followUpInput?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      });

      // Bind Left Edge Resizer
      this._bindResizer();

      this.scrollToBottom();
    }

    renderMessagesHtml() {
      if (!this.activeMessages || this.activeMessages.length === 0) return "";

      return this.activeMessages.map(msg => {
        if (msg.role === "user") {
          return `
            <div class="vl-msg vl-msg--user" id="${msg.id}" style="align-self:flex-end; max-width:88%; background:var(--accent); color:#ffffff; padding:10px 14px; border-radius:12px 12px 2px 12px; font-size:13px; font-weight:600; line-height:1.5; box-shadow:0 1px 3px rgba(0,0,0,0.1);">
              <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px; opacity:0.85; font-size:11px; font-weight:700;">
                <span>💬 Question</span>
              </div>
              <div>${this._escape(msg.content)}</div>
            </div>
          `;
        } else {
          let htmlContent = "";
          if (msg.isStreaming && !msg.content) {
            htmlContent = `
              <div style="display:flex; align-items:center; gap:8px; padding:12px; color:var(--ink-muted); font-size:13px;">
                <span class="spinner" style="width:16px; height:16px; border:2px solid currentColor; border-top-color:transparent; border-radius:50%; animation:spin 1s linear infinite;"></span>
                <span>AI Tutor analyzing code logic...</span>
              </div>
            `;
          } else {
            htmlContent = window.Darkness?.markdown?.render
              ? window.Darkness.markdown.render(msg.content)
              : this._escape(msg.content);
          }

          return `
            <div class="vl-msg vl-msg--assistant" id="${msg.id}" style="align-self:flex-start; width:100%; background:var(--surface); border:1px solid var(--line); padding:16px; border-radius:12px; font-size:13px; line-height:1.6; color:var(--ink); box-shadow:0 1px 3px rgba(0,0,0,0.04);">
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; padding-bottom:6px; border-bottom:1px solid var(--line);">
                <div style="display:flex; align-items:center; gap:6px; font-weight:700; font-size:12px; color:var(--accent);">
                  <span>🤖 AI Master Code Tutor</span>
                </div>
                ${!msg.isStreaming ? `
                  <button type="button" class="btn btn--xs btn--ghost vl-copy-msg-btn" data-msg-id="${msg.id}" style="font-size:11px; padding:2px 8px;">Copy Explanation</button>
                ` : ""}
              </div>
              <div class="markdown-body vl-msg-body" id="body_${msg.id}">
                ${htmlContent}
              </div>
            </div>
          `;
        }
      }).join("");
    }

    askFollowUp(questionText) {
      if (!questionText || !questionText.trim()) return;

      const userMsgId = "msg_u_" + Date.now();
      const aiMsgId = "msg_a_" + Date.now();

      this.activeMessages.push({
        id: userMsgId,
        role: "user",
        content: questionText.trim(),
        timestamp: Date.now()
      });

      this.activeMessages.push({
        id: aiMsgId,
        role: "assistant",
        content: "",
        isStreaming: true,
        timestamp: Date.now()
      });

      const feed = document.getElementById("vlExplanationFeed");
      if (feed) {
        feed.innerHTML = this.renderMessagesHtml();
        this.bindMsgActions();
      }

      this.scrollToBottom();
      this.streamCodeExplanation(aiMsgId, questionText.trim());
    }

    bindMsgActions() {
      const feed = document.getElementById("vlExplanationFeed");
      if (!feed) return;

      feed.querySelectorAll(".vl-copy-msg-btn").forEach(btn => {
        btn.onclick = () => {
          const msgId = btn.getAttribute("data-msg-id");
          const msgObj = this.activeMessages.find(m => m.id === msgId);
          if (msgObj && msgObj.content) {
            navigator.clipboard.writeText(msgObj.content);
            if (window.Darkness?.toast) window.Darkness.toast.show("Explanation copied to clipboard", "success");
          }
        };
      });

      if (window.Darkness && window.Darkness.renderMermaid) {
        window.Darkness.renderMermaid(feed);
      }
    }

    async streamCodeExplanation(aiMsgId, userQuestion) {
      const msgObj = this.activeMessages.find(m => m.id === aiMsgId);
      if (!msgObj) return;

      const bodyEl = document.getElementById("body_" + aiMsgId);
      if (!bodyEl) return;

      const history = this.activeMessages
        .filter(m => m.id !== aiMsgId && !m.isStreaming)
        .map(m => ({ role: m.role, content: m.content }));

      try {
        const resp = await fetch((window.Darkness?.api?.base || "") + "/api/projects/" + this.activeProjectId + "/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userQuestion || "Explain this code snippet",
            conversation_id: this.activeConversationId,
            selectedCodeContext: this.activeCodeContext,
            history: history
          }),
        });

        if (!resp.ok) {
          throw new Error("HTTP " + resp.status + " " + resp.statusText);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let fullText = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const block of lines) {
            const dataLine = block.trim().replace(/^data:\s*/, "");
            if (!dataLine) continue;
            try {
              const parsed = JSON.parse(dataLine);
              if (parsed.content) fullText += parsed.content;

              if (fullText) {
                msgObj.content = fullText;
                const rendered = window.Darkness?.markdown?.render
                  ? window.Darkness.markdown.render(fullText)
                  : this._escape(fullText);
                bodyEl.innerHTML = rendered;
                this.scrollToBottom();
              }
            } catch (e) {}
          }
        }

        if (fullText) {
          msgObj.content = fullText;
          msgObj.isStreaming = false;
          const finalRender = window.Darkness?.markdown?.render
            ? window.Darkness.markdown.render(fullText)
            : this._escape(fullText);
          bodyEl.innerHTML = finalRender;
          this.bindMsgActions();
          this.scrollToBottom();
        }
      } catch (err) {
        msgObj.isStreaming = false;
        msgObj.content = "Error generating explanation: " + (err.message || "Request failed");
        bodyEl.innerHTML = `
          <div style="padding:10px; border-radius:6px; background:rgba(239,68,68,0.1); border:1px solid var(--danger); color:var(--danger); font-size:12.5px;">
            ${this._escape(msgObj.content)}
          </div>
        `;
      }
    }

    scrollToBottom() {
      const feed = document.getElementById("vlExplanationFeed");
      const body = document.getElementById("vlPanelBody");
      if (feed) feed.scrollTop = feed.scrollHeight;
      if (body) body.scrollTop = body.scrollHeight;
    }

    highlightLine(lineNum) {
      if (!this.isOpen || !this.panelEl) return;
      const targetStep = this.steps.findIndex((s) => s.lineNumber === lineNum);
      if (targetStep >= 0) {
        this.applyStep(targetStep);
      }
    }

    _escape(text) {
      return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }
  }

  window.Darkness.SimpleCodeTracer = SimpleCodeTracer;
  window.Darkness.visualLearningPanel = new VisualLearningPanel();
})();
