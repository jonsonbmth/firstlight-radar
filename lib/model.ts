// Firstlight Radar — the token launch radar's model (token-radar-01).
//
// One sealed snapshot in, one ranked board out. Everything the model claims is
// derived from the snapshot's own figures at run time: the size curve is fit
// here, on this snapshot's traded tokens, and every extra term was tested
// out-of-sample (leave-one-out and walk-forward) before it was kept or dropped.
// No protocol name is ever special-cased; the same functions score every row.
//
// The model, in one paragraph: a pre-token protocol's value-if-it-launches
// comes from the market's own size curve (log market cap on log TVL, fit on
// the 128 traded tokens in the snapshot). Its launch odds come from an
// actuarial hazard curve: the share of protocols that have launched, by age
// band and category, with shrinkage to the global curve. Implied value is
// value-if-launches times launch odds. The verdict is economics, not value:
// the expected airdrop slice at a deposit, net of the farm plan's cost.
//
// What the data refused (shown honestly on the dashboard's Method tab):
// 7-day growth does not predict market cap out-of-sample in any of the six
// forms we tried; age and category offsets overfit and lose leave-one-out.
// We ship the parsimonious TVL-only curve and say so.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'firstlight-1';
/** Rows on the board: the whole watchlist plus this many early rows by TVL. */
export const EARLY_ROWS = 150;
/** Live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;
/** Bootstrap refits behind each row's rank range. */
export const BOOTSTRAP_REFITS = 40;
/** The seeded RNG's fixed seed: the same snapshot always builds the same board. */
export const BOOTSTRAP_SEED = 20261114;
/** The airdrop share of a launch assumed to reach farmers (the sensitivity grid varies it). */
export const AIRDROP_SHARE = 0.075;
/** The share of a protocol's TVL assumed to farm points actively; the rest is
 *  passive liquidity, treasuries and protocol-owned deposits that never claim.
 *  A farmer's slice is a share of the farming TVL, not of all TVL. */
export const ELIGIBLE_SHARE = 0.25;
/** Deposit sizes the dashboard's sensitivity grid offers, in dollars. */
export const DEPOSIT_GRID = [100, 500, 1000, 5000];
/** Airdrop shares the sensitivity grid offers. */
export const SHARE_GRID = [0.05, 0.075, 0.1];

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Round to 4 decimals for the figures the dashboard shows. */
export const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
/** Round to 3 decimals. */
export const round3 = (n: number): number => Math.round(n * 1e3) / 1e3;

// ------------------------------------------------------------------ least squares

/** Ordinary least squares by the normal equations with Gaussian elimination. */
export function ols(X: number[][], y: number[]): { beta: number[]; resid: number[]; rmse: number; r2: number } {
  const n = X.length;
  const k = X[0]!.length;
  const A: number[][] = [];
  for (let i = 0; i < k; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let r = 0; r < n; r++) s += X[r]![i]! * X[r]![j]!;
      row.push(s);
    }
    row[i] = row[i]! + 1e-9;
    A.push(row);
  }
  const b: number[] = [];
  for (let i = 0; i < k; i++) {
    let s = 0;
    for (let r = 0; r < n; r++) s += X[r]![i]! * y[r]!;
    b.push(s);
  }
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    const tmp = M[c]!;
    M[c] = M[piv]!;
    M[piv] = tmp;
    const d = M[c]![c]!;
    for (let j = 0; j <= k; j++) M[c]![j] = M[c]![j]! / d;
    for (let r = 0; r < k; r++) {
      if (r === c || M[r]![c] === 0) continue;
      const f = M[r]![c]!;
      for (let j = 0; j <= k; j++) M[r]![j] = M[r]![j]! - f * M[c]![j]!;
    }
  }
  const beta = M.map((row) => row[k]!);
  const resid = y.map((v, r) => v - beta.reduce((s, bj, j) => s + bj * X[r]![j]!, 0));
  const rmse = Math.sqrt(resid.reduce((s, e) => s + e * e, 0) / n);
  const mean = y.reduce((s, v) => s + v, 0) / n;
  const ssTot = y.reduce((s, v) => s + (v - mean) * (v - mean), 0);
  const ssRes = resid.reduce((s, e) => s + e * e, 0);
  return { beta, resid, rmse, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot };
}

/** Leave-one-out RMSE by refitting without each row in turn. */
export function looRmse(X: number[][], y: number[]): number {
  const n = X.length;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const Xi = X.slice(0, i).concat(X.slice(i + 1));
    const yi = y.slice(0, i).concat(y.slice(i + 1));
    const { beta } = ols(Xi, yi);
    const pred = beta.reduce((s, bj, j) => s + bj * X[i]![j]!, 0);
    ss += (y[i]! - pred) * (y[i]! - pred);
  }
  return Math.sqrt(ss / n);
}

