/* One delegated click handler for buttons that used to carry inline onclick="..." attributes.
 *
 * Inline event handlers cannot run under a Content-Security-Policy that forbids them (script-src-attr 'none'), so the markup
 * now says WHAT to do with data-act="..." (plus data-* arguments) and the code to do it lives here, in a file.
 * Registered in the capture phase so it works no matter what an ancestor does with the click. Attribute values are only ever
 * read as data; nothing is evaluated.
 */
(function () {
  'use strict';
  if (window.__darknessDelegatedActions) return;
  window.__darknessDelegatedActions = true;

  const D = function () { return (window.Darkness = window.Darkness || {}); };

  function svgOf(el) {
    const card = el.closest('.visual-card');
    const canvas = card && card.querySelector('.visual-card__canvas');
    return canvas && canvas.querySelector('svg');
  }

  const actions = {
    'visual-fullview': function (el) {
      const d = D();
      if (d.openVisualFullView) d.openVisualFullView({ svgElement: svgOf(el), title: el.getAttribute('data-title') || '' });
    },
    'visual-download': function (el) {
      const d = D();
      if (d.downloadSvgDirect) d.downloadSvgDirect(svgOf(el), el.getAttribute('data-name') || 'graphic');
    },
    'copy-source': function (el) {
      const text = el.getAttribute('data-code') || '';
      if (!navigator.clipboard || !navigator.clipboard.writeText) return;
      navigator.clipboard.writeText(text).then(function () {
        const d = D();
        if (d.toast && d.toast.show) d.toast.show('Diagram source copied', 'success');
      }).catch(function () {});
    },
    'goto-hash': function (el) {
      const h = el.getAttribute('data-hash') || '';
      if (/^#\/[a-z0-9-]+$/i.test(h)) location.hash = h;
    },
    'remove-model-mapping': function (el) {
      const i = parseInt(el.getAttribute('data-index'), 10);
      if (Number.isInteger(i) && typeof window.removeModelMapping === 'function') window.removeModelMapping(i);
    },
    'jump-to-file': function (el) {
      const d = D();
      const file = el.getAttribute('data-file') || '';
      const line = parseInt(el.getAttribute('data-line'), 10);
      if (!file || typeof d.jumpToFile !== 'function') return;
      if (Number.isFinite(line)) d.jumpToFile(file, line);
      else d.jumpToFile(file);
    },
    'close-modal': function (el) {
      const m = el.closest('.modal');
      if (m) m.remove();
    },
  };

  document.addEventListener('click', function (e) {
    const t = e.target;
    const el = t && t.closest ? t.closest('[data-act]') : null;
    if (!el) return;
    const fn = actions[el.getAttribute('data-act')];
    if (!fn) return;
    e.preventDefault();
    try { fn(el, e); } catch (err) { console.error('action failed:', el.getAttribute('data-act'), err); }
  }, true);

  D().actions = actions; // exposed so tests (and other modules) can call an action directly
})();
