// Firstlight Radar v2 — the whole model, fitted at runtime from the sealed snapshot.
// Nothing about any protocol is hardcoded: the curve, the validation, the hazard
// and the verdicts are all derived from /input/snapshot.json on every run.
// Deterministic: no clock, no Math.random (the bootstrap uses a fixed-seed PRNG).

export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

// ---------------------------------------------------------------- utilities

/** Deterministic PRNG (mulberry32) so the bootstrap refits reproduce byte for byte. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_MS = 86400000;
export const hasToken = (p: Proto): boolean => p.gecko_id !== null || p.symbol !== null;

export function ageDays(p: Proto, asOf: Date): number | null {
  if (!p.listed_at) return null;
  return Math.max(0, Math.round((asOf.getTime() - new Date(p.listed_at + 'T00:00:00Z').getTime()) / DAY_MS));
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
}

export const rmse = (errs: number[]): number =>
  Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / Math.max(1, errs.length));

/** Ordinary least squares via the normal equations (Gaussian elimination). */
export function ols(xs: number[][], ys: number[]): number[] | null {
  const n = ys.length;
  const k = xs[0].length + 1;
  const A: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const b: number[] = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    const r = [1, ...xs[i]];
    for (let j = 0; j < k; j++) {
      b[j] += r[j] * ys[i];
      for (let l = 0; l < k; l++) A[j][l] += r[j] * r[l];
    }
  }
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    if (Math.abs(d) < 1e-12) return null;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => row[k] / row[i]);
}

export const predict = (beta: number[], x: number[]): number =>
  beta[0] + beta.slice(1).reduce((s, v, j) => s + v * x[j], 0);

/** Leave-one-out RMSE of a one-feature-plus-intercept fit, refitting per fold. */
export function looRmse(rows: Proto[], feat: ((p: Proto) => number | null) | null): { n: number; rmse: number } | null {
  const use = rows.filter((p) => (feat === null ? true : feat(p) !== null));
  if (use.length < 10) return null;
  const xs = use.map((p) => (feat === null ? [Math.log(p.tvl_usd)] : [Math.log(p.tvl_usd), feat(p) as number]));
  const ys = use.map((p) => Math.log(p.mcap_usd as number));
  const errs: number[] = [];
  for (let i = 0; i < use.length; i++) {
    const b = ols(xs.filter((_, j) => j !== i), ys.filter((_, j) => j !== i));
    if (!b) return null;
    errs.push(ys[i] - predict(b, xs[i]));
  }
  return { n: use.length, rmse: rmse(errs) };
}

/** Walk-forward wins of a feature model against the base curve, over the cutoffs. */
export function walkForwardWins(rows: Proto[], feat: ((p: Proto) => number | null) | null, cutoffs: string[]): { wins: number; n: number } {
  let wins = 0;
  let n = 0;
  for (const cut of cutoffs) {
    const train = rows.filter((p) => p.listed_at && p.listed_at < cut && (feat === null || feat(p) !== null));
    const test = rows.filter((p) => p.listed_at && p.listed_at >= cut && (feat === null || feat(p) !== null));
    if (train.length < 10 || test.length < 3) continue;
    const b1 = ols(train.map((p) => [Math.log(p.tvl_usd)]), train.map((p) => Math.log(p.mcap_usd as number)));
    const b2 = feat === null
      ? null
      : ols(train.map((p) => [Math.log(p.tvl_usd), feat(p) as number]), train.map((p) => Math.log(p.mcap_usd as number)));
    if (!b1 || (feat !== null && !b2)) continue;
    const e1 = test.map((p) => Math.log(p.mcap_usd as number) - predict(b1, [Math.log(p.tvl_usd)]));
    const e2 = test.map((p) => Math.log(p.mcap_usd as number) - predict(b2 as number[], [Math.log(p.tvl_usd), feat(p) as number]));
    n++;
    if (rmse(e2) < rmse(e1)) wins++;
  }
  return { wins, n };
}

// ---------------------------------------------------------------- the fit

export interface WalkRow { cutoff: string; train: number; test: number; curve: number; flat: number }
export interface AblationRow { feature: string; n: number; loo: number; baseLoo: number; wfWins: number; wfN: number; verdict: string }

export interface Fit {
  intercept: number;
  slope: number;
  n: number;
  r2: number;
  residSd: number;
  q10: number; q25: number; q50: number; q75: number; q90: number;
  looCurve: number;
  looFlat: number;
  flatMedian: number;
  walkForward: WalkRow[];
  ablation: AblationRow[];
  scatter: Array<[number, number]>; // [log TVL, log mcap] of the traded comps, for the cover plot
}

