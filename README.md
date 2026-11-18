# Firstlight Radar

A token-radar-01 entry: a token launch radar for the sealed DefiLlama snapshot
of 2026-11-14 (758 protocols). It ranks pre-token protocols by what a launch
would be worth — and whether farming it pays after fees.

Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only. Two runs are byte-identical (deterministic).

## What it writes

- `board.json` — 190 ranked rows (all 40 watchlist protocols + the top 150
  early protocols under the $50M floor), each with implied value, value range,
  rank range, launch odds, a verdict and a 6-step farm plan.
- `data.js` — the same board for the dashboard, plus the fit, the ablation,
  the walk-forward table, the hazard curve and the coverage accounting.
- `dashboard/` — a static offline page (index.html + app.css + app.js,
  ~33 KB): sortable/filterable board, a detail view per protocol with a
  step-by-step derivation, nearest traded comparables, the farm plan and a
  deposit × airdrop-share sensitivity grid, plus a Method tab.
- `screenshots/` — the board, a detail view and a filtered view, rendered
  from this page in headless Chromium (1440×900 each).
- `dossier.json` — the judge's summary, built with the vendored make.fun
  library (`vendor/makefun-board.ts`, copied verbatim from the kit).

## The model

Everything is computed from the snapshot; no protocol name is hardcoded.

**Size curve.** Log market cap against log TVL, fit on the 128 traded tokens
in the snapshot with a market cap:

    log mcap = 6.9646 + 0.5223 × log TVL   (R² 0.194, residual SD 2.0771)

Out-of-sample, leave-one-out error 2.1072 against 2.2945 for a flat TVL
multiple (median 0.223×) — the curve wins. Walk-forward (fit on tokens listed
before the cutoff, tested on tokens listed after) it beats flat at all four
cutoffs: 2.058 vs 2.336 (2024-01-01), 2.156 vs 2.455 (2024-07-01),
2.249 vs 2.592 (2025-01-01), 2.577 vs 2.961 (2025-07-01).

**What was tested and rejected.** 7-day growth (6 transforms, all
leave-one-out worse, none significant), seasoning/age, and category offsets —
each overfits and loses out-of-sample. Growth wins walk-forward 4/4 but loses
leave-one-out, so it is not shipped. The full ablation is on the Method tab.

**Launch odds.** An actuarial hazard curve: the share of protocols that have
launched, by age band and category, shrunk toward the global curve (k = 10).
Token rates rise with age: 26% under 180 days, 40% at 180–365, 38% at
365–730, 55% at 730–1095, 79% at 1095–1825, 75% beyond. A deliberately
conservative terminal hazard (0.12 per block × 3 blocks) keeps the oldest
bands from collapsing to zero.

**Implied value** = value-if-launches × launch odds. Every row carries a
P25–P75 value range (P10–P90 in the detail view) from the fit's residual
quantiles and a rank range from 40 bootstrap refits of the size curve.

**Verdict (economics, not value).** Expected airdrop slice = 7.5% airdrop
share × implied value × deposit ÷ farming TVL (25% of TVL is assumed to farm
points — a stated assumption) × time-share (capped at 12 months of the
protocol's tokenless age), minus the farm plan's gas cost. FARM needs net
≥ $25 and ≥ $10/h; MARGINAL needs net ≥ $0. Verdicts move with the deposit:
at $100 there are 0 FARM, at $500 there are 2, at $1,000 there are 15, at
$5,000 there are 120. Rank 1 is SKIP at $1,000 — its fee is not covered.

## Coverage (758 protocols)

- 190 ranked (40 watchlist + 150 early).
- 37 early protocols below the board's TVL cut, shown in the accounting.
- Set aside with a reason: 416 already have a live token, 42 are centralised
  exchanges, 36 are bridges, 20 are wrapped/staked products of a token that
  already trades, 11 are versioned pools, 6 are exchange-branded products.
- Liquid-staking protocols without a token of their own are kept and ranked —
  a disclosed choice; the house watchlist excluded them only.

## Honest limits

- The size curve is weak (R² 0.194): a protocol's value range spans ~13×
  from P25 to P75. The ranges are the point — a single number would lie.
- Launch odds come from other protocols' history, not from any protocol's
  own announcements; a team can always choose never to launch.
- The airdrop share (7.5%), the farming-TVL share (25%) and the terminal
  hazard (0.12) are stated assumptions, not measurements; the sensitivity
  grid in each detail view shows how the verdict moves if they are wrong.
- Verdicts are arithmetic, not advice. Farming risks loss.

## Layout

    main.ts                 entry point: read snapshot, write /output
    lib/model.ts            the whole model: fit, hazards, economics, board
    vendor/makefun-board.ts the scorer's library, copied verbatim from the kit
    dashboard/              the offline page (index.html, app.css, app.js)
    screenshots/            the three gate screenshots
    LICENSE                 MIT

## License

MIT — see LICENSE.