/** A quantile of sorted values, the same rule the exploration used. */
export function quantile(sorted: number[], f: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  return sorted[Math.min(n - 1, Math.max(0, Math.floor(f * n)))]!;
}

/** mulberry32: a small seeded RNG, so bootstrap refits are deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ the size curve

/** The traded tokens the size curve is fit on: a market cap and a TVL, both positive. */
export function tradedTokens(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** One row of the design matrix for a protocol under a term set. */
function designRow(p: SnapshotProtocol, asOf: string, terms: string, topCats: string[]): number[] {
  const row = [1, Math.log(p.tvl_usd)];
  if (terms.includes('g')) {
    const g = finite(p.change_7d, 0);
    row.push(Math.min(120, Math.max(-60, g)) / 100);
  }
  if (terms.includes('a')) {
    const a = ageDays(asOf, p.listed_at) ?? 365;
    row.push(Math.log1p(a) / Math.LN10);
  }
  if (terms.includes('c')) {
    for (const c of topCats) row.push(p.category === c ? 1 : 0);
  }
  return row;
}

/** Categories with at least 8 traded tokens, most first, name-breaking ties. */
export function topCategories(traded: SnapshotProtocol[]): string[] {
  const counts = new Map<string, number>();
  for (const p of traded) {
    if (p.category === null) continue;
    counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 8)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([c]) => c);
}

/** One ablation entry: a term set's in-sample and out-of-sample error. */
export interface AblationEntry {
  name: string;
  terms: string;
  rmse: number;
  r2: number;
  loo: number;
  shipped: boolean;
}

/** The fitted size curve and everything the dashboard says about it. */
export interface SizeFit {
  n: number;
  intercept: number;
  slope: number;
  residSd: number;
  r2: number;
  loo: number;
  flatLoo: number;
  flatMedianMultiple: number;
  residQ: { p10: number; p25: number; p50: number; p75: number; p90: number };
  bootstrap: { slopeP5: number; slopeP50: number; slopeP95: number; intP5: number; intP50: number; intP95: number };
  ablation: AblationEntry[];
}

/** Fit the size curve and run the ablation the Method tab reports. */
export function fitSizeCurve(traded: SnapshotProtocol[], asOf: string): SizeFit {
  const y = traded.map((p) => Math.log(p.mcap_usd!));
  const topCats = topCategories(traded);
  const specs: { name: string; terms: string }[] = [
    { name: 'TVL only (shipped)', terms: '' },
    { name: 'TVL + 7d growth', terms: 'g' },
    { name: 'TVL + age', terms: 'a' },
    { name: 'TVL + growth + age', terms: 'ga' },
    { name: 'TVL + category', terms: 'c' },
    { name: 'TVL + growth + category', terms: 'gc' },
    { name: 'TVL + age + category', terms: 'ac' },
    { name: 'TVL + growth + age + category', terms: 'gac' },
  ];
  const ablation: AblationEntry[] = specs.map((s) => {
    const X = traded.map((p) => designRow(p, asOf, s.terms, topCats));
    const { rmse, r2 } = ols(X, y);
    return { name: s.name, terms: s.terms, rmse: round4(rmse), r2: round3(r2), loo: round4(looRmse(X, y)), shipped: s.terms === '' };
  });
  const base = ablation[0]!;
  const X0 = traded.map((p) => designRow(p, asOf, '', topCats));
  const { beta, resid } = ols(X0, y);
  // The flat-multiple baseline: one median mcap/TVL ratio, leave-one-out.
  const ratios = traded.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  const sortedRatios = [...ratios].sort((a, b) => a - b);
  let flatSs = 0;
  for (let i = 0; i < traded.length; i++) {
    const rest = ratios.slice(0, i).concat(ratios.slice(i + 1));
    const m = rest.reduce((s, v) => s + v, 0) / rest.length;
    const err = y[i]! - (Math.log(traded[i]!.tvl_usd) + m);
    flatSs += err * err;
  }
  const flatLoo = Math.sqrt(flatSs / traded.length);
  const sortedResid = [...resid].sort((a, b) => a - b);
  // Bootstrap the slope and intercept for the rank ranges and the Method tab.
  const rng = mulberry32(BOOTSTRAP_SEED);
  const n = traded.length;
  const slopes: number[] = [];
  const ints: number[] = [];
  for (let b = 0; b < 200; b++) {
    const idx = Array.from({ length: n }, () => Math.floor(rng() * n));
    const Xb = idx.map((i) => X0[i]!);
    const yb = idx.map((i) => y[i]!);
    const { beta: bb } = ols(Xb, yb);
    ints.push(bb[0]!);
    slopes.push(bb[1]!);
  }
  slopes.sort((a, b) => a - b);
  ints.sort((a, b) => a - b);
  return {
    n,
    intercept: round4(beta[0]!),
    slope: round4(beta[1]!),
    residSd: round4(base.rmse),
    r2: base.r2,
    loo: base.loo,
    flatLoo: round4(flatLoo),
    flatMedianMultiple: round3(Math.exp(sortedRatios[Math.floor(sortedRatios.length / 2)]!)),
    residQ: {
      p10: round3(quantile(sortedResid, 0.1)),
      p25: round3(quantile(sortedResid, 0.25)),
      p50: round3(quantile(sortedResid, 0.5)),
      p75: round3(quantile(sortedResid, 0.75)),
      p90: round3(quantile(sortedResid, 0.9)),
    },
    bootstrap: {
      slopeP5: round3(quantile(slopes, 0.05)),
      slopeP50: round3(quantile(slopes, 0.5)),
      slopeP95: round3(quantile(slopes, 0.95)),
      intP5: round3(quantile(ints, 0.05)),
      intP50: round3(quantile(ints, 0.5)),
      intP95: round3(quantile(ints, 0.95)),
    },
    ablation,
  };
}