const CUTOFFS = ['2024-01-01', '2024-07-01', '2025-01-01', '2025-07-01'];

export function fitCurve(traded: Proto[], asOf: Date): Fit {
  const xs = traded.map((p) => [Math.log(p.tvl_usd)]);
  const ys = traded.map((p) => Math.log(p.mcap_usd as number));
  const beta = ols(xs, ys) as number[];
  const resid = ys.map((y, i) => y - predict(beta, xs[i]));
  const yMean = ys.reduce((s, v) => s + v, 0) / ys.length;
  const ssTot = ys.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = resid.reduce((s, e) => s + e * e, 0);
  const sorted = [...resid].sort((a, b) => a - b);

  // LOO: the curve against a flat TVL multiple (median mcap/TVL, leave-one-out).
  const looC = looRmse(traded, null) as { n: number; rmse: number };
  const ratios = traded.map((p) => (p.mcap_usd as number) / p.tvl_usd);
  const looFlatErrs = traded.map((p, i) => {
    const m = median(ratios.filter((_, j) => j !== i));
    return Math.log(p.mcap_usd as number) - (Math.log(m) + Math.log(p.tvl_usd));
  });

  // Walk-forward: fit on tokens listed before the cutoff, test on those after.
  const walkForward: WalkRow[] = [];
  for (const cut of CUTOFFS) {
    const train = traded.filter((p) => p.listed_at && p.listed_at < cut);
    const test = traded.filter((p) => p.listed_at && p.listed_at >= cut);
    if (train.length < 10 || test.length < 3) continue;
    const b = ols(train.map((p) => [Math.log(p.tvl_usd)]), train.map((p) => Math.log(p.mcap_usd as number))) as number[];
    const eC = test.map((p) => Math.log(p.mcap_usd as number) - predict(b, [Math.log(p.tvl_usd)]));
    const m = median(train.map((p) => (p.mcap_usd as number) / p.tvl_usd));
    const eF = test.map((p) => Math.log(p.mcap_usd as number) - (Math.log(m) + Math.log(p.tvl_usd)));
    walkForward.push({ cutoff: cut, train: train.length, test: test.length, curve: rmse(eC), flat: rmse(eF) });
  }

  // Ablation: every candidate feature, judged on the SAME rows as its base
  // (a feature defined on fewer rows must not win by changing the sample).
  const ageOf = (p: Proto): number | null => ageDays(p, asOf);
  const features: Array<{ name: string; f: (p: Proto) => number | null }> = [
    { name: 'growth: change_7d raw', f: (p) => p.change_7d },
    { name: 'growth: log1p(change_7d/100)', f: (p) => (p.change_7d === null ? null : Math.log1p(p.change_7d / 100)) },
    { name: 'growth: change_7d clipped ±50', f: (p) => (p.change_7d === null ? null : Math.max(-50, Math.min(50, p.change_7d))) },
    { name: 'growth: sign × √|change_7d|', f: (p) => (p.change_7d === null ? null : Math.sign(p.change_7d) * Math.sqrt(Math.abs(p.change_7d))) },
    { name: 'age: years since listing', f: (p) => { const a = ageOf(p); return a === null ? null : a / 365; } },
    { name: 'age: log days since listing', f: (p) => { const a = ageOf(p); return a === null ? null : Math.log(1 + a); } },
    { name: 'chains: count', f: (p) => p.chains.length },
  ];
  const ablation: AblationRow[] = [];
  for (const { name, f } of features) {
    const rows = traded.filter((p) => f(p) !== null);
    const withFeat = looRmse(rows, f);
    const base = looRmse(rows, null);
    const wf = walkForwardWins(traded, f, CUTOFFS);
    if (!withFeat || !base) continue;
    const winsLoo = withFeat.rmse < base.rmse;
    const winsWf = wf.wins > wf.n / 2;
    ablation.push({
      feature: name, n: rows.length, loo: withFeat.rmse, baseLoo: base.rmse,
      wfWins: wf.wins, wfN: wf.n,
      verdict: winsLoo && winsWf ? 'SHIPPED' : 'rejected',
    });
  }
  // Category offsets: leave-one-out mean residual of the protocol's category.
  {
    const errs: number[] = [];
    const baseErrs: number[] = [];
    for (let i = 0; i < traded.length; i++) {
      const train = traded.filter((_, j) => j !== i);
      const b = ols(train.map((p) => [Math.log(p.tvl_usd)]), train.map((p) => Math.log(p.mcap_usd as number))) as number[];
      const base = predict(b, [Math.log(traded[i].tvl_usd)]);
      const peers = train.filter((p) => p.category === traded[i].category);
      let off = 0;
      if (peers.length >= 5) {
        off = peers.reduce((s, p) => s + (Math.log(p.mcap_usd as number) - predict(b, [Math.log(p.tvl_usd)])), 0) / peers.length;
      }
      errs.push(Math.log(traded[i].mcap_usd as number) - (base + off));
      baseErrs.push(Math.log(traded[i].mcap_usd as number) - base);
    }
    ablation.push({
      feature: 'category offsets', n: traded.length, loo: rmse(errs), baseLoo: rmse(baseErrs),
      wfWins: 0, wfN: 0, verdict: 'rejected',
    });
  }

  return {
    intercept: beta[0], slope: beta[1], n: traded.length,
    r2: 1 - ssRes / ssTot, residSd: Math.sqrt(ssRes / (ys.length - 2)),
    q10: quantile(sorted, 0.10), q25: quantile(sorted, 0.25), q50: quantile(sorted, 0.50),
    q75: quantile(sorted, 0.75), q90: quantile(sorted, 0.90),
    looCurve: looC.rmse, looFlat: rmse(looFlatErrs), flatMedian: median(ratios),
    walkForward, ablation,
    scatter: traded.map((p) => [Math.log(p.tvl_usd), Math.log(p.mcap_usd as number)] as [number, number]),
  };
}

