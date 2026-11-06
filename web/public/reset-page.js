/* Behaviour of /reset.html (password reset). No inline script (Content-Security-Policy).
 * The reset token travels in the URL FRAGMENT (#token=...): browsers never send it to the server or in a Referer, and it is removed from the
 * address bar and history as soon as the page has read it. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var token = '';
  (function readToken() {
    var m = /(?:^|[#&])token=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash || '');
    if (m) token = m[1];
    if (location.hash) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* the fragment simply stays */ } }
  })();

  function show(id) { ['loading', 'unavailable', 'request', 'sent', 'reset', 'done'].forEach(function (x) { $(x).hidden = x !== id; }); var h = $(id).querySelector('h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus(); } }
  function err(id, msg) { var e = $(id); e.textContent = msg || ''; e.hidden = !msg; }
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); });
  }

  fetch('/api/auth/recovery', { credentials: 'include' }).then(function (r) { return r.json(); }).then(function (info) {
    if (token) { $('title').textContent = 'Choose a new password'; $('sub').textContent = 'This link works once and expires 30 minutes after it was created.'; show('reset'); $('pw1').focus(); return; }
    if (info.available) { $('minutes').textContent = String(info.linkMinutes || 30); show('request'); $('email').focus(); }
    else { $('sub').textContent = 'Reset by e-mail is not available on this server.'; show('unavailable'); }
  }).catch(function () { $('loading').textContent = 'Could not reach the server. Reload to try again.'; });

  $('request').addEventListener('submit', function (e) {
    e.preventDefault(); err('reqError', '');
    var email = $('email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err('reqError', 'Enter a valid e-mail address.'); $('email').focus(); return; }
    $('reqSubmit').disabled = true;
    post('/api/auth/forgot', { email: email }).then(function (r) {
      $('reqSubmit').disabled = false;
      if (r.status === 202) { $('sentText').textContent = r.body.message; show('sent'); }
      else if (r.status === 501) { show('unavailable'); }
      else err('reqError', r.body.error || 'Something went wrong. Try again.');
    }).catch(function () { $('reqSubmit').disabled = false; err('reqError', 'Could not reach the server.'); });
  });

  $('show').addEventListener('change', function () { $('pw1').type = $('pw2').type = $('show').checked ? 'text' : 'password'; });
  $('reset').addEventListener('submit', function (e) {
    e.preventDefault(); err('resetError', '');
    var a = $('pw1').value, b = $('pw2').value;
    if (a.length < 8) { err('resetError', 'Use at least 8 characters.'); $('pw1').focus(); return; }
    if (a !== b) { err('resetError', 'The two passwords do not match.'); $('pw2').focus(); return; }
    $('resetSubmit').disabled = true;
    post('/api/auth/reset', { token: token, password: a }).then(function (r) {
      $('resetSubmit').disabled = false;
      if (r.ok) { token = ''; $('pw1').value = $('pw2').value = ''; show('done'); }
      else if (r.body.code === 'INVALID_TOKEN') { token = ''; $('title').textContent = 'This link cannot be used'; err('resetError', 'This reset link is not valid or has expired. Go back to sign in and request a new one.'); $('resetSubmit').disabled = true; }
      else { err('resetError', r.body.error || 'Something went wrong. Try again.'); $('pw1').focus(); }
    }).catch(function () { $('resetSubmit').disabled = false; err('resetError', 'Could not reach the server.'); });
  });
})();
