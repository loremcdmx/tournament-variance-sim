# Ingesting your own finish-place data

This is the walkthrough for anyone holding a CSV/Excel of real
tournament finishes who wants to calibrate the simulator against their
own population. The whole pipeline is two scripts, zero extra
dependencies, and runs in seconds.

## TL;DR

```bash
# 1. Get a CSV out of your tracker. Only two columns are strictly required:
#    finish_place + field_size. Everything else enables filters.
# 2. Turn raw rows into a bucketed finish-shape JSON:
npx tsx scripts/ingest_finishes.ts \
  --input path/to/finishes.csv \
  --output data/finish-shapes/my-fund.json \
  --label "My fund, freezouts 2026-Q1"

# 3. Fit a finish model to that shape:
npx tsx scripts/calibrate_alpha_empirical.ts \
  --input data/finish-shapes/my-fund.json \
  --field-size 1000

# → best: power-law α=0.51  KL=0.12  L1=0.40
```

The α value can then be pinned on a schedule row, or rolled into a new
real-data preset by dropping the shape JSON into `src/lib/sim/` and
wiring it up the same way `freezeShape.ts` consumes
`data/finish-shapes/freeze-cash.json`.

## Input CSV schema

UTF-8 CSV (or TSV / semicolon-separated — delimiter is auto-detected
from the header row). Case-insensitive header names; dashes and
underscores are interchangeable. Any subset of these columns works:

| canonical name | required? | aliases accepted                                          |
| -------------- | --------- | --------------------------------------------------------- |
| `finish_place` | **yes**   | `place`, `rank`, `position`, `finish`                     |
| `field_size`   | **yes**   | `entries`, `players`, `n`, `field`, `entrants`            |
| `player_id`    | no        | `player`, `user_id`, `uid`, `user`                        |
| `tourney_id`   | no        | `tournament_id`, `tid`, `event_id`, `tournament`          |
| `roi_bucket`   | no        | `roi`, `bucket`                                           |
| `game_type`    | no        | `format`, `type`, `structure`                             |
| `buyin`        | no        | `buy_in`, `bi`, `buy-in`                                  |
| `is_itm`       | no        | `itm`, `cashed`, `in_the_money`, `itm_flag`               |

### Example (minimal)

```csv
finish_place,field_size
1,1000
17,1000
230,1000
...
```

### Example (rich — enables all filters)

```csv
player_id,tourney_id,finish_place,field_size,buyin,roi_bucket,game_type,is_itm
h3f12,t01,1,1000,25,winning,freezeout,true
h3f12,t02,180,1000,25,winning,freezeout,false
9a44b,t01,500,1000,25,losing,freezeout,false
...
```

### Notes

- `roi_bucket` is a free-form string. Typical values are `winning` /
  `breakeven` / `losing`, but you can bucket however you want — the
  filter just matches exact strings (case-insensitive).
- `is_itm` accepts `true` / `false` / `yes` / `no` / `1` / `0`.
- Anonymise or hash `player_id` at export time. The script never reads
  player identities — it's only useful for your own sanity checking.
- **Excel (.xlsx / .xls) files are not supported directly**; save a
  copy as CSV UTF-8 first (Excel: *File → Save As → CSV UTF-8*;
  Google Sheets: *File → Download → Comma-separated values*).

## Script 1 — `ingest_finishes.ts`

Turns raw rows into a canonical bucketed finish-shape JSON that matches
the schema of `data/finish-shapes/freeze-cash.json`.

```bash
npx tsx scripts/ingest_finishes.ts \
  --input path/to/finishes.csv \
  [--output data/finish-shapes/<basename>.json] \
  [--label "description"] \
  [--bucket-width 0.5] \
  [--cash-cutoff-pct 15.5] \
  [--itm-rate 0.187] \
  [--filter-roi-bucket winning] \
  [--filter-field-size 400-10000] \
  [--filter-game-type freezeout]
```

### Flags

- `--bucket-width` histogram resolution in *place-percent* units.
  `0.5` matches the reference data; smaller means finer buckets but
  noisier densities.
- `--cash-cutoff-pct` width of the cash band (from 100% downward). The
  reference data uses `15.5` (covers top 15.5% of the field).
- `--itm-rate` overrides the empirical ITM rate stored in the JSON.
  Defaults to the fraction of `is_itm=true` rows if that column is
  present, else `cash-cutoff-pct / 100`.