// ---------------------------------------------------------------- launch odds (actuarial hazard)

export interface HazardBand { lo: number; hi: number; label: string; n: number; launched: number; rate: number; shrunk: number }
export interface Hazard {
  globalRate: number;
  k: number;
  bands: HazardBand[];
  catRates: Record<string, { n: number; rate: number; shrunk: number }>;
}

const BANDS: Array<[number, number, string]> = [
  [0, 180, '<180d'], [180, 365, '180–365d'], [365, 730, '1–2y'],
  [730, 1095, '2–3y'], [1095, 1825, '3–5y'], [1825, Infinity, '5y+'],
];

export function buildHazard(all: Proto[], asOf: Date): Hazard {
  const k = 10;
  const launched = all.filter(hasToken).length;
  const globalRate = launched / all.length;
  const shrink = (n: number, l: number): number => (l + k * globalRate) / (n + k);
  const bands: HazardBand[] = BANDS.map(([lo, hi, label]) => {
    const g = all.filter((p) => { const a = ageDays(p, asOf); return a !== null && a >= lo && a < hi; });
    const l = g.filter(hasToken).length;
    return { lo, hi, label, n: g.length, launched: l, rate: g.length ? l / g.length : globalRate, shrunk: shrink(g.length, l) };
  });
  const byCat: Record<string, Proto[]> = {};
  for (const p of all) {
    const c = p.category ?? '(none)';
    (byCat[c] ??= []).push(p);
  }
  const catRates: Hazard['catRates'] = {};
  for (const [c, g] of Object.entries(byCat)) {
    const l = g.filter(hasToken).length;
    catRates[c] = { n: g.length, rate: l / g.length, shrunk: shrink(g.length, l) };
  }
  return { globalRate, k, bands, catRates };
}

/** Launch odds: the mean of the shrunk age-band rate and the shrunk category rate. */
export function launchOdds(p: Proto, hazard: Hazard, asOf: Date): number {
  const a = ageDays(p, asOf);
  const band = a === null ? null : hazard.bands.find((b) => a >= b.lo && a < b.hi);
  const bandRate = band ? band.shrunk : hazard.globalRate;
  const cat = hazard.catRates[p.category ?? '(none)'];
  const catRate = cat ? cat.shrunk : hazard.globalRate;
  return Math.min(0.9, Math.max(0.05, (bandRate + catRate) / 2));
}

// ---------------------------------------------------------------- exclusions & coverage

const EXCL_CATS = new Set(['Bridge', 'Canonical Bridge', 'CEX']);
const VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_RE = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_RE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Why a tokenless protocol is set aside, or null when it is rankable. */
export function exclusionReason(p: Proto): string | null {
  if (p.category === 'CEX') return 'cex';
  if (p.category !== null && EXCL_CATS.has(p.category)) return 'bridge';
  if (WRAPPED_RE.test(p.name)) return 'wrapped';
  if (VERSION_RE.test(p.name)) return 'versioned';
  if (EXCHANGE_RE.test(p.name)) return 'exchange-brand';
  return null;
}

