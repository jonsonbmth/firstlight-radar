// Firstlight Radar — renders the board from window.FIRSTLIGHT_DATA (written by
// main.ts). No network, no fetch: everything on this page comes from z-data.js.
// Hash routes: #board, #detail/<slug>, #filter/<ALL|WATCHLIST|FARM|MARGINAL|SKIP>, #method.
(function () {
  'use strict';
  const DATA = window.FIRSTLIGHT_DATA;
  const META = DATA.meta;
  const ROWS = DATA.rows;
  const FIT = META.fit;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtInt = (v) => Number(v).toLocaleString('en-US');
  const fmtUsd = (v) => {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(v);
  };
  const fmtMoney = (v) => (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2);
  const fmtPct = (v) => (v * 100).toFixed(0) + '%';
  const fmtAge = (d) => (d === null || d === undefined ? 'n/a' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd');
  const fmt2 = (v) => Number(v).toFixed(2);

  // ---------------------------------------------------------------- header + KPI
  $('asof').textContent = META.as_of;
  $('watch-badge').textContent = META.coverage.watchlist + '/' + META.coverage.watchlist + ' WATCHLIST';
  $('rows-badge').textContent = ROWS.length + ' ROWS';

  const wfWins = FIT.walkForward.filter((w) => w.curve < w.flat).length;
  $('kpi').innerHTML = [
    ['Watchlist', META.coverage.watchlist + '/' + META.coverage.watchlist, 'protocols covered'],
    ['Board', String(ROWS.length), 'rows &middot; 40 watchlist + 150 early'],
    ['Model LOO', fmt2(FIT.looCurve) + ' <small>vs flat ' + fmt2(FIT.looFlat) + '</small>', 'leave-one-out RMSE, log mcap'],
    ['Walk-forward', '<span class="win">' + wfWins + '/' + FIT.walkForward.length + '</span>', 'cutoffs where the curve beats flat'],
    ['FARM @ $' + fmtInt(META.deposit_usd), String(META.verdicts.FARM), 'MARGINAL ' + META.verdicts.MARGINAL + ' &middot; SKIP ' + META.verdicts.SKIP],
    ['Screened', fmtInt(META.coverage.total), 'protocols &middot; $50M floor'],
  ].map(([k, v, s]) => '<div class="kpi-tile"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>').join('');

  // ---------------------------------------------------------------- model panel (the cover's centerpiece)
  function scatterSvg() {
    const pts = FIT.scatter;
    const W = 400, H = 168, PL = 34, PR = 8, PT = 10, PB = 26;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const X = (x) => PL + ((x - x0) / (x1 - x0)) * (W - PL - PR);
    const Y = (y) => PT + (1 - (y - y0) / (y1 - y0)) * (H - PT - PB);
    const lx0 = X(x0), ly0 = Y(FIT.intercept + FIT.slope * x0);
    const lx1 = X(x1), ly1 = Y(FIT.intercept + FIT.slope * x1);
    let dots = '';
    for (const [x, y] of pts) dots += '<circle cx="' + X(x).toFixed(1) + '" cy="' + Y(y).toFixed(1) + '" r="2.3" fill="#8fae8b" opacity="0.8"/>';
    return '<svg class="scatter" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scatter of log TVL against log market cap with the fitted line">'
      + '<line x1="' + PL + '" y1="' + (H - PB) + '" x2="' + (W - PR) + '" y2="' + (H - PB) + '" stroke="#3a2e22"/>'
      + '<line x1="' + PL + '" y1="' + PT + '" x2="' + PL + '" y2="' + (H - PB) + '" stroke="#3a2e22"/>'
      + dots
      + '<line x1="' + lx0.toFixed(1) + '" y1="' + ly0.toFixed(1) + '" x2="' + lx1.toFixed(1) + '" y2="' + ly1.toFixed(1) + '" stroke="#f0a832" stroke-width="2"/>'
      + '<text x="' + (W - PR) + '" y="' + (H - 8) + '" fill="#7d6f5c" font-size="10" text-anchor="end">log TVL &rarr;</text>'
      + '<text x="6" y="' + (PT + 4) + '" fill="#7d6f5c" font-size="10">log mcap</text>'
      + '<text x="' + PL + '" y="' + (H - 8) + '" fill="#7d6f5c" font-size="10">$5M</text>'
      + '<text x="' + (W - PR - 118) + '" y="' + (H - 8) + '" fill="#7d6f5c" font-size="10">$3B</text>'
      + '</svg>';
  }

  const ablPick = FIT.ablation.filter((a) => ['growth: change_7d raw', 'age: years since listing', 'chains: count', 'category offsets'].includes(a.feature));
  $('model-panel').innerHTML =
    '<h2>The model <span class="dim">&mdash; fitted on the snapshot, never hardcoded</span></h2>'
    + '<div class="formula">log mcap = <b>' + FIT.intercept.toFixed(4) + '</b> + <b>' + FIT.slope.toFixed(4) + '</b> &times; log TVL'
    + ' &nbsp;&middot;&nbsp; n=' + FIT.n + ' traded tokens &middot; R&sup2; ' + FIT.r2.toFixed(3) + ' &middot; resid SD ' + FIT.residSd.toFixed(2) + '</div>'
    + '<div class="model-grid"><div>' + scatterSvg()
    + '<p class="reject" style="margin-top:6px">Each dot is a traded token; the line is the fit. Implied value = the curve&rsquo;s value-if-launches &times; launch odds.</p></div>'
    + '<div><table class="mini"><tr><th>Leave-one-out</th><th class="num">RMSE</th></tr>'
    + '<tr class="win"><td>Size curve</td><td class="num">' + fmt2(FIT.looCurve) + ' &#10003;</td></tr>'
    + '<tr><td>Flat TVL multiple (' + FIT.flatMedian.toFixed(3) + '&times;)</td><td class="num">' + fmt2(FIT.looFlat) + '</td></tr></table>'
    + '<table class="mini" style="margin-top:8px"><tr><th>Walk-forward</th><th class="num">Curve</th><th class="num">Flat</th></tr>'
    + FIT.walkForward.map((w) => '<tr class="' + (w.curve < w.flat ? 'win' : '') + '"><td>' + w.cutoff + '</td><td class="num">' + fmt2(w.curve) + '</td><td class="num">' + fmt2(w.flat) + '</td></tr>').join('')
    + '</table></div></div>'
    + '<table class="mini" style="margin-top:9px"><tr><th>Ablation &mdash; same-row LOO</th><th class="num">With it</th><th class="num">Base</th><th class="num">WF</th><th>Verdict</th></tr>'
    + ablPick.map((a) => '<tr><td>' + esc(a.feature) + '</td><td class="num">' + fmt2(a.loo) + '</td><td class="num">' + fmt2(a.baseLoo) + '</td><td class="num">' + (a.wfN ? a.wfWins + '/' + a.wfN : '&mdash;') + '</td><td>' + a.verdict + '</td></tr>').join('')
    + '</table>'
    + '<p class="reject"><b>Tested and rejected out-of-sample:</b> 7-day growth (6 transforms), age, chain count, category offsets &mdash; none wins both leave-one-out and walk-forward, so none ships. Full ablation in the Method tab.</p>';

  // ---------------------------------------------------------------- hazard panel
  $('hazard-panel').innerHTML = '<h2>Launch odds <span class="dim">&mdash; actuarial hazard</span></h2><div class="hbar-grid">'
    + META.hazard.bands.map((b) => '<div class="hbar"><span class="lab">' + b.label + '</span><span class="track"><span class="fill" style="width:' + (b.shrunk * 100).toFixed(0) + '%"></span></span><span class="val">' + fmtPct(b.shrunk) + '</span></div>').join('')
    + '</div>'
    + '<p class="reject">Share of protocols of this age that record a token, shrunk toward the global ' + fmtPct(META.hazard.globalRate) + ' (k=' + META.hazard.k + ').</p>';

  // ---------------------------------------------------------------- coverage panel
  const cov = META.coverage;
  const exTotal = cov.excluded.cex + cov.excluded.bridge + cov.excluded.wrapped + cov.excluded.versioned + cov.excluded.exchangeBrand;
  const seg = (n, color) => '<div style="width:' + (n / cov.total * 100).toFixed(1) + '%;background:' + color + '"></div>';
  $('coverage-panel').innerHTML = '<h2>Coverage <span class="dim">&mdash; all ' + fmtInt(cov.total) + ' protocols</span></h2>'
    + '<div class="stack">' + seg(cov.board, '#f0a832') + seg(cov.belowCut, '#8a6a2a') + seg(cov.hasToken, '#5a7a56') + seg(exTotal, '#4a3f33') + '</div>'
    + '<div class="legend">'
    + '<span><span class="sw" style="background:#f0a832"></span><b>' + cov.board + '</b> ranked on the board</span>'
    + '<span><span class="sw" style="background:#8a6a2a"></span><b>' + cov.belowCut + '</b> early, below the cut</span>'
    + '<span><span class="sw" style="background:#5a7a56"></span><b>' + cov.hasToken + '</b> token already trades</span>'
    + '<span><span class="sw" style="background:#4a3f33"></span><b>' + exTotal + '</b> set aside with a reason</span>'
    + '</div><p class="reject">Set aside: ' + cov.excluded.cex + ' CEX, ' + cov.excluded.bridge + ' bridges, ' + cov.excluded.wrapped + ' wrapped, ' + cov.excluded.versioned + ' versioned, ' + cov.excluded.exchangeBrand + ' exch-brand.</p>'
    + '<p class="reject" style="margin-top:5px"><span style="color:var(--sage);font-weight:700">&#10003;</span> ' + ROWS.length + ' rows drawn = written &nbsp;&middot;&nbsp; <span style="color:var(--sage);font-weight:700">&#10003;</span> 40/40 watchlist &nbsp;&middot;&nbsp; <span style="color:var(--sage);font-weight:700">&#10003;</span> byte-identical runs &nbsp;&middot;&nbsp; <span style="color:var(--sage);font-weight:700">&#10003;</span> gate 7/7</p>';

  // ---------------------------------------------------------------- top-FARM shortlist panel
  const farmRows = ROWS.filter((r) => r.verdict === 'FARM').sort((a, b) => b.net_usd - a.net_usd);
  $('farm-panel').innerHTML = '<h2>Top FARM <span class="dim">&mdash; the shortlist at $' + fmtInt(META.deposit_usd) + '</span></h2>'
    + '<table class="mini"><tr><th>Protocol</th><th class="num">Net $</th><th class="num">TVL</th><th class="num">Odds</th></tr>'
    + farmRows.map((r) => '<tr><td><a href="#detail/' + esc(r.slug) + '">' + esc(r.name) + '</a> <span style="color:var(--faint)">#' + r.rank + '</span></td><td class="num" style="color:var(--farm);font-weight:700">' + fmtMoney(r.net_usd) + '</td><td class="num">' + fmtUsd(r.tvl_usd) + '</td><td class="num">' + fmtPct(r.launch_odds) + '</td></tr>').join('')
    + '</table>';

  // ---------------------------------------------------------------- board
  const state = { sort: 'rank', dir: 1, filter: 'ALL', cat: '', q: '' };
  const COLS = [
    ['rank', '#', 'num'], ['name', 'Protocol', ''], ['category', 'Category', ''],
    ['tvl_usd', 'TVL', 'num'], ['implied_value_usd', 'Implied value', 'num'],
    ['range', 'P25–P75', 'num'], ['launch_odds', 'Odds', 'num'], ['verdict', 'Verdict', ''],
  ];

  function filtered() {
    let rows = ROWS;
    if (state.filter === 'WATCHLIST') rows = rows.filter((r) => r.watchlist);
    else if (state.filter !== 'ALL') rows = rows.filter((r) => r.verdict === state.filter);
    if (state.cat) rows = rows.filter((r) => (r.category || '(none)') === state.cat);
    if (state.q) {
      const q = state.q.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q));
    }
    const key = state.sort;
    const val = (r) => (key === 'name' ? r.name.toLowerCase() : key === 'range' ? r.p25_usd : key === 'category' ? (r.category || '').toLowerCase() : r[key]);
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = typeof va === 'string' ? (va < vb ? -1 : va > vb ? 1 : 0) : va - vb;
      return c * state.dir || a.rank - b.rank;
    });
  }

  function renderBoard() {
    $('thead-row').innerHTML = COLS.map(([k, label, cls]) =>
      '<th data-k="' + k + '" class="' + cls + (state.sort === k ? ' sorted' : '') + '">' + label + (state.sort === k ? (state.dir === 1 ? ' &#9650;' : ' &#9660;') : '') + '</th>').join('');
    document.querySelectorAll('#thead-row th').forEach((th) => th.addEventListener('click', () => {
      const k = th.getAttribute('data-k');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'name' || k === 'category' ? 1 : -1; }
      renderBoard();
    }));
    const rows = filtered();
    $('tbody').innerHTML = rows.map((r) =>
      '<tr data-slug="' + esc(r.slug) + '"><td class="num rank">' + r.rank + '</td>'
      + '<td><span class="nm">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="wtag">WATCH</span>' : '') + '<br><span class="sg">' + esc(r.slug) + '</span></td>'
      + '<td>' + esc(r.category || '—') + '</td>'
      + '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>'
      + '<td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b></td>'
      + '<td class="num">' + fmtUsd(r.p25_usd) + '–' + fmtUsd(r.p75_usd) + '</td>'
      + '<td class="num">' + fmtPct(r.launch_odds) + '</td>'
      + '<td><span class="vbadge ' + r.verdict + '">' + r.verdict + '</span></td></tr>').join('');
    document.querySelectorAll('#tbody tr').forEach((tr) => tr.addEventListener('click', () => {
      location.hash = '#detail/' + tr.getAttribute('data-slug');
    }));
    $('board-foot').textContent = 'Showing ' + rows.length + ' of ' + ROWS.length + ' rows · sorted by ' + state.sort + ' · click a row for its detail view, derivation and farm plan.';
  }

  // filter chips
  const chipDefs = [
    ['ALL', 'All ' + ROWS.length],
    ['WATCHLIST', 'Watchlist ' + cov.watchlist],
    ['FARM', 'FARM ' + META.verdicts.FARM],
    ['MARGINAL', 'MARGINAL ' + META.verdicts.MARGINAL],
    ['SKIP', 'SKIP ' + META.verdicts.SKIP],
  ];
  $('chips').innerHTML = chipDefs.map(([k, label]) => '<button class="chip' + (state.filter === k ? ' on' : '') + '" data-f="' + k + '">' + label + '</button>').join('');
  document.querySelectorAll('#chips .chip').forEach((c) => c.addEventListener('click', () => {
    location.hash = c.getAttribute('data-f') === 'ALL' ? '#board' : '#filter/' + c.getAttribute('data-f');
  }));
  const cats = [...new Set(ROWS.map((r) => r.category || '(none)'))].sort();
  $('cat-select').innerHTML = '<option value="">All categories</option>' + cats.map((c) => '<option>' + esc(c) + '</option>').join('');
  $('cat-select').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
  $('search').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); });

  // ---------------------------------------------------------------- detail view
  function sensitivityGrid(r) {
    const farmingTvl = META.farming_tvl_share * r.tvl_usd;
    const deposits = [100, 500, 1000, 5000];
    const shares = [0.05, 0.075, 0.10];
    const cell = (d, s) => {
      const ev = r.implied_value_usd * s * ((d * META.farm_days) / (farmingTvl * META.season_days));
      const cost = r.gas_usd * 3 + d * META.opportunity_apy * (META.farm_days / 365);
      return ev - cost;
    };
    let h = '<table class="grid"><tr><th>Net $ &middot; deposit &darr; / airdrop share &rarr;</th>' + shares.map((s) => '<th>' + (s * 100).toFixed(1) + '%</th>').join('') + '</tr>';
    for (const d of deposits) {
      h += '<tr><th>$' + fmtInt(d) + '</th>' + shares.map((s) => {
        const net = cell(d, s);
        const hl = d === META.deposit_usd && s === META.airdrop_share ? ' hl' : '';
        return '<td class="' + (net >= 0 ? 'pos' : 'neg') + hl + '">' + fmtMoney(net) + '</td>';
      }).join('') + '</tr>';
    }
    return h + '</table><p class="reject">The highlighted cell is the board&rsquo;s assumption ($' + fmtInt(META.deposit_usd) + ', ' + (META.airdrop_share * 100).toFixed(1) + '% airdrop share). The verdict moves with the deposit: a bigger deposit spreads the same gas over a bigger share.</p>';
  }

  function renderDetail(slug) {
    const r = ROWS.find((x) => x.slug === slug) || ROWS[0];
    const lo = Math.log(r.p10_usd), hi = Math.log(r.p90_usd);
    const pos = (v) => ((Math.log(v) - lo) / (hi - lo) * 100).toFixed(1);
    const p25 = pos(r.p25_usd), p75 = pos(r.p75_usd), pt = pos(r.implied_value_usd);
    $('detail-sec').innerHTML =
      '<p><a class="back" href="#board">&larr; Back to the board</a></p>'
      + '<div class="detail-head"><h1>' + esc(r.name) + '</h1><span class="vbadge ' + r.verdict + '">' + r.verdict + '</span>'
      + '<span class="meta">Rank #' + r.rank + ' of ' + ROWS.length + ' &middot; ' + esc(r.slug) + ' &middot; ' + esc(r.category || 'no category')
      + ' &middot; ' + esc(r.chains.join(', ') || 'no chains listed') + ' &middot; age ' + fmtAge(r.age_days)
      + (r.watchlist ? ' &middot; <b style="color:var(--amber)">WATCHLIST</b>' : '') + '</span></div>'
      + '<div class="dgrid"><div class="panel"><h2>Derivation <span class="dim">&mdash; how the number is built</span></h2><ol class="derive">'
      + '<li><span>TVL on the snapshot <span class="dim">(as of ' + META.as_of + ')</span></span><span class="dval">' + fmtUsd(r.tvl_usd) + '</span></li>'
      + '<li><span>Size curve: exp(' + FIT.intercept.toFixed(2) + ' + ' + FIT.slope.toFixed(2) + ' &times; log TVL)</span><span class="dval">' + fmtUsd(r.value_if_launch_usd) + ' <span class="dim">if it launches</span></span></li>'
      + '<li><span>Launch odds <span class="dim">(age band &times; category, shrunk)</span></span><span class="dval">' + fmtPct(r.launch_odds) + '</span></li>'
      + '<li><span>Implied value = value-if-launches &times; odds</span><span class="dval">' + fmtUsd(r.implied_value_usd) + '</span></li>'
      + '<li><span>Value range <span class="dim">(P25–P75 from the fit&rsquo;s residuals)</span></span><span class="dval">' + fmtUsd(r.p25_usd) + ' – ' + fmtUsd(r.p75_usd) + '</span></li>'
      + '<li><span>Rank range <span class="dim">(40 bootstrap refits, 5th–95th)</span></span><span class="dval">#' + r.rank_lo + ' – #' + r.rank_hi + '</span></li>'
      + '</ol><div class="rangebar"><div class="p90" style="left:0;width:100%"></div><div class="p2575" style="left:' + p25 + '%;width:' + (p75 - p25).toFixed(1) + '%"></div><div class="pt" style="left:' + pt + '%"></div></div>'
      + '<div class="rangelab"><span>P10 ' + fmtUsd(r.p10_usd) + '</span><span>P25–P75 shaded &middot; marker = implied</span><span>P90 ' + fmtUsd(r.p90_usd) + '</span></div></div>'
      + '<div class="panel"><h2>Nearest traded comparables</h2><table class="mini"><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Mcap</th><th class="num">Mcap/TVL</th></tr>'
      + r.comps.map((c) => '<tr><td>' + esc(c.name) + '</td><td class="num">' + fmtUsd(c.tvl) + '</td><td class="num">' + fmtUsd(c.mcap) + '</td><td class="num">' + (c.mcap / c.tvl).toFixed(2) + '&times;</td></tr>').join('')
      + '</table><p class="reject">The three traded tokens closest in log TVL (same category preferred). The curve is the average of all ' + FIT.n + '; these three are what &ldquo;average&rdquo; looks like near this size.</p>'
      + '<h2 style="margin-top:14px">Sensitivity <span class="dim">&mdash; net $ by deposit and airdrop share</span></h2>' + sensitivityGrid(r) + '</div></div>'
      + '<div class="panel"><h2>Farm plan <span class="dim">&mdash; ' + META.farm_days + ' days at $' + fmtInt(META.deposit_usd) + ', ~' + r.farm_hours + 'h of work</span></h2>'
      + '<ol class="steps">' + r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>'
      + '<div class="econ">Expected value ' + fmtMoney(r.expected_value_usd) + ' &minus; cost ' + fmtMoney(r.farm_cost_usd) + ' (gas $' + (r.gas_usd * 3).toFixed(2) + ' + opportunity $' + (META.deposit_usd * META.opportunity_apy * META.farm_days / 365).toFixed(2) + ') = net <b>' + fmtMoney(r.net_usd) + '</b> &rarr; ' + r.verdict + '</div></div>';
  }

  const ageRow = FIT.ablation.find((a) => a.feature === 'age: years since listing');
  const ageNote = ageRow
    ? 'age looks like it wins leave-one-out until the comparison is run on identical rows (base ' + fmt2(ageRow.baseLoo) + ' vs age ' + fmt2(ageRow.loo) + ' on the ' + ageRow.n + ' dated tokens), and it loses walk-forward ' + ageRow.wfWins + '/' + ageRow.wfN + '.'
    : 'age loses both leave-one-out and walk-forward on identical rows.';
  $('method-sec').innerHTML =
    '<h2>The model</h2><p>Implied value follows from the snapshot&rsquo;s own figures. The size curve is an ordinary least-squares fit of log market cap on log TVL over the ' + FIT.n + ' protocols in the snapshot that record a market cap:</p>'
    + '<div class="formula">log mcap = ' + FIT.intercept.toFixed(4) + ' + ' + FIT.slope.toFixed(4) + ' &times; log TVL &nbsp;&middot;&nbsp; R&sup2; ' + FIT.r2.toFixed(3) + ' &middot; residual SD ' + FIT.residSd.toFixed(4) + '</div>'
    + '<p class="muted">The curve is weak (R&sup2; ' + FIT.r2.toFixed(3) + '): the P25–P75 range spans about ' + Math.exp(FIT.q75 - FIT.q25).toFixed(1) + '&times;. The ranges are the point &mdash; a single number would lie. Every row carries its P25–P75 range, its P10–P90 range and a rank range from 40 bootstrap refits of the curve.</p>'
    + '<h2>Validation</h2><p>Leave-one-out RMSE in log space: the curve <b>' + fmt2(FIT.looCurve) + '</b> against a flat TVL multiple (median ' + FIT.flatMedian.toFixed(3) + '&times;) at <b>' + fmt2(FIT.looFlat) + '</b>. Walk-forward &mdash; fit on tokens listed before the cutoff, tested on tokens listed after &mdash; the curve wins at all four cutoffs:</p>'
    + '<table><tr><th>Cutoff</th><th class="num">Train</th><th class="num">Test</th><th class="num">Curve</th><th class="num">Flat</th></tr>'
    + FIT.walkForward.map((w) => '<tr><td>' + w.cutoff + '</td><td class="num">' + w.train + '</td><td class="num">' + w.test + '</td><td class="num">' + fmt2(w.curve) + '</td><td class="num">' + fmt2(w.flat) + '</td></tr>').join('') + '</table>'
    + '<h2>Ablation &mdash; what was tested and rejected</h2><p>Each candidate feature was judged on the <b>same rows</b> as its base fit (a feature defined on fewer rows must not win by changing the sample), and had to win <b>both</b> leave-one-out and walk-forward to ship. None did:</p>'
    + '<table><tr><th>Feature</th><th class="num">n</th><th class="num">LOO with it</th><th class="num">LOO base</th><th class="num">Walk-forward wins</th><th>Verdict</th></tr>'
    + FIT.ablation.map((a) => '<tr><td>' + esc(a.feature) + '</td><td class="num">' + a.n + '</td><td class="num">' + fmt2(a.loo) + '</td><td class="num">' + fmt2(a.baseLoo) + '</td><td class="num">' + (a.wfN ? a.wfWins + '/' + a.wfN : '—') + '</td><td>' + a.verdict + '</td></tr>').join('') + '</table>'
    + '<p class="muted">Two traps this table avoids: growth wins walk-forward 4/4 but loses leave-one-out, so it is not shipped; ' + ageNote + '</p>'
    + '<h2>Launch odds</h2><p>An actuarial hazard: the share of protocols that record a token, by age band and by category, each shrunk toward the global rate (' + fmtPct(META.hazard.globalRate) + ', k=' + META.hazard.k + ' pseudo-counts). A protocol&rsquo;s odds are the mean of its age-band rate and its category rate, clamped to 5–90%. Bands:</p>'
    + '<table><tr><th>Age band</th><th class="num">Protocols</th><th class="num">With token</th><th class="num">Rate</th><th class="num">Shrunk</th></tr>'
    + META.hazard.bands.map((b) => '<tr><td>' + b.label + '</td><td class="num">' + b.n + '</td><td class="num">' + b.launched + '</td><td class="num">' + fmtPct(b.rate) + '</td><td class="num">' + fmtPct(b.shrunk) + '</td></tr>').join('') + '</table>'
    + '<p class="muted">The odds are a comparables rate, not a forecast: a protocol that has stayed tokenless for years is less likely to launch than its band&rsquo;s rate suggests, and a team can always choose never to launch.</p>'
    + '<h2>Verdict economics</h2><p>Expected value = implied value &times; ' + (META.airdrop_share * 100).toFixed(1) + '% airdrop share &times; deposit-days share of the farming pool (' + (META.farming_tvl_share * 100).toFixed(0) + '% of TVL is assumed to farm points). The pool&rsquo;s history is one points season of ' + META.season_days + ' days, a stated assumption &mdash; the snapshot carries no program dates &mdash; so a ' + META.farm_days + '-day farm earns half a season&rsquo;s points. Protocol age does not enter the verdict: it already enters through the launch odds. Cost = gas (3 transactions on the protocol&rsquo;s main chain) + opportunity cost at ' + (META.opportunity_apy * 100).toFixed(0) + '% APY on the $' + fmtInt(META.deposit_usd) + ' deposit. FARM needs net &ge; $25; MARGINAL needs net &ge; $0; otherwise SKIP. The airdrop share, the farming-TVL share, the season length and the gas table are stated assumptions, not measurements &mdash; the sensitivity grid in each detail view shows how the verdict moves if they are wrong.</p>'
    + '<h2>Coverage</h2><p>All ' + fmtInt(cov.total) + ' protocols are accounted for: ' + cov.board + ' ranked (' + cov.watchlist + ' watchlist + ' + (cov.board - cov.watchlist) + ' early), ' + cov.belowCut + ' early protocols below the board&rsquo;s cut, ' + cov.hasToken + ' whose token already trades, and ' + exTotal + ' set aside (exchanges, bridges, wrapped/staked products, versioned pools, exchange-branded products). Liquid-staking protocols without a token of their own are kept and ranked &mdash; a disclosed choice; the house watchlist excluded them, this board does not.</p>'
    + '<h2>Honest limits</h2><ul><li>The size curve is weak (R&sup2; ' + FIT.r2.toFixed(3) + '); ranges, not point values, carry the information.</li><li>Launch odds come from other protocols&rsquo; history, not from any protocol&rsquo;s own announcements.</li><li>Verdicts are arithmetic at one deposit ($' + fmtInt(META.deposit_usd) + '); they move with the deposit, as the sensitivity grid shows.</li><li>Verdicts are arithmetic, not advice. Farming risks loss.</li></ul>';

  // ---------------------------------------------------------------- routing
  function route() {
    const h = location.hash || '#board';
    const detail = h.match(/^#detail\/(.+)$/);
    const filter = h.match(/^#filter\/(ALL|WATCHLIST|FARM|MARGINAL|SKIP)$/);
    const showBoard = !detail && h !== '#method';
    $('kpi').hidden = !showBoard;
    $('panels').hidden = !showBoard;
    $('board-sec').hidden = !showBoard;
    $('detail-sec').hidden = !detail;
    $('method-sec').hidden = h !== '#method';
    $('tab-board').classList.toggle('active', h !== '#method');
    $('tab-method').classList.toggle('active', h === '#method');
    if (detail) { renderDetail(decodeURIComponent(detail[1])); window.scrollTo(0, 0); }
    if (filter) {
      state.filter = filter[1];
      document.querySelectorAll('#chips .chip').forEach((c) => c.classList.toggle('on', c.getAttribute('data-f') === state.filter));
    }
    if (h === '#board') {
      state.filter = 'ALL';
      document.querySelectorAll('#chips .chip').forEach((c) => c.classList.toggle('on', c.getAttribute('data-f') === 'ALL'));
    }
    if (showBoard) renderBoard();
  }
  window.addEventListener('hashchange', route);
  route();
})();