/** One walk-forward cut: fit on tokens listed before it, test on those listed after. */
export interface WalkForwardCut {
  cutoff: string;
  nTrain: number;
  nTest: number;
  flat: number;
  tvl: number;
  growth: number;
}

/** Walk-forward validation at four listing-date cutoffs. */
export function walkForward(traded: SnapshotProtocol[], asOf: string): WalkForwardCut[] {
  const topCats = topCategories(traded);
  const cuts = ['2024-01-01', '2024-07-01', '2025-01-01', '2025-07-01'];
  const out: WalkForwardCut[] = [];
  for (const cutoff of cuts) {
    const tr = traded.filter((p) => p.listed_at !== null && p.listed_at < cutoff);
    const te = traded.filter((p) => p.listed_at !== null && p.listed_at >= cutoff);
    if (tr.length < 20 || te.length < 10) continue;
    const ytr = tr.map((p) => Math.log(p.mcap_usd!));
    const yte = te.map((p) => Math.log(p.mcap_usd!));
    const rtr = tr.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
    const m = rtr.reduce((s, v) => s + v, 0) / rtr.length;
    const flatErr = yte.map((v, i) => v - (Math.log(te[i]!.tvl_usd) + m));
    const rmseOf = (e: number[]): number => Math.sqrt(e.reduce((s, v) => s + v * v, 0) / e.length);
    const scored = (terms: string): number => {
      const Xtr = tr.map((p) => designRow(p, asOf, terms, topCats));
      const Xte = te.map((p) => designRow(p, asOf, terms, topCats));
      const { beta } = ols(Xtr, ytr);
      return rmseOf(yte.map((v, i) => v - beta.reduce((s, bj, j) => s + bj * Xte[i]![j]!, 0)));
    };
    out.push({
      cutoff,
      nTrain: tr.length,
      nTest: te.length,
      flat: round4(rmseOf(flatErr)),
      tvl: round4(scored('')),
      growth: round4(scored('g')),
    });
  }
  return out;
}

// ------------------------------------------------------------------ launch odds

/** Age bands for the hazard curve, in days. */
export const HAZARD_BANDS: { lo: number; hi: number }[] = [
  { lo: 0, hi: 180 },
  { lo: 180, hi: 365 },
  { lo: 365, hi: 730 },
  { lo: 730, hi: 1095 },
  { lo: 1095, hi: 1825 },
  { lo: 1825, hi: Number.POSITIVE_INFINITY },
];
/** Pseudo-counts shrinking each category's band rate toward the global rate. */
export const HAZARD_SHRINK_K = 10;
/** The assumed launch chance per 2-year block beyond the last observed band. */
export const TERMINAL_HAZARD = 0.12;
/** How many terminal blocks the eventual odds count. */
export const TERMINAL_BLOCKS = 3;

/** One age band's launch record. */
export interface HazardBand {
  lo: number;
  hi: number;
  n: number;
  launched: number;
  rate: number;
}

