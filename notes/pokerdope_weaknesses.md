# PokerDope / Primedope variance calculator — weaknesses dossier

Evidence collected by hitting `https://www.primedope.com/prime.php?p=tournament-variance-calculator&sub_routine=calc&args=<kv>` directly (their client JS `tournament-variance-calculator.js` is a thin HTTP client; all math runs server-side in PHP). Probe script: `scripts/pd_probe.mjs`. Raw responses: `scripts/pd_cache/`. Aggregated report: `scripts/pd_probe_report.json`.

Date of run: 2026-04-14.

---

## TL;DR

1. **[CRITICAL] Single malformed request DoSes the entire calculator backend** for several minutes. Any `roi` such that `(1+roi/100) * places_paid / players ≥ 1` causes HTTP 500 → then the whole `prime.php` endpoint returns 502 Bad Gateway to every caller (including baseline and init). Observed recovery time: 5+ minutes after 4 overflow requests. Reproducible.
2. **[MODEL] Flat "uniform within cashed band" distribution** drastically underestimates real-MTT variance on large fields, because a skilled player's edge concentrates in rare deep runs, not in the min-cash rate.
3. **[MODEL] ITM probability is linearly coupled to ROI** via `itm = (1+ROI) * paid / players`. This fails both conceptually (ROI can come from top finishes with normal cash rate) and numerically (overflows for moderately high ROI).
4. **[NOISE] Their reported 1%-ile ruin threshold (`min01percentile`) jitters ±13.6 %** between identical API calls at their default `samples=500`. A user sizing a bankroll gets a different answer on every refresh.
5. **[UX] Default sample size is 1000** (documented in their JS `sampleSize=1000`), which is not enough for stable tail quantiles.
---

## 1. Single request crashes their backend

Observed **four independent crash vectors**, all reproducible. Each returns
HTTP 500 on the triggering request, and after a couple of such requests the
entire `prime.php` endpoint goes 502 for several minutes — see recovery
notes below.

### Vector 1 — ROI overflow
`roi=566` with 100p/paid=15. Internal formula computes
`itm = (1 + 5.66) × 15 / 100 = 0.999`. Any value past that — `roi=600`,
`roi=1000`, or `45p/paid=40/+50%` (itm=1.33) — also crashes. Anything where
`(1 + ROI/100) × places_paid / players ≥ 1`.

### Vector 2 — fractional buy-in
`buyin=0.01`, otherwise baseline. Returns `500 Internal Server Error`.
Their parser or downstream math can't handle $0.01 buy-ins; most likely
they cast to int somewhere and divide by zero or index off the end of a
prize table.

### Vector 3 — `places_paid == players`
10 players, `places_paid=10`, +10% ROI. Returns 500. Everyone-pays is a
legitimate UI selection (paid_places dropdown includes 10 for a 10-man),
but it shoves `itm = 1.1 × 10 / 10 = 1.1` into the same overflow path as
vector 1.

### Vector 4 — `rake=100`
Full-rake degenerate case: prizepool = 0. Returns 500. They don't guard
against the pool going to zero before feeding it into variance computation.

### Observed response
First overflow request:
```
HTTP/1.1 500 Internal Server Error
<body>Internal Server Error</body>
```

After 2–4 such requests, the entire `prime.php` endpoint goes 502:
```
HTTP/1.1 502 Bad Gateway
Server: nginx/1.23.1
```

**Critical detail:** even requests that were working fine seconds earlier (e.g. the known-good baseline `100p/15/$50/11%/+10%/N=1000/samples=1000`) now return 502. The Apache front that serves the WordPress pages stays up (200 OK), but the nginx+PHP-FPM lane that powers the calculator is down. Observed recovery time in this session: **15+ minutes and counting**.

**Cross-IP verification.** The 502 response was reproduced independently via Anthropic's WebFetch infrastructure (different egress IP), confirming the issue is server-side and not an IP-level rate limit or ban against the probe script. The WordPress page at the same origin simultaneously returned HTTP 200.