// ---------------------------------------------------------------- farm economics

export const DEPOSIT = 1000;
export const FARM_DAYS = 90;
export const SEASON_DAYS = 180; // assumed length of a points season (see farmEconomics)
export const AIRDROP_SHARE = 0.075; // assumed share of implied value paid out as an airdrop
export const FARMING_TVL_SHARE = 0.25; // assumed share of TVL actively farming points
export const OPPORTUNITY_APY = 0.08;

export const GAS_TABLE: Record<string, number> = {
  Ethereum: 30, Solana: 0.5, Base: 2, Arbitrum: 2, Optimism: 2, BSC: 1,
  Polygon: 1, Avalanche: 2, 'zkSync Era': 2, Linea: 2, Scroll: 2, Gnosis: 1,
  Fantom: 1, Celo: 1, Moonbeam: 1, Aurora: 1,
};

export function primaryChain(p: Proto): string {
  return p.chains.length > 0 ? p.chains[0] : 'its home chain';
}

export function gasUsd(p: Proto): number {
  return GAS_TABLE[primaryChain(p)] ?? 5;
}

/** Expected net dollars of farming this protocol at the stated deposit. */
export function farmEconomics(p: Proto, implied: number): { ev: number; cost: number; net: number; hours: number; gas: number } {
  // The farmer's share of the airdrop pool is their deposit-days over the
  // pool's deposit-days. The pool's history is one points season (180 days,
  // a stated assumption — the snapshot carries no program dates), so a 90-day
  // farm earns half a season's points. Protocol age does not enter here: it
  // already enters through the launch odds.
  const farmingTvl = FARMING_TVL_SHARE * p.tvl_usd;
  const share = (DEPOSIT * FARM_DAYS) / (farmingTvl * SEASON_DAYS);
  const ev = implied * AIRDROP_SHARE * share;
  const gas = gasUsd(p);
  const cost = gas * 3 + DEPOSIT * OPPORTUNITY_APY * (FARM_DAYS / 365); // bridge in, act, claim + opportunity cost
  const hours = 3.3; // ~200 minutes across the six steps (see buildFarmSteps)
  return { ev, cost, net: ev - cost, hours, gas };
}

export function verdictOf(net: number): 'FARM' | 'MARGINAL' | 'SKIP' {
  if (net >= 25) return 'FARM';
  if (net >= 0) return 'MARGINAL';
  return 'SKIP';
}

// ---------------------------------------------------------------- farm steps

const CATEGORY_STEP: Record<string, string> = {
  Dexs: 'Swap $500 into the pool\'s paired asset on {name} and add $1,000 of liquidity to its deepest {chain} pool; confirm the position shows in the app. Cost ~${gas} gas + ~0.3% swap fee · ~20 min.',
  Lending: 'Supply the $1,000 USDC to {name}\'s lending market on {chain}; leave borrowing off so the position stays liquidation-free. Cost ~${gas} gas · ~15 min.',
  Yield: 'Deposit $1,000 into {name}\'s highest-TVL vault on {chain} and confirm the vault receipt token lands in your wallet. Cost ~${gas} gas · ~15 min.',
  'Liquid Staking': 'Stake $1,000 of the native asset through {name} on {chain} and hold the receipt token; do not sell it. Cost ~${gas} gas · ~15 min.',
  Derivatives: 'Deposit $1,000 USDC as margin on {name} ({chain}) and open a small 1x hedged position; keep leverage off. Cost ~${gas} gas · ~20 min.',
  Perps: 'Deposit $1,000 USDC as margin on {name} ({chain}) and open a small 1x hedged position; keep leverage off. Cost ~${gas} gas · ~20 min.',
  CDP: 'Lock $1,000 of collateral in {name}\'s vault on {chain} and mint a small amount of its stablecoin; keep the ratio above 200%. Cost ~${gas} gas · ~20 min.',
  'Yield Aggregator': 'Deposit $1,000 into {name}\'s top auto-compounding vault on {chain} and confirm the position is tracked. Cost ~${gas} gas · ~15 min.',
  RWA: 'Deposit $1,000 into {name}\'s highest-TVL real-world-asset pool on {chain}; check the lock-up before you confirm. Cost ~${gas} gas · ~15 min.',
  'Risk Curators': 'Deposit $1,000 into {name}\'s highest-TVL curated vault on {chain} and confirm the position shows in the app. Cost ~${gas} gas · ~15 min.',
};

