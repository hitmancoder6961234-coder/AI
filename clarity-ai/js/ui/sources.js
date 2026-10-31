window.Clarity = window.Clarity || {};

window.Clarity.sources = {
  render(items, open = false) {
    const panel = document.getElementById('sourcePanel');
    if (!panel) return;
    const docs = Array.isArray(items) && items.length ? items : [
      { title: 'Workspace brief', type: 'Summary', snippet: 'No source citations are currently selected. Ask a question to preview the supporting context.' }
    ];
    panel.innerHTML = [
      '<div class="source-panel__head"><h3>Source preview</h3><button class="btn btn--ghost btn--icon-sm" type="button" id="sourceCloseBtn" aria-label="Close source panel">',
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
      '</button></div>',
      '<div class="source-panel__body">'
    ].join('');
    docs.forEach((doc) => {
      const card = document.createElement('article');
      card.className = 'doc-card';
      if (doc.onPreview && card && card.style) card.style.cursor = 'pointer';
      card.innerHTML = [
        '<div class="doc-card__title">' + window.Clarity.utils.escapeHtml(doc.title || 'Untitled source') + '</div>',
        '<div class="doc-card__meta">' + window.Clarity.utils.escapeHtml(doc.type || 'Reference') + '</div>',
        '<div class="doc-card__snippet">' + window.Clarity.utils.escapeHtml(doc.snippet || 'No excerpt available.') + '</div>'
      ].join('');
      if (doc.onPreview) {
        card.addEventListener('click', () => doc.onPreview());
      }
      const bodyEl = panel.querySelector('.source-panel__body');
      if (bodyEl) bodyEl.appendChild(card);
    });
    const closeBtn = document.getElementById('sourceCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.toggle(false));
    }
    this.toggle(open);
  },
  showAttachmentSources(attachments, projectName) {
    const items = [];
    if (projectName) {
      items.push({
        title: projectName,
        type: 'Project context',
        snippet: 'All files in this project are used as context for the AI.',
      });
    }
    for (const att of (attachments || [])) {
      if (att.type === 'file') {
        items.push({
          title: att.name || 'Attached file',
          type: 'File',
          snippet: 'Content of this file is included as context.',
          onPreview: async () => {
            try {
              const data = await window.Clarity.api.get('/api/files/' + (att.file_id || att.id) + '/content');
              const body = '<pre style="white-space:pre-wrap;max-height:60vh;overflow:auto;background:var(--surface-muted);padding:12px;border-radius:8px;font-size:12.5px;">' + window.Clarity.utils.escapeHtml(data.content || '(empty)') + '</pre>';
              window.Clarity.modal.open(att.name, body, '<button class="btn btn--primary" data-modal-close="true">Close</button>');
            } catch (e) {
              window.Clarity.toast.show('Preview failed', 'danger');
            }
          }
        });
      } else if (att.type === 'image') {
        items.push({
          title: att.name || 'Attached image',
          type: 'Image',
          snippet: 'Image attached to the conversation.',
          onPreview: () => {
            const body = '<div style="text-align:center;"><img src="' + att.url + '" style="max-width:100%;max-height:60vh;" /></div>';
            window.Clarity.modal.open(att.name || 'Image', body, '<button class="btn btn--primary" data-modal-close="true">Close</button>');
          }
        });
      }
    }
    if (items.length === 0) {
      this.render(null, false);
      return;
    }
    this.render(items, true);
  },
  toggle(open) {
    const panel = document.getElementById('sourcePanel');
    if (!panel) return;
    const shouldOpen = typeof open === 'boolean' ? open : panel.getAttribute('aria-hidden') === 'true';
    panel.classList.toggle('is-open', shouldOpen);
    panel.setAttribute('aria-hidden', String(!shouldOpen));
    panel.hidden = !shouldOpen;
  }
};

