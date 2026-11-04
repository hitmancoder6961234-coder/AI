window.Darkness = window.Darkness || {};

window.Darkness.uiSidebar = {
  _conversations: [],
  _searchQuery: "",
  _searchBound: false,
  _rafId: null,
  _lastSignature: null,
  _lastActiveId: null,
  _navRendered: false,

  // Fast date formatter that caches today's boundary to avoid repeated toLocaleTimeString calls
  _formatFastTime(timestamp) {
    if (!timestamp) return "";
    const ts = timestamp > 1e11 ? timestamp : timestamp * 1000;
    const date = new Date(ts);
    const now = new Date();
    
    // Same day: show HH:MM
    if (
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear()
    ) {
      const h = date.getHours().toString().padStart(2, "0");
      const m = date.getMinutes().toString().padStart(2, "0");
      return `${h}:${m}`;
    }

    // Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear()
    ) {
      return "Yesterday";
    }

    // Same year: M/D
    if (date.getFullYear() === now.getFullYear()) {
      return `${date.getMonth() + 1}/${date.getDate()}`;
    }

    // Older: YYYY/M/D
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  },

  // Pre-index conversations once on load for O(1) attribute access during search
  _prepareConversations(rawList) {
    if (!Array.isArray(rawList)) return [];

    // Sort newest first once
    const sorted = rawList.slice().sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));

    return sorted.map((item) => {
      const title = (item.title || "New conversation").trim();
      const snippet = (item.content_snippet || "").trim();
      const displayTime = this._formatFastTime(item.updated_at || item.created_at);

      return {
        id: item.id,
        title,
        updated_at: item.updated_at || item.created_at || 0,
        _searchTitle: title.toLowerCase(),
        _searchSnippet: snippet.toLowerCase(),
        _displayTime: displayTime,
        _escapedTitle: window.Darkness?.utils?.escapeHtml
          ? window.Darkness.utils.escapeHtml(title)
          : title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
      };
    });
  },

  async loadConversations() {
    try {
      const data = await window.Darkness.api.get("/api/conversations");
      const list = data.conversations || [];
      this._conversations = this._prepareConversations(list);
    } catch (err) {
      console.error("Failed to load conversations:", err);
      this._conversations = [];
    }
  },

  render() {
    const navRoot = document.getElementById("primaryNav");
    const secondaryNav = document.getElementById("secondaryNav");
    if (!navRoot || !secondaryNav) return;

    const route = window.location.hash || "#/chat";
    const renderLinks = (list, root) => {
      root.innerHTML = list.map((item) => {
        const isDefaultChatRoute = route === "#/" && item.href === "#/chat";
        const active = route === item.href || isDefaultChatRoute ? "is-active" : "";
        const icon = this._getIcon(item.icon);
        return (
          '<a class="nav__item ' +
          active +
          '" href="' +
          item.href +
          '" aria-label="' +
          window.Darkness.utils.escapeHtml(item.label) +
          '" data-tooltip="' +
          window.Darkness.utils.escapeHtml(item.label) +
          '"><span class="nav__icon">' +
          icon +
          '</span><span class="nav__label">' +
          window.Darkness.utils.escapeHtml(item.label) +
          '</span></a>'
        );
      }).join("");
    };

    renderLinks((window.Darkness.data && window.Darkness.data.nav) || [], navRoot);
    renderLinks((window.Darkness.data && window.Darkness.data.secondaryNav) || [], secondaryNav);
    this._bindSearchEvents();
    this._updateRecent();

    // Wire tooltip on every interactive sidebar element (only shows when rail).
    const sidebar = document.getElementById("sidebar");
    if (sidebar && window.Darkness.uiTooltip) {
      window.Darkness.uiTooltip.bindSidebar(sidebar);
    }
  },

  _scheduleUpdateRecent() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this._updateRecent();
    });
  },

  _bindSearchEvents() {
    if (this._searchBound) return;
    const input = document.getElementById("sidebarSearchInput");
    const clearBtn = document.getElementById("sidebarSearchClear");
    if (!input) return;

    this._searchBound = true;

    // Fast input handling: updates clear button immediately, coalesces filter with requestAnimationFrame
    input.addEventListener("input", (e) => {
      this._searchQuery = e.target.value || "";
      if (clearBtn) {
        clearBtn.style.display = this._searchQuery.trim() ? "block" : "none";
      }
      this._scheduleUpdateRecent();
    });

    // Keyboard navigation from search input
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const firstLink = document.querySelector("#recentList .recent__item");
        if (firstLink) firstLink.focus();
      } else if (e.key === "Enter") {
        const firstLink = document.querySelector("#recentList .recent__item");
        if (firstLink) {
          e.preventDefault();
          firstLink.click();
        }
      } else if (e.key === "Escape") {
        input.value = "";
        this._searchQuery = "";
        if (clearBtn) clearBtn.style.display = "none";
        this._updateRecent();
        input.blur();
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        input.value = "";
        this._searchQuery = "";
        clearBtn.style.display = "none";
        this._updateRecent();
        input.focus();
      });
    }

    // Keyboard navigation within recent list (ArrowUp, ArrowDown)
    const list = document.getElementById("recentList");
    if (list) {
      list.addEventListener("keydown", (e) => {
        const target = e.target.closest(".recent__item");
        if (!target) return;
        const items = Array.from(list.querySelectorAll(".recent__item"));
        const idx = items.indexOf(target);

        if (e.key === "ArrowDown" && idx < items.length - 1) {
          e.preventDefault();
          items[idx + 1].focus();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          if (idx > 0) {
            items[idx - 1].focus();
          } else {
            input.focus();
          }
        }
      });
    }

    // Listen to hash changes to update active conversation highlighting without rebuilding DOM
    window.addEventListener("hashchange", () => {
      this._updateActiveChatHighlight();
    });
  },

  _getActiveChatId() {
    const hash = window.location.hash || "";
    const match = hash.match(/^#\/chat\/(.+)$/);
    return match ? match[1] : null;
  },

  _updateActiveChatHighlight() {
    const activeId = this._getActiveChatId();
    if (activeId === this._lastActiveId) return;
    this._lastActiveId = activeId;

    const list = document.getElementById("recentList");
    if (!list) return;

    const items = list.querySelectorAll(".recent__item");
    items.forEach((el) => {
      const href = el.getAttribute("href") || "";
      const isTarget = activeId && href.endsWith("/chat/" + activeId);
      if (isTarget) {
        el.classList.add("is-active");
        el.setAttribute("aria-current", "page");
      } else {
        el.classList.remove("is-active");
        el.removeAttribute("aria-current");
      }
    });
  },

  // Highlight search keywords in the title without costly regex rebuilds
  _highlightTitle(title, tokens) {
    if (!tokens || tokens.length === 0) return window.Darkness.utils.escapeHtml(title);
    
    // Sort tokens by length desc to match longer tokens first
    const sortedTokens = tokens.slice().sort((a, b) => b.length - a.length);
    const lower = title.toLowerCase();
    const intervals = [];

    for (const token of sortedTokens) {
      if (!token) continue;
      let startIdx = 0;
      while ((startIdx = lower.indexOf(token, startIdx)) !== -1) {
        const endIdx = startIdx + token.length;
        // Merge or insert interval
        let overlapped = false;
        for (const inv of intervals) {
          if (startIdx < inv.end && endIdx > inv.start) {
            inv.start = Math.min(inv.start, startIdx);
            inv.end = Math.max(inv.end, endIdx);
            overlapped = true;
            break;
          }
        }
        if (!overlapped) {
          intervals.push({ start: startIdx, end: endIdx });
        }
        startIdx += token.length;
      }
    }

    if (intervals.length === 0) {
      return window.Darkness.utils.escapeHtml(title);
    }

    intervals.sort((a, b) => a.start - b.start);

    let html = "";
    let cursor = 0;
    for (const inv of intervals) {
      if (inv.start > cursor) {
        html += window.Darkness.utils.escapeHtml(title.slice(cursor, inv.start));
      }
      html += '<mark class="recent__highlight">' +
        window.Darkness.utils.escapeHtml(title.slice(inv.start, inv.end)) +
        '</mark>';
      cursor = inv.end;
    }
    if (cursor < title.length) {
      html += window.Darkness.utils.escapeHtml(title.slice(cursor));
    }
    return html;
  },

  _updateRecent() {
    const list = document.getElementById("recentList");
    if (!list) return;

    const query = (this._searchQuery || "").trim().toLowerCase();
    const activeChatId = this._getActiveChatId();
    this._lastActiveId = activeChatId;

    let items = [];
    let totalMatches = 0;
    const MAX_RECENT = 8;
    const MAX_SEARCH_RESULTS = 15;

    if (!query) {
      // Default view: top recent chats
      items = this._conversations.slice(0, MAX_RECENT);
      totalMatches = this._conversations.length;
    } else {
      // Fast single-pass search with multi-token matching and early break
      const tokens = query.split(/\s+/).filter(Boolean);
      const tokenCount = tokens.length;
      const allConvs = this._conversations;
      const len = allConvs.length;

      for (let i = 0; i < len; i++) {
        const item = allConvs[i];
        let match = true;
        for (let t = 0; t < tokenCount; t++) {
          const tok = tokens[t];
          if (!item._searchTitle.includes(tok) && !item._searchSnippet.includes(tok)) {
            match = false;
            break;
          }
        }
        if (match) {
          totalMatches++;
          if (items.length < MAX_SEARCH_RESULTS) {
            items.push(item);
          } else if (totalMatches > 50) {
            // Cap counting at 50+ to keep interactions ultra-responsive even with 10k items
            break;
          }
        }
      }
    }

    // Signature check to prevent layout thrashing when filtered items haven't changed
    const signature = `${query}::${activeChatId}::${items.map(i => i.id).join(",")}`;
    if (signature === this._lastSignature) {
      return;
    }
    this._lastSignature = signature;

    // Empty state handling
    if (items.length === 0) {
      list.innerHTML = query
        ? '<li class="recent__empty" style="padding: 8px 10px; font-size: 12px; color: var(--ink-muted); text-align: center;">No chats match "<strong>' +
          window.Darkness.utils.escapeHtml(query) +
          '</strong>"</li>'
        : '<li class="recent__empty">No recent chats</li>';
      return;
    }

    // Render list items with token highlighting and active state
    const tokens = query ? query.split(/\s+/).filter(Boolean) : null;
    const htmlChunks = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const isActive = activeChatId === item.id ? " is-active" : "";
      const ariaCurrent = activeChatId === item.id ? ' aria-current="page"' : "";
      
      let title = item.title || "New conversation";
      if (title.length > 38) {
        title = title.slice(0, 35) + "...";
      }

      const formattedTitle = query ? this._highlightTitle(title, tokens) : window.Darkness.utils.escapeHtml(title);
      const timeStr = item._displayTime || "";

      htmlChunks.push(
        '<li><a class="recent__item' +
          isActive +
          '" href="#/chat/' +
          item.id +
          '"' +
          ariaCurrent +
          ' title="' +
          window.Darkness.utils.escapeHtml(item.title) +
          '"><span class="recent__title">' +
          formattedTitle +
          '</span><span class="recent__time">' +
          timeStr +
          "</span></a></li>"
      );
    }

    // When searching, show result count and quick link to all history if more exist
    if (query && totalMatches > MAX_SEARCH_RESULTS) {
      htmlChunks.push(
        '<li class="recent__meta">' +
          '<span>Showing ' + items.length + ' of ' + totalMatches + (totalMatches > 50 ? '+' : '') + ' matches</span>' +
          '<a href="#/history" title="View all matches in full history">View all</a>' +
        '</li>'
      );
    } else if (!query && totalMatches > MAX_RECENT) {
      htmlChunks.push(
        '<li class="recent__meta" style="justify-content: flex-end;">' +
          '<a href="#/history" title="View all conversations">View all (' + totalMatches + ') →</a>' +
        '</li>'
      );
    }

    list.innerHTML = htmlChunks.join("");
  },

  _getIcon(name) {
    const icons = {
      chat: '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
      house: '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
      book: '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/></svg>',
      layers: '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/></svg>',
      compass: '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>',
      folder: '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>',
      library: '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/></svg>',
      clock: '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      gear: '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
      cpu: '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>',
      project: '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>',
      file: '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>',
      'file-text': '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
      zap: '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
      sparkles: '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4"/><path d="M21 5h-4"/><path d="M5 17v4"/><path d="M7 19H3"/></svg>',
      bot: '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1"/><path d="M8 14h.01"/><path d="M16 14h.01"/></svg>',
      globe: '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
      monitor: '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    };
    return (
      icons[name] ||
      '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/></svg>'
    );
  },

  async refresh() {
    await this.loadConversations();
    this.render();
  },
};
