window.Clarity = window.Clarity || {};

window.Clarity.composer = {
  _attachedFiles: [],
  _isStreaming: false,
  _onStop: null,
  _isThinking: false,
  _isRecording: false,
  _recognition: null,
  _mountedContainer: null,

  mount(container, onSubmit, modelId, existingAttachments) {
    if (!container) return null;

    this._mountedContainer = container;
    this._attachedFiles = existingAttachments || [];
    const fileCount = this._attachedFiles.length;

    container.innerHTML = [
      '<div class="composer-card" id="composerCard">',
        '<!-- Top-left attachments tray -->',
        '<div class="composer-card__attachments" id="composerAttachments"></div>',

        '<!-- Single unified compact row -->',
        '<div class="composer-card__main composer-card__main--unified">',
          '<div class="composer-card__footer-left">',
            '<button class="composer-btn composer-btn--upload" id="composerUpload" type="button" title="Attach documents, PDFs, images, or code" aria-label="Attach documents">',
              '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
                '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
                '<polyline points="17 8 12 3 7 8"/>',
                '<line x1="12" y1="3" x2="12" y2="15"/>',
              '</svg>',
            '</button>',
            '<input type="file" id="composerFileInput" hidden multiple accept=".pdf,.docx,.doc,.pptx,.ppt,.txt,.md,.csv,.json,.xml,.yaml,.yml,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.rs,.php,.rb,.sql,.html,.css,.scss,.sh,.zip,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff">',
          '</div>',
          '<div class="composer-card__input-wrap">',
            '<textarea id="composerInput" rows="1" placeholder="Ask Darkness" aria-label="Message input"></textarea>',
          '</div>',
          '<div class="composer-card__footer-right">',
            '<button class="composer-btn composer-btn--send" id="composerSend" type="button" title="Send message" aria-label="Send message" disabled>',
              '<span class="composer-send-inner">',
                '<svg class="composer-send-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right: 2px; margin-top: 1px;">',
                  '<line x1="22" y1="2" x2="11" y2="13"/>',
                  '<polygon points="22 2 15 22 11 13 2 9 22 2"/>',
                '</svg>',
              '</span>',
            '</button>',
          '</div>',
        '</div>',
      '</div>',
    ].join('');

    if (fileCount > 0) this._refreshAttachments();

    // Dynamically update placeholder
    const input = container.querySelector("#composerInput");
    if (input) {
      let projName = "";
      const conv = window.Clarity?.state?.activeConversation;
      if (conv && conv.project_id) {
        const projId = conv.project_id;
        const proj = window.Clarity?.state?.projects?.find(p => p.id === projId);
        if (proj) {
          projName = proj.name;
        }
      }
      if (projName) {
        input.placeholder = "Ask anything about " + projName + "...";
      } else {
        input.placeholder = "Ask Darkness";
      }
    }

    const fileInput = container.querySelector("#composerFileInput");
    const uploadBtn = container.querySelector("#composerUpload");
    const sendBtn = container.querySelector("#composerSend");
    const card = container.querySelector("#composerCard");

    // Auto-grow textarea smoothly based on typed content
    const autoResize = () => {
      if (!input) return;
      input.style.height = "auto";
      const scrollH = input.scrollHeight;
      const targetH = Math.min(Math.max(scrollH, 32), 220);
      input.style.height = targetH + "px";
      input.style.overflowY = scrollH > 220 ? "auto" : "hidden";
    };
    this.autoResize = autoResize;

    const updateSendState = () => {
      this._syncSendButton();
    };

    if (input) {
      setTimeout(autoResize, 0);
      input.addEventListener("input", () => {
        autoResize();
        updateSendState();
        if (window.Clarity && window.Clarity.chat && window.Clarity.chat.setRobotState) {
          window.Clarity.chat.setRobotState("listening");
          clearTimeout(window.Clarity.composer._typingTimeout);
          window.Clarity.composer._typingTimeout = setTimeout(() => {
            if (!window.Clarity.composer._isStreaming) {
              window.Clarity.chat.setRobotState("idle");
            }
          }, 3000);
        }
      });

      input.addEventListener("keyup", autoResize);
      input.addEventListener("change", autoResize);
      input.addEventListener("paste", () => setTimeout(autoResize, 10));

      input.addEventListener("focus", () => {
        autoResize();
        if (window.Clarity && window.Clarity.chat && window.Clarity.chat.setRobotState && !window.Clarity.composer._isStreaming) {
          window.Clarity.chat.setRobotState("attention");
          setTimeout(() => {
            if (!window.Clarity.composer._isStreaming && document.activeElement === input) {
              window.Clarity.chat.setRobotState("listening");
            }
          }, 800);
        }
      });

      input.addEventListener("blur", () => {
        if (window.Clarity && window.Clarity.chat && window.Clarity.chat.setRobotState && !window.Clarity.composer._isStreaming) {
          window.Clarity.chat.setRobotState("idle");
        }
      });

      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          handleActionClick();
        }
      });
    }

    const send = () => {
      if (this._isStreaming) return;
      const value = String((input ? input.value : "") || "").trim();
      if (!value && this._attachedFiles.length === 0) return;
      const toSendAttachments = this._attachedFiles.slice();
      if (input) {
        input.value = "";
        autoResize();
      }
      this._attachedFiles = [];
      this._refreshAttachments();
      updateSendState();
      if (typeof onSubmit === "function") {
        onSubmit(value, toSendAttachments, this._isThinking);
      }
    };

    const handleActionClick = (e) => {
      if (e) e.preventDefault();
      if (this._isStreaming) {
        if (typeof this._onStop === "function") {
          this._onStop();
        }
      } else {
        send();
      }
    };

    if (sendBtn) sendBtn.addEventListener("click", handleActionClick);

    if (uploadBtn) {
      uploadBtn.addEventListener("click", () => {
        if (fileInput) fileInput.click();
      });
    }

    // Voice recognition logic
    this._initVoiceInput(container);

    // Drag and Drop
    if (card) {
      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        card.classList.add("is-dragover");
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("is-dragover");
      });
      card.addEventListener("drop", async (e) => {
        e.preventDefault();
        card.classList.remove("is-dragover");
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length > 0) {
          await this._handleFiles(files, fileInput);
          if (input) input.focus();
        }
      });
    }

    // Clipboard Paste (Ctrl+V) handler for images, screenshots, and files
    const handlePaste = async (event) => {
      if (event._clarityHandled) return;
      if (!card || (!card.contains(event.target) && event.target !== input)) {
        return;
      }
      event._clarityHandled = true;

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
              fileName = `screenshot_${Date.now()}.${ext}`;
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

      // Fallback for clipboardData.files only if items had no files
      if (filesToUpload.length === 0 && clipboardData.files && clipboardData.files.length > 0) {
        for (const file of Array.from(clipboardData.files)) {
          filesToUpload.push(file);
        }
      }

      if (filesToUpload.length > 0) {
        // Prevent default so raw binary/blob data is not inserted into textarea
        event.preventDefault();
        event.stopPropagation();
        await this._handleFiles(filesToUpload, fileInput);
        if (input) {
          input.focus();
          autoResize();
          this._syncSendButton();
        }
      }
    };

    // Attach paste handler ONLY once on the card wrapper to avoid double-firing via bubbling
    if (card) {
      if (card._clarityPasteHandler) {
        card.removeEventListener("paste", card._clarityPasteHandler);
      }
      card._clarityPasteHandler = handlePaste;
      card.addEventListener("paste", handlePaste);
    }

    if (fileInput) {
      fileInput.addEventListener("change", async (event) => {
        const files = Array.from(event.target.files || []);
        event.target.value = "";
        await this._handleFiles(files, fileInput);
        if (input) input.focus();
      });
    }

    this._syncSendButton();
    return { input, sendBtn, fileInput, uploadBtn };
  },

  setStreaming(isStreaming, onStop) {
    this._isStreaming = !!isStreaming;
    this._onStop = onStop || null;
    const sendBtn = document.getElementById("composerSend");
    if (!sendBtn) return;

    if (this._isStreaming) {
      sendBtn.disabled = false;
      sendBtn.classList.add("is-streaming");
      sendBtn.title = "Stop generation";
      sendBtn.innerHTML = `
        <span class="composer-send-inner">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
        </span>
      `;
    } else {
      sendBtn.classList.remove("is-streaming");
      sendBtn.title = "Send message";
      sendBtn.innerHTML = `
        <span class="composer-send-inner">
          <svg class="composer-send-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right: 2px; margin-top: 1px;">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </span>
      `;
      this._syncSendButton();
    }
  },

  _syncSendButton() {
    const sendBtn = document.getElementById("composerSend");
    if (!sendBtn) return;
    if (this._isStreaming) {
      sendBtn.disabled = false;
    } else {
      const input = document.getElementById("composerInput");
      const hasContent = (input?.value || "").trim().length > 0 || this._attachedFiles.length > 0;
      sendBtn.disabled = !hasContent;
    }
  },

  async _handleFiles(files, fileInput) {
    const maxSize = 104857600; // 100 MB (104,857,600 bytes)
    const validFiles = [];
    const errors = [];

    // Deduplicate against files already attached or currently in this._attachedFiles
    const existingSignatures = new Set(this._attachedFiles.map(a => `${a.name}_${a.size}`));

    for (const file of files) {
      if (file.size > maxSize) {
        errors.push(`${file.name} is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed upload size is 100 MB (104,857,600 bytes).`);
        continue;
      }
      const sig = `${file.name}_${file.size}`;
      if (existingSignatures.has(sig)) {
        continue; // Prevent duplicate attachment
      }
      existingSignatures.add(sig);
      validFiles.push(file);
    }

    for (const err of errors) {
      window.Clarity.toast.show(err, "danger");
    }
    if (validFiles.length === 0) return;

    // Create instant local previews for responsive UX
    const tempUploadId = "uploading_" + Date.now();
    const tempItems = validFiles.map((f, i) => {
      const isImg = f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name);
      let localUrl = "";
      if (isImg) {
        try { localUrl = URL.createObjectURL(f); } catch (_) {}
      }
      return {
        id: tempUploadId + "_" + i,
        file_id: tempUploadId + "_" + i,
        name: f.name,
        size: f.size,
        type: isImg ? "image" : (/\.pdf$/i.test(f.name) ? "pdf" : "file"),
        mime: f.type,
        localPreview: localUrl,
        isUploading: true,
      };
    });

    this._attachedFiles.push(...tempItems);
    this._refreshAttachments();
    this._syncSendButton();

    try {
      const formData = new FormData();
      validFiles.forEach(f => formData.append("files", f, f.name));

      const resp = await fetch((window.Clarity.api?.base || "") + "/api/files/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      // Revoke local preview URLs for temp items
      tempItems.forEach(t => {
        if (t.localPreview) {
          try { URL.revokeObjectURL(t.localPreview); } catch (_) {}
        }
      });

      // Remove temp loading items
      this._attachedFiles = this._attachedFiles.filter(f => !f.isUploading);

      if (!resp.ok) {
        const text = await resp.text();
        let parsedErr;
        try { parsedErr = JSON.parse(text); } catch(e){}
        throw new Error((parsedErr && parsedErr.error) || `Upload failed with status ${resp.status}`);
      }

      const data = await resp.json();
      const filesReturned = data.files || (data.file ? [data.file] : []);

      for (const result of filesReturned) {
        const fileName = result.filename || result.name || "document";
        const isPdf = (result.mime && result.mime.includes("pdf")) || /\.pdf$/i.test(fileName);
        const isImage = (result.mime && result.mime.startsWith("image/")) || result.file_type === "image" || /\.(png|jpe?g|webp|gif|bmp)$/i.test(fileName);
        const originalFile = validFiles.find(f => f.name === fileName);
        const fileSize = result.size || originalFile?.size || 0;
        const fileId = result.id || ("file_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7));

        if (result.file_type === "archive") {
          const projectName = fileName || "Uploaded Project";
          const projResp = await fetch((window.Clarity.api?.base || "") + "/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ name: projectName, description: "Auto-created from upload" }),
          });
          const projData = await projResp.json();
          const projectId = projData.id;

          if (result.extracted && result.extracted.length > 0) {
            await fetch((window.Clarity.api?.base || "") + `/api/projects/${projectId}/index`, { method: "POST", credentials: "include" });
          }

          this._attachedFiles.push({
            id: projectId,
            file_id: projectId,
            name: projectName,
            size: fileSize,
            type: "project",
            url: `#/project/${projectId}`,
          });
        } else {
          let url = "";
          if (isImage && result.id) {
            url = await this._getFileUrl(result.id);
          }
          this._attachedFiles.push({
            id: fileId,
            file_id: result.id || fileId,
            name: fileName,
            size: fileSize,
            type: isImage ? "image" : (isPdf ? "pdf" : "file"),
            mime: result.mime || (isPdf ? "application/pdf" : (isImage ? "image/png" : "application/octet-stream")),
            url: url,
            content: result.content || "",
          });
        }
      }

      if (this._attachedFiles.length > 0) {
        if (window.Clarity.uiChat) {
          window.Clarity.uiChat._attachedFiles = this._attachedFiles;
          if (typeof window.Clarity.uiChat._saveState === "function") {
            window.Clarity.uiChat._saveState();
          }
        }
        this._refreshAttachments();
        this._syncSendButton();
      }
    } catch (err) {
      this._attachedFiles = this._attachedFiles.filter(f => !f.isUploading);
      this._refreshAttachments();
      console.error("File upload error:", err);
      window.Clarity.toast.show("Upload failed: " + (err.message || "network error"), "danger");
    }
  },

  async _getFileUrl(fileId) {
    return window.Clarity.api.base + `/api/files/${fileId}/raw`;
  },

  async _getFileContent(fileId) {
    try {
      const data = await window.Clarity.api.get(`/api/files/${fileId}/content`);
      return data.content || "";
    } catch (err) {
      return "";
    }
  },

  removeFile(fileId) {
    if (!fileId) return;
    const removed = this._attachedFiles.find(f => String(f.id) === String(fileId) || String(f.file_id) === String(fileId));
    if (removed && removed.localPreview) {
      try { URL.revokeObjectURL(removed.localPreview); } catch (_) {}
    }
    this._attachedFiles = this._attachedFiles.filter(f => String(f.id) !== String(fileId) && String(f.file_id) !== String(fileId));
    if (window.Clarity.uiChat) {
      window.Clarity.uiChat._attachedFiles = this._attachedFiles;
      if (typeof window.Clarity.uiChat._saveState === "function") {
        window.Clarity.uiChat._saveState();
      }
    }
    this._refreshAttachments();
    this._syncSendButton();
  },

  _getAttachmentsContainer() {
    return (this._mountedContainer && this._mountedContainer.querySelector("#composerAttachments")) || document.getElementById("composerAttachments");
  },

  _refreshAttachments() {
    const container = this._getAttachmentsContainer();
    if (!container) return;
    if (this._attachedFiles.length === 0) {
      container.innerHTML = "";
      container.classList.remove("is-active");
    } else {
      container.innerHTML = this._renderAttachments();
      container.classList.add("is-active");
      this._bindRemoveButtons();
    }
    this._syncSendButton();
  },

  _renderAttachments() {
    if (this._attachedFiles.length === 0) return "";
    const items = this._attachedFiles.map(att => {
      const safeName = window.Clarity.utils.escapeHtml(att.name || "attachment");
      const sizeText = att.size ? formatBytes(att.size) : "";
      const chipId = String(att.id || att.file_id || "");
      const isImage = att.type === "image" || (att.mime && att.mime.startsWith("image/")) || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(att.name || "");
      const isPdf = att.type === "pdf" || (att.mime && att.mime.includes("pdf")) || /\.pdf$/i.test(att.name || "");
      const isDoc = /\.(docx?|odt|rtf|txt|md)$/i.test(att.name || "");
      const isSheet = /\.(xlsx?|csv|tsv)$/i.test(att.name || "");
      const isSlide = /\.(pptx?|key)$/i.test(att.name || "");

      let badgeClass = "composer-att-badge--file";
      let badgeLabel = "FILE";
      if (isPdf) { badgeClass = "composer-att-badge--pdf"; badgeLabel = "PDF"; }
      else if (isDoc) { badgeClass = "composer-att-badge--doc"; badgeLabel = "DOC"; }
      else if (isSheet) { badgeClass = "composer-att-badge--xls"; badgeLabel = "XLS"; }
      else if (isSlide) { badgeClass = "composer-att-badge--ppt"; badgeLabel = "PPT"; }

      let previewNode = "";
      if (isImage && (att.url || att.localPreview)) {
        previewNode = `
          <div class="composer-att-thumb-wrap">
            <img src="${att.url || att.localPreview}" alt="${safeName}" class="composer-att-thumb" />
            ${att.isUploading ? '<span class="composer-att-spinner"></span>' : ''}
          </div>
        `;
      } else {
        previewNode = `
          <span class="composer-att-badge ${badgeClass}">${badgeLabel}</span>
          ${att.isUploading ? '<span class="composer-att-spinner"></span>' : ''}
        `;
      }

      return `
        <div class="composer-att-chip ${isImage ? 'composer-att-chip--image' : 'composer-att-chip--file'}" data-attach-id="${chipId}" title="${safeName}">
          ${previewNode}
          <div class="composer-att-info">
            <span class="composer-att-name">${safeName}</span>
            ${sizeText ? `<span class="composer-att-size">${sizeText}</span>` : ''}
          </div>
          <button class="composer-att-remove attachment-remove" type="button" title="Remove ${safeName}" aria-label="Remove ${safeName}" data-remove-id="${chipId}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      `;
    });

    return `<div class="composer-attachments-wrapper">${items.join("")}</div>`;
  },

  _bindRemoveButtons() {
    const container = this._getAttachmentsContainer();
    if (!container) return;
    container.querySelectorAll(".attachment-remove").forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const removeId = btn.getAttribute("data-remove-id") || btn.closest("[data-attach-id]")?.getAttribute("data-attach-id");
        if (removeId) {
          this.removeFile(removeId);
        }
      };
    });
  },

  getAttachedFiles() {
    return this._attachedFiles;
  },

  clearAttachments() {
    this._attachedFiles = [];
    this._refreshAttachments();
  },

  _initVoiceInput(container) {
    const micBtn = container.querySelector("#composerMicBtn");
    if (!micBtn) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      micBtn.style.display = "none";
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      this._isRecording = true;
      micBtn.classList.add("is-recording");
      window.Clarity.toast.show("Listening... Speak now", "info");
    };

    recognition.onerror = (e) => {
      console.warn("Speech recognition error:", e);
      this._isRecording = false;
      micBtn.classList.remove("is-recording");
    };

    recognition.onend = () => {
      this._isRecording = false;
      micBtn.classList.remove("is-recording");
    };

    recognition.onresult = (event) => {
      const input = container.querySelector("#composerInput");
      if (!input) return;

      let interimTranscript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      if (finalTranscript) {
        input.value = (input.value ? input.value + " " : "") + finalTranscript;
        input.dispatchEvent(new Event("input"));
      }
    };

    micBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this._isRecording) {
        recognition.stop();
      } else {
        recognition.start();
      }
    });

    this._recognition = recognition;
  },
};

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
