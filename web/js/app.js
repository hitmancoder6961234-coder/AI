window.Clarity = window.Clarity || {};

window.Clarity.app = {
  async init() {
    const state = window.Clarity.settings.get();
    if (window.Clarity.theme && typeof window.Clarity.theme.init === "function") {
      window.Clarity.theme.init();
    }
    window.Clarity.settings.applyTheme(state.theme || "light");
    document.documentElement.setAttribute("data-density", state.density || "comfortable");

    const sidebar = document.getElementById("sidebar");
    if (sidebar) {
      const isMobile = window.innerWidth < 1024;
      const storedRail = localStorage.getItem("clarity_sidebar_rail");
      const isRailStored = storedRail === "true";
      // On mobile start closed (off-canvas), on desktop restore stored rail state.
      sidebar.classList.toggle("is-open", !isMobile);
      if (!isMobile && isRailStored) {
        sidebar.classList.add("is-rail");
      } else if (!isMobile) {
        sidebar.classList.remove("is-rail");
      }
    }
    if (window.Clarity.sources && typeof window.Clarity.sources.toggle === "function") {
      window.Clarity.sources.toggle(false);
    }

    window.Clarity.uiChat.init();
    window.Clarity.uiTopbar.renderThemeToggle();
    window.Clarity.uiSidebar.render();

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
            if (window.Clarity && typeof window.Clarity.renderKaTeX === "function") {
              window.Clarity.renderKaTeX(mainContainer);
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
    const user = await window.Clarity.auth.refresh();
    if (!user) {
      window.Clarity.auth.renderGate();
    } else {
      window.Clarity.auth.clearGate();
      window.Clarity.uiTopbar.renderUserMenu();
      await window.Clarity.uiTopbar.initModelSelector();
      await window.Clarity.uiSidebar.refresh();
      const hash = (window.location.hash || "").trim();
      if (!hash || hash === "#/") {
        window.location.hash = "#/chat";
      }
      await this.navigate(window.Clarity.utils.routeFromHash());
    }

    // React to future auth changes (logout, session expiry).
    window.Clarity.auth.onChange((nextUser) => {
      if (!nextUser) {
        window.Clarity.auth.renderGate();
        return;
      }
      window.Clarity.auth.clearGate();
      window.Clarity.uiTopbar.renderUserMenu();
    });
  },

  async afterLogin() {
    window.Clarity.auth.clearGate();
    window.Clarity.uiTopbar.renderUserMenu();
    await window.Clarity.uiTopbar.initModelSelector();
    if (window.Clarity.uiSidebar) await window.Clarity.uiSidebar.refresh();
    if (window.location.hash !== "#/chat") {
      window.location.hash = "#/chat";
    }
    await this.navigate(window.Clarity.utils.routeFromHash());
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
      if (window.Clarity.uiTooltip && typeof window.Clarity.uiTooltip.clear === "function") {
        window.Clarity.uiTooltip.clear();
      }
      const floatingBurger = document.getElementById("floatingBurger");
      if (floatingBurger) {
        floatingBurger.style.display = !isOpen ? "inline-flex" : "none";
      }
    };
    window.Clarity.app.setSidebarOpen = setSidebarOpen;
    window.Clarity.app.closeSidebar = () => {
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
          try { localStorage.setItem("clarity_sidebar_rail", "false"); } catch(e){}
        }
      });
      brand.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const isMobile = window.innerWidth < 1024;
        if (isMobile) return;
        if (sidebar && sidebar.classList.contains("is-rail")) {
          event.preventDefault();
          sidebar.classList.remove("is-rail");
          try { localStorage.setItem("clarity_sidebar_rail", "false"); } catch(e){}
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
          localStorage.setItem("clarity_sidebar_rail", isRailNow ? "true" : "false");
        } catch(e){}
        syncCollapseAffordance();
        if (window.Clarity.uiTooltip) window.Clarity.uiTooltip.refresh();
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
        window.Clarity.settings.applyTheme(theme);
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
        if (window.Clarity.uiTooltip) window.Clarity.uiTooltip.bind(burger);
      });
      window.addEventListener("resize", syncBurgerAffordance);
      if (sidebar) {
        new MutationObserver(syncBurgerAffordance).observe(sidebar, { attributes: true, attributeFilter: ["class"] });
      }
      syncBurgerAffordance();
    }

    const handleNewChatAction = () => {
      if (window.Clarity.uiChat && typeof window.Clarity.uiChat.startNewConversation === "function") {
        window.Clarity.uiChat.startNewConversation();
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
        window.Clarity.uiSidebar.loadConversations();
      });
    }

    window.addEventListener("hashchange", () => {
      this.navigate(window.Clarity.utils.routeFromHash());
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
        window.Clarity?.toast?.show("Toggled main sidebar", "info");
      } else if (key === "n") {
        e.preventDefault();
        window.Clarity.uiChat.startNewConversation();
        window.location.hash = "#/chat";
        window.Clarity?.toast?.show("Started a new chat", "success");
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
        await window.Clarity.uiChat.loadConversation(cid);
      } else {
        window.Clarity.uiChat.renderChat();
      }
      return;
    }

    const cleanPath = rawPath.split("?")[0].replace(/\/+$/, "");
    const page = (
      cleanPath === "" || cleanPath === "#" || cleanPath === "#/" || cleanPath === "#/chat" ? "chat" :
      cleanPath === "#/home" ? "home" :
      cleanPath === "#/knowledge" ? "knowledge" :
      cleanPath === "#/collections" ? "collections" :
      cleanPath === "#/document-studio" ? "document-studio" :
      cleanPath === "#/presentation-studio" ? "presentation-studio" :
      cleanPath === "#/history" ? "history" :
      cleanPath === "#/settings" ? "settings" :
      cleanPath === "#/model" || cleanPath === "#/models" ? "model" :
      cleanPath === "#/project" || cleanPath.startsWith("#/project/") ? "project" :
      "chat"
    );

    if (page === "chat") {
      const cid = window.Clarity.store.get("active_conversation");
      if (cid) {
        await window.Clarity.uiChat.loadConversation(cid);
      } else {
        window.Clarity.uiChat.renderChat();
      }
    } else {
      const handler = window.Clarity.pages && window.Clarity.pages[page];
      if (typeof handler === "function") {
        console.log(`[APP ROUTER] Executing page handler '${page}' for route '${rawPath}'`);
        await handler(rawPath);
      } else {
        console.warn(`[APP ROUTER] Handler for '${page}' not found on window.Clarity.pages`);
      }
    }

    if (window.Clarity.uiSidebar) window.Clarity.uiSidebar.render();
    if (window.Clarity.uiTopbar) {
      window.Clarity.uiTopbar.renderThemeToggle();
      await window.Clarity.uiTopbar.initModelSelector();
    }
  },
};

document.addEventListener("DOMContentLoaded", function () {
  window.Clarity.app.init();
});