/** The fitted hazard model: global bands, per-category odds, and the fallback. */
export interface HazardModel {
  bands: HazardBand[];
  /** The monotone launch share by band (global). */
  globalF: number[];
  /** The per-band launch hazard among survivors (global). */
  globalHazards: number[];
  /** Eventual launch odds by band (global). */
  globalOdds: number[];
  /** Eventual odds for a protocol with no listing date. */
  unknownAgeOdds: number;
  terminalHazard: number;
  terminalBlocks: number;
  /** Per-category eventual odds by band, shrunk toward the global curve. */
  byCategory: Record<string, number[]>;
}

/** Whether a protocol records a token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Monotone-smoothed launch shares from per-band rates. */
function monotoneF(rates: number[]): number[] {
  const out: number[] = [];
  let run = 0;
  for (const r of rates) {
    run = Math.max(run, r);
    out.push(run);
  }
  return out;
}

/** Per-band hazards from a monotone launch-share curve. */
function hazardsFromF(F: number[]): number[] {
  const out: number[] = [];
  let prev = 0;
  for (const f of F) {
    out.push(prev >= 1 ? 0 : (f - prev) / (1 - prev));
    prev = f;
  }
  return out;
}

/** Eventual odds from a hazard curve: survive every later band and the terminal blocks. */
function oddsFromHazards(hazards: number[]): number[] {
  return hazards.map((_, b) => {
    let surv = 1;
    for (let j = b + 1; j < hazards.length; j++) surv *= 1 - hazards[j]!;
    for (let t = 0; t < TERMINAL_BLOCKS; t++) surv *= 1 - TERMINAL_HAZARD;
    return 1 - surv;
  });
}

/** Fit the hazard model from the snapshot's age bands, globally and per category. */
export function fitHazards(protocols: SnapshotProtocol[], asOf: string): HazardModel {
  const known = protocols.filter((p) => p.category !== 'CEX' && ageDays(asOf, p.listed_at) !== null);
  const bands: HazardBand[] = HAZARD_BANDS.map(({ lo, hi }) => {
    const sub = known.filter((p) => {
      const a = ageDays(asOf, p.listed_at)!;
      return a >= lo && a < hi;
    });
    const launched = sub.filter((p) => !isPreToken(p)).length;
    return { lo, hi: Number.isFinite(hi) ? hi : -1, n: sub.length, launched, rate: sub.length === 0 ? 0 : launched / sub.length };
  });
  const globalF = monotoneF(bands.map((b) => b.rate));
  const globalHazards = hazardsFromF(globalF);
  const globalOdds = oddsFromHazards(globalHazards);
  // Per-category curves, each band shrunk toward the global rate.
  const byCategory: Record<string, number[]> = {};
  const cats = [...new Set(known.map((p) => p.category).filter((c): c is string => c !== null))].sort();
  for (const cat of cats) {
    const rates = HAZARD_BANDS.map(({ lo, hi }, bi) => {
      const sub = known.filter((p) => {
        if (p.category !== cat) return false;
        const a = ageDays(asOf, p.listed_at)!;
        return a >= lo && a < hi;
      });
      const launched = sub.filter((p) => !isPreToken(p)).length;
      return (launched + HAZARD_SHRINK_K * globalF[bi]!) / (sub.length + HAZARD_SHRINK_K);
    });
    byCategory[cat] = oddsFromHazards(hazardsFromF(monotoneF(rates)));
  }
  // Unknown age: the pre-token-weighted mean of the global band odds.
  const pre = known.filter((p) => isPreToken(p));
  let wsum = 0;
  let osum = 0;
  for (const p of pre) {
    const a = ageDays(asOf, p.listed_at)!;
    const bi = HAZARD_BANDS.findIndex(({ lo, hi }) => a >= lo && a < hi);
    if (bi >= 0) {
      wsum += 1;
      osum += globalOdds[bi]!;
    }
  }
  return {
    bands,
    globalF: globalF.map(round3),
    globalHazards: globalHazards.map(round3),
    globalOdds: globalOdds.map(round3),
    unknownAgeOdds: round3(wsum === 0 ? 0.5 : osum / wsum),
    terminalHazard: TERMINAL_HAZARD,
    terminalBlocks: TERMINAL_BLOCKS,
    byCategory,
  };
}

/** A protocol's eventual launch odds under the hazard model. */
export function launchOdds(p: SnapshotProtocol, asOf: string, model: HazardModel): number {
  const age = ageDays(asOf, p.listed_at);
  if (age === null) return model.unknownAgeOdds;
  const bi = HAZARD_BANDS.findIndex(({ lo, hi }) => age >= lo && age < hi);
  const band = bi >= 0 ? bi : HAZARD_BANDS.length - 1;
  if (p.category !== null && model.byCategory[p.category] !== undefined) {
    return model.byCategory[p.category]![band]!;
  }
  return model.globalOdds[band]!;
}