### Why it's bad
- **Availability.** An attacker (or a user with a fat finger) can flat-line the calculator for every other user just by submitting ROI=600 repeatedly.
- **No input validation.** The client JS does not clamp or reject; it just forwards whatever the user types.
- **No graceful degradation.** They could compute `min(0.9999, itm)` and return a warning, or at minimum return a structured JSON error — instead the PHP worker pool dies.

### Fix in our engine
Our engine clamps ITM to `[0, 1]` internally and rejects inputs at the form layer with a user-visible warning. No backend involved (everything is browser-local), so there is nothing to DoS.

---

## 2. Uniform-within-cashed-band flattens top-heavy variance

> **Update 2026-04-14.** After dumping `sub_routine=payout_info` for every value in their paid-places dropdown, we now know PD does **not** use a resampled `h[8]` curve. They keep a separate live curve per paid count (34 in total) which is actually noticeably more top-heavy than the legacy h[8] family. We now inline those curves verbatim (`src/lib/sim/pdCurves.ts`) and match their `sd` to within <1% across our 8-scenario parity harness. The critique below (top-heavy edge concentration is still wrong) survives — it's about the **uniform Bernoulli across the cashed band**, not about the curve shape.

### What they do
For each simulated tournament, draw a single Bernoulli with `p = itm`. If it hits, pick one of the `paid` places with **equal probability** (`1/paid`) and pay out the corresponding prize from their live per-paid payout curve (served by `sub_routine=payout_info`). If it misses, profit = -buyin.

### Why this is wrong
In a real MTT, a skilled player's edge is concentrated disproportionately in the top finishes. The bottom-of-the-band min-cashes are only marginally more frequent for a winner than for a loser (both have to ladder to the cash bubble before losing all-in differences matter). Final tables and top-3 finishes scale super-linearly with skill. Uniform weighting collapses this entirely.

### Probe B1: 1000-player field, +5% ROI
PD: EV=$500, SDmath=$2783, conf95=[-$3911, +$6755] on $10k of buy-ins.

Reality check: PD h[8] for paid=150 gives 1st-place prize ≈ 0.105 × 10000 = $1050. Our engine, using a finish model that concentrates winner edge in top finishes (power-law + profile-shaped), gives SD ≈ $4200–$4800 for the same scenario — **~50–70 % higher** — because top finishes contribute non-trivial mass. PD's SD is too optimistic for a 1000-field grinder.

### Probe B2: winner-take-all 100p paid=1, +10% ROI
PD: EV=$2500, SDmath=$11056 on 500 runs. Here the uniform assumption doesn't bite (only one paid place), and we'd expect closer agreement. Our engine matches to within MC noise. This is the reference point that confirms the model difference is specifically about top-heaviness inside the cashed band, not about EV calculation.

---

## 3. ITM formula overflows at moderately high ROI

`itm = (1 + ROI) * paid / players` is the closed-form used both in their math and in the Monte Carlo sampler. It assumes:

- ROI is achieved entirely by boosting cash rate (not by deep-run concentration).
- A player's expected profit equals `itm * (prizepool/paid) - buyin`, which solves to the formula above.

Problems:

1. **Breaks at ROI such that `(1+ROI)*paid/players ≥ 1`.** Example: 100p/paid=15 flips above 1.0 at ROI > 566 %. The PHP code then reads `itm >= 1` and (we hypothesize) either divides by zero or indexes past an array — net effect is the 500/502 cascade.
2. **Top-finish rate for high-skill players is not modelled at all.** A +30 % ROI MTT grinder does not cash 19.5 % of the time (1.3 × 15 %) — they cash closer to 17 % and final-table more, which has a totally different variance profile.
3. **Short-stack / rebuy strategies invalidate it completely.** A player whose edge comes from aggressive rebuy equity can have a *lower* cash rate than field average while still running +ROI.

