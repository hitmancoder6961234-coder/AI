window.Clarity = window.Clarity || {};

window.Clarity.settings = {
  defaults: { theme: 'dark', density: 'comfortable' },
  get() {
    const store = window.Clarity.store || { get(key, fallback) { return fallback; } };
    const saved = store.get('app_settings', {});
    return Object.assign({}, this.defaults, saved || {});
  },
  set(partial) {
    const next = Object.assign(this.get(), partial || {});
    const store = window.Clarity.store || { set() {} };
    store.set('app_settings', next);
    return next;
  },
  applyTheme(theme) {
    const next = theme || this.get().theme || 'light';
    if (!['light', 'dark', 'system'].includes(next)) return;
    this.set({ theme: next });
    if (window.Clarity.theme) {
      window.Clarity.theme.setMode(next);
    } else {
      document.documentElement.setAttribute('data-theme', next);
    }
    document.querySelectorAll('[data-theme-flag]').forEach((flag) => {
      const isActive = flag.dataset.themeFlag === next;
      flag.textContent = isActive ? 'Active' : '';
      flag.parentElement.classList.toggle('is-active', isActive);
    });
  }
};
