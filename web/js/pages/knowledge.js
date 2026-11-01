window.Darkness = window.Darkness || {};
window.Darkness.pages = window.Darkness.pages || {};

(function() {
  let ragData = {
    projectId: 'global',
    projectName: 'Global Knowledge Base',
    status: 'Ready',
    stats: { documents: 0, chunks: 0, vectors: 0 },
    documents: [],
    settings: { chunkSize: 800, chunkOverlap: 120, similarityThreshold: 0.65 }
  };
  let activeFilter = '';
  let isRefreshing = false;
  let isUploading = false;
  
  // Persist panel open/closed state in localStorage (default closed for full chat space)
  let isDocPanelOpen = localStorage.getItem('darkness_kb_doc_panel_open') === 'true';

  // Persistent server-backed chat history (grounded in Supabase/backend)
  let chatMessages = [];
  let isChatThinking = false;
  let knowledgeChatAttachments = [];

  async function loadKnowledgeChatHistory() {
    try {
      const user = window.Darkness?.auth?.getUser ? window.Darkness.auth.getUser() : null;
      const cid = "knowledge_rag_chat_" + (user?.id || "default");
      const res = await fetch(`/api/conversations/${encodeURIComponent(cid)}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.messages) && data.messages.length > 0) {
          chatMessages = data.messages.map(m => ({
            role: m.role,
            content: m.content || "",
            documentsUsed: m.attachments?.documentsUsed || [],
            sources: m.attachments?.sources || []
          }));
        }
      }
    } catch (e) {
      console.warn("Failed to load persistent knowledge chat history:", e);
    }
  }

  function saveChatMessages() {
    // Chat messages are automatically persisted to Supabase and SQLite via the /api/knowledge/rag/ask endpoint
  }

  window.Darkness.pages.knowledge = async function renderKnowledgePage() {
    const main = document.getElementById('main');
    if (!main) return;

    main.innerHTML = `
      <div style="height: 100%; display: flex; align-items: center; justify-content: center; color: var(--ink-muted); font-size: 13.5px;">
        <div class="hstack" style="gap: 8px;">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" class="spin-anim"><circle cx="12" cy="12" r="10" stroke-dasharray="30" stroke-dashoffset="10"/></svg>
          <span>Loading Knowledge Base...</span>
        </div>
      </div>
    `;

    await Promise.all([loadRagData(), loadKnowledgeChatHistory()]);
    renderPage(main);
  };

  async function loadRagData() {
    try {
      const res = await fetch('/api/knowledge/rag');
      if (res.ok) {
        const data = await res.json();
        ragData = data || ragData;
      }
    } catch (err) {
      console.warn('Failed to load knowledge RAG data:', err);
    }
  }

  function getActiveModelLabel() {
    const modelId = window.Darkness?.store?.get?.("active_model") || window.Darkness?.chat?._activeModel;
    if (modelId) {
      return modelId.replace('gemini-', '').replace('-preview', '');
    }
    return 'Dynamic Mode';
  }

  function renderPage(main) {
    const docs = (ragData.documents || []).filter(d => {
      if (!activeFilter) return true;
      const q = activeFilter.toLowerCase();
      return (d.name || '').toLowerCase().includes(q) || 
             (d.path || '').toLowerCase().includes(q) || 
             (d.fileType || '').toLowerCase().includes(q);
    });

    const totalChunks = ragData.stats?.chunks || (ragData.documents || []).reduce((acc, d) => acc + (d.chunksCount || 0), 0);
    const totalDocs = (ragData.documents || []).length;
    const modelLabel = getActiveModelLabel();

    main.innerHTML = `
      <div class="knowledge-page-root" style="height: 100%; display: flex; flex-direction: column; overflow: hidden; background: var(--canvas); padding: 10px 14px 12px;">
        
        <!-- Clean, Compact Control Bar (Non-scrolling, Zero Unnecessary Clutter) -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; gap: 10px; flex-shrink: 0; min-height: 34px;">
          <div class="hstack" style="gap: 8px; min-width: 0;">
            <div style="width: 26px; height: 26px; border-radius: 6px; background: var(--surface-muted); color: var(--ink); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                <polyline points="2 12 12 17 22 12"/>
                <polyline points="2 17 12 22 22 17"/>
              </svg>
            </div>
            <div class="hstack" style="gap: 8px; min-width: 0;">
              <h1 style="font-size: 14.5px; font-weight: 700; margin: 0; color: var(--ink); white-space: nowrap;">
                My Library
              </h1>
              ${totalDocs > 0 ? `
                <span style="display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 9999px; font-size: 10.5px; font-weight: 500; background: var(--surface-muted); color: var(--ink-muted); white-space: nowrap;">
                  ${totalDocs} doc${totalDocs === 1 ? '' : 's'}
                </span>
              ` : ''}
            </div>
          </div>

          <!-- Top Actions -->
          <div class="hstack" style="gap: 6px; flex-shrink: 0;">
            ${chatMessages.length > 0 ? `
              <button id="exportKnowledgeChatBtn" class="btn btn--ghost btn--sm" style="font-size: 11.5px; height: 30px; padding: 0 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; color: var(--ink-muted);" title="Export conversation as PDF">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                <span>Export</span>
              </button>
              <button id="clearKnowledgeChatBtn" class="btn btn--ghost btn--sm" style="font-size: 11.5px; height: 30px; padding: 0 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; color: var(--ink-muted);" title="Clear conversation history">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <polyline points="3 3 3 8 8 8"/>
                </svg>
                <span>Clear</span>
              </button>
            ` : ''}

            <!-- Book Open / Close Document Manager Toggle Button -->
            <button id="toggleDocPanelBtn" class="btn ${isDocPanelOpen ? 'btn--primary' : 'btn--outline'}" style="position: relative; width: 34px; height: 34px; padding: 0; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; transition: all 0.2s ease;" title="${isDocPanelOpen ? 'Close Documents (Book Open)' : `Open Documents (${totalDocs})`}" aria-label="Toggle Documents">
              ${isDocPanelOpen ? `
                <!-- Book Open Icon -->
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                </svg>
              ` : `
                <!-- Book Closed Icon -->
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                </svg>
              `}
              ${totalDocs > 0 ? `
                <span style="position: absolute; top: -3px; right: -3px; background: ${isDocPanelOpen ? '#8b5cf6' : '#2563eb'}; color: white; font-size: 9px; font-weight: 700; width: 15px; height: 15px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); border: 1.5px solid var(--surface); line-height: 1;">
                  ${totalDocs > 99 ? '99+' : totalDocs}
                </span>
              ` : ''}
            </button>

            
          </div>
        </div>

        <!-- Main Body: Clean Full Height View (Non-scrolling parent) -->
        <div style="flex: 1; min-height: 0; display: flex; gap: 12px; overflow: hidden;" id="knowledgeMainLayout">
          
          <!-- MAIN CHAT CARD (Scrolls internally) -->
          <div class="card" style="flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden; padding: 12px 14px; border: 1px solid var(--line); background: var(--surface); border-radius: 12px; box-shadow: 0 1px 6px rgba(0,0,0,0.02);" id="knowledgeChatCard">
            
            <!-- Scrollable Message Window Thread (Clean, spacious, prominent) -->
            <div id="knowledgeChatThread" style="flex: 1; min-height: 0; overflow-y: auto; padding: 8px 4px; display: flex; flex-direction: column; gap: 14px; margin-bottom: 8px;">
              
              ${chatMessages.length === 0 ? `
                <div style="margin: auto; text-align: center; max-width: 420px; padding: 20px 10px; color: var(--ink-muted);">
                  <div style="font-size: 13px; color: var(--ink-muted); margin-bottom: 4px;">
                    Type your question below...
                  </div>
                </div>
              ` : chatMessages.map(renderChatMessageHtml).join('')}
              
              ${isChatThinking ? `
                <div style="display: flex; align-items: flex-start; width: 100%;">
                  <div style="background: var(--surface-muted); border: 1px solid var(--line); border-radius: 10px; padding: 9px 14px; font-size: 12.5px; color: var(--ink-muted); display: flex; align-items: center; gap: 8px;">
                    <span style="display: inline-flex; gap: 3px;">
                      <span style="width: 4px; height: 4px; border-radius: 50%; background: #8b5cf6; animation: bounce 1.4s infinite ease-in-out both;"></span>
                      <span style="width: 4px; height: 4px; border-radius: 50%; background: #8b5cf6; animation: bounce 1.4s infinite ease-in-out both; animation-delay: 0.2s;"></span>
                      <span style="width: 4px; height: 4px; border-radius: 50%; background: #8b5cf6; animation: bounce 1.4s infinite ease-in-out both; animation-delay: 0.4s;"></span>
                    </span>
                    <span>Retrieving context & generating answer...</span>
                  </div>
                </div>
              ` : ''}
            </div>

            <!-- Knowledge Chat Attachments Tray -->
            <div id="knowledgeChatAttachments" style="display:none; flex-wrap:wrap; gap:6px; padding:6px 10px; margin-bottom:6px; border-radius:8px; background:var(--surface-muted); border:1px solid var(--line);"></div>

            <!-- Chat Composer Input Form (Fixed at bottom) -->
            <form id="knowledgeChatForm" style="display: flex; gap: 8px; align-items: center; flex-shrink: 0; padding-top: 4px; border-top: 1px solid var(--line);">
              <button type="button" class="btn btn--ghost btn--icon-sm" id="knowledgeChatAttachBtn" title="Attach Document, PDF, or Image to Knowledge Chat" style="width: 38px; height: 38px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--ink-muted); border: 1px solid var(--line); cursor: pointer;" aria-label="Attach File">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </button>
              <input type="file" id="knowledgeChatFileInput" hidden multiple accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.md,.csv,.json,.xml,.yaml,.yml,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.rs,.php,.rb,.sql,.html,.css,.scss,.sh,.zip,.png,.jpg,.jpeg,.webp,.gif" />
              <div class="rag-search-wrapper" style="flex: 1; position: relative;">
                <textarea id="knowledgeChatInput" class="input" placeholder="Ask anything about your library documents..." style="padding-left: 12px; padding-right: 60px; min-height: 40px; max-height: 120px; font-size: 13.5px; border-radius: 8px; width: 100%; resize: none; overflow-y: auto; padding-top: 10px; font-family: inherit; line-height: 1.4;" rows="1" autocomplete="off"></textarea>
                <span style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 10px; font-weight: 500; color: var(--ink-muted); background: var(--bg); padding: 2px 4px; border-radius: 4px; border: 1px solid var(--line);">
                  ↵
                </span>
              </div>
              <button type="submit" id="knowledgeChatSendBtn" class="btn btn--primary" ${isChatThinking ? 'disabled' : ''} style="height: 40px; padding: 0 14px; font-weight: 600; border-radius: 8px; font-size: 13px; display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                <span>${isChatThinking ? 'Thinking' : 'Send'}</span>
              </button>
            </form>
          </div>

          <!-- COLLAPSIBLE DOCUMENT MANAGER PANEL (Optional, toggled via icon) -->
          ${isDocPanelOpen ? `
            <div class="card" style="width: 330px; flex-shrink: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden; padding: 12px; border: 1px solid var(--line); background: var(--surface); border-radius: 12px; box-shadow: 0 1px 6px rgba(0,0,0,0.02); gap: 8px;" id="knowledgeDocPanel">
              
              <!-- Panel Header with Close Button -->
              <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); padding-bottom: 6px; flex-shrink: 0;">
                <div class="hstack" style="gap: 6px;">
                  <h3 style="font-size: 12.5px; font-weight: 700; margin: 0; color: var(--ink);">Saved Documents (${docs.length})</h3>
                </div>

                <button id="closeDocPanelBtn" class="btn btn--ghost btn--icon-sm" title="Close panel" aria-label="Close" style="width: 24px; height: 24px;">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>

              <!-- Upload Button Box -->
              <div style="border: 1px dashed var(--line); border-radius: 6px; padding: 8px 10px; text-align: center; background: var(--surface-muted); cursor: pointer; flex-shrink: 0;" id="kbDragDropZone" class="${isUploading ? 'uploading-pulse' : ''}">
                <input type="file" id="kbHiddenFileInput" hidden multiple accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.md,.csv,.json,.xml,.yaml,.yml,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.rs,.php,.rb,.sql,.html,.css,.scss,.sh,.zip" />
                <div style="font-size: 11.5px; font-weight: 600; color: var(--ink);">
                  ${isUploading ? 'Uploading & Indexing...' : '+ Upload Documents'}
                </div>
                <div style="font-size: 10px; color: var(--ink-muted);">
                  PDF, DOCX, XLSX, TXT, CSV, MD (max 100 MB)
                </div>
              </div>

              <!-- Search / Filter Documents -->
              <div style="position: relative; flex-shrink: 0;">
                <div style="display: flex; gap: 4px; align-items: center;">
                  <div style="position: relative; flex: 1;">
                    <input type="text" id="filterSourcesInput" class="input" style="height: 28px; font-size: 11px; border-radius: 5px; padding-left: 24px; width: 100%;" placeholder="Search documents..." value="${window.Darkness.utils.escapeHtml(activeFilter)}" />
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" style="position: absolute; left: 7px; top: 50%; transform: translateY(-50%); color: var(--ink-muted);">
                      <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                  </div>

                </div>
              </div>
              <!-- Internally Scrollable Document Cards List -->
              <div style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;" id="kbDocListContainer">
                ${docs.length === 0 ? `
                  <div style="padding: 20px 8px; text-align: center; color: var(--ink-muted); font-size: 11.5px; background: var(--surface-muted); border-radius: 6px; margin: auto 0;">
                    ${totalDocs === 0 ? 'No documents uploaded yet.' : 'No matching documents.'}
                  </div>
                ` : docs.map(renderDocCardHtml).join('')}
              </div>

            </div>
          ` : ''}

        </div>
      </div>
    `;

    bindPageEvents();
  }

  function renderDocCardHtml(d) {
    const safeName = window.Darkness.utils.escapeHtml(d.name || d.path || 'document');
    const ext = (d.extension || '').replace('.', '').toUpperCase() || 'DOC';
    const chunks = d.chunksCount || 0;
    const sizeStr = d.sizeFormatted || formatBytes(d.size || 0);

    return `
      <div style="padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); display: flex; flex-direction: column; gap: 3px;" class="kb-doc-card">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600; color: var(--ink); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${safeName}">
              ${safeName}
            </div>
            <div style="font-size: 9.5px; color: var(--ink-muted);">
              ${ext} • ${sizeStr}
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="hstack" style="gap: 1px; flex-shrink: 0;">
            <button class="btn btn--ghost btn--icon-sm preview-doc-btn" data-doc-path="${window.Darkness.utils.escapeHtml(d.path || d.name)}" title="Preview" aria-label="Preview" style="width: 22px; height: 22px;">
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="btn btn--ghost btn--icon-sm delete-doc-btn" data-doc-id="${d.id || ''}" data-doc-path="${window.Darkness.utils.escapeHtml(d.path || d.name)}" title="Delete" aria-label="Delete" style="width: 22px; height: 22px; color: var(--danger);">
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function renderChatMessageHtml(msg) {
    if (window.Darkness && window.Darkness.uiChat && typeof window.Darkness.uiChat._renderMessage === "function") {
      const copyMsg = { ...msg };
      if (copyMsg.role === 'assistant' && copyMsg.documentsUsed && copyMsg.documentsUsed.length > 0 && !copyMsg.streaming) {
        let sourcesText = "\n\n**Sources**\n";
        copyMsg.documentsUsed.forEach(d => {
           sourcesText += `- ${typeof d === 'string' ? d : d.filename}\n`;
        });
        if (!copyMsg.content) copyMsg.content = "";
        if (!copyMsg.content.includes("**Sources**")) {
           copyMsg.content += sourcesText;
        }
      }
      return window.Darkness.uiChat._renderMessage(copyMsg);
    }
    // Fallback if not loaded
    const isUser = msg.role === 'user';
    const safeContent = window.Darkness.utils.escapeHtml(msg.content);
    return `<div>${safeContent}</div>`;
  }

  function bindPageEvents() {

      // Setup delegation for message controls on page load
      const thread = document.getElementById('knowledgeChatThread');
      if (thread && !thread._hasIntercepts) {
         thread._hasIntercepts = true;
         thread.addEventListener('click', (e) => {
            const btn = e.target.closest('.message-control');
            if (btn) {
               e.stopPropagation();
               const action = btn.getAttribute('data-action');
               const msgEl = btn.closest('.message');
               if (action === 'read-aloud') {
                  const msgId = msgEl ? msgEl.getAttribute("data-msg-id") : null;
                  if (window.Darkness && window.Darkness.narrationSync) {
                     window.Darkness.narrationSync.toggleReadAloud(msgId, msgEl);
                  }
               } else if (action === 'copy') {
                  const content = msgEl ? msgEl.querySelector('.message__content')?.textContent : '';
                  if (content) {
                     navigator.clipboard.writeText(content);
                     window.Darkness.toast.show("Copied to clipboard", "success");
                  }
               } else if (action === 'edit') {
                  const content = msgEl ? msgEl.querySelector('.message__content')?.textContent : '';
                  if (content) {
                     const input = document.getElementById('knowledgeChatInput');
                     if (input) {
                        input.value = content;
                        input.focus();
                     }
                  }
               } else if (action === 'regenerate') {
                  let prev = msgEl.previousElementSibling;
                  let qStr = "";
                  while (prev) {
                     if (prev.classList.contains("message--user")) {
                        qStr = prev.querySelector(".message__content")?.textContent || "";
                        break;
                     }
                     prev = prev.previousElementSibling;
                  }
                  if (qStr) {
                     const input = document.getElementById('knowledgeChatInput');
                     if (input) {
                        input.value = qStr;
                        // Trigger form submit or sendChatMessage
                        document.getElementById('knowledgeChatForm')?.dispatchEvent(new Event('submit'));
                     }
                  }
               }
               return;
            }

            const playerBtn = e.target.closest('[data-player-action]');
            if (playerBtn) {
               e.stopPropagation();
               const pAction = playerBtn.getAttribute("data-player-action");
               const controller = window.Darkness.speechController;
               const bar = playerBtn.closest(".narration-player-bar");
               const mId = bar ? bar.getAttribute("data-player-msg-id") : null;
               if (!controller) return;

               if (pAction === "play-pause") {
                  const state = controller.getState();
                  if (state === "playing") {
                     controller.pause();
                  } else if (state === "paused") {
                     controller.resume();
                  } else if (mId) {
                     window.Darkness.narrationSync?.startReadAloud(mId);
                  }
               } else if (pAction === "stop") {
                  controller.stop();
               } else if (pAction === "replay") {
                  controller.replay();
               } else if (pAction === "preview") {
                  const vSel = bar ? bar.querySelector('[data-player-action="voice"]') : null;
                  controller.previewVoice(vSel ? vSel.value : null);
               }
               return;
            }
            
            const codeCopyBtn = e.target.closest('.code-copy');
            if (codeCopyBtn) {
               e.stopPropagation();
               const codeEl = codeCopyBtn.closest(".code-block").querySelector("code");
               if (codeEl) {
                  navigator.clipboard.writeText(codeEl.textContent).then(() => {
                     window.Darkness.toast.show("Code copied", "success");
                  });
               }
               return;
            }
         });

         thread.addEventListener('change', (e) => {
            const sel = e.target.closest('select[data-player-action]');
            if (sel) {
               const act = sel.getAttribute("data-player-action");
               if (act === "speed") {
                  window.Darkness.speechController?.setSpeed(sel.value);
               } else if (act === "voice") {
                  window.Darkness.speechController?.setVoice(sel.value);
               }
            }
         });
      }

    const fileInput = document.getElementById('kbHiddenFileInput');
    const dropzone = document.getElementById('kbDragDropZone');
    const filterInput = document.getElementById('filterSourcesInput');
    const refreshBtn = document.getElementById('refreshLibraryBtn');
    const togglePanelBtn = document.getElementById('toggleDocPanelBtn');
    const closePanelBtn = document.getElementById('closeDocPanelBtn');

    const chatForm = document.getElementById('knowledgeChatForm');
    const chatInput = document.getElementById('knowledgeChatInput');
    const chatThread = document.getElementById('knowledgeChatThread');
    const clearChatBtn = document.getElementById('clearKnowledgeChatBtn');
    const chatAttachBtn = document.getElementById('knowledgeChatAttachBtn');
    const chatFileInput = document.getElementById('knowledgeChatFileInput');
    const chatAttachmentsCont = document.getElementById('knowledgeChatAttachments');

    function renderKnowledgeChatAttachments() {
      if (!chatAttachmentsCont) return;
      if (knowledgeChatAttachments.length === 0) {
        chatAttachmentsCont.innerHTML = "";
        chatAttachmentsCont.style.display = "none";
      } else {
        chatAttachmentsCont.style.display = "flex";
        chatAttachmentsCont.style.flexWrap = "wrap";
        chatAttachmentsCont.style.gap = "6px";
        chatAttachmentsCont.innerHTML = knowledgeChatAttachments.map(att => {
          if (att.isUploading) {
            return `
              <div style="display:inline-flex; align-items:center; gap:6px; padding:3px 8px; border-radius:12px; background:var(--surface); border:1px dashed var(--accent); font-size:11.5px; color:var(--ink);">
                <span class="spinner" style="width:11px; height:11px;"></span>
                <span>Uploading ${window.Darkness.utils.escapeHtml(att.name)}...</span>
              </div>
            `;
          }
          const safeName = window.Darkness.utils.escapeHtml(att.name || "document");
          const chipId = String(att.id || att.file_id || "");
          return `
            <div style="display:inline-flex; align-items:center; gap:5px; padding:3px 8px; border-radius:12px; background:var(--surface); border:1px solid var(--line-strong); font-size:11.5px; color:var(--ink);">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span style="font-weight:500;">${safeName}</span>
              <button type="button" class="kb-att-remove" data-id="${chipId}" title="Remove file" style="border:none; background:transparent; color:var(--ink-muted); cursor:pointer; padding:0 2px; line-height:1; display:flex; align-items:center;">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          `;
        }).join("");

        chatAttachmentsCont.querySelectorAll(".kb-att-remove").forEach(btn => {
          btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const targetId = btn.getAttribute("data-id");
            knowledgeChatAttachments = knowledgeChatAttachments.filter(a => String(a.id) !== String(targetId) && String(a.file_id) !== String(targetId));
            renderKnowledgeChatAttachments();
          };
        });
      }
    }
    renderKnowledgeChatAttachments();

    async function handleKnowledgeChatUploadFiles(selectedFiles) {
      if (!selectedFiles || selectedFiles.length === 0) return;
      const MAX_UPLOAD_SIZE = 104857600; // 100 MB
      const oversized = selectedFiles.filter(f => f.size > MAX_UPLOAD_SIZE);
      if (oversized.length > 0) {
        const names = oversized.map(f => `${f.name} (${(f.size / (1024 * 1024)).toFixed(1)} MB)`).join(', ');
        window.Darkness.toast.show(`File exceeds 100 MB limit: ${names}. Maximum allowed file size is 100 MB.`, "danger");
      }
      const validFiles = selectedFiles.filter(f => f.size <= MAX_UPLOAD_SIZE);
      if (validFiles.length === 0) return;

      const tempId = "uploading_" + Date.now();
      validFiles.forEach((f, idx) => {
        knowledgeChatAttachments.push({
          id: tempId + "_" + idx,
          file_id: tempId + "_" + idx,
          name: f.name,
          size: f.size,
          isUploading: true
        });
      });
      renderKnowledgeChatAttachments();

      try {
        const formData = new FormData();
        validFiles.forEach(f => formData.append("files", f, f.name));
        const resp = await fetch((window.Darkness.api?.base || "") + "/api/files/upload", {
          method: "POST",
          body: formData,
          credentials: "include"
        });

        knowledgeChatAttachments = knowledgeChatAttachments.filter(a => !a.isUploading);

        if (resp.status === 413) {
          throw new Error("File exceeds 100 MB upload limit.");
        }
        if (!resp.ok) {
          throw new Error("Upload failed");
        }
        const data = await resp.json();
        const returnedFiles = data.files || (data.file ? [data.file] : []);

        for (const resItem of returnedFiles) {
          knowledgeChatAttachments.push({
            id: resItem.id || ("file_" + Date.now()),
            file_id: resItem.id,
            name: resItem.filename || resItem.name || "document",
            size: resItem.size || 0,
            type: resItem.file_type || "file",
            content: resItem.content || ""
          });
        }
        window.Darkness.toast.show(`Attached ${returnedFiles.length} file(s) to Knowledge Chat`, "success");
      } catch (err) {
        knowledgeChatAttachments = knowledgeChatAttachments.filter(a => !a.isUploading);
        window.Darkness.toast.show("File upload failed: " + (err.message || ""), "danger");
      }
      renderKnowledgeChatAttachments();
    }

    if (chatAttachBtn && chatFileInput) {
      chatAttachBtn.onclick = () => chatFileInput.click();
      chatFileInput.onchange = async (e) => {
        const selectedFiles = Array.from(e.target.files || []);
        if (selectedFiles.length === 0) return;
        e.target.value = "";
        await handleKnowledgeChatUploadFiles(selectedFiles);
      };
    }

    // Dedicated clipboard paste handler for Knowledge RAG Chat
    const handleKnowledgeChatPaste = async (event) => {
      if (event._knowledgeChatHandled) return;
      const clipboardData = event.clipboardData || window.clipboardData;
      if (!clipboardData) return;

      const items = Array.from(clipboardData.items || []);
      const filesToUpload = [];

      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            let fileName = file.name;
            if (!fileName || fileName === "image.png" || fileName === "blob") {
              const ext = (file.type && file.type.split("/")[1]) || "png";
              fileName = `kb_screenshot_${Date.now()}.${ext}`;
              try {
                filesToUpload.push(new File([file], fileName, { type: file.type || "image/png" }));
              } catch (_) {
                filesToUpload.push(file);
              }
            } else {
              filesToUpload.push(file);
            }
          }
        }
      }

      if (filesToUpload.length === 0 && clipboardData.files && clipboardData.files.length > 0) {
        for (const file of Array.from(clipboardData.files)) {
          filesToUpload.push(file);
        }
      }

      if (filesToUpload.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        event._knowledgeChatHandled = true;
        await handleKnowledgeChatUploadFiles(filesToUpload);
      } else {
        // Plain text paste into knowledgeChatInput: stop propagation so it stays strictly isolated to this box
        event.stopPropagation();
      }
    };

    chatInput?.addEventListener("paste", handleKnowledgeChatPaste);
    chatForm?.addEventListener("paste", handleKnowledgeChatPaste);

    // Toggle Document Panel Open / Closed
    if (chatInput) {
      chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
      });
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          chatForm?.dispatchEvent(new Event('submit'));
        }
      });
    }

    const toggleDocPanel = () => {
      isDocPanelOpen = !isDocPanelOpen;
      localStorage.setItem('darkness_kb_doc_panel_open', isDocPanelOpen ? 'true' : 'false');
      renderPage(document.getElementById('main'));
    };

    togglePanelBtn?.addEventListener('click', toggleDocPanel);
    closePanelBtn?.addEventListener('click', toggleDocPanel);

    // Upload triggers
    const triggerUpload = () => fileInput && fileInput.click();
    dropzone?.addEventListener('click', triggerUpload);

    fileInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleUploadFiles(Array.from(e.target.files));
      }
    });

    // Drag and drop events
    if (dropzone) {
      ['dragenter', 'dragover'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.style.borderColor = '#8b5cf6';
          dropzone.style.background = 'rgba(139, 92, 246, 0.06)';
        });
      });

      ['dragleave', 'drop'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.style.borderColor = 'var(--line)';
          dropzone.style.background = 'var(--surface-muted)';
        });
      });

      dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
          handleUploadFiles(Array.from(dt.files));
        }
      });
    }

    // Filter documents
    filterInput?.addEventListener('input', (e) => {
      activeFilter = e.target.value.trim();
      const container = document.getElementById('kbDocListContainer');
      if (container) {
        const filteredDocs = (ragData.documents || []).filter(d => {
          if (!activeFilter) return true;
          const q = activeFilter.toLowerCase();
          return (d.name || '').toLowerCase().includes(q) || 
                 (d.path || '').toLowerCase().includes(q) || 
                 (d.fileType || '').toLowerCase().includes(q);
        });
        container.innerHTML = filteredDocs.length === 0 
          ? `<div style="padding: 16px 8px; text-align: center; color: var(--ink-muted); font-size: 11px; background: var(--surface-muted); border-radius: 6px;">No matching documents.</div>`
          : filteredDocs.map(renderDocCardHtml).join('');
        rebindDocActionButtons();
      }
    });

    // Refresh Library
    refreshBtn?.addEventListener('click', async () => {
      if (isRefreshing) return;
      isRefreshing = true;
      const svg = refreshBtn.querySelector('svg');
      if (svg) svg.classList.add('spin-anim');
      refreshBtn.setAttribute('disabled', 'true');

      try {
        await loadRagData();
        window.Darkness?.toast?.show('Library refreshed', 'info');
      } catch (err) {
        window.Darkness?.toast?.show('Failed to refresh library', 'danger');
      } finally {
        isRefreshing = false;
        renderPage(document.getElementById('main'));
      }
    });

    // Auto-scroll chat thread to bottom
    if (chatThread) {
      chatThread.scrollTop = chatThread.scrollHeight;
    }

    // Send chat query function
    
    const sendChatMessage = async (text) => {
      const q = (text || chatInput?.value || '').trim();
      if ((!q && knowledgeChatAttachments.length === 0) || isChatThinking) return;

      const attachmentsToSend = knowledgeChatAttachments.slice();
      knowledgeChatAttachments = [];
      renderKnowledgeChatAttachments();

      let displayContent = q;
      if (attachmentsToSend.length > 0) {
        const attBadges = attachmentsToSend.map(a => `📎 ${a.name}`).join(" • ");
        displayContent = (q ? `${q}\n\n` : "") + `*(Attached: ${attBadges})*`;
      }

      const userMsg = {
        id: 'user-' + Date.now(),
        role: 'user',
        content: displayContent,
        rawQuery: q,
        attachments: attachmentsToSend,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      chatMessages.push(userMsg);
      saveChatMessages();
      if (chatInput) { chatInput.value = ''; chatInput.style.height = 'auto'; }
      
      const aiMsg = {
          id: 'ai-' + Date.now(),
          role: 'assistant',
          content: "",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          documentsUsed: [],
          streaming: true,
      };
      chatMessages.push(aiMsg);
      isChatThinking = true;

      const performRender = () => {
         renderPage(document.getElementById('main'));
         setTimeout(() => {
            const thread = document.getElementById('knowledgeChatThread');
            if (thread) {
               thread.scrollTop = thread.scrollHeight;
               if (window.Darkness.uiChat._bindMessageControls) {
                  window.Darkness.uiChat._bindMessageControls(thread);
               }
            }
         }, 10);
      };

      
      performRender();
      
      // Setup intercepts for edit/copy/regenerate in knowledge chat
      const thread = document.getElementById('knowledgeChatThread');
      if (thread && !thread._hasIntercepts) {
         thread._hasIntercepts = true;
         thread.addEventListener('click', (e) => {
            const btn = e.target.closest('.message-control');
            if (!btn) return;
            const action = btn.getAttribute('data-action');
            if (action === 'copy') {
               e.stopPropagation();
               const msgEl = btn.closest('.message');
               const content = msgEl ? msgEl.querySelector('.message__content')?.textContent : '';
               if (content) {
                  navigator.clipboard.writeText(content);
                  window.Darkness.toast.show("Copied to clipboard", "success");
               }
            } else if (action === 'edit') {
               e.stopPropagation();
               // Implement simple edit fallback for Knowledge RAG
               const msgEl = btn.closest('.message');
               const content = msgEl ? msgEl.querySelector('.message__content')?.textContent : '';
               if (content) {
                  const input = document.getElementById('knowledgeChatInput');
                  if (input) {
                     input.value = content;
                     input.focus();
                  }
               }
            } else if (action === 'regenerate') {
               e.stopPropagation();
               // Find previous user message
               const msgEl = btn.closest('.message');
               let prev = msgEl.previousElementSibling;
               let q = "";
               while (prev) {
                  if (prev.classList.contains("message--user")) {
                     q = prev.querySelector(".message__content")?.textContent || "";
                     break;
                  }
                  prev = prev.previousElementSibling;
               }
               if (q) {
                  // send it again
                  const input = document.getElementById('knowledgeChatInput');
                  if (input) {
                     input.value = q;
                     sendChatMessage();
                  }
               }
            }
         }, true);
      }

      try {
        const historyPayload = chatMessages.slice(0, -1).map(m => ({
          role: m.role,
          content: m.content
        }));
        const activeModelId = window.Darkness?.store?.get?.("active_model") || window.Darkness?.chat?._activeModel || undefined;

        const res = await fetch('/api/knowledge/rag/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: q || "Explain the attached documents",
            conversationHistory: historyPayload,
            model_id: activeModelId,
            attachments: attachmentsToSend,
            file_ids: attachmentsToSend.map(a => a.id || a.file_id).filter(Boolean),
          }),
        });
        
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
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
                if (event.error) {
                   aiMsg.content = event.error.message || "Error generating response.";
                   aiMsg.streaming = false;
                   performRender();
                } else if (event.done) {
                   aiMsg.streaming = false;
                   if (event.documentsUsed) aiMsg.documentsUsed = event.documentsUsed;
                   if (event.sources) aiMsg.sources = event.sources;
                   saveChatMessages();
                   performRender();
                } else if (event.content) {
                   aiMsg.content += event.content;
                   performRender();
                }
             } catch(e) {}
          }
        }
      } catch (err) {
        aiMsg.content = `⚠️ Error: ${err.message || 'Failed to reach AI service'}.`;
        aiMsg.streaming = false;
        saveChatMessages();
      } finally {
        isChatThinking = false;
        performRender();
        setTimeout(() => {
          const input = document.getElementById('knowledgeChatInput');
          if (input) input.focus();
        }, 30);
      }
    };

    chatForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      sendChatMessage();
    });

    chatInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });



    // Clear Chat
    const exportChatBtn = document.getElementById('exportKnowledgeChatBtn');
    exportChatBtn?.addEventListener('click', async () => {
      if (chatMessages.length === 0) return;
      try {
        const oldText = exportChatBtn.querySelector('span').textContent;
        exportChatBtn.querySelector('span').textContent = 'Exporting...';
        
        if (window.Darkness && window.Darkness.uiChat && window.Darkness.uiChat.exportChatToPdf) {
          await window.Darkness.uiChat.exportChatToPdf({ feed: document.getElementById('knowledgeChatThread') });
        } else {
           window.Darkness.toast.show('Export not ready', 'danger');
        }
        
        exportChatBtn.querySelector('span').textContent = oldText;
      } catch (err) {
        window.Darkness.toast.show('Failed to export', 'danger');
        console.error(err);
      }
    });

    clearChatBtn?.addEventListener('click', async () => {
      chatMessages = [];
      try {
        const user = window.Darkness?.auth?.getUser ? window.Darkness.auth.getUser() : null;
        const cid = "knowledge_rag_chat_" + (user?.id || "default");
        await fetch(`/api/conversations/${encodeURIComponent(cid)}`, { method: "DELETE", credentials: "include" });
      } catch (e) {}
      renderPage(document.getElementById('main'));
      window.Darkness.toast.show('Chat cleared', 'info');
    });

    // Copy Message Text
    document.querySelectorAll('.copy-msg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const content = btn.getAttribute('data-content') || '';
        navigator.clipboard.writeText(content).then(() => {
          window.Darkness.toast.show('Copied to clipboard', 'success');
        }).catch(() => {
          window.Darkness.toast.show('Could not copy', 'danger');
        });
      });
    });

    // Preview source pill
    document.querySelectorAll('.preview-source-pill').forEach(pill => {
      pill.addEventListener('click', async () => {
        const docName = pill.getAttribute('data-doc-name');
        try {
          const res = await fetch(`/api/knowledge/rag/chunks?filePath=${encodeURIComponent(docName)}`);
          const data = await res.json();
          const chunks = data.chunks || [];
          const fullText = chunks.map(c => c.content).join('\n\n') || '(No content available)';
          
          window.Darkness.modal.open(
            `Document: ${docName}`,
            `<pre style="white-space: pre-wrap; max-height: 55vh; overflow: auto; background: var(--surface-muted); padding: 12px; border-radius: 8px; font-size: 12px; font-family: var(--font-mono);">${window.Darkness.utils.escapeHtml(fullText)}</pre>`,
            `<button class="btn btn--primary" data-modal-close="true">Close</button>`
          );
        } catch {
          window.Darkness.toast.show('Preview unavailable', 'danger');
        }
      });
    });

    rebindDocActionButtons();
  }

  function rebindDocActionButtons() {
    // Preview Doc
    document.querySelectorAll('.preview-doc-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const docPath = btn.getAttribute('data-doc-path');
        try {
          const res = await fetch(`/api/knowledge/rag/chunks?filePath=${encodeURIComponent(docPath)}`);
          const data = await res.json();
          const chunks = data.chunks || [];
          const fullText = chunks.map(c => c.content).join('\n\n') || '(No preview content available)';
          
          window.Darkness.modal.open(
            `Preview: ${docPath}`,
            `<pre style="white-space: pre-wrap; max-height: 55vh; overflow: auto; background: var(--surface-muted); padding: 12px; border-radius: 8px; font-size: 12px; font-family: var(--font-mono);">${window.Darkness.utils.escapeHtml(fullText)}</pre>`,
            `<button class="btn btn--primary" data-modal-close="true">Close</button>`
          );
        } catch {
          window.Darkness.toast.show('Preview unavailable', 'danger');
        }
      });
    });

    // Permanent Delete Document from Database
    document.querySelectorAll('.delete-doc-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const docId = btn.getAttribute('data-doc-id');
        const docPath = btn.getAttribute('data-doc-path');
        
        window.Darkness.modal.open(
          'Delete Document?',
          `<div style="font-size: 13px; line-height: 1.5; color: var(--ink);">
             Are you sure you want to permanently delete <strong>${window.Darkness.utils.escapeHtml(docPath)}</strong>?
           </div>`,
          `<div class="hstack" style="gap: 8px; justify-content: flex-end;">
             <button class="btn btn--outline" data-modal-close="true">Cancel</button>
             <button class="btn btn--danger" id="confirmDeleteKbDocBtn">Delete</button>
           </div>`
        );

        document.getElementById('confirmDeleteKbDocBtn')?.addEventListener('click', async () => {
          window.Darkness.modal.close();
          window.Darkness.toast.show('Deleting document...', 'info');
          try {
            const res = await fetch('/api/knowledge/rag/documents', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: docId, path: docPath }),
            });
            const data = await res.json();
            if (data.success) {
              window.Darkness.toast.show('Document deleted', 'success');
              await loadRagData();
              renderPage(document.getElementById('main'));
            } else {
              window.Darkness.toast.show(data.error || 'Deletion failed', 'danger');
            }
          } catch (err) {
            window.Darkness.toast.show('Failed to delete: ' + err.message, 'danger');
          }
        }, { once: true });
      });
    });
  }

  async function handleUploadFiles(files) {
    if (!files || files.length === 0) return;

    const MAX_UPLOAD_SIZE = 104857600; // 100 MB (104,857,600 bytes)
    const fileList = Array.from(files);
    const oversized = fileList.filter(f => f.size > MAX_UPLOAD_SIZE);
    if (oversized.length > 0) {
      const names = oversized.map(f => `${f.name} (${(f.size / (1024 * 1024)).toFixed(1)} MB)`).join(', ');
      window.Darkness.toast.show(`File exceeds 100 MB limit: ${names}. Maximum allowed file size is 100 MB (104,857,600 bytes).`, 'danger');
    }

    const validFiles = fileList.filter(f => f.size <= MAX_UPLOAD_SIZE);
    if (validFiles.length === 0) return;

    isUploading = true;
    renderPage(document.getElementById('main'));
    window.Darkness.toast.show(`Uploading ${validFiles.length} document(s)...`, 'info');

    const fd = new FormData();
    validFiles.forEach(f => fd.append('files', f, f.name));

    try {
      const res = await fetch('/api/knowledge/rag/upload', {
        method: 'POST',
        body: fd,
      });

      if (res.status === 413) {
        window.Darkness.toast.show('Upload rejected: File exceeds the 100 MB maximum size limit.', 'danger');
        return;
      }

      const data = await res.json();
      if (data.success) {
        window.Darkness.toast.show(data.message || 'Files saved and indexed!', 'success');
        await loadRagData();
      } else {
        window.Darkness.toast.show(data.error || 'Upload failed', 'danger');
      }
    } catch (err) {
      window.Darkness.toast.show('Upload failed: ' + err.message, 'danger');
    } finally {
      isUploading = false;
      renderPage(document.getElementById('main'));
    }
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
})();
