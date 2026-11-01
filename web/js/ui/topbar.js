window.Darkness = window.Darkness || {};

window.Darkness.uiTopbar = {
  _menuBound: false,

  _getInitials(name) {
    if (!name) return "?";
    const parts = String(name).trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }
    return (name ? name.charAt(0).toUpperCase() : '');
  },

  updateModelChip() {
    if (window.Darkness.modelSelector) {
      window.Darkness.modelSelector.renderDropdown("userMenuModelSelector");
    }
  },

  renderThemeToggle() {
    const btn = document.getElementById("themeToggleBtn");
    if (!btn || btn._bound) return;
    btn._bound = true;
    const syncLabel = () => {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      btn.setAttribute("aria-label", "Toggle theme (current: " + current + ")");
    };
    syncLabel();
    btn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      const next = current === "dark" ? "light" : "dark";
      window.Darkness.settings.applyTheme(next);
      window.Darkness.toast.show("Theme switched to " + next, "success");
      syncLabel();
    });
  },

  async initModelSelector() {
    if (window.Darkness.modelSelector) {
      await window.Darkness.modelSelector.load();
    }
    this._bindModelDropdown();
  },

  /**
   * The top-right profile control. Shows a circular avatar with user initials
   * and opens a dropdown menu with profile info, Settings and Sign out.
   */
  renderUserMenu() {
    const button = document.getElementById("userMenuBtn");
    const avatarEl = document.getElementById("userMenuAvatar");
    const initialEl = document.getElementById("userMenuInitial");
    const avatarImg = document.getElementById("userMenuAvatarImg");
    const avatarDropdown = document.getElementById("userMenuAvatarDropdown");
    const initialDropdown = document.getElementById("userMenuInitialDropdown");
    const avatarImgDropdown = document.getElementById("userMenuAvatarImgDropdown");
    const nameEl = document.getElementById("userMenuName");
    const emailFullLabel = document.getElementById("userMenuEmailFull");
    const user = window.Darkness.auth && window.Darkness.auth.user;
    if (!button || !user) return;

    const email = user.email || "";
    const name = user.name || email.split("@")[0] || "?";
    const initials = this._getInitials(name);
    const photoUrl = user.picture || user.photoURL || user.avatar || user.avatar_url || user.image || user.profileImage || user.profile_image || null;

    if (initialEl) initialEl.textContent = initials;
    if (initialDropdown) initialDropdown.textContent = initials;
    if (nameEl) nameEl.textContent = name;
    if (emailFullLabel) emailFullLabel.textContent = email;

    const sidebarName = document.getElementById("sidebarProfileName");
    const sidebarEmail = document.getElementById("sidebarProfileEmail");
    if (sidebarName) sidebarName.textContent = name;
    if (sidebarEmail) sidebarEmail.textContent = email;

    const applyPhoto = (imgEl, fallbackEl, containerEl) => {
      if (!imgEl || !containerEl) return;
      if (photoUrl && typeof photoUrl === "string" && photoUrl.trim() !== "") {
        imgEl.onload = () => {
          if (containerEl && containerEl.classList) containerEl.classList.remove("avatar--fallback");
          if (imgEl && imgEl.style) imgEl.style.display = "";
          if (fallbackEl && fallbackEl.style) fallbackEl.style.display = "none";
        };
        imgEl.onerror = () => {
          if (containerEl && containerEl.classList) containerEl.classList.add("avatar--fallback");
          if (imgEl && imgEl.style) imgEl.style.display = "none";
          if (fallbackEl && fallbackEl.style) fallbackEl.style.display = "flex";
        };
        imgEl.src = photoUrl;
        if (containerEl && containerEl.classList) containerEl.classList.remove("avatar--fallback");
      } else {
        if (containerEl && containerEl.classList) containerEl.classList.add("avatar--fallback");
        if (imgEl && imgEl.style) imgEl.style.display = "none";
        if (imgEl && imgEl.removeAttribute) imgEl.removeAttribute("src");
        if (fallbackEl && fallbackEl.style) fallbackEl.style.display = "flex";
      }
    };

    applyPhoto(avatarImg, initialEl, avatarEl);
    applyPhoto(avatarImgDropdown, initialDropdown, avatarDropdown);

    if (window.Darkness.uiTooltip) window.Darkness.uiTooltip.bind(button);

    if (this._menuBound) return;
    this._menuBound = true;

    const menu = document.getElementById("userMenu");
    if (!menu) return;

    const close = () => {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    };
    const open = () => {
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
      const container = button.closest(".sidebar-profile-container");
      if (container) {
        if (menu && menu.style) {
          menu.style.position = "absolute";
          menu.style.bottom = "calc(100% + 8px)";
          menu.style.left = "0px";
          menu.style.right = "auto";
          menu.style.top = "auto";
          menu.style.width = "220px";
          menu.style.minWidth = "220px";
          menu.style.maxWidth = "220px";
        }
      } else {
        const rect = button.getBoundingClientRect();
        if (menu && menu.style) {
          menu.style.top = rect.bottom + 8 + "px";
          menu.style.right = Math.max(8, window.innerWidth - rect.right) + "px";
        }
      }
    };

    // Density Selector Logic
    const densityButtons = menu.querySelectorAll(".density-btn");
    const syncDensityButtons = () => {
      const currentDensity = window.Darkness.settings.get().density || "comfortable";
      densityButtons.forEach(btn => {
        const val = btn.getAttribute("data-density-val");
        if (val === currentDensity) {
          btn.style.background = "var(--surface)";
          btn.style.color = "var(--ink)";
          btn.style.fontWeight = "600";
          btn.style.border = "1px solid var(--line-strong)";
          btn.style.boxShadow = "var(--shadow-soft)";
        } else {
          btn.style.background = "transparent";
          btn.style.color = "var(--ink-faint)";
          btn.style.fontWeight = "500";
          btn.style.border = "none";
          btn.style.boxShadow = "none";
        }
      });
    };

    densityButtons.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const nextDensity = btn.getAttribute("data-density-val");
        window.Darkness.settings.set({ density: nextDensity });
        document.documentElement.setAttribute("data-density", nextDensity);
        syncDensityButtons();
        if (window.Darkness.toast && typeof window.Darkness.toast.show === "function") {
          window.Darkness.toast.show(`Density scaled to ${nextDensity}`, "success");
        }
      });
    });

    syncDensityButtons();

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const sidebar = document.getElementById("sidebar");
      // Do not open sign out menu when sidebar is collapsed / closed
      if (sidebar && sidebar.classList.contains("is-rail")) {
        return;
      }
      if (menu.hidden) open();
      else close();
    });
    document.addEventListener("click", (event) => {
      if (!menu.hidden && !menu.contains(event.target) && !button.contains(event.target)) close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
    menu.querySelector('[data-user-action="settings"]')?.addEventListener("click", () => {
      close();
      window.location.hash = "#/settings";
    });
    menu.querySelector('[data-user-action="logout"]')?.addEventListener("click", async () => {
      close();
      await window.Darkness.auth.logout();
    });
  },

  _bindModelDropdown() {
    const chip = document.getElementById("modelChip");
    const dropdown = document.getElementById("modelSelectorDropdown");
    if (!chip || !dropdown || dropdown._bound) return;
    dropdown._bound = true;

    window.Darkness.modelSelector.renderDropdown("modelSelectorDropdown");

    const place = () => {
      const rect = chip.getBoundingClientRect();
      if (dropdown && dropdown.style) {
        dropdown.style.position = "fixed";
        dropdown.style.top = rect.bottom + 8 + "px";
        dropdown.style.left = rect.left + "px";
        dropdown.style.minWidth = Math.max(320, rect.width) + "px";
      }
    };

    chip.addEventListener("click", (event) => {
      event.stopPropagation();
      if (dropdown.hidden) {
        dropdown.hidden = false;
        dropdown.classList.add("is-open");
        place();
      } else {
        dropdown.hidden = true;
        dropdown.classList.remove("is-open");
      }
    });

    document.addEventListener("click", (event) => {
      if (!chip.contains(event.target) && !dropdown.contains(event.target)) {
        dropdown.hidden = true;
        dropdown.classList.remove("is-open");
      }
    });

    window.addEventListener("resize", () => {
      if (!dropdown.hidden) place();
    });
  },
};

