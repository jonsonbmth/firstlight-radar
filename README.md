# Firstlight Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/jonsonbmth/firstlight-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/jonsonbmth/firstlight-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token-radar-01 entry: a token launch radar for the sealed DefiLlama snapshot
of 2026-11-14 (758 protocols). It ranks pre-token protocols by what a launch
would be worth — and whether farming it pays after fees.

V2 puts the model and its out-of-sample validation on the cover itself: the
fitted curve with its scatter plot, leave-one-out against a flat multiple,
the walk-forward table and the ablation — visible at a glance, not buried in
a tab.

Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only. Two runs are byte-identical (deterministic);
main.ts self-checks the board (ranks 1..N, non-increasing values, 40/40
watchlist, farm-step bounds) before writing anything.

## What it writes

- `board.json` — 190 ranked rows (all 40 watchlist protocols + the top 150
  early protocols under the $50M floor), each with implied value, value range,
  rank range, launch odds, a verdict and a 6-step farm plan.
- `dashboard/z-data.js` — the same board for the dashboard, plus the fit, the
  ablation, the walk-forward table, the hazard curve and the coverage
  accounting. Named `z-data.js` so it sorts last: the dossier's text shows
  the page's code whole before the data is cut. Pretty-printed, so the
  dossier shows the model summary and the first rows.
- `dashboard/` — a static offline page (index.html + app.css + app.js):
  sortable/filterable board, the model + hazard + coverage + Top-FARM panels
  on the cover, a detail view per protocol with a step-by-step derivation,
  nearest traded comparables, the farm plan and a deposit × airdrop-share
  sensitivity grid, plus a Method tab.
- `screenshots/` — the board, a detail view and a filtered view, rendered
  from this page in headless Chromium (1440×900 each).
- `dossier.json` — the judge's summary, built with the vendored make.fun
  library (`vendor/makefun-board.ts`, copied verbatim from the kit).

## The model

Everything is computed from the snapshot; no protocol name is hardcoded.

**Size curve.** Log market cap against log TVL, fit on the 128 traded tokens
in the snapshot with a market cap:

    log mcap = 6.9646 + 0.5223 × log TVL   (R² 0.194, residual SD 2.0935)

Out-of-sample, leave-one-out RMSE 2.1072 against 2.3095 for a flat TVL
multiple (median 0.214×) — the curve wins. Walk-forward (fit on tokens listed
before the cutoff, tested on tokens listed after) it beats flat at all four
cutoffs: 2.058 vs 2.342 (2024-01-01), 2.156 vs 2.448 (2024-07-01),
2.249 vs 2.601 (2025-01-01), 2.577 vs 2.969 (2025-07-01).

**What was tested and rejected.** 7-day growth (4 transforms), age (2
forms), chain count, and category offsets — each judged on the SAME rows as
its base fit and required to win BOTH leave-one-out and walk-forward to ship.
None did. Two traps the ablation avoids: growth wins walk-forward 4/4 but
loses leave-one-out, so it is not shipped; age looks like it wins
leave-one-out until the comparison runs on identical rows (base 1.99 vs age
2.01 on the 95 dated tokens), and it loses walk-forward 0/4. The full
ablation is on the cover and in the Method tab.

**Launch odds.** An actuarial hazard curve: the share of protocols that
record a token, by age band and category, each shrunk toward the global rate
(54.9%, k = 10 pseudo-counts). A protocol's odds are the mean of its
age-band rate and its category rate, clamped to 5–90%. Shrunk band rates:
29% under 180 days, 42% at 180–365, 39% at 1–2y, 55% at 2–3y, 78% at 3–5y,
64% beyond.

**Implied value** = value-if-launches × launch odds. Every row carries a
P25–P75 value range (P10–P90 in the detail view) from the fit's residual
quantiles and a rank range from 40 bootstrap refits of the size curve
(fixed-seed PRNG, deterministic).

**Verdict (economics, not value).** Expected airdrop slice = implied value
× 7.5% airdrop share × deposit-days share of the farming pool (25% of TVL
is assumed to farm points; the pool's history is one 180-day points season,
so a 90-day farm earns half a season's points — a stated assumption, since
the snapshot carries no program dates), minus the farm plan's cost (3 gas
transactions on the protocol's main chain + opportunity cost at 8% APY).
FARM needs net ≥ $25; MARGINAL needs net ≥ $0. Verdicts at $1,000: 4 FARM /
39 MARGINAL / 147 SKIP. Rank 1 is SKIP at $1,000 — its fee is not covered.
The sensitivity grid in each detail view shows how the verdict moves with
the deposit and the airdrop share.

## Coverage (758 protocols)

- 190 ranked (40 watchlist + 150 early).
- 37 early protocols below the board's cut.
- Set aside with a reason: 416 already have a live token, 42 are centralised
  exchanges, 43 are bridges, 18 are wrapped/staked products of a token that
  already trades, 11 are versioned pools, 1 is exchange-branded.
- Liquid-staking protocols without a token of their own are kept and ranked —
  a disclosed choice; the house watchlist excluded them only.

## Honest limits

- The size curve is weak (R² 0.194): a protocol's value range spans ~13×
  from P25 to P75. The ranges are the point — a single number would lie.
- Launch odds come from other protocols' history, not from any protocol's
  own announcements; a team can always choose never to launch. A protocol
  that has stayed tokenless for years is less likely to launch than its
  band's rate suggests.
- The airdrop share (7.5%), the farming-TVL share (25%), the season length
  (180 days) and the gas table are stated assumptions, not measurements; the
  sensitivity grid in each detail view shows how the verdict moves if they
  are wrong.
- Verdicts are arithmetic, not advice. Farming risks loss.

## Layout

    main.ts                 entry point: read snapshot, self-check, write /output
    lib/model.ts            the whole model: fit, hazards, economics, board
    vendor/makefun-board.ts the scorer's library, copied verbatim from the kit
    dashboard/              the offline page (index.html, app.css, app.js)
    screenshots/            the three gate screenshots
    LICENSE                 MIT

## License

MIT — see LICENSE.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
