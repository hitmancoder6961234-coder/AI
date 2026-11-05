/* Behaviour of /copilot.html. Moved out of an inline block so the Content-Security-Policy can forbid inline script and style elements. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var EMBED = params.get('embed') === '1';
  var PAGE = (params.get('page') || '').replace(/^#\/?/, '').slice(0, 60);
  window.addEventListener('message', function (e) { if (e.origin === location.origin && e.data && e.data.type === 'copilot-page') PAGE = String(e.data.page || '').replace(/^#\/?/, '').slice(0, 60); });
  if (EMBED) document.body.classList.add('embed');

  var S = { convs: [], id: null, msgs: [], busy: false, ctrl: null, title: 'New chat', model: null, stick: true };

  // ---------- helpers ----------
  // The session is the HttpOnly cookie (same-origin requests carry it); no token is read from storage.
  function headers(json) { var h = {}; if (json) h['Content-Type'] = 'application/json'; return h; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  async function api(method, path, body) {
    var r = await fetch(path, { method: method, headers: headers(body !== undefined), credentials: 'include', body: body !== undefined ? JSON.stringify(body) : undefined });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(j.error || r.statusText); e.status = r.status; e.code = j.code; throw e; }
    return j;
  }

  // ---------- safe Markdown ----------
  function inline(src, sources) {
    var t = esc(src);
    var codes = [];
    t = t.replace(/`([^`\n]+)`/g, function (_, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?![\w])/g, '$1<em>$2</em>');
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, function (_, l, u) { return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + l + '</a>'; });
    t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, function (_, p, u) { return p + '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>'; });
    if (sources && sources.length) t = t.replace(/\[(\d{1,2})\]/g, function (m, n) { var s = sources[Number(n) - 1]; return s ? '<a class="cite" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(s.title) + '">' + n + '</a>' : m; });
    return t.replace(/\u0000(\d+)\u0000/g, function (_, i) { return '<code>' + codes[Number(i)] + '</code>'; });
  }
  function block(text, sources) {
    var lines = text.split('\n'), out = [], i = 0, para = [];
    function flush() { if (para.length) { out.push('<p>' + inline(para.join(' '), sources) + '</p>'); para = []; } }
    function cells(l) { return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); }); }
    while (i < lines.length) {
      var l = lines[i], tr = l.trim(), m;
      if (!tr) { flush(); i++; continue; }
      if ((m = /^(#{1,4})\s+(.*)$/.exec(tr))) { flush(); out.push('<h' + m[1].length + '>' + inline(m[2], sources) + '</h' + m[1].length + '>'); i++; continue; }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(tr)) { flush(); out.push('<hr>'); i++; continue; }
      if (/^>\s?/.test(tr)) { flush(); var q = []; while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, '')); out.push('<blockquote>' + block(q.join('\n'), sources) + '</blockquote>'); continue; }
      if (tr.indexOf('|') !== -1 && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        flush(); var head = cells(tr); i += 2; var rows = [];
        while (i < lines.length && lines[i].indexOf('|') !== -1 && lines[i].trim()) rows.push(cells(lines[i++]));
        out.push('<div class="tw"><table><thead><tr>' + head.map(function (h) { return '<th>' + inline(h, sources) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + head.map(function (_, k) { return '<td>' + inline(r[k] || '', sources) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
        continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
        flush();
        var stack = [], html = '';
        while (i < lines.length && (m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]))) {
          var depth = Math.floor(m[1].replace(/\t/g, '  ').length / 2), ord = /\d/.test(m[2]), tag = ord ? 'ol' : 'ul';
          while (stack.length > depth + 1) html += '</li></' + stack.pop() + '>';
          if (stack.length === depth + 1) html += '</li>';
          else { while (stack.length < depth + 1) { html += '<' + tag + '>'; stack.push(tag); } }
          html += '<li>' + inline(m[3], sources);
          i++;
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) html += ' ' + inline(lines[i++].trim(), sources);
        }
        while (stack.length) html += '</li></' + stack.pop() + '>';
        out.push(html);
        continue;
      }
      para.push(tr); i++;
    }
    flush();
    return out.join('');
  }
  function md(text, sources) {
    var parts = [], re = /(^|\n)```([\w+#.-]*)[^\n]*\n([\s\S]*?)(\n```|$)/g, last = 0, m;
    while ((m = re.exec(text))) {
      parts.push(block(text.slice(last, m.index), sources));
      parts.push('<div class="cb"><div class="cb-h"><span>' + esc(m[2] || 'code') + '</span><button type="button" data-copy="code">Copy</button></div><pre><code>' + esc(m[3]) + '</code></pre></div>');
      last = m.index + m[0].length;
    }
    parts.push(block(text.slice(last), sources));
    return parts.join('');
  }

  // ---------- rendering ----------
  var col = $('col'), scroller = $('scroll');
  var ICON = { copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>', redo: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/></svg>', edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>' };
  var SUGGESTIONS = [
    ['Explain a concept', 'Explain how HTTPS works, step by step, for a beginner'],
    ['Write code', 'Write a Python function that finds duplicate files in a folder'],
    ['Draft something', 'Draft a polite email asking my professor for a deadline extension'],
    ['Plan my project', 'Give me a 4-week plan to build a final-year web project']
  ];

  function messageHtml(m, idx, isLast) {
    if (m.role === 'user') {
      return '<div class="msg user" data-i="' + idx + '"><div class="bubble"><div class="utext">' + esc(m.content) + '</div></div></div>';
    }
    var src = m.sources && m.sources.length ? '<div class="srcs">' + m.sources.map(function (s, k) { return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(s.title) + '">' + (k + 1) + '. ' + esc(s.title) + '</a>'; }).join('') + '</div>' : '';
    return '<div class="msg assistant ' + (isLast ? 'last' : '') + '" data-i="' + idx + '"><div class="av">D</div><div class="bubble"><div class="md">' + (m.error ? '<div class="err">' + esc(m.error) + (m.noModel ? ' <a href="/#/model" target="_top">Open the Model page</a>' : '') + '</div>' : '') + md(m.content || '', m.sources) + '</div>' + src +
      '<div class="acts"><button type="button" data-act="copy" title="Copy">' + ICON.copy + ' Copy</button>' + (isLast ? '<button type="button" data-act="redo" title="Regenerate">' + ICON.redo + ' Regenerate</button>' : '') + '</div></div></div>';
  }

  function emptyHint() {
    var f = LOCKED ? { scope: { mode: 'topic', topic: LOCKED } } : focusState();
    if (!f.error && f.scope.mode === 'topic') return 'Focused on <b>' + esc(f.scope.topic) + '</b>. Questions about anything else will be politely declined.';
    if (!f.error && f.scope.mode === 'project') return 'Focused on your project. Answers come only from its files.';
    return 'Ask anything. Answers stream in as they are written.';
  }
  function renderAll() {
    if (!S.msgs.length) {
      col.innerHTML = '<div class="empty"><img src="/brand/darkness-logo.svg" alt=""><h1>How can I help you today?</h1><p>' + emptyHint() + '</p><div class="sugg">' + SUGGESTIONS.map(function (s, i) { return '<button type="button" data-sg="' + i + '"><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></button>'; }).join('') + '</div></div>';
    } else {
      var lastAssistant = -1; for (var k = S.msgs.length - 1; k >= 0; k--) if (S.msgs[k].role === 'assistant') { lastAssistant = k; break; }
      col.innerHTML = S.msgs.map(function (m, i) { return messageHtml(m, i, i === lastAssistant && !S.busy); }).join('');
      // user message edit buttons (last user message only keeps the UI calm)
      Array.prototype.forEach.call(col.querySelectorAll('.msg.user'), function (el) {
        var i = Number(el.getAttribute('data-i'));
        var acts = document.createElement('div'); acts.className = 'acts';
        acts.innerHTML = '<button type="button" data-act="edit" title="Edit">' + ICON.edit + ' Edit</button><button type="button" data-act="copyu" title="Copy">' + ICON.copy + ' Copy</button>';
        el.querySelector('.bubble').appendChild(acts); acts.dataset.i = i;
      });
    }
    $('title').textContent = S.title;
    stick();
  }
  function stick() { if (S.stick) scroller.scrollTop = scroller.scrollHeight; }
  scroller.addEventListener('scroll', function () {
    var near = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    S.stick = near; $('jump').classList.toggle('show', !near && S.msgs.length > 0);
  });
  $('jump').addEventListener('click', function () { S.stick = true; scroller.scrollTop = scroller.scrollHeight; });

  function renderList() {
    var el = $('list');
    if (!S.convs.length) { el.innerHTML = '<h4>No chats yet</h4>'; return; }
    var now = Date.now(), groups = { 'Today': [], 'Previous 7 days': [], 'Older': [] };
    S.convs.forEach(function (c) { var d = (now - c.updatedAt) / 864e5; groups[d < 1 ? 'Today' : d < 7 ? 'Previous 7 days' : 'Older'].push(c); });
    el.innerHTML = Object.keys(groups).filter(function (g) { return groups[g].length; }).map(function (g) {
      return '<h4>' + g + '</h4>' + groups[g].map(function (c) { return '<div class="conv ' + (c.id === S.id ? 'on' : '') + '" role="listitem"><button class="t" type="button" data-open="' + esc(c.id) + '" title="' + esc(c.title) + '">' + esc(c.title) + '</button><button class="ic" type="button" data-ren="' + esc(c.id) + '" aria-label="Rename">' + ICON.edit + '</button><button class="ic" type="button" data-del="' + esc(c.id) + '" aria-label="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button></div>'; }).join('');
    }).join('');
  }

  // ---------- data ----------
  async function loadList() { try { S.convs = (await api('GET', '/api/copilot/conversations')).conversations; } catch (e) { if (e.status === 401) return needLogin(); } renderList(); }
  function needLogin() { col.innerHTML = '<div class="empty"><h1>Please sign in</h1><p>Open <a href="/" target="_top" style="color:var(--accent)">Darkness AI</a>, sign in, then come back.</p></div>'; }
  async function open(id) {
    if (S.busy) return;
    try {
      var r = await api('GET', '/api/copilot/conversations/' + encodeURIComponent(id));
      S.id = id; S.msgs = r.messages; S.title = r.conversation.title; S.stick = true;
      restoreFocus(r.conversation.scope);
      renderAll(); renderList(); closeSide();
    } catch (e) { toast(e.message); }
  }
  function fresh() { if (S.busy) return; S.id = null; S.msgs = []; S.title = 'New chat'; renderAll(); renderList(); closeSide(); $('input').focus(); }
  function toast(msg) { var d = document.createElement('div'); d.textContent = msg; d.style.cssText = 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);background:var(--panel);border:1px solid var(--line);padding:8px 14px;border-radius:12px;z-index:50;font-size:13px'; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2800); }

  // ---------- focus (what the Copilot may talk about) ----------
  var LOCKED = null;
  function focusState() {
    if (LOCKED) return { scope: { mode: 'topic', topic: LOCKED } };
    var mode = $('focus').value;
    if (mode === 'topic') {
      var t = $('topic').value.trim();
      if (t.length < 3) return { error: 'Type the topic to focus on (at least 3 characters), or set Focus to Anything.', scope: { mode: 'open' } };
      return { scope: { mode: 'topic', topic: t } };
    }
    if (mode === 'project') {
      if (!$('proj').value) return { error: 'Choose which project to focus on, or set Focus to Anything.', scope: { mode: 'open' } };
      return { scope: { mode: 'project' }, projectId: $('proj').value };
    }
    return { scope: { mode: 'open' } };
  }
  function syncFocus(save) {
    var mode = $('focus').value;
    $('topicPill').hidden = mode !== 'topic'; $('projPill').hidden = mode !== 'project';
    $('focusPill').classList.toggle('on', mode !== 'open' || Boolean(LOCKED));
    var note = $('focusNote'), f = focusState(), ph = 'Message Darkness Copilot';
    if (LOCKED) { note.hidden = false; note.innerHTML = 'Answers are limited to: <b>' + esc(LOCKED) + '</b>'; ph = 'Ask about ' + LOCKED; }
    else if (mode === 'topic' && !f.error) { note.hidden = false; note.innerHTML = 'Answering only about <b>' + esc(f.scope.topic) + '</b>. Anything else is politely declined.'; ph = 'Ask about ' + f.scope.topic; }
    else if (mode === 'project' && !f.error) { var nm = $('proj').options[$('proj').selectedIndex].text; note.hidden = false; note.innerHTML = 'Answering only from the project <b>' + esc(nm) + '</b>. If it is not in the files, it says so.'; ph = 'Ask about ' + nm; }
    else note.hidden = true;
    $('input').placeholder = ph;
    if (!S.msgs.length && !S.busy) renderAll();
    if (save !== false) { try { localStorage.setItem('darkness_copilot_focus', JSON.stringify({ focus: mode, topic: $('topic').value, proj: $('proj').value, choice: $('choice').value })); } catch (e) { /* optional */ } }
  }
  function restoreFocus(scope) {
    if (!scope) return;
    $('focus').value = scope.mode === 'topic' || scope.mode === 'project' ? scope.mode : 'open';
    if (scope.topic) $('topic').value = scope.topic;
    if (scope.projectId && $('proj').querySelector('option[value="' + scope.projectId.replace(/"/g, '') + '"]')) $('proj').value = scope.projectId;
    syncFocus(false);
  }

  // ---------- sending ----------
  function setBusy(b) {
    S.busy = b;
    var btn = $('send');
    btn.classList.toggle('stop', b);
    btn.setAttribute('aria-label', b ? 'Stop generating' : 'Send');
    btn.innerHTML = b ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>' : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    btn.disabled = !b && !$('input').value.trim();
  }

  async function ask(opts) {
    // opts: {message} | {regenerate:true} | {message, editMessageId}
    if (S.busy) return;
    var text = (opts.message || '').trim();
    var fcheck = focusState(); if (fcheck.error) { toast(fcheck.error); return false; }
    if (opts.regenerate) { while (S.msgs.length && S.msgs[S.msgs.length - 1].role === 'assistant') S.msgs.pop(); }
    else if (opts.editMessageId) { var at = S.msgs.findIndex(function (m) { return m.id === opts.editMessageId; }); if (at >= 0) S.msgs = S.msgs.slice(0, at); S.msgs.push({ role: 'user', content: text }); }
    else S.msgs.push({ role: 'user', content: text });
    var reply = { role: 'assistant', content: '', sources: undefined };
    S.msgs.push(reply); S.stick = true; setBusy(true);
    renderAll();
    var bubble = col.querySelector('.msg.assistant:last-child .md');
    if (bubble) bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    S.ctrl = new AbortController();
    var pending = false, acc = '';
    function paint() { pending = false; if (bubble) { bubble.innerHTML = md(acc, reply.sources); bubble.classList.add('caret'); } stick(); }
    try {
      var fs = focusState();
      var body = { conversationId: S.id || undefined, message: text, regenerate: opts.regenerate || undefined, editMessageId: opts.editMessageId || undefined, webSearch: $('web').checked, page: PAGE || undefined, model: $('choice').value, scope: fs.scope, projectId: fs.scope.mode === 'project' ? fs.projectId : undefined };
      var res = await fetch('/api/copilot/chat', { method: 'POST', headers: headers(true), credentials: 'include', body: JSON.stringify(body), signal: S.ctrl.signal });
      if (!res.ok) { var j = await res.json().catch(function () { return {}; }); var e = new Error(j.error || res.statusText); e.code = j.code; throw e; }
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
      for (;;) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        var frames = buf.split('\n\n'); buf = frames.pop();
        for (var f = 0; f < frames.length; f++) {
          var ev = /^event: (.+)$/m.exec(frames[f]), da = /^data: (.+)$/m.exec(frames[f]);
          if (!ev || !da) continue;
          var d; try { d = JSON.parse(da[1]); } catch (x) { continue; }
          if (ev[1] === 'meta') { S.id = d.conversationId; S.title = d.title; $('title').textContent = d.title; var um = S.msgs[S.msgs.length - 2]; if (um) um.id = d.userMessageId; reply.id = d.assistantMessageId; }
          else if (ev[1] === 'sources') reply.sources = d;
          else if (ev[1] === 'notice') toast(d.text);
          else if (ev[1] === 'token') { acc += d.t; if (!pending) { pending = true; requestAnimationFrame(paint); } }
          else if (ev[1] === 'error') throw new Error(d.message);
          else if (ev[1] === 'done') { S.title = d.title || S.title; }
        }
      }
      reply.content = acc;
    } catch (err) {
      reply.content = acc;
      if (err.name === 'AbortError') { /* user stopped: keep the partial answer */ }
      else { reply.error = err.message || 'Something went wrong'; reply.noModel = err.code === 'NO_MODEL'; if (!acc) reply.content = ''; }
    } finally {
      S.ctrl = null; setBusy(false); renderAll(); loadList();
    }
  }

  // ---------- events ----------
  var input = $('input');
  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 220) + 'px'; $('send').disabled = !S.busy && !input.value.trim(); }
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('form').requestSubmit(); } });
  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (S.busy) { if (S.ctrl) S.ctrl.abort(); return; }
    var t = input.value.trim(); if (!t) return;
    var fc = focusState(); if (fc.error) { toast(fc.error); return; } // keep the typed message
    input.value = ''; autosize(); ask({ message: t });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.busy && S.ctrl) { S.ctrl.abort(); return; }
    // inside the slide-in panel the keystroke never reaches the host page, so ask it to close
    if (EMBED && window.parent !== window && ((e.key === 'Escape' && !S.busy) || ((e.ctrlKey || e.metaKey) && e.key === '/'))) { e.preventDefault(); window.parent.postMessage({ type: 'copilot-close' }, location.origin); }
  });
  $('newChat').addEventListener('click', fresh);
  $('web').addEventListener('change', function () { $('webPill').classList.toggle('on', this.checked); });
  ['focus', 'proj', 'topic', 'choice'].forEach(function (id) { $(id).addEventListener('change', syncFocus); });
  $('topic').addEventListener('input', syncFocus);
  $('topic').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('input').focus(); } });

  col.addEventListener('click', function (e) {
    var sg = e.target.closest('[data-sg]'); if (sg) { ask({ message: SUGGESTIONS[Number(sg.getAttribute('data-sg'))][1] }); return; }
    var cp = e.target.closest('[data-copy="code"]'); if (cp) { var code = cp.closest('.cb').querySelector('code').textContent; navigator.clipboard.writeText(code).then(function () { cp.textContent = 'Copied'; setTimeout(function () { cp.textContent = 'Copy'; }, 1500); }); return; }
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), msgEl = b.closest('.msg'), idx = msgEl ? Number(msgEl.getAttribute('data-i')) : -1, m = S.msgs[idx];
    if (act === 'copy' || act === 'copyu') { navigator.clipboard.writeText(m.content).then(function () { var o = b.innerHTML; b.textContent = 'Copied'; setTimeout(function () { b.innerHTML = o; }, 1500); }); }
    else if (act === 'redo') ask({ regenerate: true });
    else if (act === 'edit') {
      var bub = msgEl.querySelector('.bubble');
      bub.innerHTML = '<div class="edit"><textarea aria-label="Edit message"></textarea><div class="row"><button type="button" class="pill" data-ed="cancel">Cancel</button><button type="button" class="pill on" data-ed="save">Save and send</button></div></div>';
      var ta = bub.querySelector('textarea'); ta.value = m.content; ta.focus();
      bub.addEventListener('click', function h(ev) { var x = ev.target.closest('[data-ed]'); if (!x) return; bub.removeEventListener('click', h); if (x.getAttribute('data-ed') === 'cancel') renderAll(); else if (ta.value.trim()) ask({ message: ta.value, editMessageId: m.id }); });
    }
  });

  $('list').addEventListener('click', async function (e) {
    var o = e.target.closest('[data-open]'), r = e.target.closest('[data-ren]'), d = e.target.closest('[data-del]');
    if (o) return open(o.getAttribute('data-open'));
    if (r) { var id = r.getAttribute('data-ren'), cur = S.convs.find(function (c) { return c.id === id; }); var nt = prompt('Rename chat', cur ? cur.title : ''); if (nt && nt.trim()) { await api('PATCH', '/api/copilot/conversations/' + encodeURIComponent(id), { title: nt.trim() }); if (id === S.id) S.title = nt.trim(); $('title').textContent = S.title; loadList(); } }
    if (d) { var did = d.getAttribute('data-del'); if (confirm('Delete this chat?')) { await api('DELETE', '/api/copilot/conversations/' + encodeURIComponent(did)); if (did === S.id) fresh(); loadList(); } }
  });
  $('clearAll').addEventListener('click', async function () { if (confirm('Delete ALL your Copilot chats? This cannot be undone.')) { await api('DELETE', '/api/copilot/conversations'); fresh(); loadList(); } });

  function closeSide() { document.body.classList.remove('side-open'); }
  $('menu').addEventListener('click', function () { document.body.classList.toggle('side-open'); });
  $('scrim').addEventListener('click', closeSide);

  // ---------- boot ----------
  (async function () {
    renderAll();
    try {
      var st = await api('GET', '/api/copilot/status');
      S.model = st.model; $('model').textContent = st.model || 'No model';
      if (!st.model) $('model').style.borderColor = 'var(--bad)';
      var ch = st.choices || {}; $('modelPill').hidden = !(ch.gpt && ch.mine);
      if (!ch.gpt) $('choice').querySelector('option[value="gpt"]').remove();
      if (!ch.mine) $('choice').querySelector('option[value="mine"]').remove();
      if (st.lockedTopic) { LOCKED = st.lockedTopic; $('focusPill').hidden = true; }
    } catch (e) { if (e.status === 401) return needLogin(); }
    try { var p = await api('GET', '/api/builder/projects'); $('proj').innerHTML = '<option value="">Choose...</option>' + p.projects.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>'; }).join(''); } catch (e) { /* optional */ }
    try { var sv = JSON.parse(localStorage.getItem('darkness_copilot_focus') || 'null'); if (sv && !LOCKED) { $('focus').value = sv.focus || 'open'; $('topic').value = sv.topic || ''; if (sv.proj && $('proj').querySelector('option[value="' + String(sv.proj).replace(/"/g, '') + '"]')) $('proj').value = sv.proj; if (sv.choice && $('choice').querySelector('option[value="' + sv.choice + '"]')) $('choice').value = sv.choice; } } catch (e) { /* optional */ }
    syncFocus(false);
    await loadList();
    var want = params.get('c'); if (want) open(want);
    input.focus();
  })();
})();
