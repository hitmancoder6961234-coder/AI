window.Darkness = window.Darkness || {};
window.Darkness.pages = window.Darkness.pages || {};

/* Compare models: one prompt, 2-3 of your own configured models, answers side by side.
 * Every model is a separate provider call made with your own key, so the page says so, caps the choice at three, and lets you
 * cancel (which stops the upstream calls). Nothing is saved to your history. Answers are shown as plain text on purpose. */

var COMPARE_MIN = 2, COMPARE_MAX = 3, COMPARE_PROMPT_MAX = 8000;

window.Darkness.pages.compare = async function renderComparePage() {
  const D = window.Darkness;
  const main = document.getElementById('main');
  if (!main) return;
  const esc = D.utils.escapeHtml;

  main.innerHTML =
    '<div class="page"><div class="page__inner">' +
      '<header class="page__header"><div><h1 class="page__title">Compare models</h1>' +
      '<p class="page__subtitle">Send one prompt to 2 or 3 of your models and read the answers side by side. ' +
      'Each model is a separate request to its provider using your own key. Nothing here is saved to your history.</p></div></header>' +
      '<div id="cmpBody"><p class="muted" role="status">Loading your models…</p></div>' +
    '</div></div>';
  const body = document.getElementById('cmpBody');

  let list = [];
  try {
    const data = await D.api.get('/api/models');
    list = (data.models || []).filter((m) => m && m.enabled !== false);
  } catch (e) {
    body.innerHTML = '<div class="history-empty" role="alert">Could not load your models: ' + esc(e.message || 'unknown error') + '</div>';
    return;
  }
  if (list.length < COMPARE_MIN) {
    body.innerHTML = '<div class="history-empty">You need at least ' + COMPARE_MIN + ' enabled models to compare. <a href="#/model">Add or enable models</a>.</div>';
    return;
  }

  const label = (m) => m.name || m.modelName || m.id;
  body.innerHTML =
    '<form id="cmpForm" class="stack" style="gap:16px;" novalidate>' +
      '<fieldset class="cmp-models"><legend class="label">Models <span class="muted">(choose ' + COMPARE_MIN + ' or ' + COMPARE_MAX + ')</span></legend>' +
        '<div class="cmp-models__grid">' +
          list.map((m) => '<label class="cmp-model"><input type="checkbox" name="model" value="' + esc(m.id) + '"> <span class="cmp-model__name">' + esc(label(m)) + '</span> <span class="muted">' + esc(m.provider || '') + '</span></label>').join('') +
        '</div>' +
        '<p class="muted" id="cmpPick" role="status" aria-live="polite"></p>' +
      '</fieldset>' +
      '<div><label for="cmpPrompt" class="label">Prompt</label>' +
        '<textarea id="cmpPrompt" class="input" rows="5" maxlength="' + COMPARE_PROMPT_MAX + '" aria-describedby="cmpCount" placeholder="Ask something all of them should answer"></textarea>' +
        '<p class="muted" id="cmpCount">0 / ' + COMPARE_PROMPT_MAX + '</p></div>' +
      '<div class="hstack" style="gap:8px;">' +
        '<button type="submit" class="btn btn--primary" id="cmpRun" disabled>Compare</button>' +
        '<button type="button" class="btn btn--ghost" id="cmpCancel" hidden>Cancel</button>' +
      '</div>' +
    '</form>' +
    '<section id="cmpResults" class="cmp-results" aria-label="Comparison results" aria-live="polite" aria-busy="false"></section>';

  const form = document.getElementById('cmpForm');
  const promptEl = document.getElementById('cmpPrompt');
  const countEl = document.getElementById('cmpCount');
  const pickEl = document.getElementById('cmpPick');
  const runBtn = document.getElementById('cmpRun');
  const cancelBtn = document.getElementById('cmpCancel');
  const resultsEl = document.getElementById('cmpResults');
  const boxes = () => Array.from(form.querySelectorAll('input[name="model"]'));
  let running = null;

  function sync() {
    const chosen = boxes().filter((b) => b.checked);
    const full = chosen.length >= COMPARE_MAX;
    boxes().forEach((b) => { b.disabled = !b.checked && (full || !!running); if (running) b.disabled = true; });
    pickEl.textContent = chosen.length + ' of ' + COMPARE_MAX + ' selected' + (chosen.length < COMPARE_MIN ? ' - choose at least ' + COMPARE_MIN : '') + (full ? ' (maximum)' : '');
    countEl.textContent = promptEl.value.length + ' / ' + COMPARE_PROMPT_MAX;
    runBtn.disabled = !!running || chosen.length < COMPARE_MIN || !promptEl.value.trim();
  }
  form.addEventListener('change', sync);
  promptEl.addEventListener('input', sync);
  sync();

  function card(r) {
    const ok = r.finish === 'done';
    const status = ok ? 'Answered' : r.finish === 'timeout' ? 'Timed out' : r.finish === 'cancelled' ? 'Cancelled' : 'Failed';
    return '<article class="cmp-card' + (ok ? '' : ' cmp-card--bad') + '" aria-labelledby="cmpH-' + esc(r.modelId) + '">' +
      '<header class="cmp-card__head"><h2 class="cmp-card__title" id="cmpH-' + esc(r.modelId) + '">' + esc(r.label) + '</h2>' +
      '<span class="muted">' + esc(r.provider) + '</span></header>' +
      '<p class="cmp-card__meta"><span class="cmp-badge cmp-badge--' + (ok ? 'ok' : 'bad') + '">' + status + '</span> <span class="muted">' + (r.latencyMs / 1000).toFixed(1) + ' s</span></p>' +
      (ok
        ? '<div class="cmp-card__text" tabindex="0" role="region" aria-label="Answer from ' + esc(r.label) + '"></div>' +
          (r.truncated ? '<p class="muted">The answer was cut at a length limit.</p>' : '') +
          '<button type="button" class="btn btn--ghost btn--sm" data-cmp-copy="' + esc(r.modelId) + '" aria-label="Copy the answer from ' + esc(r.label) + '">Copy answer</button>'
        : '<p class="cmp-card__error" role="alert">' + esc(r.error || 'No answer.') + '</p>') +
    '</article>';
  }

  function paint(results) {
    resultsEl.innerHTML = '<div class="cmp-grid cmp-grid--' + results.length + '">' + results.map(card).join('') + '</div>';
    // answers go in as text, never as HTML: a model's output is untrusted
    const cards = resultsEl.querySelectorAll('.cmp-card');
    results.forEach((r, i) => {
      const holder = r.finish === 'done' && cards[i] ? cards[i].querySelector('.cmp-card__text') : null;
      if (holder) holder.textContent = r.text;
    });
    resultsEl.querySelectorAll('[data-cmp-copy]').forEach((b) => {
      b.addEventListener('click', async () => {
        const r = results.find((x) => x.modelId === b.getAttribute('data-cmp-copy'));
        try { await navigator.clipboard.writeText(r.text); D.toast.show('Answer copied', 'success'); }
        catch (e) { D.toast.show('Copy failed', 'danger'); }
      });
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (runBtn.disabled) return;
    const modelIds = boxes().filter((b) => b.checked).map((b) => b.value);
    const ctl = new AbortController();
    running = ctl;
    cancelBtn.hidden = false;
    resultsEl.setAttribute('aria-busy', 'true');
    resultsEl.innerHTML = '<p class="muted" role="status">Asking ' + modelIds.length + ' models… this can take up to a minute.</p>';
    sync();
    try {
      const out = await D.api.request('/api/compare', { method: 'POST', body: JSON.stringify({ prompt: promptEl.value.trim(), modelIds }), signal: ctl.signal });
      paint(out.results || []);
    } catch (err) {
      if (ctl.signal.aborted) resultsEl.innerHTML = '<p class="muted" role="status">Cancelled. The requests to the providers were stopped.</p>';
      else resultsEl.innerHTML = '<div class="history-empty" role="alert">' + esc(err.message || 'The comparison failed.') + '</div>';
    } finally {
      running = null;
      cancelBtn.hidden = true;
      resultsEl.setAttribute('aria-busy', 'false');
      sync();
    }
  });
  cancelBtn.addEventListener('click', () => { if (running) running.abort(); });
};
