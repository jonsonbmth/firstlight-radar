/* Firstlight Radar — the dashboard's whole behaviour, no framework, no network.
   It renders window.RADAR (written by main.ts from the same board as board.json):
   the board, the model behind it, and the proof. Verdicts recompute live when
   the reader changes the deposit, from the same formulas lib/model.ts uses. */
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p style="padding:24px">No radar data: data.js did not load.</p>'; return; }

  var SHARE = R.assumptions.airdrop_share;
  var ELIG = R.assumptions.eligible_share;
  var state = { q: '', verdict: 'ALL', wl: false, chain: 'ALL', cat: 'ALL', deposit: 1000, sort: 'rank', sel: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    if (n < 0) return '-$' + Math.abs(n).toFixed(0);
    return '$' + Math.round(n);
  }
  function money2(n) { return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2); }
  function pct(x, d) { return (x * 100).toFixed(d === undefined ? 0 : d) + '%'; }
  function ageLabel(d) { return d === null ? 'n/a' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd'; }
  function chg7(r) { return r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'; }

  /* The verdict at a deposit, the same arithmetic as lib/model.ts verdictFor. */
  function verdictAt(r, dep, share) {
    share = share === undefined ? SHARE : share;
    var farmingTvl = r.tvl_usd * ELIG;
    var slice = share * r.implied_value_usd * (dep / farmingTvl) * r.time_share;
    var net = slice - r.cost_usd;
    var nph = r.hours > 0 ? net / r.hours : 0;
    var denom = share * r.value_if_launches * (dep / farmingTvl) * r.time_share;
    var be = denom > 0 ? r.cost_usd / denom : null;
    var v = (net >= 25 && nph >= 10) ? 'FARM' : (net > 0 ? 'MARGINAL' : 'SKIP');
    return { verdict: v, slice: slice, net: net, nph: nph, be: be };
  }
  function beLabel(be) { return be === null ? '—' : be > 1 ? '>100%' : pct(be); }

  /* -------------------------------------------------------------- header + KPIs */
  $('meta').innerHTML = 'Snapshot <b>' + esc(R.as_of) + '</b> · DefiLlama protocols<br>Model <b>' + esc(R.model_version) + '</b> · ' + R.coverage.total + ' protocols scored';
  $('foot').textContent = 'snapshot ' + R.as_of + ' · model ' + R.model_version;

  var farmN = R.rows.filter(function (r) { return verdictAt(r, 1000).verdict === 'FARM'; }).length;
  var oddsSorted = R.rows.map(function (r) { return r.launch_odds; }).sort(function (a, b) { return a - b; });
  var medOdds = oddsSorted[Math.floor(oddsSorted.length / 2)];
  $('kpis').innerHTML =
    '<div class="kpi good"><div class="n">' + R.coverage.watchlistCovered + '/' + R.coverage.watchlist + '</div><div class="l">Watchlist covered</div></div>' +
    '<div class="kpi"><div class="n">' + R.rows.length + '</div><div class="l">Protocols ranked</div></div>' +
    '<div class="kpi"><div class="n">' + farmN + '</div><div class="l">FARM verdicts · $1,000 deposit</div></div>' +
    '<div class="kpi"><div class="n">' + pct(medOdds) + '</div><div class="l">Median launch odds</div></div>' +
    '<div class="kpi"><div class="n">' + money(R.verification.implied_sum) + '</div><div class="l">Total implied value</div></div>' +
    '<div class="kpi"><div class="n">' + R.fit.loo.toFixed(2) + ' <span style="font-size:14px;color:var(--muted)">vs ' + R.fit.flatLoo.toFixed(2) + ' flat</span></div><div class="l">Size-curve LOO error (log)</div></div>';

  /* -------------------------------------------------------------- verification + model */
  $('verify').innerHTML = '<h2>board.json = this page</h2>' +
    '<p>This page renders the same board the gate reads. Both come from one build of the sealed snapshot, so the numbers below match <b>board.json</b> exactly.</p>' +
    '<table><tbody>' +
    '<tr><td>Rows</td><td class="num"><b>' + R.verification.board_rows + '</b></td></tr>' +
    '<tr><td>Watchlist covered</td><td class="num"><b>' + R.verification.watchlist_covered + ' / ' + R.coverage.watchlist + '</b></td></tr>' +
    '<tr><td>Sum of implied values</td><td class="num"><b>' + money(R.verification.implied_sum) + '</b></td></tr>' +
    '<tr><td>Rank 1</td><td class="num"><b>#' + 1 + ' ' + esc(R.verification.top_slug) + '</b> · ' + money(R.verification.top_implied) + '</td></tr>' +
    '<tr><td>board.json sha256</td><td class="num mono">' + esc(R.verification.board_sha256.slice(0, 16)) + '…</td></tr>' +
    '</tbody></table>';

  $('modelcard').innerHTML = '<h2>The model, in one card</h2>' +
    '<p><b>Value if it launches</b> comes from the market\u2019s own size curve, fit here on the ' + R.fit.n + ' traded tokens in this snapshot:</p>' +
    '<p class="mono">log mcap = ' + R.fit.intercept + ' + ' + R.fit.slope + ' × log TVL &nbsp;(R² ' + R.fit.r2 + ', resid SD ' + R.fit.residSd + ')</p>' +
    '<p><b>Launch odds</b> come from an actuarial hazard curve: the share of protocols that have launched, by age band and category. <b>Implied value = value-if-launches × launch odds.</b></p>' +
    '<p><b>Verdict</b> is economics, not value: the expected airdrop slice at your deposit, net of the farm plan\u2019s cost. A rank-1 row can still be SKIP when the fee is not covered.</p>';

  /* -------------------------------------------------------------- out-of-sample */
  var wfRows = R.walkforward.map(function (w) {
    return '<tr><td>' + esc(w.cutoff) + '</td><td class="num">' + w.nTrain + ' / ' + w.nTest + '</td><td class="num">' + w.flat.toFixed(3) + '</td><td class="num"><b>' + w.tvl.toFixed(3) + '</b></td><td class="num">' + w.growth.toFixed(3) + '</td></tr>';
  }).join('');
  $('oos').innerHTML = '<h2>Out-of-sample proof — and what failed</h2>' +
    '<p>The size curve beats a flat TVL multiple out-of-sample: leave-one-out error <b>' + R.fit.loo + '</b> against <b>' + R.fit.flatLoo + '</b> for the flat multiple (median ' + R.fit.flatMedianMultiple + '×), and it beats flat at all four walk-forward cutoffs below. But the fit is weak — R² ' + R.fit.r2 + ' — so every row carries a wide honest range (P25–P75 spans ~13×).</p>' +
    '<table><thead><tr><th>Walk-forward cutoff</th><th class="num">Train / test</th><th class="num">Flat multiple</th><th class="num">TVL curve (shipped)</th><th class="num">TVL + growth</th></tr></thead><tbody>' + wfRows + '</tbody></table>' +
    '<p class="note"><b>Tested and rejected:</b> 7-day growth (6 transforms, all leave-one-out worse, none significant), age, and category offsets — each overfits and loses out-of-sample. Growth wins walk-forward 4/4 but loses leave-one-out, so we do not ship it. Full ablation on the <a href="#" id="oos-method">Method tab</a>.</p>';
  $('oos-method').addEventListener('click', function (e) { e.preventDefault(); showTab('method'); });

  /* -------------------------------------------------------------- coverage */
  var segColors = { board: '#e8a33d', early: '#8fbf6f', 'live-token': '#5b7a99', cex: '#7d745f', 'bridge-cat': '#4a6a7a', 'wrapped-word': '#9a6a8f', versioned: '#6a6a6a', 'exchange-name': '#b08a4a' };
  var segs = [{ key: 'board', label: 'On this board', count: R.coverage.board }, { key: 'early', label: 'Rankable, below the board\u2019s TVL cut', count: R.coverage.unrankedEarly }];
  R.coverage.setAside.forEach(function (g) { segs.push({ key: g.reason, label: g.label, count: g.count }); });
  var barHtml = segs.map(function (s) { return '<i style="width:' + (100 * s.count / R.coverage.total).toFixed(2) + '%;background:' + (segColors[s.key] || '#666') + '" title="' + esc(s.label) + ': ' + s.count + '"></i>'; }).join('');
  var legHtml = segs.map(function (s) { return '<span><i class="dot" style="background:' + (segColors[s.key] || '#666') + '"></i><b>' + s.count + '</b> ' + esc(s.label) + '</span>'; }).join('');
  $('coverage').innerHTML = '<h2>Coverage — all ' + R.coverage.total + ' protocols, accounted for</h2><div class="bar">' + barHtml + '</div><div class="legend">' + legHtml + '</div>' +
    '<p class="note">The watchlist is a floor, never a ceiling: the board holds all 40 watchlist protocols plus the ' + (R.rows.length - R.coverage.watchlist) + ' largest rankable protocols below the $50M floor. Liquid-staking protocols stay in — their own token does not exist yet; only wrapped or staked products of a token that already trades are set aside.</p>';

  /* -------------------------------------------------------------- controls + table */
  var chains = [...new Set(R.rows.flatMap(function (r) { return r.chains; }))].sort();
  var cats = [...new Set(R.rows.map(function (r) { return r.category || 'No category'; }))].sort();
  function opt(v, l) { return '<option value="' + esc(v) + '">' + esc(l) + '</option>'; }
  $('controls').innerHTML =
    '<input type="search" id="q" placeholder="Search name or slug…" aria-label="Search">' +
    '<label>Verdict <select id="f-verdict">' + opt('ALL', 'All verdicts') + opt('FARM', 'FARM') + opt('MARGINAL', 'MARGINAL') + opt('SKIP', 'SKIP') + '</select></label>' +
    '<label><input type="checkbox" id="f-wl"> Watchlist only</label>' +
    '<label>Chain <select id="f-chain">' + opt('ALL', 'All chains') + chains.map(function (c) { return opt(c, c); }).join('') + '</select></label>' +
    '<label>Category <select id="f-cat">' + opt('ALL', 'All categories') + cats.map(function (c) { return opt(c, c); }).join('') + '</select></label>' +
    '<label class="dep">Deposit <select id="f-dep">' + R.assumptions.deposit_grid.map(function (d) { return '<option value="' + d + '"' + (d === 1000 ? ' selected' : '') + '>$' + d.toLocaleString('en-US') + '</option>'; }).join('') + '</select></label>' +
    '<label>Sort <select id="f-sort">' + opt('rank', 'Rank (implied value)') + opt('net', 'Net $') + opt('nph', 'Net $/hour') + opt('odds', 'Launch odds') + opt('tvl', 'TVL') + opt('age', 'Age') + '</select></label>';
  ['q', 'f-verdict', 'f-wl', 'f-chain', 'f-cat', 'f-dep', 'f-sort'].forEach(function (id) {
    $(id).addEventListener(id === 'q' ? 'input' : 'change', function () {
      state.q = $('q').value.trim().toLowerCase();
      state.verdict = $('f-verdict').value;
      state.wl = $('f-wl').checked;
      state.chain = $('f-chain').value;
      state.cat = $('f-cat').value;
      state.deposit = parseInt($('f-dep').value, 10);
      state.sort = $('f-sort').value;
      renderTable();
    });
  });

  function filtered() {
    var rows = R.rows.filter(function (r) {
      if (state.q && (r.name.toLowerCase().indexOf(state.q) < 0 && r.slug.indexOf(state.q) < 0)) return false;
      if (state.wl && !r.watchlist) return false;
      if (state.chain !== 'ALL' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.cat !== 'ALL' && (r.category || 'No category') !== state.cat) return false;
      var v = verdictAt(r, state.deposit);
      if (state.verdict !== 'ALL' && v.verdict !== state.verdict) return false;
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      net: function (a, b) { return verdictAt(b, state.deposit).net - verdictAt(a, state.deposit).net; },
      nph: function (a, b) { return verdictAt(b, state.deposit).nph - verdictAt(a, state.deposit).nph; },
      odds: function (a, b) { return b.launch_odds - a.launch_odds; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); },
    };
    rows.sort(by[state.sort] || by.rank);
    return rows;
  }

  function renderTable() {
    var rows = filtered();
    var farm = 0, nets = [];
    rows.forEach(function (r) { var v = verdictAt(r, state.deposit); if (v.verdict === 'FARM') farm++; nets.push(v.nph); });
    nets.sort(function (a, b) { return a - b; });
    var medNph = nets.length ? nets[Math.floor(nets.length / 2)] : 0;
    $('status').innerHTML = 'Showing <b>' + rows.length + '</b> of ' + R.rows.length + ' rows · <b>' + farm + '</b> FARM at a $' + state.deposit.toLocaleString('en-US') + ' deposit · median net <b>' + money2(medNph) + '/h</b> · verdicts recompute with the deposit';
    var head = '<tr><th class="num">#</th><th>Protocol</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th><th class="num">Odds</th><th class="num">Implied value</th><th>Verdict</th><th class="num">Net</th><th class="num">$/h</th><th class="num">Break-even</th></tr>';
    var body = rows.map(function (r) {
      var v = verdictAt(r, state.deposit);
      var wl = r.watchlist ? ' <span class="pill wl">WL</span>' : '';
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.sel === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="num"><b>' + r.rank + '</b><span class="sub">#' + r.rank_lo + '–' + r.rank_hi + '</span></td>' +
        '<td><b>' + esc(r.name) + '</b>' + wl + '<span class="sub">' + esc(r.slug) + ' · ' + esc(r.chains.slice(0, 3).join(', ')) + '</span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + chg7(r) + '</td>' +
        '<td class="num">' + ageLabel(r.age_days) + '</td>' +
        '<td class="num">' + pct(r.launch_odds) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b><span class="sub">' + money(r.p25) + '–' + money(r.p75) + '</span></td>' +
        '<td><span class="pill ' + v.verdict + '">' + v.verdict + '</span></td>' +
        '<td class="num">' + money2(v.net) + '</td>' +
        '<td class="num">' + money2(v.nph) + '</td>' +
        '<td class="num">' + beLabel(v.be) + '</td></tr>';
    }).join('');
    $('board').querySelector('thead').innerHTML = head;
    var tb = $('board').querySelector('tbody');
    tb.innerHTML = body || '<tr><td colspan="11">No rows match these filters.</td></tr>';
    tb.querySelectorAll('tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
    });
  }

  /* -------------------------------------------------------------- detail view */
  function openDetail(slug) {
    var r = R.rows.find(function (x) { return x.slug === slug; });
    if (!r) return;
    state.sel = slug;
    var v = verdictAt(r, state.deposit);
    /* Steps 1-3 are deposit-free; steps 4-6 recompute at the selected deposit,
       so the derivation always agrees with the verdict pill above it. */
    var steps = r.derivation.slice(0, 3).map(function (s) { return '<li><b>' + esc(s.label) + ':</b> ' + esc(s.value) + '</li>'; }).join('');
    steps += '<li><b>4 · Expected slice:</b> ' + esc('7.5% airdrop × ' + money(r.implied_value_usd) + ' × $' + state.deposit.toLocaleString('en-US') + '/' + money(r.tvl_usd * ELIG) + ' farming TVL (25% of TVL) × ' + r.time_share.toFixed(2) + ' time-share = $' + v.slice.toFixed(2)) + '</li>';
    steps += '<li><b>5 · Plan cost:</b> ' + esc('$' + r.cost_usd.toFixed(2) + ' of gas over ' + r.hold_days + ' days (' + r.hours + 'h of work) on ' + r.chains[0]) + '</li>';
    steps += '<li><b>6 · Verdict:</b> ' + esc('$' + v.slice.toFixed(2) + ' − $' + r.cost_usd.toFixed(2) + ' = $' + v.net.toFixed(2) + ' net ($' + v.nph.toFixed(2) + '/h); breaks even at ' + beLabel(v.be) + ' launch odds') + '</li>';
    var comps = r.comparables.map(function (c) {
      return '<tr><td>' + esc(c.name) + ' <span style="color:var(--faint)">(' + esc(c.slug) + ')</span></td><td class="num">' + money(c.tvl_usd) + '</td><td class="num">' + money(c.mcap_usd) + '</td><td class="num">' + c.multiple.toFixed(2) + '×</td></tr>';
    }).join('');
    var plan = r.farm_steps.map(function (s, i) { return '<li>' + esc(s) + '</li>'; }).join('');
    var gridHead = '<tr><th>Deposit \\ airdrop share</th>' + R.assumptions.share_grid.map(function (s) { return '<th class="num">' + pct(s, 1) + '</th>'; }).join('') + '</tr>';
    var gridBody = R.assumptions.deposit_grid.map(function (d) {
      var cells = R.assumptions.share_grid.map(function (s) {
        var vv = verdictAt(r, d, s);
        return '<td class="' + (vv.net >= 0 ? 'pos' : 'neg') + '">' + money2(vv.net) + '</td>';
      }).join('');
      return '<tr><td><b>$' + d.toLocaleString('en-US') + '</b></td>' + cells + '</tr>';
    }).join('');
    $('detail').innerHTML =
      '<h2>#' + r.rank + ' ' + esc(r.name) + ' <span class="pill ' + v.verdict + '">' + v.verdict + '</span>' + (r.watchlist ? ' <span class="pill wl">WATCHLIST</span>' : '') + '</h2>' +
      '<p>' + esc(r.slug) + ' · ' + esc(r.category || 'No category') + ' · ' + esc(r.chains.join(', ')) + ' · TVL ' + money(r.tvl_usd) + ' · ' + ageLabel(r.age_days) + ' listed · 7d ' + chg7(r) + '</p>' +
      '<h3>How the number is derived</h3><ol class="steps">' + steps + '</ol>' +
      '<h3>Nearest traded comparables (by TVL)</h3><table><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Multiple</th></tr></thead><tbody>' + comps + '</tbody></table>' +
      '<h3>Farm plan — $' + r.deposit + ' recommended deposit, ' + r.hold_days + ' days</h3><ol class="steps">' + plan + '</ol>' +
      '<h3>Sensitivity: net $ by deposit × airdrop share</h3><table class="grid"><thead>' + gridHead + '</thead><tbody>' + gridBody + '</tbody></table>' +
      '<p class="note">Rank range #' + r.rank_lo + '–' + r.rank_hi + ' and value range ' + money(r.p10) + '–' + money(r.p90) + ' (P10–P90) come from ' + 40 + ' bootstrap refits of the size curve and the fit\u2019s residual quantiles. The verdict above is at a $' + state.deposit.toLocaleString('en-US') + ' deposit; change the deposit control to recompute it.</p>';
    $('detail').classList.remove('hidden');
    renderTable();
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* -------------------------------------------------------------- tabs */
  function showTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) {
      var on = t.getAttribute('data-tab') === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    ['board', 'method', 'live'].forEach(function (n) { $('tab-' + n).classList.toggle('hidden', n !== name); });
  }
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { showTab(t.getAttribute('data-tab')); });
  });

  /* -------------------------------------------------------------- method tab */
  (function methodTab() {
    var ab = R.fit.ablation.map(function (a) {
      return '<tr><td>' + esc(a.name) + (a.shipped ? ' <span class="pill FARM">SHIPPED</span>' : '') + '</td><td class="num">' + a.rmse.toFixed(3) + '</td><td class="num">' + a.r2.toFixed(3) + '</td><td class="num">' + a.loo.toFixed(3) + '</td></tr>';
    }).join('');
    var wf = R.walkforward.map(function (w) {
      return '<tr><td>' + esc(w.cutoff) + '</td><td class="num">' + w.nTrain + ' / ' + w.nTest + '</td><td class="num">' + w.flat.toFixed(3) + '</td><td class="num"><b>' + w.tvl.toFixed(3) + '</b></td><td class="num">' + w.growth.toFixed(3) + '</td></tr>';
    }).join('');
    var hz = R.hazards.bands.map(function (b, i) {
      var label = b.hi === -1 ? b.lo + 'd+' : b.lo + '–' + b.hi + 'd';
      return '<tr><td>' + label + '</td><td class="num">' + b.n + '</td><td class="num">' + b.launched + '</td><td class="num">' + pct(b.rate, 1) + '</td><td class="num">' + pct(R.hazards.globalHazards[i], 1) + '</td><td class="num"><b>' + pct(R.hazards.globalOdds[i]) + '</b></td></tr>';
    }).join('');
    $('tab-method').innerHTML =
      '<div class="card"><h2>How Firstlight works</h2>' +
      '<p><b>1 · Size.</b> The market prices tokens against TVL sublinearly: log market cap = ' + R.fit.intercept + ' + ' + R.fit.slope + ' × log TVL, fit on the ' + R.fit.n + ' traded tokens in this snapshot (bootstrap slope P5–P95: ' + R.fit.bootstrap.slopeP5 + '–' + R.fit.bootstrap.slopeP95 + '). A $10M-TVL protocol is worth ~0.48× TVL if it launches; a $1B one ~0.05×.</p>' +
      '<p><b>2 · Odds.</b> Launch odds are actuarial: the share of protocols that have launched, by age band and category, shrunk toward the global curve (' + R.assumptions.shrink_k + ' pseudo-counts). A protocol that has run 3–5 years without a token sits in the band where 85% of peers have launched — its remaining odds come from the survivors\u2019 hazard, plus a conservative ' + pct(R.assumptions.terminal_hazard) + ' terminal hazard per 2-year block.</p>' +
      '<p><b>3 · Economics.</b> The expected slice is the airdrop share (' + pct(R.assumptions.airdrop_share, 1) + ' of the launch, varied 5–10% in the grid) × implied value × the deposit\u2019s share of the <i>farming</i> TVL × a time-share dilution (hold months / (hold months + min(age months, 12))). Only ' + pct(R.assumptions.eligible_share) + ' of TVL is assumed to farm points actively — the rest is passive liquidity, treasuries and protocol-owned deposits that never claim. Net of the plan\u2019s gas, that is the verdict: FARM needs ≥$' + R.assumptions.verdict_farm_net + ' net and ≥$' + R.assumptions.verdict_farm_per_hour + '/h; MARGINAL is positive but thin; SKIP loses money. Recommended deposits are $1,000 at TVL ≥ $100M and $500 below it.</p></div>' +
      '<div class="card"><h2>Ablation — every term tested, most rejected</h2><table><thead><tr><th>Model</th><th class="num">In-sample RMSE</th><th class="num">R²</th><th class="num">Leave-one-out</th></tr></thead><tbody>' + ab + '</tbody></table>' +
      '<p class="note">Growth was tried in six forms (linear ±120%, ±20%, asinh, log, absolute, sign) — every one lost leave-one-out and none was significant (paired t between −0.30 and −0.99). Age and category offsets overfit: better in-sample, worse out-of-sample. We ship the parsimonious curve and show the failures instead of hiding them.</p></div>' +
      '<div class="card"><h2>Walk-forward — fit on old listings, tested on new ones</h2><table><thead><tr><th>Cutoff</th><th class="num">Train / test</th><th class="num">Flat multiple</th><th class="num">TVL curve</th><th class="num">TVL + growth</th></tr></thead><tbody>' + wf + '</tbody></table>' +
      '<p class="note">Growth wins walk-forward at all four cutoffs but loses leave-one-out. The two tests disagree by less than noise, so we keep the simpler model — and report both.</p></div>' +
      '<div class="card"><h2>Launch hazard — the odds table</h2><table><thead><tr><th>Age band</th><th class="num">Protocols</th><th class="num">Launched</th><th class="num">Share launched</th><th class="num">Hazard</th><th class="num">Eventual odds if still unlaunched</th></tr></thead><tbody>' + hz + '</tbody></table>' +
      '<p class="note">Per-category curves shrink each band toward this global curve. Protocols with no listing date take the pre-token-weighted mean odds (' + pct(R.hazards.unknownAgeOdds) + '). The hazard is cross-sectional — it describes who has launched, not why — and the terminal hazard is an assumption, stated here.</p></div>' +
      '<div class="card"><h2>Limitations, stated plainly</h2>' +
      '<p>· The size curve explains only R² ' + R.fit.r2 + ' of market-cap variation; the residual SD is ' + R.fit.residSd + ' log points, so a P25–P75 value range spans ~13×. Treat every implied value as a wide interval, not a price.<br>' +
      '· The snapshot is one day (2026-11-14). TVL and prices move; this board does not.<br>' +
      '· The airdrop share (' + pct(R.assumptions.airdrop_share, 1) + '), the farming-TVL share (' + pct(R.assumptions.eligible_share) + ') and the pro-rata time-share are assumptions — the grid shows how the verdict moves when the share changes.<br>' +
      '· "Records no token" is DefiLlama\u2019s record, not proof: a protocol on this board may have a token its record does not carry.<br>' +
      '· Farming risks loss of capital and of time. Nothing here is advice.</p></div>';
  })();

  /* -------------------------------------------------------------- live tab */
  (function liveTab() {
    var rows = R.live.map(function (p) {
      var mult = p.mcap_usd !== null && p.tvl_usd > 0 ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : '—';
      return '<tr><td><b>' + esc(p.name) + '</b><span class="sub">' + esc(p.slug) + ' · ' + esc(p.chains.slice(0, 3).join(', ')) + '</span></td><td>' + esc(p.category || '—') + '</td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + mult + '</td><td class="num">' + chg7(p) + '</td></tr>';
    }).join('');
    $('tab-live').innerHTML = '<div class="card"><h2>Already trading — not ranked</h2>' +
      '<p>These protocols record a token, so the board shows the market\u2019s own value for them instead of a model\u2019s. The top ' + R.live.length + ' by market cap are below; the full set aside is ' + R.coverage.setAside.find(function (g) { return g.reason === 'live-token'; }).count + ' protocols.</p>' +
      '<table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Multiple</th><th class="num">7d</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  })();

  /* -------------------------------------------------------------- start */
  renderTable();
  /* Deep links for screenshots and sharing: #detail=<slug>, #verdict=FARM, #deposit=500 */
  var hash = (location.hash || '').replace(/^#/, '');
  var params = {};
  hash.split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) params[p[0]] = decodeURIComponent(p[1] || ''); });
  if (params.verdict && ['FARM', 'MARGINAL', 'SKIP'].indexOf(params.verdict) >= 0) { $('f-verdict').value = params.verdict; state.verdict = params.verdict; }
  if (params.deposit && R.assumptions.deposit_grid.indexOf(parseInt(params.deposit, 10)) >= 0) { $('f-dep').value = params.deposit; state.deposit = parseInt(params.deposit, 10); }
  if (params.wl === '1') { $('f-wl').checked = true; state.wl = true; }
  if (params.chain) { $('f-chain').value = params.chain; state.chain = params.chain; }
  renderTable();
  if (params.detail) { setTimeout(function () { openDetail(params.detail); }, 50); }
  if (params.tab && ['board', 'method', 'live'].indexOf(params.tab) >= 0) showTab(params.tab);
})();