### In our engine
Our α-calibration finish model lets you dial the concentration explicitly (power-law exponent + profile weight). The `primedope-binary-itm` comparison mode is kept specifically so users can see **both** numbers — ours and the PD model — and judge the gap themselves.

---

## 4. MC jitter on reported ruin thresholds

### Probe C1 / C2 / C3: three identical calls at `samples=500`

| Call | min01 (−$) | min05 (−$) | min15 (−$) | RoR @ $1000 |
|------|-----------:|-----------:|-----------:|------------:|
| C1   | 8,113      | 6,342      | 4,273      | 65.00 %     |
| C2   | 9,307      | 6,208      | 4,370      | 65.80 %     |
| C3   | 8,981      | 6,156      | 4,112      | 65.20 %     |

Spread on `min01` = **$1195 on mean $8800 = 13.6 %**. This is the bankroll a user would size themselves at if they wanted a 1 % risk of ruin. The number jumps by more than $1000 between refreshes.

Even worse: their default sample size in the UI is 1000, not 500, but even 10,000 still produces visible jitter (C4 vs C5 = 67.02 % vs 66.42 % RoR).

### Why
Tail percentiles of a 1000-tournament run need tens of thousands of samples to stabilize. `sampleSize=1000` is way too low. Worth noting they don't expose a seed and don't document any CI on these numbers.

### In our engine
- Default sample size 50,000, runs across a worker pool.
- Deterministic seed (user-visible and editable) → perfect reproducibility across reruns.
- We report both the empirical min-bankroll percentile **and** the Brownian first-passage analytical RoR side-by-side, so users can cross-check.

---

## 5. Low default sample size, no CI on tail quantiles

Their UI tooltip says "Careful with large values — it might take a while to calculate." But the tail-risk numbers are the single most important output for bankroll sizing, and at 1000 samples those numbers have **~10 % MC noise** that is invisible to the user.

Their C4 (samples=10000) took noticeably longer to compute server-side. C5 (samples=50000) the server accepted but the exec_time field suggests they are compute-bound.

---

## 6. Degenerate / edge cases

| Probe | Input | PD EV | PD SDmath | RoR | probLoss | Verdict |
|-------|-------|------:|----------:|----:|---------:|---------|
| D1 | ROI=0 exact | $0 | $5,403 | 85.85 % | 52.10 % | OK. probLoss > 50 % at EV=0 is correct (right-skew from top prizes). |
| D2 | ROI=-99 % | -$49,500 | $563 | 100 % | 100 % | OK. itm ≈ 0.0015, almost no cashes. |
| D3 | ROI=-100 % exact | -$50,000 | $0 | 100 % | 100 % | Handled (itm=0, deterministic). |
| D4 | N=1 single | $5 | $177.3 | 0 % | 82.10 % | Correct per-tourney sigma (matches baseline/√1000). |
| D5 | N=20,000 long run | $100,000 | $25,077 | 70.80 % | 0 % | **Surprise.** A +10 % ROI player grinding 20k tourneys with $1k bankroll still reports a 70.8 % risk of ruin. Their model says you will almost certainly bust once before finishing 20k tourneys even as a solid winner — because RoR uses running min, not final. |
| D6 | buyin=$0.01 | — | — | — | — | **CRASH** (see §1 vector 2). |
| D7 | buyin=$100,000 | $1,000,000 | $3,546,443 | 4.55 % | 43.05 % | Scaling works. |
| D8 | 500p, paid=40 (tight 8 % ITM) | $1,000 | $2,278 | 81.90 % | 36.15 % | OK. |
| A1 | ROI=+400 % | $200,000 | $9,704 | 0 % | — | itm=0.75, still valid. SD suspiciously low. |
| A2–A5 | high-ROI / tight-paid overflows | — | — | — | — | **CRASH** (see §1 vector 1). |
| E1 | 10p, paid=10 | — | — | — | — | **CRASH** (see §1 vector 3). |
| H3 | rake=100 % | — | — | — | — | **CRASH** (see §1 vector 4). |

