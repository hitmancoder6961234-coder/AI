window.Darkness = window.Darkness || {};

window.Darkness.app = {
  async init() {
    const state = window.Darkness.settings.get();
    if (window.Darkness.theme && typeof window.Darkness.theme.init === "function") {
      window.Darkness.theme.init();
    }
    window.Darkness.settings.applyTheme(state.theme || "light");
    document.documentElement.setAttribute("data-density", state.density || "comfortable");

    const sidebar = document.getElementById("sidebar");
    if (sidebar) {
      const isMobile = window.innerWidth < 1024;
      const storedRail = localStorage.getItem("darkness_sidebar_rail");
      const isRailStored = storedRail === "true";
      // On mobile start closed (off-canvas), on desktop restore stored rail state.
      sidebar.classList.toggle("is-open", !isMobile);
      if (!isMobile && isRailStored) {
        sidebar.classList.add("is-rail");
      } else if (!isMobile) {
        sidebar.classList.remove("is-rail");
      }
    }
    if (window.Darkness.sources && typeof window.Darkness.sources.toggle === "function") {
      window.Darkness.sources.toggle(false);
    }

    window.Darkness.uiChat.init();
    window.Darkness.uiTopbar.renderThemeToggle();
    window.Darkness.uiSidebar.render();

    // Configure MutationObserver on #main container to auto-render KaTeX on new dynamic content
    const mainContainer = document.getElementById("main");
    if (mainContainer) {
      let katexDebounceTimer = null;
      const isKaTeXOrCodeNode = (node) => {
        if (!node) return false;
        if (node.nodeType === 1) {
          const el = node;
          return el.classList.contains("katex") ||
                 el.classList.contains("katex-html") ||
                 el.classList.contains("katex-display") ||
                 Boolean(el.closest && (el.closest(".katex") || el.closest("pre") || el.closest("code") || el.closest("[data-katex-processed='true']")));
        }
        if (node.nodeType === 3) {
          const parent = node.parentElement;
          return Boolean(parent && (parent.closest(".katex") || parent.closest("pre") || parent.closest("code") || parent.closest("[data-katex-processed='true']")));
        }
        return false;
      };

      const katexObserver = new MutationObserver((mutations) => {
        let hasUnprocessedContent = false;
        for (let i = 0; i < mutations.length; i++) {
          const mut = mutations[i];
          if (mut.addedNodes.length > 0) {
            for (let j = 0; j < mut.addedNodes.length; j++) {
              if (!isKaTeXOrCodeNode(mut.addedNodes[j])) {
                hasUnprocessedContent = true;
                break;
              }
            }
          } else if (mut.type === "characterData") {
            if (!isKaTeXOrCodeNode(mut.target)) {
              hasUnprocessedContent = true;
              break;
            }
          }
          if (hasUnprocessedContent) break;
        }

        if (hasUnprocessedContent) {
          clearTimeout(katexDebounceTimer);
          katexDebounceTimer = setTimeout(() => {
            if (window.Darkness && typeof window.Darkness.renderKaTeX === "function") {
              window.Darkness.renderKaTeX(mainContainer);
            }
          }, 60);
        }
      });

      katexObserver.observe(mainContainer, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    this.bindGlobalEvents();

    // Auth gate first: nothing that needs a session is requested until the
    // session is known, so no request can 401 during startup.
    const user = await window.Darkness.auth.refresh();
    if (!user) {
      window.Darkness.auth.renderGate();
    } else {
      window.Darkness.auth.clearGate();
      window.Darkness.uiTopbar.renderUserMenu();
      await window.Darkness.uiTopbar.initModelSelector();
      await window.Darkness.uiSidebar.refresh();
      const hash = (window.location.hash || "").trim();
      if (!hash || hash === "#/") {
        window.location.hash = "#/chat";
      }
      await this.navigate(window.Darkness.utils.routeFromHash());
    }

    // React to future auth changes (logout, session expiry).
    window.Darkness.auth.onChange((nextUser) => {
      if (!nextUser) {
        window.Darkness.auth.renderGate();
        return;
      }
      window.Darkness.auth.clearGate();
      window.Darkness.uiTopbar.renderUserMenu();
    });
  },

  async afterLogin() {
    window.Darkness.auth.clearGate();
    window.Darkness.uiTopbar.renderUserMenu();
    await window.Darkness.uiTopbar.initModelSelector();
    if (window.Darkness.uiSidebar) await window.Darkness.uiSidebar.refresh();
    if (window.location.hash !== "#/chat") {
      window.location.hash = "#/chat";
    }
    await this.navigate(window.Darkness.utils.routeFromHash());
  },

  bindGlobalEvents() {
    const sidebar = document.getElementById("sidebar");
    const brand = document.querySelector(".brand");
    const sidebarCollapse = document.getElementById("sidebarCollapse");
    const scrim = document.getElementById("scrim");

    const setSidebarOpen = (open) => {
      if (!sidebar) return;
      const isMobile = window.innerWidth < 1024;
      if (!isMobile) {
        sidebar.classList.add("is-open");
        if (scrim) scrim.hidden = true;
        const floatingBurger = document.getElementById("floatingBurger");
        if (floatingBurger) floatingBurger.style.display = "none";
        return;
      }
      const isOpen = open === undefined ? !sidebar.classList.contains("is-open") : open;
      sidebar.classList.toggle("is-open", isOpen);
      if (scrim) scrim.hidden = !isOpen;
      if (window.Darkness.uiTooltip && typeof window.Darkness.uiTooltip.clear === "function") {
        window.Darkness.uiTooltip.clear();
      }
      const floatingBurger = document.getElementById("floatingBurger");
      if (floatingBurger) {
        floatingBurger.style.display = !isOpen ? "inline-flex" : "none";
      }
    };
    window.Darkness.app.setSidebarOpen = setSidebarOpen;
    window.Darkness.app.closeSidebar = () => {
      if (window.innerWidth < 1024) {
        setSidebarOpen(false);
      }
    };

    if (brand) {
      brand.addEventListener("click", (event) => {
        const isMobile = window.innerWidth < 1024;
        if (isMobile && sidebar) {
          event.preventDefault();
          sidebar.classList.add("is-open");
          if (scrim) scrim.hidden = false;
          return;
        }
        if (sidebar && sidebar.classList.contains("is-rail")) {
          event.preventDefault();
          sidebar.classList.remove("is-rail");
          try { localStorage.setItem("darkness_sidebar_rail", "false"); } catch(e){}
        }
      });
      brand.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const isMobile = window.innerWidth < 1024;
        if (isMobile) return;
        if (sidebar && sidebar.classList.contains("is-rail")) {
          event.preventDefault();
          sidebar.classList.remove("is-rail");
          try { localStorage.setItem("darkness_sidebar_rail", "false"); } catch(e){}
        }
      });
    }
    if (sidebarCollapse) {
      const syncCollapseAffordance = () => {
        const isRail = sidebar && sidebar.classList.contains("is-rail");
        const label = isRail ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)";
        sidebarCollapse.setAttribute("data-tooltip", label);
        sidebarCollapse.setAttribute("aria-label", label);
        sidebarCollapse.setAttribute("title", label);
        sidebarCollapse.setAttribute("aria-expanded", isRail ? "false" : "true");
      };
      sidebarCollapse.addEventListener("click", () => {
        if (!sidebar) return;
        sidebar.classList.toggle("is-rail");
        const isRailNow = sidebar.classList.contains("is-rail");
        if (isRailNow) {
          sidebar.classList.add("is-open");
        }
        try {
          localStorage.setItem("darkness_sidebar_rail", isRailNow ? "true" : "false");
        } catch(e){}
        syncCollapseAffordance();
        if (window.Darkness.uiTooltip) window.Darkness.uiTooltip.refresh();
      });
      syncCollapseAffordance();
    }
    // Single source of truth: re-sync every toggleable affordance whenever the
    // sidebar's expanded/collapsed state changes. The brand is the new
    // collapsed-mode toggle.
    const syncSidebarState = () => {
      const isRail = sidebar && sidebar.classList.contains("is-rail");
      const brand = document.getElementById("sidebarBrand");
      if (brand) {
        brand.setAttribute("aria-expanded", isRail ? "false" : "true");
        brand.setAttribute("aria-label", isRail ? "Open sidebar" : "Go to home");
        if (isRail) {
          brand.setAttribute("role", "button");
          brand.setAttribute("tabindex", "0");
          brand.setAttribute("title", "Open sidebar");
          brand.setAttribute("data-tip-bound", "1");
        } else {
          brand.removeAttribute("role");
          brand.removeAttribute("tabindex");
          brand.removeAttribute("data-tip-bound");
        }
      }
    };
    if (sidebar) {
      new MutationObserver(syncSidebarState).observe(sidebar, { attributes: true, attributeFilter: ["class"] });
      syncSidebarState();
    }
    if (scrim) {
      scrim.addEventListener("click", () => {
        setSidebarOpen(false);
      });
    }

    document.querySelectorAll("[data-theme-set]").forEach((button) => {
      button.addEventListener("click", () => {
        const theme = button.getAttribute("data-theme-set");
        window.Darkness.settings.applyTheme(theme);
      });
    });

    const topbarBurger = document.getElementById("topbarBurger");
    const floatingBurger = document.getElementById("floatingBurger");
    const burgers = [topbarBurger, floatingBurger].filter(Boolean);

    if (burgers.length > 0) {
      const syncBurgerAffordance = () => {
        const isMobile = window.innerWidth < 1024;
        const isOpen = sidebar && sidebar.classList.contains("is-open");
        const label = isOpen ? "Close navigation" : "Open navigation";
        burgers.forEach(burger => {
          burger.setAttribute("aria-label", label);
          burger.setAttribute("title", label);
          burger.setAttribute("aria-expanded", isOpen ? "true" : "false");
          burger.setAttribute("data-tooltip", label);
          if (burger.id === "floatingBurger") {
            burger.style.display = (isMobile && !isOpen) ? "inline-flex" : "none";
          } else {
            burger.hidden = !isMobile;
          }
        });
      };
      burgers.forEach(burger => {
        burger.addEventListener("click", () => {
          if (!sidebar) return;
          const isMobile = window.innerWidth < 1024;
          if (!isMobile) return;
          const isCurrentlyOpen = sidebar.classList.contains("is-open");
          if (isCurrentlyOpen) {
            setSidebarOpen(false);
          } else {
            sidebar.classList.remove("is-rail");
            setSidebarOpen(true);
          }
          syncBurgerAffordance();
        });
        if (window.Darkness.uiTooltip) window.Darkness.uiTooltip.bind(burger);
      });
      window.addEventListener("resize", syncBurgerAffordance);
      if (sidebar) {
        new MutationObserver(syncBurgerAffordance).observe(sidebar, { attributes: true, attributeFilter: ["class"] });
      }
      syncBurgerAffordance();
    }

    const handleNewChatAction = () => {
      if (window.Darkness.uiChat && typeof window.Darkness.uiChat.startNewConversation === "function") {
        window.Darkness.uiChat.startNewConversation();
      }
      window.location.hash = "#/chat";
      // Auto close sidebar drawer on mobile
      if (window.innerWidth < 1024) {
        setSidebarOpen(false);
      };
    };

    const newChatBtn = document.getElementById("newChatBtn");
    if (newChatBtn) {
      newChatBtn.addEventListener("click", handleNewChatAction);
    }

    const sidebarNewChat = document.getElementById("sidebarNewChat");
    if (sidebarNewChat) {
      sidebarNewChat.addEventListener("click", handleNewChatAction);
    }

    const refreshConv = document.getElementById("refreshConversations");
    if (refreshConv) {
      refreshConv.addEventListener("click", () => {
        window.Darkness.uiSidebar.loadConversations();
      });
    }

    window.addEventListener("hashchange", () => {
      this.navigate(window.Darkness.utils.routeFromHash());
    });

    window.addEventListener("resize", () => {
      const dd = document.getElementById("modelSelectorDropdown");
      if (dd && !dd.hidden && dd.style) {
        const chip = document.getElementById("modelChip");
        if (chip) {
          const rect = chip.getBoundingClientRect();
          dd.style.top = (rect.bottom + 8) + "px";
          dd.style.left = (rect.left) + "px";
        }
      }
    });

    // Global keyboard shortcuts for Navigation and Chat Actions
    window.addEventListener("keydown", (e) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (!isCmdOrCtrl) return;

      const key = e.key.toLowerCase();

      if (key === "b") {
        // If the project workspace is active, let its own local Ctrl+B toggle the file explorer
        const explorer = document.getElementById("vscodeExplorerWrapper");
        if (explorer) return;

        e.preventDefault();
        const isMobile = window.innerWidth < 1024;
        if (isMobile) {
          if (sidebar) {
            const isCurrentlyOpen = sidebar.classList.contains("is-open");
            setSidebarOpen(!isCurrentlyOpen);
            if (topbarBurger) {
              const isOpen = !isCurrentlyOpen;
              const label = isOpen ? "Close navigation" : "Open navigation";
              topbarBurger.setAttribute("aria-label", label);
              topbarBurger.setAttribute("title", label);
              topbarBurger.setAttribute("aria-expanded", isOpen ? "true" : "false");
              topbarBurger.setAttribute("data-tooltip", label);
            }
          }
        } else {
          if (sidebarCollapse) {
            sidebarCollapse.click();
          }
        }
        window.Darkness?.toast?.show("Toggled main sidebar", "info");
      } else if (key === "n") {
        e.preventDefault();
        window.Darkness.uiChat.startNewConversation();
        window.location.hash = "#/chat";
        window.Darkness?.toast?.show("Started a new chat", "success");
      }
    });
  },

  async navigate(route) {
    const rawPath = String(route || "#/chat");
    if (rawPath === "#/explore") {
      window.location.hash = "#/knowledge";
      return;
    }
    const main = document.getElementById("main");
    if (!main) return;

    if (window.innerWidth < 1024 && typeof this.closeSidebar === "function") {
      this.closeSidebar();
    }

    if (rawPath.startsWith("#/chat/")) {
      const cid = rawPath.replace("#/chat/", "");
      if (cid) {
        await window.Darkness.uiChat.loadConversation(cid);
      } else {
        window.Darkness.uiChat.renderChat();
      }
      return;
    }

    const cleanPath = rawPath.split("?")[0].replace(/\/+$/, "");
    const page = (
      cleanPath === "" || cleanPath === "#" || cleanPath === "#/" || cleanPath === "#/chat" ? "chat" :
      cleanPath === "#/home" ? "home" :
      cleanPath === "#/builder" ? "builder" :
      cleanPath === "#/knowledge" ? "knowledge" :
      cleanPath === "#/collections" ? "collections" :
      cleanPath === "#/document-studio" ? "document-studio" :
      cleanPath === "#/presentation-studio" ? "presentation-studio" :
      cleanPath === "#/history" ? "history" :
      cleanPath === "#/settings" ? "settings" :
      cleanPath === "#/usage" ? "usage" :
      cleanPath === "#/agents" ? "agents" :
      cleanPath === "#/memory" ? "memory" :
      cleanPath === "#/prompts" ? "prompts" :
      cleanPath === "#/system" ? "system" :
      cleanPath === "#/compare" ? "compare" :
      cleanPath === "#/account" ? "account" :
      cleanPath === "#/model" || cleanPath === "#/models" ? "model" :
      cleanPath === "#/project" || cleanPath.startsWith("#/project/") ? "project" :
      "chat"
    );

    if (page === "chat") {
      // "Ask" box on the Overview: start a fresh conversation and send the question once (consumed here, never replayed)
      let pending = "";
      try { pending = sessionStorage.getItem("darkness_pending_prompt") || ""; sessionStorage.removeItem("darkness_pending_prompt"); } catch (e) { pending = ""; }
      if (pending.trim()) {
        await window.Darkness.uiChat.startNewConversation();
        setTimeout(() => { try { window.Darkness.uiChat.sendMessage(pending.trim().slice(0, 8000)); } catch (e) { /* the composer stays available */ } }, 120);
        return;
      }
      const cid = window.Darkness.store.get("active_conversation");
      if (cid) {
        await window.Darkness.uiChat.loadConversation(cid);
      } else {
        window.Darkness.uiChat.renderChat();
      }
    } else {
      const handler = window.Darkness.pages && window.Darkness.pages[page];
      if (typeof handler === "function") {
        console.log(`[APP ROUTER] Executing page handler '${page}' for route '${rawPath}'`);
        await handler(rawPath);
      } else {
        console.warn(`[APP ROUTER] Handler for '${page}' not found on window.Darkness.pages`);
      }
    }

    if (window.Darkness.uiSidebar) window.Darkness.uiSidebar.render();
    if (window.Darkness.uiTopbar) {
      window.Darkness.uiTopbar.renderThemeToggle();
      await window.Darkness.uiTopbar.initModelSelector();
    }
  },
};

document.addEventListener("DOMContentLoaded", function () {
  window.Darkness.app.init();
});