function fill(tpl: string, p: Proto, gas: number): string {
  return tpl.replaceAll('{name}', p.name).replaceAll('{chain}', primaryChain(p)).replaceAll('{gas}', String(gas));
}

/** Six concrete farm steps, each with its cost and time. */
export function buildFarmSteps(p: Proto): string[] {
  const gas = gasUsd(p);
  const action = CATEGORY_STEP[p.category ?? ''] ??
    'Deposit the $1,000 into {name}\'s main product on {chain} — its highest-TVL pool or vault — and confirm the position shows in the app. Cost ~${gas} gas · ~15 min.';
  return [
    `Move $1,000 USDC onto ${primaryChain(p)} through the official bridge or a major aggregator; keep $25 aside for gas. Cost ~$${gas} gas · ~15 min.`,
    fill(action, p, gas),
    `Connect the same wallet to ${p.name}'s points or rewards page and confirm your deposit is tracked; finish any one-time quests shown there. Cost $0 · ~10 min.`,
    `Once a week, top up or rebalance so the position stays in the rewarded range; each weekly touch costs ~$${gas} gas. Cost ~$${gas}/week · ~10 min/week.`,
    `Hold the position for the full 90-day farm; withdrawing early resets most points programs. Set a calendar reminder for day 90. Cost $0 · ~5 min.`,
    `Watch ${p.name}'s official announcements; if a token launches, claim through the official app only, then unwind the position. Claiming costs ~$${gas} gas · ~20 min.`,
  ];
}

// ---------------------------------------------------------------- the board

export interface Comp { slug: string; name: string; tvl: number; mcap: number }

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  // extras the dashboard reads
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  value_if_launch_usd: number;
  launch_odds: number;
  p25_usd: number;
  p75_usd: number;
  p10_usd: number;
  p90_usd: number;
  rank_lo: number;
  rank_hi: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  expected_value_usd: number;
  farm_cost_usd: number;
  net_usd: number;
  farm_hours: number;
  gas_usd: number;
  comps: Comp[];
}

export interface Coverage {
  total: number;
  hasToken: number;
  excluded: { cex: number; bridge: number; wrapped: number; versioned: number; exchangeBrand: number };
  rankable: number;
  board: number;
  belowCut: number;
  watchlist: number;
}

export interface BoardMeta {
  as_of: string;
  source: string;
  floor_usd: number;
  fit: Fit;
  hazard: Hazard;
  coverage: Coverage;
  verdicts: { FARM: number; MARGINAL: number; SKIP: number };
  deposit_usd: number;
  farm_days: number;
  season_days: number;
  airdrop_share: number;
  farming_tvl_share: number;
  opportunity_apy: number;
}

export interface Board { meta: BoardMeta; rows: BoardRow[] }

