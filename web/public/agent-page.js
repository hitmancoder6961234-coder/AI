/* Behaviour of /agent.html: durable agent runs (plan, approvals, pause / resume / stop, history).
 * No inline script (Content-Security-Policy); the session is the HttpOnly cookie. All text from the server or the model is escaped before it is shown. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var controller = null;   // the live event stream, if any
  var currentId = null;    // the session being shown
  var lastApproval = null; // the latest approval request of the live run

  var H = { 'Content-Type': 'application/json' };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function md(s) { return esc(s).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>'); }
  function add(cls, html) { var d = document.createElement('div'); d.className = 'step ' + cls; d.innerHTML = html; $('log').appendChild(d); d.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  function status(t) { $('status').textContent = t || ''; }
  function ago(ts) { var s = Math.max(0, Math.round((Date.now() - ts) / 1000)); if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' days ago'; }
  var LABEL = { running: 'Running', waiting_approval: 'Needs approval', paused: 'Paused', done: 'Finished', failed: 'Failed', cancelled: 'Cancelled' };

  function api(method, path, body, signal) {
    return fetch(path, { method: method, headers: H, credentials: 'include', signal: signal, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  // ---------------------------------------------------------------- tools
  function loadTools() {
    api('GET', '/api/agent/tools').then(function (r) {
      if (r.status === 401) { $('auth').style.display = 'block'; return null; }
      return r.json();
    }).then(function (j) {
      if (!j) return;
      $('provider').textContent = j.active ? 'Model provider: ' + j.active : 'No AI provider key configured on the server';
      var box = $('tools');
      [].slice.call(box.querySelectorAll('label')).forEach(function (n) { n.remove(); });
      j.tools.forEach(function (t) {
        var l = document.createElement('label'); l.title = t.description;
        var i = document.createElement('input'); i.type = 'checkbox'; i.checked = true; i.value = t.name;
        l.appendChild(i); l.appendChild(document.createTextNode(t.name));
        if (t.requiresApproval) { var tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'asks first'; l.appendChild(tag); }
        else if (t.risk === 'network') { var net = document.createElement('span'); net.className = 'tag tag--net'; net.textContent = 'internet'; l.appendChild(net); }
        box.appendChild(l);
      });
    }).catch(function () { status('Could not reach the server.'); });
  }

  // ---------------------------------------------------------------- plan, approval, buttons
  function setProgress(done, total) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    $('planBar').setAttribute('aria-valuenow', String(pct)); $('planFill').style.width = pct + '%';
  }
  function showPlan(tasks, done) {
    var card = $('planCard'), list = $('planList'); list.innerHTML = '';
    if (!tasks || !tasks.length) { card.hidden = true; return; }
    card.hidden = false;
    var d = {}; (done || []).forEach(function (n) { d[n] = true; });
    tasks.forEach(function (t) {
      var li = document.createElement('li'); li.className = d[t.n] ? 'is-done' : '';
      li.innerHTML = '<span class="chk" aria-hidden="true">' + (d[t.n] ? '✓' : '○') + '</span> <span>' + esc(t.title) + (t.tool ? ' <span class="tag">' + esc(t.tool) + '</span>' : '') + '</span><span class="sr">' + (d[t.n] ? ' (reported done)' : ' (not done yet)') + '</span>';
      list.appendChild(li);
    });
    setProgress((done || []).length, tasks.length);
  }
  function showApproval(p) {
    lastApproval = p;
    var args = JSON.stringify(p.args, null, 2);
    $('approvalBody').innerHTML = '<p><b>' + esc(p.tool) + '</b> wants to run. ' + esc(p.reason) + '</p><pre>' + esc(args.length > 1500 ? args.slice(0, 1500) + '…' : args) + '</pre><p class="hint">Nothing has been changed yet. If you deny, the agent is told and carries on without it.</p>';
    $('approval').hidden = false;
    $('approve').focus();
  }
  function hideApproval() { $('approval').hidden = true; lastApproval = null; }
  function buttons(state) {
    // state: idle | running | waiting | paused | failed
    $('run').disabled = state === 'running' || state === 'waiting';
    $('pause').hidden = state !== 'running';
    $('stop').hidden = !(state === 'running' || state === 'waiting' || state === 'paused' || state === 'failed');
    $('resume').hidden = !(state === 'paused' || state === 'failed');
  }

  // ---------------------------------------------------------------- events
  function handle(type, data) {
    if (type === 'session') { currentId = data.id; }
    else if (type === 'start') status('Working with ' + data.provider + ' / ' + data.model + '…');
    else if (type === 'plan') showPlan(data.tasks, []);
    else if (type === 'progress') {
      [].slice.call($('planList').children).forEach(function (li, i) { if (data.done.indexOf(i + 1) >= 0) { li.className = 'is-done'; li.querySelector('.chk').textContent = '✓'; } });
      setProgress(data.done.length, data.total);
    }
    else if (type === 'thought') add('thought', esc(data.text));
    else if (type === 'tool_call') add('tool', '<b>' + esc(data.tool) + '</b> <span class="muted">' + esc(JSON.stringify(data.args)) + '</span>');
    else if (type === 'tool_result') add(data.ok ? 'ok' : 'bad', '<b>' + esc(data.tool) + (data.ok ? ' ✓' : ' ✗') + '</b><pre>' + esc(data.output) + '</pre>');
    else if (type === 'approval_required') { add('ask', '<b>Waiting for your approval</b> to run ' + esc(data.tool)); showApproval(data); }
    else if (type === 'approval_result') { add(data.approved ? 'ok' : 'bad', '<b>' + esc(data.tool) + '</b> ' + (data.approved ? 'approved' : 'denied')); hideApproval(); }
    else if (type === 'waiting_approval') { status('Waiting for your approval. The run is saved; you can leave and come back.'); buttons('waiting'); }
    else if (type === 'final') { $('answer').style.display = 'block'; $('answerBody').innerHTML = md(data.answer); status('Done in ' + data.steps + ' step' + (data.steps === 1 ? '' : 's') + '.'); }
    else if (type === 'done') { buttons('idle'); }
    else if (type === 'paused') { status('Paused. Your progress is saved: use Resume to continue.'); buttons('paused'); }
    else if (type === 'cancelled') { status('Stopped.'); buttons('idle'); hideApproval(); }
    else if (type === 'error') { add('bad', '<b>Error</b> ' + esc(data.message)); status(data.resumable ? 'The run failed but its progress is saved: you can Resume.' : 'The run failed.'); buttons(data.resumable ? 'failed' : 'idle'); }
  }

  async function stream(path, body) {
    controller = new AbortController(); buttons('running');
    try {
      var res = await api('POST', path, body, controller.signal);
      if (res.status === 401) { $('auth').style.display = 'block'; status(''); buttons('idle'); return; }
      if (!res.ok) { var j = await res.json().catch(function () { return {}; }); add('bad', '<b>' + esc(j.error || res.statusText) + '</b>'); status(''); buttons(currentId ? 'paused' : 'idle'); return; }
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
      for (;;) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        var parts = buf.split('\n\n'); buf = parts.pop();
        parts.forEach(function (p) {
          var ev = /^event: (.+)$/m.exec(p), da = /^data: (.+)$/m.exec(p);
          if (ev && da) { try { handle(ev[1], JSON.parse(da[1])); } catch (e) { /* ignore a malformed frame */ } }
        });
      }
    } catch (e) {
      if (e.name !== 'AbortError') { add('bad', '<b>Connection lost</b> ' + esc(e.message)); status('Connection lost. The run was paused and saved: use Resume.'); buttons('paused'); }
    } finally { controller = null; loadHistory(); }
  }

  function resetView() { $('log').innerHTML = ''; $('answer').style.display = 'none'; $('auth').style.display = 'none'; $('planCard').hidden = true; hideApproval(); }

  function run() {
    var goal = $('goal').value.trim();
    if (!goal) { status('Write a goal first.'); return; }
    resetView(); currentId = null;
    var tools = [].slice.call(document.querySelectorAll('#tools input:checked')).map(function (i) { return i.value; });
    status('Starting…');
    stream('/api/agent/sessions', { goal: goal, tools: tools, approvals: $('approvals').value, plan: $('plan').checked });
  }
  function decide(approve) {
    if (!currentId || !lastApproval) return;
    var id = lastApproval.id; hideApproval(); status(approve ? 'Approved. Continuing…' : 'Denied. Continuing without it…');
    stream('/api/agent/sessions/' + currentId + '/approve', { decision: approve ? 'approve' : 'deny', approvalId: id });
  }

  // ---------------------------------------------------------------- history
  function loadHistory() {
    api('GET', '/api/agent/sessions').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j) return;
      $('historyNote').textContent = 'Saved runs are kept for ' + j.retentionDays + ' days, or until you delete them.';
      var ul = $('historyList'); ul.innerHTML = '';
      if (!j.sessions.length) { ul.innerHTML = '<li class="muted">No runs yet.</li>'; return; }
      j.sessions.forEach(function (s) {
        var li = document.createElement('li');
        li.innerHTML = '<span class="badge badge--' + esc(s.status) + '">' + esc(LABEL[s.status] || s.status) + '</span> <span class="goal">' + esc(s.goalPreview) + '</span> <span class="muted">' + esc(ago(s.updatedAt)) + ' · ' + s.steps + ' step' + (s.steps === 1 ? '' : 's') + '</span>' +
          '<span class="acts"><button type="button" class="ghost" data-open="' + esc(s.id) + '" aria-label="Open run: ' + esc(s.goalPreview.slice(0, 50)) + '">Open</button>' +
          (s.status === 'running' ? '' : '<button type="button" class="ghost danger" data-del="' + esc(s.id) + '" aria-label="Delete run: ' + esc(s.goalPreview.slice(0, 50)) + '">Delete</button>') + '</span>';
        ul.appendChild(li);
      });
    }).catch(function () { /* the list is optional */ });
  }
  function openSession(id) {
    api('GET', '/api/agent/sessions/' + id).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return;
      var s = d.session; currentId = s.id; resetView();
      $('goal').value = s.goal;
      showPlan(s.plan, s.done);
      if (s.answer) { $('answer').style.display = 'block'; $('answerBody').innerHTML = md(s.answer); }
      if (s.status === 'waiting_approval' && s.pending) { showApproval(s.pending); buttons('waiting'); status('This run is waiting for your approval.'); }
      else if (s.status === 'paused') { buttons('paused'); status('Paused. Use Resume to continue.'); }
      else if (s.status === 'failed') { buttons(s.retries >= d.maxRetries ? 'idle' : 'failed'); status('Failed' + (s.error ? ': ' + s.error : '') + (s.retries >= d.maxRetries ? '. Start a new run.' : '. Use Resume to continue from the last checkpoint.')); }
      else if (s.status === 'running' && d.live) { buttons('running'); status('Running in another window.'); }
      else buttons('idle');
      var rows = d.events.map(function (e) { return '<li><span class="muted">' + esc(new Date(e.ts).toLocaleTimeString()) + '</span> <b>' + esc(e.type.replace(/_/g, ' ')) + '</b>' + (e.tool ? ' ' + esc(e.tool) : '') + (e.ok === true ? ' ✓' : e.ok === false ? ' ✗' : '') + (e.summary ? ' <span class="muted">' + esc(e.summary) + '</span>' : '') + '</li>'; }).join('');
      $('timeline').innerHTML = '<h3>Execution history</h3><p class="hint">Every step, approval and decision of this run. Tool outputs are not kept here, only whether each call worked.</p><ol class="trail">' + rows + '</ol>';
      $('timeline').focus();
    });
  }
  function control(path, label) {
    if (!currentId) return;
    status(label);
    api('POST', '/api/agent/sessions/' + currentId + '/' + path, {}).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (j) { if (j && j.error) status(j.error); setTimeout(loadHistory, 600); });
  }

  $('run').addEventListener('click', run);
  $('approve').addEventListener('click', function () { decide(true); });
  $('deny').addEventListener('click', function () { decide(false); });
  $('pause').addEventListener('click', function () { control('pause', 'Pausing at the next step…'); });
  $('stop').addEventListener('click', function () {
    if (!currentId) { if (controller) controller.abort(); return; }
    control('cancel', 'Stopping…'); buttons('idle'); hideApproval();
  });
  $('resume').addEventListener('click', function () { if (!currentId) return; status('Resuming…'); stream('/api/agent/sessions/' + currentId + '/resume', {}); });
  $('goal').addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') run(); });
  $('refreshHistory').addEventListener('click', loadHistory);
  $('historyList').addEventListener('click', function (e) {
    var open = e.target.closest && e.target.closest('[data-open]'), del = e.target.closest && e.target.closest('[data-del]');
    if (open) openSession(open.getAttribute('data-open'));
    if (del && window.confirm('Delete this run and its history? This cannot be undone.')) {
      var id = del.getAttribute('data-del');
      api('DELETE', '/api/agent/sessions/' + id).then(function () { if (currentId === id) { currentId = null; resetView(); buttons('idle'); $('timeline').innerHTML = ''; } loadHistory(); });
    }
  });
  buttons('idle');
  loadTools();
  loadHistory();
})();