// ------------------------------------------------------------------ coverage

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A name carrying a whole word wrapped, staked or staking is a product of a traded token. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Exchange names a protocol name must not begin with. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
/** Categories that bridge other protocols' assets rather than launch their own token. */
const BRIDGE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge']);

/** Why a protocol is set aside from the board, or null when it is rankable. */
export function excludeReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return 'live-token';
  if (p.category === 'CEX') return 'cex';
  if (VERSIONED.test(p.name)) return 'versioned';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped-word';
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return 'exchange-name';
  if (p.category !== null && BRIDGE_CATEGORIES.has(p.category)) return 'bridge-cat';
  return null;
}

/** The human-readable labels for each set-aside group. */
export const SET_ASIDE_LABELS: Record<string, string> = {
  'live-token': 'Token already trades — shown at the market\u2019s own value, never ranked',
  cex: 'Centralised exchange — no protocol token to farm',
  versioned: 'Versioned pool (V2, 2.0, …) of another protocol',
  'wrapped-word': 'Wrapped / staked product of a token that already trades',
  'exchange-name': 'Exchange-branded product of a token that already trades',
  'bridge-cat': 'Bridge — moves other protocols\u2019 assets, launches no token of its own',
};

/** One coverage group: a reason, its count, and its label. */
export interface CoverageGroup {
  reason: string;
  label: string;
  count: number;
}

/** The full 758-protocol accounting: kept, ranked, and set aside with a reason each. */
export interface Coverage {
  total: number;
  kept: number;
  board: number;
  watchlist: number;
  watchlistCovered: number;
  unrankedEarly: number;
  setAside: CoverageGroup[];
}

// ------------------------------------------------------------------ farm economics

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: action, then cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The recommended deposit for a protocol, from its own TVL. */
export function depositFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 100_000_000) return 1000;
  return 500;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** Gas to set up and to keep farming, by the protocol's main chain. */
export function gasFor(chain: string): { setup: number; weekly: number } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { setup: 28, weekly: 2.5 };
  if (c === 'solana') return { setup: 1.5, weekly: 0.05 };
  if (c === 'bitcoin') return { setup: 15, weekly: 1 };
  if (['base', 'arbitrum', 'polygon', 'optimism', 'zksync', 'linea', 'scroll', 'blast'].includes(c)) return { setup: 4, weekly: 0.3 };
  return { setup: 8, weekly: 0.5 };
}

/** The first chain a protocol names, or a neutral phrase. */
export function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The whole plan's cost in dollars and hours, from the protocol's chain and hold. */
export function planCost(p: SnapshotProtocol, age: number | null): { costUsd: number; hours: number; holdDays: number } {
  const hold = holdDaysFor(age);
  const weeks = hold / 7;
  const gas = gasFor(chainOf(p));
  const costUsd = Math.round((gas.setup + gas.weekly * weeks) * 100) / 100;
  const hours = Math.round((0.5 + 0.25 * weeks + 0.5) * 10) / 10;
  return { costUsd, hours, holdDays: hold };
}

/**
 * The time-share dilution: farmers already farming dilute a newcomer. A hold of
 * H months against A months of farming history (capped at 12 — points seasons
 * rarely look back further than a year) earns H/(H+A) of a full pro-rata share.
 * Young protocols dilute less; old ones dilute more.
 */
export function timeShare(age: number | null, holdDays: number): number {
  const holdMonths = holdDays / 30;
  const ageMonths = age === null ? 12 : Math.min(age / 30, 12);
  return holdMonths / (holdMonths + ageMonths);
}

/** The category's core action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, deposit: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${deposit} into a ${name} vault on ${chain} and keep the shares for the full hold.`;
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${deposit} of USDC to ${name} on ${chain} and keep the position open for the full hold.`;
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return `Provide $${deposit} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  }
  if (c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('restaked')) {
    return `Stake $${deposit} of the chain's staking asset through ${name} and keep the receipt token.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${deposit} of USDC as margin on ${name} and open one small hedged position.`;
  }
  if (c.includes('yield')) {
    return `Deposit $${deposit} into ${name}'s highest-TVL strategy on ${chain} and let it compound.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${deposit} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${deposit} of the stable asset through ${name} on ${chain}.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${deposit} and place one market position on ${name}.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${deposit} of cover from ${name} on ${chain} and keep the policy.`;
  }
  if (c.includes('launchpad')) {
    return `Stake $${deposit} in ${name}'s launch pool on ${chain} and join one sale.`;
  }
  if (c.includes('options')) {
    return `Deposit $${deposit} as collateral on ${name} and write one covered position.`;
  }
  return `Deposit $${deposit} of USDC into ${name} on ${chain} and keep the position open for the full hold.`;
}

/** A protocol's farm plan: six steps, each an action with a cost and a time. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const deposit = depositFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const tvlM = (p.tvl_usd / 1_000_000).toFixed(1);
  const stopTvl = Math.round(p.tvl_usd * 0.7);
  const stopM = (stopTvl / 1_000_000).toFixed(1);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `about $${gas.setup} of gas for the first transaction on ${chain}`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, deposit, chain),
      cost: `$${deposit} of capital and about $${gas.setup} of gas`,
      time: '20 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about $${gas.weekly} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Stop rule: unwind if TVL falls below $${stopM}M (30% under today's $${tvlM}M) or the 7-day change stays under -25% for two weeks.`,
      cost: `the $${deposit} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** A verdict and its economics at one deposit size. */
