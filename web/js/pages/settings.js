window.Clarity = window.Clarity || {};
window.Clarity.pages = window.Clarity.pages || {};

const THEME_ICONS = {
  light: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
  dark: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  system: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="M7 9l2 2-2 2M17 9l-2 2 2 2"/></svg>',
};

const DENSITY_ICONS = {
  comfortable: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1.5"/><rect x="3" y="11" width="18" height="5" rx="1.5"/></svg>',
  compact: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="3.5" rx="1"/><rect x="3" y="9" width="18" height="3.5" rx="1"/><rect x="3" y="14" width="18" height="3.5" rx="1"/></svg>',
};

function segmentedGroup(items, type) {
  return '<div class="segmented" role="' + (type === "theme" ? "radiogroup" : "radiogroup") + '" aria-label="' + type + '">' +
    items.map(it => {
      const icon = type === "theme" ? THEME_ICONS[it.value] : DENSITY_ICONS[it.value];
      return '<button class="segmented__option" type="button" data-' + type + '="' + it.value + '" role="radio" aria-checked="false">' +
        '<span class="segmented__icon">' + icon + '</span>' +
        '<span class="segmented__label">' + window.Clarity.utils.escapeHtml(it.label) + '</span>' +
        '</button>';
    }).join("") +
    '</div>';
}

window.Clarity.pages.settings = function renderSettingsPage() {
  const main = document.getElementById("main");
  if (!main) return;
  const current = window.Clarity.settings.get();

  const page = [
    '<div class="page"><div class="page__inner page__inner--narrow">',

    '<header class="page__header page__header--clean">',
      '<div>',
        '<h1 class="page__title">Settings</h1>',
        '<p class="page__subtitle">Manage your workspace appearance, model adapters and local preferences.</p>',
      '</div>',
    '</header>',

    '<section class="settings-stack">',

      '<article class="settings-card">',
        '<header class="settings-card__head">',
          '<div>',
            '<h2 class="settings-card__title">Appearance</h2>',
            '<p class="settings-card__desc">Choose how Darkness looks on this device.</p>',
          '</div>',
        '</header>',
        '<div class="settings-card__body">',
          segmentedGroup([
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "system", label: "System" },
          ], "theme"),
          '<p class="settings-card__hint">System follows your operating system preference.</p>',
        '</div>',
      '</article>',

      '<article class="settings-card">',
        '<header class="settings-card__head">',
          '<div>',
            '<h2 class="settings-card__title">Display density</h2>',
            '<p class="settings-card__desc">Adjust the spacing used across the app.</p>',
          '</div>',
        '</header>',
        '<div class="settings-card__body">',
          segmentedGroup([
            { value: "comfortable", label: "Comfortable" },
            { value: "compact", label: "Compact" },
          ], "density"),
        '</div>',
      '</article>',

      '<article class="settings-card">',
        '<header class="settings-card__head">',
          '<div>',
            '<h2 class="settings-card__title">Model adapter</h2>',
            '<p class="settings-card__desc">Configure AI providers and the active model.</p>',
          '</div>',
        '</header>',
        '<div class="settings-card__body settings-card__body--row">',
          '<a class="btn btn--outline btn--md" href="#/model">',
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 12a7.4 7.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2-1.2L14.6 3H9.4l-.4 2.7a7.6 7.6 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7.6 7.6 0 0 0 2 1.2l.4 2.7h5.2l.4-2.7a7.6 7.6 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2Z"/></svg>',
            '<span>Manage models</span>',
          '</a>',
          '<span class="settings-card__hint settings-card__hint--right">Add, test and switch between providers.</span>',
        '</div>',
      '</article>',

      '<article class="settings-card">',
        '<header class="settings-card__head">',
          '<div>',
            '<h2 class="settings-card__title">Reset preferences</h2>',
            '<p class="settings-card__desc">Clear locally stored preferences. Your server data is not affected.</p>',
          '</div>',
        '</header>',
        '<div class="settings-card__body settings-card__body--row">',
          '<button class="btn btn--outline btn--md btn--danger-outline" id="resetLocalBtn" type="button">',
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
            '<span>Reset local data</span>',
          '</button>',
          '<span class="settings-card__hint settings-card__hint--right">Clears theme, density and chat attachment cache.</span>',
        '</div>',
      '</article>',

    '</section>',
    '</div></div>'
  ].join('');

  main.innerHTML = page;

  const theme = document.querySelectorAll('.segmented__option[data-theme]');
  const density = document.querySelectorAll('.segmented__option[data-density]');

  const refresh = () => {
    const settings = window.Clarity.settings ? window.Clarity.settings.get() : {};
    const mode = settings.theme || 'light';
    theme.forEach(btn => {
      const v = btn.getAttribute('data-theme');
      const active = v === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', String(active));
    });
    const d = settings.density || 'comfortable';
    density.forEach(btn => {
      const v = btn.getAttribute('data-density');
      const active = v === d;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', String(active));
    });
  };
  refresh();

  theme.forEach(btn => btn.addEventListener('click', () => {
    const v = btn.getAttribute('data-theme');
    window.Clarity.settings.applyTheme(v);
    window.Clarity.theme.setMode(v);
    window.Clarity.toast.show('Theme set to ' + v.charAt(0).toUpperCase() + v.slice(1), 'success');
    refresh();
  }));

  density.forEach(btn => btn.addEventListener('click', () => {
    const v = btn.getAttribute('data-density');
    window.Clarity.settings.set({ density: v });
    document.documentElement.setAttribute('data-density', v);
    window.Clarity.toast.show('Density set to ' + v, 'success');
    refresh();
  }));

  document.getElementById('resetLocalBtn')?.addEventListener('click', () => {
    if (!confirm('Clear all local preferences?')) return;
    try {
      Object.keys(localStorage).filter(k => k !== 'auth_token').forEach(k => localStorage.removeItem(k));
      window.Clarity.toast.show('Local preferences cleared. Reloading…', 'success');
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {}
  });
};
