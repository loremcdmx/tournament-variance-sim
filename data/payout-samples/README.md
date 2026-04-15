# Real payout samples

Scraped/transcribed payout tables from real online MTTs. Used to
calibrate `buildRealisticCurve` in `src/lib/sim/payouts.ts` against
actual rooms, and as a growing reference corpus for future work on
PKO / satellite / high-roller shape modelling.

## Schema

Each sample is one JSON file. Shape:

```jsonc
{
  "id": "gg-mini-coinmasters-2026-04-14",   // stable slug, used as primary key
  "source": "GGPoker",                       // room
  "tournament": "₹25 Mini CoinMasters - PENGU",
  "gameType": "NLH",
  "format": "regular",                       // "regular" | "bounty" | "satellite" | "sng"
  "currency": "INR",
  "buyIn": 25,                               // total buy-in in display currency
  "entries": 911,                            // total entries (unique + re-entries)
  "uniqueEntries": 665,                      // optional
  "reEntries": 246,                          // optional
  "prizePool": 20953,                        // regular-side pool (bounty handled separately)
  "paid": 144,
  "capturedAt": "2026-04-14",                // ISO date
  "partial": false,                          // true if only top-N places captured
  "places": [                                // range-compressed, inclusive, ordered
    { "from": 1,  "to": 1,  "prize": 3501 },
    { "from": 2,  "to": 2,  "prize": 2482 },
    { "from": 8,  "to": 9,  "prize": 341.53 },
    ...
  ],
  "bounty": {                                // optional, bounty/PKO structures
    "type": "progressive",                   // "progressive" | "regular"
    "pctOfBuyIn": 50,                        // fraction of buy-in assigned to bounty pool
    "note": "50% of eliminated player's current bounty is kept, 50% goes on head"
  }
}
```

## Invariants

- `places` covers the inclusive range `[1, paid]` with no gaps and no overlaps (validated at load time — unless `partial: true`, in which case only `[1, N]` for the top-N captured must be gap-free).
- `prize` is the **per-place** prize inside the range (not the sum over the range).
- For full samples, `Σ (to − from + 1) × prize ≈ prizePool` (within 0.5 % rounding slack).

## Adding a new sample

1. Drop a new `{slug}.json` file in this directory.
2. Use the slug as the `id`.
3. Run `npx tsx scripts/compare_real_samples.ts` — prints real vs.
   modelled stats and warns on schema violations.
4. If the real table disagrees with our modelled curve by more than
   a couple of percentage points on 1st-share, open
   `src/lib/sim/payouts.ts` and retune `buildRealisticCurve` params
   for the relevant structure preset.

## Current samples

See `scripts/compare_real_samples.ts` output for the live diff table.