export function buildBoard(snap: Snapshot): Board {
  const asOf = new Date(snap.as_of + 'T00:00:00Z');
  const watch = new Set(snap.watchlist);
  const traded = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const fit = fitCurve(traded, asOf);
  const hazard = buildHazard(snap.protocols, asOf);

  // Coverage accounting: every protocol lands in exactly one bucket.
  const excluded = { cex: 0, bridge: 0, wrapped: 0, versioned: 0, exchangeBrand: 0 };
  const rankable: Proto[] = [];
  let hasTokenCount = 0;
  for (const p of snap.protocols) {
    if (hasToken(p)) { hasTokenCount++; continue; }
    const reason = exclusionReason(p);
    if (reason === 'cex') excluded.cex++;
    else if (reason === 'bridge') excluded.bridge++;
    else if (reason === 'wrapped') excluded.wrapped++;
    else if (reason === 'versioned') excluded.versioned++;
    else if (reason === 'exchange-brand') excluded.exchangeBrand++;
    else rankable.push(p);
  }

  // Value: the curve's value-if-launches, times the launch odds.
  const valueIfLaunch = (p: Proto): number => Math.exp(fit.intercept + fit.slope * Math.log(p.tvl_usd));
  const scored = rankable.map((p) => {
    const odds = launchOdds(p, hazard, asOf);
    const vil = valueIfLaunch(p);
    return { p, odds, vil, implied: vil * odds };
  });
  // The board: every watchlist protocol, plus the 150 highest-valued early ones.
  const onWatch = scored.filter((s) => watch.has(s.p.slug));
  const early = scored.filter((s) => !watch.has(s.p.slug)).sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const chosen = [...onWatch, ...early.slice(0, 150)];
  chosen.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  // Bootstrap rank ranges: 40 refits on resampled residuals, fixed seed.
  const rng = mulberry32(20261114);
  const xs = traded.map((p) => [Math.log(p.tvl_usd)]);
  const ys = traded.map((p) => Math.log(p.mcap_usd as number));
  const fitted = ys.map((_, i) => predict([fit.intercept, fit.slope], xs[i]));
  const resid = ys.map((y, i) => y - fitted[i]);
  const rankSamples = new Map<string, number[]>();
  for (const s of chosen) rankSamples.set(s.p.slug, []);
  for (let b = 0; b < 40; b++) {
    const yStar = fitted.map((f) => f + resid[Math.floor(rng() * resid.length)]);
    const beta = ols(xs, yStar);
    if (!beta) continue;
    const re = chosen.map((s) => ({ slug: s.p.slug, v: Math.exp(predict(beta, [Math.log(s.p.tvl_usd)])) * s.odds }));
    re.sort((a, b2) => b2.v - a.v);
    re.forEach((r, i) => rankSamples.get(r.slug)?.push(i + 1));
  }

  // Nearest traded comparables by log-TVL distance (same category preferred).
  const compsFor = (p: Proto): Comp[] => {
    const lt = Math.log(p.tvl_usd);
    return traded
      .map((t) => ({ t, d: Math.abs(Math.log(t.tvl_usd) - lt) + (t.category === p.category ? 0 : 0.5) }))
      .sort((a, b) => a.d - b.d || (a.t.slug < b.t.slug ? -1 : 1))
      .slice(0, 3)
      .map(({ t }) => ({ slug: t.slug, name: t.name, tvl: t.tvl_usd, mcap: t.mcap_usd as number }));
  };

  const verdicts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  const rows: BoardRow[] = chosen.map((s, i) => {
    const { p, odds, vil, implied } = s;
    const pred = fit.intercept + fit.slope * Math.log(p.tvl_usd);
    const econ = farmEconomics(p, implied);
    const verdict = verdictOf(econ.net);
    verdicts[verdict]++;
    const samples = (rankSamples.get(p.slug) ?? [i + 1]).sort((a, b) => a - b);
    return {
      slug: p.slug,
      name: p.name,
      rank: i + 1,
      implied_value_usd: Math.max(1, Math.round(implied)),
      farm_steps: buildFarmSteps(p),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: ageDays(p, asOf),
      watchlist: watch.has(p.slug),
      value_if_launch_usd: Math.max(1, Math.round(vil)),
      launch_odds: Math.round(odds * 1000) / 1000,
      p25_usd: Math.max(1, Math.round(odds * Math.exp(pred + fit.q25))),
      p75_usd: Math.max(1, Math.round(odds * Math.exp(pred + fit.q75))),
      p10_usd: Math.max(1, Math.round(odds * Math.exp(pred + fit.q10))),
      p90_usd: Math.max(1, Math.round(odds * Math.exp(pred + fit.q90))),
      rank_lo: quantile(samples, 0.05),
      rank_hi: quantile(samples, 0.95),
      verdict,
      expected_value_usd: Math.round(econ.ev * 100) / 100,
      farm_cost_usd: Math.round(econ.cost * 100) / 100,
      net_usd: Math.round(econ.net * 100) / 100,
      farm_hours: econ.hours,
      gas_usd: econ.gas,
      comps: compsFor(p),
    };
  });

  const coverage: Coverage = {
    total: snap.protocols.length,
    hasToken: hasTokenCount,
    excluded,
    rankable: rankable.length,
    board: rows.length,
    belowCut: rankable.length - rows.length,
    watchlist: snap.watchlist.length,
  };

  return {
    meta: {
      as_of: snap.as_of, source: snap.source, floor_usd: snap.floor_usd,
      fit, hazard, coverage, verdicts,
      deposit_usd: DEPOSIT, farm_days: FARM_DAYS, season_days: SEASON_DAYS, airdrop_share: AIRDROP_SHARE,
      farming_tvl_share: FARMING_TVL_SHARE, opportunity_apy: OPPORTUNITY_APY,
    },
    rows,
  };
}