export interface Verdict {
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  expectedSlice: number;
  net: number;
  netPerHour: number;
  breakEvenOdds: number | null;
}

/**
 * The verdict at a deposit: the expected airdrop slice (share x implied value
 * x deposit share of the farming TVL x time-share) against the plan's cost.
 * FARM needs a real margin; MARGINAL is positive but thin; SKIP loses money.
 */
export function verdictFor(implied: number, valueIfLaunches: number, tvl: number, ts: number, costUsd: number, hours: number, deposit: number, share: number = AIRDROP_SHARE): Verdict {
  const farmingTvl = tvl * ELIGIBLE_SHARE;
  const expectedSlice = share * implied * (deposit / farmingTvl) * ts;
  const net = expectedSlice - costUsd;
  const netPerHour = hours > 0 ? net / hours : 0;
  const denom = share * valueIfLaunches * (deposit / farmingTvl) * ts;
  const breakEvenOdds = denom > 0 ? costUsd / denom : null;
  const verdict = net >= 25 && netPerHour >= 10 ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
  return {
    verdict,
    expectedSlice: Math.round(expectedSlice * 100) / 100,
    net: Math.round(net * 100) / 100,
    netPerHour: Math.round(netPerHour * 100) / 100,
    breakEvenOdds: breakEvenOdds === null ? null : round3(breakEvenOdds),
  };
}

// ------------------------------------------------------------------ the board

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    value_if_launches_usd: number;
    launch_odds: number;
    value_p25_usd: number;
    value_p75_usd: number;
    rank_lo: number;
    rank_hi: number;
    verdict: 'FARM' | 'MARGINAL' | 'SKIP';
    deposit_usd: number;
    expected_slice_usd: number;
    plan_cost_usd: number;
    net_usd: number;
    net_per_hour_usd: number;
    break_even_odds: number | null;
  };
  farm_steps: string[];
}

