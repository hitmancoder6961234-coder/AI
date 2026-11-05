/*!
 * Darkness Copilot launcher: a slide-in assistant panel available on every page of the app.
 * Opens /copilot.html in an iframe (same origin, same session). Ctrl+/ toggles, Esc closes.
 */
(function () {
  'use strict';
  if (window.__darknessCopilotLauncher) return;
  window.__darknessCopilotLauncher = true;

  // stylesheet instead of an injected <style> element: the Content-Security-Policy only allows styles from this origin
  var css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = '/copilot-launcher.css';
  document.head.appendChild(css);

  var btn = document.createElement('button');
  btn.className = 'cpl-btn'; btn.type = 'button';
  btn.setAttribute('aria-label', 'Open Copilot'); btn.title = 'Copilot (Ctrl+/)';
  btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';

  var drawer = document.createElement('aside');
  drawer.className = 'cpl-drawer'; drawer.setAttribute('aria-label', 'Darkness Copilot'); drawer.setAttribute('aria-hidden', 'true');
  drawer.innerHTML = '<div class="cpl-head"><span>Darkness Copilot</span><a href="/copilot.html" target="_top" title="Open full page">Full page</a><button type="button" aria-label="Close Copilot">&times;</button></div>';
  var frame = null;
  var closeBtn = drawer.querySelector('button');

  function open() {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.title = 'Darkness Copilot';
      frame.src = '/copilot.html?embed=1&page=' + encodeURIComponent(location.hash || '#/chat');
      drawer.appendChild(frame);
    } else if (frame.contentWindow) {
      frame.contentWindow.postMessage({ type: 'copilot-page', page: location.hash }, location.origin);
    }
    drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'true');
    setTimeout(function () { try { frame.contentWindow.document.getElementById('input').focus(); } catch (e) { /* not ready */ } }, 320);
  }
  function close() { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); btn.setAttribute('aria-expanded', 'false'); btn.focus(); }
  function toggle() { drawer.classList.contains('open') ? close() : open(); }

  btn.addEventListener('click', toggle);
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); toggle(); }
    else if (e.key === 'Escape' && drawer.classList.contains('open')) close();
  });
  window.addEventListener('message', function (e) { if (e.origin === location.origin && e.data && e.data.type === 'copilot-close') close(); });
  window.addEventListener('hashchange', function () {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage({ type: 'copilot-page', page: location.hash }, location.origin);
  });

  function mount() { document.body.appendChild(btn); document.body.appendChild(drawer); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
