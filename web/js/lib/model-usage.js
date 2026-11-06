window.Darkness = window.Darkness || {};

/**
 * "Models" section of the Usage page: one card per model with calls, ESTIMATED tokens, last used and a daily sparkline.
 *
 * Honest numbers: calls and dates are counted from stored replies; tokens are estimated from text length (the API labels them as such, and so does
 * this page) because providers' own token counts are not recorded. A cost appears only if YOU type a price per million tokens for that model; it is
 * labelled an estimate and is kept in this browser only (nothing is sent to the server).
 */
(function () {
  const D = window.Darkness;
  const M = function () { return D.mg; };
  const PRICE_KEY = "darkness_model_prices";

  function loadPrices() { try { return JSON.parse(localStorage.getItem(PRICE_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function savePrice(id, v) {
    const all = loadPrices();
    if (v === "" || !isFinite(Number(v)) || Number(v) < 0) delete all[id]; else all[id] = Number(v);
    try { localStorage.setItem(PRICE_KEY, JSON.stringify(all)); } catch (e) {}
  }
  const money = function (n) { return n < 0.01 ? n.toFixed(4) : n < 10 ? n.toFixed(3) : n.toFixed(2); };

  /** Mounts into `host` (an element). `days` is the same range the page uses. */
  function mount(host, days) {
    const m = M(), esc = m.esc, V = D.viz;
    let sort = "calls", data = null;
    try { const s0 = localStorage.getItem("darkness_model_sort"); if (s0 === "calls" || s0 === "tokens" || s0 === "recent") sort = s0; } catch (e) {}

    host.innerHTML = '<div class="mg-section"><h2>Models</h2><p>Replies and estimated tokens per model.</p></div><div class="mg-muted" role="status">Loading…</div>';

    function ordered() {
      const list = data.models.slice();
      if (sort === "tokens") list.sort(function (a, b) { return b.estimatedTokens - a.estimatedTokens; });
      else if (sort === "recent") list.sort(function (a, b) { return (b.lastUsedAt || 0) - (a.lastUsedAt || 0); });
      else list.sort(function (a, b) { return b.calls - a.calls; });
      return list;
    }

    function card(x, i) {
      const prices = loadPrices(), price = prices[x.id];
      const cost = price != null ? "≈ " + money(x.estimatedTokens / 1e6 * price) + " est." : "";
      const tones = ["accent", "ok", "info", "warn"];
      return '<article class="mg-card ix-model ix-tone-' + tones[i % tones.length] + '" style="--i:' + i + '" data-model="' + esc(x.id) + '">' +
        '<header class="ix-model__head"><h3 class="ix-model__name">' + esc(x.name) + '</h3><span class="ix-model__cost" title="Estimated from the price you entered below">' + esc(cost) + "</span></header>" +
        V.area(x.series, { tone: tones[i % tones.length], height: 56, label: x.name + " replies per day" }) +
        '<dl class="ix-model__stats"><div class="ix-model__stat"><dt>Calls</dt><dd>' + m.num(x.calls) + '</dd></div><div class="ix-model__stat"><dt>≈ Tokens</dt><dd>' + m.compact(x.estimatedTokens) +
        '</dd></div><div class="ix-model__stat"><dt>Last used</dt><dd>' + (x.lastUsedAt ? esc(m.ago(x.lastUsedAt)) : "—") + "</dd></div></dl>" +
        '<label class="ix-price">Price per 1M tokens <input class="input" type="number" min="0" step="any" inputmode="decimal" data-price="' + esc(x.id) + '" value="' + (price != null ? price : "") + '" placeholder="optional" aria-label="Price per million tokens for ' + esc(x.name) + '"></label></article>';
    }

    function paint() {
      const list = ordered();
      host.innerHTML = '<div class="ix-toolbar"><div class="mg-section"><h2>Models</h2><p>Replies per model in the last ' + data.days + ' days. Tokens are <strong>estimated</strong> from text length.</p></div>' +
        '<div class="mg-actions"><span class="ix-sample" title="' + esc(data.tokenMethod) + '">ESTIMATED</span><label for="ixModelSort">Sort</label><select id="ixModelSort" class="input">' +
        [["calls", "Calls"], ["tokens", "Tokens"], ["recent", "Last used"]].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === sort ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") +
        '</select><button class="btn btn--outline btn--sm" id="ixModelCsv" type="button">' + m.icon("download", 15) + " <span>Export CSV</span></button></div></div>" +
        (list.length ? '<div class="ix-models">' + list.map(card).join("") + "</div>" : '<div class="mg-card"><div class="mg-empty">' + m.icon("cpu", 28) + "<strong>No replies in this period</strong><p>Once a model answers, it gets a card here.</p></div></div>") +
        '<p class="mg-muted">' + esc(data.tokenMethod) + ". A cost appears only after you enter a price; it stays in this browser.</p>";
      const sel = host.querySelector("#ixModelSort");
      if (sel) sel.addEventListener("change", function () { sort = sel.value; try { localStorage.setItem("darkness_model_sort", sort); } catch (e) {} paint(); });
      const csv = host.querySelector("#ixModelCsv");
      if (csv) csv.addEventListener("click", function () {
        const prices = loadPrices();
        const rows = [["model", "calls", "estimated_tokens", "last_used", "price_per_1m_tokens", "estimated_cost"]].concat(ordered().map(function (x) {
          const p = prices[x.id];
          return [x.name, x.calls, x.estimatedTokens, x.lastUsedAt ? new Date(x.lastUsedAt).toISOString() : "", p != null ? p : "", p != null ? (x.estimatedTokens / 1e6 * p).toFixed(6) : ""];
        }));
        m.download("darkness-models-" + data.days + "d.csv", m.csv(rows));
        D.toast.show("Model usage exported", "success");
      });
      host.querySelectorAll("[data-price]").forEach(function (inp) {
        inp.addEventListener("change", function () {
          savePrice(inp.getAttribute("data-price"), inp.value);
          const cardEl = inp.closest("[data-model]"), x = data.models.filter(function (q) { return q.id === inp.getAttribute("data-price"); })[0];
          const costEl = cardEl && cardEl.querySelector(".ix-model__cost"), p = loadPrices()[x.id];
          if (costEl) costEl.textContent = p != null ? "≈ " + money(x.estimatedTokens / 1e6 * p) + " est." : "";
        });
      });
    }

    D.api.get("/api/usage/models", { days: days }).then(function (r) { if (!host.isConnected) return; data = r; paint(); })
      .catch(function (err) { if (host.isConnected) host.innerHTML = '<div class="mg-section"><h2>Models</h2></div><div class="mg-muted" role="alert">Could not load model usage: ' + esc(err && err.message) + "</div>"; });
  }

  D.mg = D.mg || {};
  D.mg.modelUsage = mount;
})();