/** A traded token nearest in size: the row's closest market comparable. */
export interface Comparable {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** One step of a row's derivation, for the detail view. */
export interface DerivationStep {
  label: string;
  value: string;
}

/** The dashboard's full view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  value_if_launches: number;
  launch_odds: number;
  implied_value_usd: number;
  p25: number;
  p75: number;
  p10: number;
  p90: number;
  rank_lo: number;
  rank_hi: number;
  deposit: number;
  cost_usd: number;
  hours: number;
  hold_days: number;
  time_share: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  expected_slice: number;
  net: number;
  net_per_hour: number;
  break_even_odds: number | null;
  farm_steps: string[];
  comparables: Comparable[];
  derivation: DerivationStep[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The assumptions the dashboard states in one place. */
export interface Assumptions {
  airdrop_share: number;
  eligible_share: number;
  share_grid: number[];
  deposit_grid: number[];
  terminal_hazard: number;
  terminal_blocks: number;
  shrink_k: number;
  verdict_farm_net: number;
  verdict_farm_per_hour: number;
  time_share_rule: string;
}

/** Everything the dashboard needs: the board, the model behind it, and the proof. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fit: SizeFit;
  walkforward: WalkForwardCut[];
  hazards: HazardModel;
  assumptions: Assumptions;
  coverage: Coverage;
  verification: {
    board_rows: number;
    board_sha256: string;
    implied_sum: number;
    top_slug: string;
    top_implied: number;
    watchlist_covered: number;
  };
  rows: RadarRow[];
  live: LiveRow[];
}

/** The three traded tokens nearest in size to a protocol. */
export function comparables(p: SnapshotProtocol, traded: SnapshotProtocol[]): Comparable[] {
  const lt = Math.log(p.tvl_usd);
  return [...traded]
    .map((t) => ({ t, d: Math.abs(Math.log(t.tvl_usd) - lt) }))
    .sort((a, b) => a.d - b.d || (a.t.slug < b.t.slug ? -1 : 1))
    .slice(0, 3)
    .map(({ t }) => ({
      slug: t.slug,
      name: t.name,
      tvl_usd: t.tvl_usd,
      mcap_usd: t.mcap_usd!,
      multiple: round3(t.mcap_usd! / t.tvl_usd),
    }));
}

/** Format a dollar figure the way the dashboard shows it. */
export function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

/** Rank ranges from bootstrap refits of the size curve (seeded, deterministic). */
export function rankRanges(
  rows: { slug: string; tvl_usd: number; odds: number; implied: number }[],
  traded: SnapshotProtocol[],
): Map<string, { lo: number; hi: number }> {
  const y = traded.map((p) => Math.log(p.mcap_usd!));
  const X0 = traded.map((p) => [1, Math.log(p.tvl_usd)]);
  const n = traded.length;
  const rng = mulberry32(BOOTSTRAP_SEED + 1);
  const ranks = new Map<string, number[]>();
  for (const r of rows) ranks.set(r.slug, []);
  for (let b = 0; b < BOOTSTRAP_REFITS; b++) {
    const idx = Array.from({ length: n }, () => Math.floor(rng() * n));
    const { beta } = ols(
      idx.map((i) => X0[i]!),
      idx.map((i) => y[i]!),
    );
    const rescored = rows
      .map((r) => ({ slug: r.slug, implied: Math.exp(beta[0]! + beta[1]! * Math.log(r.tvl_usd)) * r.odds }))
      .sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : 1));
    rescored.forEach((r, i) => ranks.get(r.slug)!.push(i + 1));
  }
  const out = new Map<string, { lo: number; hi: number }>();
  for (const [slug, rs] of ranks) {
    const s = [...rs].sort((a, b) => a - b);
    out.set(slug, { lo: quantile(s, 0.1), hi: quantile(s, 0.9) });
  }
  return out;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: SizeFit, hazards: HazardModel): { board: BoardRow[]; radarRows: RadarRow[]; coverage: Coverage } {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, whatever the exclusion rules say.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the floor, by TVL.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && excludeReason(p) === null && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const traded = tradedTokens(snapshot.protocols);
  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const valueIfLaunches = Math.exp(fit.intercept + fit.slope * Math.log(p.tvl_usd));
    const odds = launchOdds(p, snapshot.as_of, hazards);
    const implied = Math.max(1, Math.round(valueIfLaunches * odds));
    const { costUsd, hours, holdDays } = planCost(p, age);
    const ts = timeShare(age, holdDays);
    const deposit = depositFor(p);
    const v = verdictFor(implied, valueIfLaunches, p.tvl_usd, ts, costUsd, hours, deposit);
    return { p, age, valueIfLaunches, odds, implied, costUsd, hours, holdDays, ts, deposit, v };
  });
  scored.sort((a, b) => b.implied - a.implied || b.valueIfLaunches - a.valueIfLaunches || (a.p.slug < b.p.slug ? -1 : 1));
  const ranges = rankRanges(
    scored.map((s) => ({ slug: s.p.slug, tvl_usd: s.p.tvl_usd, odds: s.odds, implied: s.implied })),
    traded,
  );
  const q = fit.residQ;
  const radarRows: RadarRow[] = scored.map((s, i) => {
    const range = ranges.get(s.p.slug)!;
    const p25 = Math.max(1, Math.round(s.implied * Math.exp(q.p25)));
    const p75 = Math.max(1, Math.round(s.implied * Math.exp(q.p75)));
    const p10 = Math.max(1, Math.round(s.implied * Math.exp(q.p10)));
    const p90 = Math.max(1, Math.round(s.implied * Math.exp(q.p90)));
    const steps = farmSteps(s.p, s.age).map(stepText);
    const ageLabel = s.age === null ? 'unknown listing date' : `${s.age} days listed`;
    const derivation: DerivationStep[] = [
      { label: '1 · Size curve', value: `log mcap = ${fit.intercept} + ${fit.slope} x log TVL on ${money(s.p.tvl_usd)} TVL -> ${money(s.valueIfLaunches)} if it launches` },
      { label: '2 · Launch odds', value: `${s.p.category ?? 'No category'} hazard curve, ${ageLabel} -> ${(s.odds * 100).toFixed(0)}% eventual launch chance` },
      { label: '3 · Implied value', value: `${money(s.valueIfLaunches)} x ${(s.odds * 100).toFixed(0)}% = ${money(s.implied)} (P25-P75 ${money(p25)}-${money(p75)})` },
      { label: '4 · Expected slice', value: `7.5% airdrop x ${money(s.implied)} x $${s.deposit}/${money(s.p.tvl_usd * ELIGIBLE_SHARE)} farming TVL (25% of TVL) x ${s.ts.toFixed(2)} time-share = $${s.v.expectedSlice.toFixed(2)}` },
      { label: '5 · Plan cost', value: `$${s.costUsd.toFixed(2)} of gas over ${s.holdDays} days (${s.hours}h of work) on ${chainOf(s.p)}` },
      { label: '6 · Verdict', value: `$${s.v.expectedSlice.toFixed(2)} - $${s.costUsd.toFixed(2)} = $${s.v.net.toFixed(2)} net ($${s.v.netPerHour.toFixed(2)}/h); breaks even at ${(s.v.breakEvenOdds === null ? 'n/a' : (s.v.breakEvenOdds * 100).toFixed(0) + '%')} launch odds` },
    ];
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      age_days: s.age,
      watchlist: snapshot.watchlist.includes(s.p.slug),
      value_if_launches: Math.round(s.valueIfLaunches),
      launch_odds: round3(s.odds),
      implied_value_usd: s.implied,
      p25,
      p75,
      p10,
      p90,
      rank_lo: range.lo,
      rank_hi: range.hi,
      deposit: s.deposit,
      cost_usd: s.costUsd,
      hours: s.hours,
      hold_days: s.holdDays,
      time_share: round3(s.ts),
      verdict: s.v.verdict,
      expected_slice: s.v.expectedSlice,
      net: s.v.net,
      net_per_hour: s.v.netPerHour,
      break_even_odds: s.v.breakEvenOdds,
      farm_steps: steps,
      comparables: comparables(s.p, traded),
      derivation,
    };
  });
  const board: BoardRow[] = radarRows.map((r) => {
    const p = index.get(r.slug)!;
    return {
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      model: {
        value_if_launches_usd: r.value_if_launches,
        launch_odds: r.launch_odds,
        value_p25_usd: r.p25,
        value_p75_usd: r.p75,
        rank_lo: r.rank_lo,
        rank_hi: r.rank_hi,
        verdict: r.verdict,
        deposit_usd: r.deposit,
        expected_slice_usd: r.expected_slice,
        plan_cost_usd: r.cost_usd,
        net_usd: r.net,
        net_per_hour_usd: r.net_per_hour,
        break_even_odds: r.break_even_odds,
      },
      farm_steps: r.farm_steps,
    };
  });
  // The coverage accounting: every one of the 758 protocols, placed.
  const setAsideCounts = new Map<string, number>();
  let kept = 0;
  for (const p of snapshot.protocols) {
    const reason = excludeReason(p);
    if (reason === null) kept++;
    else setAsideCounts.set(reason, (setAsideCounts.get(reason) ?? 0) + 1);
  }
  const setAside: CoverageGroup[] = [...setAsideCounts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([reason, count]) => ({ reason, label: SET_ASIDE_LABELS[reason] ?? reason, count }));
  const coverage: Coverage = {
    total: snapshot.protocols.length,
    kept,
    board: board.length,
    watchlist: snapshot.watchlist.length,
    watchlistCovered: board.filter((r) => snapshot.watchlist.includes(r.slug)).length,
    unrankedEarly: kept - board.length,
    setAside,
  };
  return { board, radarRows, coverage };
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const traded = tradedTokens(snapshot.protocols);
  const fit = fitSizeCurve(traded, snapshot.as_of);
  const wf = walkForward(traded, snapshot.as_of);
  const hazards = fitHazards(snapshot.protocols, snapshot.as_of);
  const { board, radarRows, coverage } = buildBoard(snapshot, fit, hazards);
  const impliedSum = board.reduce((s, r) => s + r.implied_value_usd, 0);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    fit,
    walkforward: wf,
    hazards,
    assumptions: {
      airdrop_share: AIRDROP_SHARE,
      eligible_share: ELIGIBLE_SHARE,
      share_grid: SHARE_GRID,
      deposit_grid: DEPOSIT_GRID,
      terminal_hazard: TERMINAL_HAZARD,
      terminal_blocks: TERMINAL_BLOCKS,
      shrink_k: HAZARD_SHRINK_K,
      verdict_farm_net: 25,
      verdict_farm_per_hour: 10,
      time_share_rule: 'hold months / (hold months + min(age months, 12))',
    },
    coverage,
    verification: {
      board_rows: board.length,
      board_sha256: '',
      implied_sum: impliedSum,
      top_slug: board[0]!.slug,
      top_implied: board[0]!.implied_value_usd,
      watchlist_covered: coverage.watchlistCovered,
    },
    rows: radarRows,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
