window.Darkness = window.Darkness || {};
window.Darkness.pages = window.Darkness.pages || {};

/* History: every past conversation, with search (titles and messages), tags, folders and pinning.
 * The list comes from /api/conversations; typing in the search box, picking a tag or folder, or "pinned only" switches to
 * /api/conversations/search (server-side, scoped to you). All controls are real, labelled form controls and buttons. */

const PIN_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3 7 7 .6-5.3 4.7 1.6 7.2L12 17.8 5.7 21.5l1.6-7.2L2 9.6 9 9z"/></svg>';
const PIN_OFF_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3 7 7 .6-5.3 4.7 1.6 7.2L12 17.8 5.7 21.5l1.6-7.2L2 9.6 9 9z"/></svg>';

window.Darkness.pages.history = async function renderHistoryPage() {
  const D = window.Darkness;
  const main = document.getElementById('main');
  if (!main) return;

  let conversations = [];
  try {
    const data = await D.api.get("/api/conversations");
    conversations = data.conversations || [];
  } catch (e) {
    D.toast.show("Failed to load history", "danger");
  }

  const hasConversations = conversations.length > 0;
  const clearAllBtn = hasConversations
    ? '<button class="btn btn--danger-outline" id="clearAllHistoryBtn" type="button" style="display:inline-flex;align-items:center;gap:8px;">' +
        D.icons.trash2 +
        '<span>Clear all history</span></button>'
    : '';

  main.innerHTML = [
    '<div class="page"><div class="page__inner page__inner--narrow">',
    '<header class="page__header">',
      '<div><h1 class="page__title">History</h1>',
      '<p class="page__subtitle">All your past conversations. Click any item to reopen it.</p></div>',
      '<div class="hstack" style="gap:8px;">' + clearAllBtn +
      '<button class="btn btn--primary" id="newFromHistoryBtn" type="button">',
        '<svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px;" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
        ' New conversation</button></div>',
    '</header>',
    hasConversations
      ? '<div class="history-tools" role="search" aria-label="Search and filter conversations">' +
          '<div class="history-tools__row">' +
            '<label class="sr-only" for="historySearch">Search conversations</label>' +
            '<input class="input history-tools__search" id="historySearch" type="search" placeholder="Search titles and messages" autocomplete="off" maxlength="100" />' +
            '<label class="sr-only" for="historyFolder">Folder</label>' +
            '<select class="input history-tools__folder" id="historyFolder"><option value="">All folders</option></select>' +
            '<label class="history-tools__pinned"><input type="checkbox" id="historyPinnedOnly" /> <span>Pinned only</span></label>' +
          '</div>' +
          '<div class="history-tools__tags" id="historyTags" role="group" aria-label="Filter by tag"></div>' +
          '<p class="muted history-tools__status" id="historyStatus" role="status" aria-live="polite"></p>' +
        '</div>'
      : '',
    hasConversations
      ? '<div class="history-list" id="historyList"></div>'
      : '<div class="empty-state" style="padding:40px 20px;text-align:center;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);color:var(--ink-muted);">No conversations yet. Start one and it will show up here.</div>',
    '</div></div>'
  ].join('');

  document.getElementById('newFromHistoryBtn')?.addEventListener('click', async () => {
    await D.uiChat.startNewConversation();
    window.location.hash = '#/chat';
  });

  document.getElementById('clearAllHistoryBtn')?.addEventListener('click', () => {
    const body = '<p style="margin:0;color:var(--ink);">This will permanently delete all your conversations from history. This action cannot be undone.</p>';
    const actions = [
      '<button class="btn btn--outline" type="button" data-modal-close="true">Cancel</button>',
      '<button class="btn btn--danger" id="confirmClearAllBtn" type="button">Clear history</button>'
    ].join('');
    D.modal.open('Clear all history?', body, actions);

    document.getElementById('confirmClearAllBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('confirmClearAllBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Deleting...';
      }
      try {
        await D.api.del('/api/conversations');
        D.modal.close();
        D.store.remove("active_conversation");
        if (D.uiSidebar) await D.uiSidebar.refresh();
        await D.pages.history('#/history');
        D.toast.show('All conversation history cleared permanently.', 'success');
      } catch (err) {
        D.modal.close();
        const errorDetail = err.message || err.statusText || 'Unknown error';
        console.error('Clear all history failed:', err);
        D.toast.show('Clear all failed: ' + errorDetail, 'danger');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Clear history';
        }
      }
    }, { once: true });
  });

  if (!hasConversations) return;

  // ---- state -------------------------------------------------------------------------------------------------------------
  const state = { q: '', tag: '', folder: '', pinned: false, items: conversations.map(fromListItem), searching: false };
  const listEl = document.getElementById('historyList');
  const statusEl = document.getElementById('historyStatus');
  const searchEl = document.getElementById('historySearch');
  const folderEl = document.getElementById('historyFolder');
  const pinnedEl = document.getElementById('historyPinnedOnly');
  const tagsEl = document.getElementById('historyTags');

  async function loadFacets() {
    try {
      const f = await D.api.get('/api/conversations/facets');
      folderEl.innerHTML = '<option value="">All folders</option>' + (f.folders || []).map((x) => '<option value="' + D.utils.escapeHtml(x.name) + '"' + (state.folder === x.name ? ' selected' : '') + '>' + D.utils.escapeHtml(x.name) + ' (' + x.count + ')</option>').join('');
      tagsEl.innerHTML = (f.tags || []).map((t) => '<button type="button" class="history-chip' + (state.tag === t.name ? ' is-active' : '') + '" data-tag-filter="' + D.utils.escapeHtml(t.name) + '" aria-pressed="' + (state.tag === t.name ? 'true' : 'false') + '">' + D.utils.escapeHtml(t.name) + ' <span class="muted">' + t.count + '</span></button>').join('');
      tagsEl.hidden = !(f.tags || []).length;
    } catch (e) { /* the filters are optional: the list still works */ }
  }

  function fromListItem(c) {
    return { id: c.id, title: c.title, updatedAt: Number(c.updated_at) || 0, messageCount: Number(c.message_count) || 0, model: c.model_id, tags: c.tags || [], folder: c.folder || null, pinned: !!c.pinned, snippet: null, titleMatch: false };
  }

  function render() {
    if (!state.items.length) {
      listEl.innerHTML = '<div class="history-empty">' + (state.searching ? 'No conversations match.' : 'No conversations yet.') + '</div>';
    } else {
      listEl.innerHTML = state.items.map(historyItemHtml).join('');
    }
    bindItems();
    statusEl.textContent = state.searching ? state.items.length + (state.items.length === 1 ? ' conversation matches' : ' conversations match') : (state.q ? 'Type at least 2 characters to search.' : '');
  }

  let seq = 0;
  async function refresh() {
    const mine = ++seq;
    const active = state.q.length >= 2 || state.tag || state.folder || state.pinned;
    if (state.q && state.q.length < 2) { statusEl.textContent = 'Type at least 2 characters to search.'; }
    if (!active) {
      state.searching = false;
      const data = await D.api.get('/api/conversations').catch(() => ({ conversations: [] }));
      if (mine !== seq) return;
      state.items = (data.conversations || []).map(fromListItem);
      render();
      return;
    }
    const params = new URLSearchParams();
    if (state.q.length >= 2) params.set('q', state.q);
    if (state.tag) params.set('tag', state.tag);
    if (state.folder) params.set('folder', state.folder);
    if (state.pinned) params.set('pinned', 'true');
    try {
      const data = await D.api.get('/api/conversations/search?' + params.toString());
      if (mine !== seq) return; // a newer search replaced this one
      state.searching = true;
      state.items = (data.results || []).map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt, messageCount: r.messageCount, model: null, tags: r.tags, folder: r.folder, pinned: r.pinned, snippet: r.titleMatch ? null : r.snippet, titleMatch: r.titleMatch }));
      render();
    } catch (e) {
      if (mine !== seq) return;
      statusEl.textContent = e.message || 'Search failed';
    }
  }

  let timer = null;
  searchEl.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = searchEl.value.trim(); refresh(); }, 250);
  });
  folderEl.addEventListener('change', () => { state.folder = folderEl.value; refresh(); });
  pinnedEl.addEventListener('change', () => { state.pinned = pinnedEl.checked; refresh(); });
  tagsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tag-filter]');
    if (!b) return;
    state.tag = state.tag === b.getAttribute('data-tag-filter') ? '' : b.getAttribute('data-tag-filter');
    loadFacets();
    refresh();
  });

  function bindItems() {
    listEl.querySelectorAll('[data-history-open]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.hash = '#/chat/' + el.getAttribute('data-history-open');
      });
    });

    listEl.querySelectorAll('[data-history-pin]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-history-pin');
        const next = btn.getAttribute('aria-pressed') !== 'true';
        btn.disabled = true;
        try {
          await D.api.patch('/api/conversations/' + id + '/meta', { pinned: next });
          if (D.uiSidebar) D.uiSidebar.refresh();
          await refresh();
        } catch (err) {
          btn.disabled = false;
          D.toast.show('Could not change pin: ' + (err.message || ''), 'danger');
        }
      });
    });

    listEl.querySelectorAll('[data-history-organize]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-history-organize');
        const item = state.items.find((x) => x.id === id);
        if (!item) return;
        const body =
          '<div class="stack" style="gap:12px;">' +
            '<div><label for="orgTags" class="label">Tags</label>' +
            '<input class="input" id="orgTags" type="text" maxlength="260" value="' + D.utils.escapeHtml((item.tags || []).join(', ')) + '" aria-describedby="orgTagsHelp" />' +
            '<p class="muted" id="orgTagsHelp" style="margin:4px 0 0;font-size:12px;">Separate with commas. Up to 10 tags: letters, numbers, spaces, - and _.</p></div>' +
            '<div><label for="orgFolder" class="label">Folder</label>' +
            '<input class="input" id="orgFolder" type="text" maxlength="40" value="' + D.utils.escapeHtml(item.folder || '') + '" />' +
            '<p class="muted" style="margin:4px 0 0;font-size:12px;">Leave empty for no folder.</p></div>' +
            '<p class="history-form-error" id="orgError" role="alert" hidden></p>' +
          '</div>';
        const actions = '<button class="btn btn--outline" type="button" data-modal-close="true">Cancel</button><button class="btn btn--primary" id="orgSave" type="button">Save</button>';
        D.modal.open('Organize conversation', body, actions);
        document.getElementById('orgTags')?.focus();
        document.getElementById('orgSave')?.addEventListener('click', async () => {
          const errEl = document.getElementById('orgError');
          const tags = document.getElementById('orgTags').value.split(',').map((t) => t.trim()).filter(Boolean);
          try {
            await D.api.patch('/api/conversations/' + id + '/meta', { tags, folder: document.getElementById('orgFolder').value });
            D.modal.close();
            await loadFacets();
            await refresh();
            D.toast.show('Saved.', 'success');
          } catch (err) {
            errEl.textContent = err.message || 'Could not save.';
            errEl.hidden = false;
          }
        });
      });
    });

    listEl.querySelectorAll('[data-history-delete]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const id = btn.getAttribute('data-history-delete');
        const body = '<p style="margin:0;color:var(--ink);">Are you sure you want to permanently delete this conversation?</p>';
        const actions = [
          '<button class="btn btn--outline" type="button" data-modal-close="true">Cancel</button>',
          '<button class="btn btn--danger" id="confirmDeleteConvBtn" type="button">Delete</button>'
        ].join('');
        D.modal.open('Delete conversation?', body, actions);

        document.getElementById('confirmDeleteConvBtn')?.addEventListener('click', async () => {
          D.modal.close();
          const deleteBtn = btn;
          deleteBtn.disabled = true;
          deleteBtn.innerHTML = '<span>Deleting...</span>';
          try {
            await D.api.del('/api/conversations/' + id);
            const currentActive = D.store.get("active_conversation");
            if (currentActive === id) {
              D.store.remove("active_conversation");
            }
            if (D.uiSidebar) await D.uiSidebar.refresh();
            await D.pages.history('#/history');
            D.toast.show('Conversation deleted.', 'success');
          } catch (err) {
            D.toast.show('Delete failed: ' + (err.message || ''), 'danger');
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = D.icons.trash;
          }
        }, { once: true });
      });
    });
  }

  render();
  loadFacets();
};

