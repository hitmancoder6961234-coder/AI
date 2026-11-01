window.Clarity = window.Clarity || {};

window.Clarity.theme = {
  state: {
    mode: 'light',
    current: 'light',
    system: 'light',
  },

  init() {
    this.state.system = this.getSystemPreference();
    const saved = (window.Clarity.settings && window.Clarity.settings.get().theme) || null;
    if (saved && ['light', 'dark', 'system'].includes(saved)) {
      this.state.mode = saved;
    } else {
      this.state.mode = 'light';
    }
    this.applyTheme();
    this.setupSystemListener();
  },

  getSystemPreference() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  },

  setupSystemListener() {
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.mediaQuery.addEventListener('change', () => {
      this.state.system = this.getSystemPreference();
      if (this.state.mode === 'system') this.applyTheme();
    });
  },

  resolve() {
    if (this.state.mode === 'system' || !this.state.mode) {
      return 'light';
    }
    return this.state.mode;
  },

  applyTheme() {
    const themeToApply = this.resolve();
    this.state.current = themeToApply;
    document.documentElement.setAttribute('data-theme', themeToApply);
    // Also set color-scheme on <html> so the browser chrome (scrollbars, form
    // controls) matches. The CSS sets color-scheme via tokens too.
    try { document.documentElement.style.colorScheme = themeToApply; } catch (e) {}
    this.notifyComponents(themeToApply);
  },

  setMode(mode) {
    if (!['light', 'dark', 'system'].includes(mode)) return;
    this.state.mode = mode;
    this.applyTheme();
  },

  notifyComponents(theme) {
    document.querySelectorAll('[data-theme-flag]').forEach((flag) => {
      const isActive = flag.dataset.themeFlag === theme;
      flag.textContent = isActive ? 'Active' : '';
      flag.parentElement.classList.toggle('is-active', isActive);
    });

    window.dispatchEvent(new CustomEvent('clarity-theme-change', { detail: { theme } }));
    document.dispatchEvent(new CustomEvent('clarity-theme-change', { detail: { theme } }));
  }
};
