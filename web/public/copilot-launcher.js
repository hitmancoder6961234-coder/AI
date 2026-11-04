/*!
 * Darkness Copilot launcher: a slide-in assistant panel available on every page of the app.
 * Opens /copilot.html in an iframe (same origin, same session). Ctrl+/ toggles, Esc closes.
 */
(function () {
  'use strict';
  if (window.__darknessCopilotLauncher) return;
  window.__darknessCopilotLauncher = true;

  var css = document.createElement('style');
  css.textContent =
    '.cpl-btn{position:fixed;right:16px;bottom:70px;z-index:8990;width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.22);background:rgba(14,14,22,.78);color:#eef2ff;display:grid;place-items:center;cursor:pointer;box-shadow:0 6px 22px rgba(0,0,0,.45);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);transition:transform .2s}' +
    '.cpl-btn:hover{transform:translateY(-2px) scale(1.05)}.cpl-btn:focus-visible{outline:2px solid #8bd3ff;outline-offset:2px}' +
    '@media(max-width:700px){.cpl-btn{bottom:148px;right:12px}}' +
    '.cpl-drawer{position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);z-index:9100;background:#08080f;border-left:1px solid rgba(255,255,255,.14);box-shadow:-20px 0 60px rgba(0,0,0,.5);transform:translateX(104%);transition:transform .25s ease;display:flex;flex-direction:column}' +
    '.cpl-drawer.open{transform:none}' +
    '.cpl-head{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.12);font:600 13px system-ui,sans-serif;color:#eef2ff;background:#0e0e18}' +
    '.cpl-head span{flex:1;padding-left:4px}.cpl-head button,.cpl-head a{background:none;border:0;color:#9aa4d6;padding:6px 8px;border-radius:8px;cursor:pointer;font:inherit;font-weight:500;text-decoration:none}' +
    '.cpl-head button:hover,.cpl-head a:hover{color:#fff;background:rgba(255,255,255,.08)}' +
    '.cpl-drawer iframe{flex:1;border:0;width:100%;background:transparent}' +
    '@media(prefers-reduced-motion:reduce){.cpl-drawer,.cpl-btn{transition:none}}';
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