function historyItemHtml(conv) {
  const D = window.Darkness;
  const esc = D.utils.escapeHtml;
  let timeStr = '';
  if (conv.updatedAt) {
    const ms = Number(conv.updatedAt) > 1e11 ? Number(conv.updatedAt) : Number(conv.updatedAt) * 1000;
    timeStr = new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  let title = conv.title || '';
  if (title.length > 60) title = title.slice(0, 57) + '...';
  title = esc(title) || 'New conversation';
  const count = conv.messageCount || 0;
  const modelPart = conv.model ? ' • Model: ' + esc(String(conv.model).replace(/^models\//, '')) : '';
  const chips = (conv.folder ? '<span class="history-chip history-chip--folder">' + D.icons.folder + ' ' + esc(conv.folder) + '</span>' : '') +
    (conv.tags || []).map((t) => '<span class="history-chip">' + esc(t) + '</span>').join('');
  const label = esc(conv.title || 'conversation');
  return '<div class="history-item' + (conv.pinned ? ' is-pinned' : '') + '">' +
    '<a class="history-item__main" href="#/chat/' + esc(conv.id) + '" data-history-open="' + esc(conv.id) + '">' +
      '<div class="history-item__title">' + (conv.pinned ? '<span class="history-pin" title="Pinned">' + PIN_ICON + '<span class="sr-only">Pinned: </span></span>' : '') + title + '</div>' +
      '<div class="history-item__desc">' + count + ' message' + (count === 1 ? '' : 's') + modelPart + '</div>' +
      (conv.snippet ? '<div class="history-item__snippet">' + esc(conv.snippet) + '</div>' : '') +
      (chips ? '<div class="history-item__chips">' + chips + '</div>' : '') +
    '</a>' +
    '<div class="history-item__side">' +
      '<span class="muted history-item__time">' + esc(timeStr) + '</span>' +
      '<div class="hstack" style="gap:4px;">' +
        '<button class="btn btn--ghost btn--icon-sm" type="button" data-history-pin="' + esc(conv.id) + '" aria-pressed="' + (conv.pinned ? 'true' : 'false') + '" aria-label="' + (conv.pinned ? 'Unpin ' : 'Pin ') + label + '" title="' + (conv.pinned ? 'Unpin' : 'Pin') + '">' + (conv.pinned ? PIN_ICON : PIN_OFF_ICON) + '</button>' +
        '<button class="btn btn--ghost btn--icon-sm" type="button" data-history-organize="' + esc(conv.id) + '" aria-label="Tags and folder for ' + label + '" title="Tags and folder">' + D.icons.edit + '</button>' +
        '<button class="btn btn--ghost btn--icon-sm" type="button" data-history-delete="' + esc(conv.id) + '" title="Delete" aria-label="Delete ' + label + '">' + D.icons.trash + '</button>' +
      '</div>' +
    '</div></div>';
}