- `--filter-*` drop rows that don't match. Compose freely to build a
  per-ROI-bucket table.

### Output

One JSON file with two histograms:

- `buckets_cash_conditional` — density over the cash band only
  (conditional on being ITM). Used by the `*-realdata-*` finish
  models.
- `buckets_raw_over_all_finishes` — density over the full field. Used
  by `calibrate_alpha_empirical.ts` to fit `α` against a parametric
  model.

Plus metadata: `sample_size`, `itm_rate_empirical`, `cash_cutoff_x`,
`bucket_width_pct`, and whichever filters were applied.

## Script 2 — `calibrate_alpha_empirical.ts`

Fits a parametric model (`power-law`, `stretched-exp`, or
`plackett-luce`) to a shape JSON by minimising KL-divergence against
the empirical PMF.

```bash
npx tsx scripts/calibrate_alpha_empirical.ts \
  --input data/finish-shapes/my-fund.json \
  [--output <input>.alpha.json] \
  [--field-size 1000] \
  [--model power-law|stretched-exp|plackett-luce|all] \
  [--beta 1]
```

`--field-size N` is the tournament size at which the fit is evaluated.
Use a number typical of your sample — the fit is stable across `N` if
the shape is self-similar, but at very different scales α drifts
because the tail behaviour of each model diverges.

### Output

One JSON file per input, with `fits` sorted by KL ascending, e.g.:

```json
{
  "best": { "model": "power-law", "alpha": 0.5072, "kl": 0.1264, "l1": 0.4044 },
  "fits": [
    { "model": "power-law", "alpha": 0.5072, "kl": 0.1264, "l1": 0.4044 },
    { "model": "stretched-exp", "alpha": 0.0025, "kl": 0.1487, "l1": 0.4911, "beta": 1 },
    { "model": "plackett-luce", "alpha": 0.5362, "kl": 0.2557, "l1": 0.6513 }
  ]
}
```

## Building an α-by-ROI-bucket table

Re-run `ingest_finishes.ts` once per bucket, then calibrate each:

```bash
for bucket in winning breakeven losing; do
  npx tsx scripts/ingest_finishes.ts \
    --input raw.csv \
    --output "data/finish-shapes/my-fund-${bucket}.json" \
    --filter-roi-bucket "$bucket" \
    --label "$bucket players"
  npx tsx scripts/calibrate_alpha_empirical.ts \
    --input "data/finish-shapes/my-fund-${bucket}.json" \
    --field-size 1000
done
```

You'll end up with three `.alpha.json` files showing how concentrated
the top-of-field mass is for each ROI bucket. The `α` values can be
pinned per-player-group via schedule-row `alphaOverride`.

## Wiring a new shape into the engine

The current engine consumes real-data shapes via
`src/lib/sim/freezeShape.ts` / `mysteryShape.ts` / `pkoShape.ts`, each
of which re-exports a const array matching its
`data/finish-shapes/*.json`. To add your own, the lowest-friction path
is:

1. Save your shape as `data/finish-shapes/<name>.json`.
2. Copy one of the `*Shape.ts` files into
   `src/lib/sim/<name>Shape.ts` and point it at your JSON.
3. Add a new `FinishModelId` (e.g. `"my-fund-tilt"`) and register it in
   `finishModel.ts`'s `buildFinishPMF` switch.
4. Expose it in the UI via `src/lib/finishModelRegistry.ts`.

Or just pin the fitted `α` directly on a schedule row and keep using
the built-in `power-law` / `stretched-exp` model — no code changes
required.

## Troubleshooting

| symptom                                       | likely cause / fix                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `missing required column: finish_place`       | Rename your header or add it. Accepted aliases: `place`, `rank`, `position`, `finish`.                         |
| `no rows survived filters`                    | One of the `--filter-*` flags is too strict, or matches don't exist in the data. Drop filters one at a time.   |
| ITM rate is way off from reality              | Pass `--itm-rate` explicitly, or verify the `is_itm` column was actually populated at export time.             |
| KL > 1 (very poor fit)                        | Your data may be multi-modal (e.g., different stake tiers mixed). Split by `buyin` band and fit each.          |
| α < 0 for a winning cohort                    | Shouldn't happen if data is clean. Check that `finish_place=1` means the winner, not the first bust, for your source. |