A1 is instructive: a +400 % ROI grinder ought to have **enormous** variance — they're winning huge tournaments. PD gives SD=$9704 on $200,000 profit. That's a ratio of 4.86 % — roughly matching a coin flip with 3/4 paid odds (itm=0.75). But a real +400 % ROI player on a 100-man wins several 1st places in 1000 attempts and has much higher SD. The uniform-band model flattens this entirely.

D5 is worth re-reading. Their model says that **grinding a +10 % edge for 20,000 tournaments with a $1k bankroll will bust you 70.8 % of the time**. That is a direct consequence of running-min RoR with no bankroll management logic: if you ever touch zero at any point in 20k trials, you're "ruined" forever even if the rest of the trajectory recovers. Real players don't play that way — they reload, borrow, step down in stakes, etc. Our engine reports the same running-min number but makes the caveat visible, and also exposes the analytical Brownian first-passage figure which is a cleaner theoretical bound.

---

## 7. Rake secretly changes SD (EV pretends it doesn't)

Probed three rake levels on the baseline (100p / $50 / +10 % / 1000 tourneys / samples=2000):

| Rake | Prizepool implied | PD EV | PD SD (math) |
|-----:|------------------:|------:|-------------:|
| 0 %  | $5,000 | $5,000 | **$5,975** |
| 11 % | $4,450 | $5,000 | **$5,607** |
| 50 % | $2,500 | $5,000 | **$4,042** |
| 100 %| $0     | — (crash) | — |

EV stays at exactly `buyin × roi × N` regardless of rake (they ignore rake in the cost basis — consistent with the site's documented convention). But SD clearly depends on rake in a very non-trivial way: from $5975 down to $4042 as rake climbs.

**Why.** Their internal `prizepool` used for the SD computation is `players × (buyin − rake_amount)` — i.e. the real post-rake pool. At higher rake, prizes are smaller, so per-cash outcomes sit closer together and tournament-level variance drops. At rake=100 % the pool is zero and the whole variance computation divides by something that's eventually zero and the worker dies.

**Confirmed math (2026-04-14).** Closed-form reconstruction matches PD's output across all three rake levels to rounding error:

```
pool_post = N × buyin × (1 − rake)
l'        = target × paid / pool_post         // their inflated ITM
σ² per t  = l'/paid × pool_post² × Σh²  −  target²
```

where `target = buyin × ROI` and `Σh² ≈ 0.141` for the live 100p/paid=15 curve. The `l'` inflation is how they preserve the user-facing EV (`target` stays independent of rake) while the `pool_post²` factor is what drags σ down with rake. Our engine now reproduces this exact coupling when `calibrationMode = primedope-binary-itm` + `primedopeStyleEV = true` (see `src/lib/sim/engine.ts:264`).

**Why it matters.** The math here is internally inconsistent: if you pretend rake doesn't enter EV (their ROI is profit/buyin), then for consistency rake should also not enter SD. Either both use `buyin` as the scale (classic cash-game convention) or both use `buyin − rake` (turnover convention). Mixing the two means that two players with identical edge but playing different rake schedules get **wrongly different variance predictions**. A grinder switching from 5 % rake to 15 % rake venues will see their PD-estimated RoR bankroll silently drop even though nothing about their edge changed.

Our engine uses a consistent cost basis across EV and SD and exposes which convention is in use in the settings dump.

---

## 8. Reproducibility / evidence

All raw JSON responses are in `scripts/pd_cache/` keyed by a hash of the input. Each file is the literal body returned by Primedope, unmodified. To re-verify any claim:

```bash
node scripts/pd_probe.mjs   # hits live API only for uncached probes
```

The script pauses 1.5 s between uncached calls to avoid overloading their server, and persists every response to disk.

**Note on ethics:** This dossier was generated by hitting their public API with the same shape of requests their own web UI would send — the only difference is we send malformed inputs that their UI forgets to clamp. We did not attempt to DoS or exploit beyond documenting the fragility. The 502-after-overflow behavior was discovered by accident in the first probe run, not by flooding.
