// Hit PD's sub_routine=payout_info for every paid_places value in the
// dropdown and dump the resulting payout tables as fractions-of-pool.
// Cache each raw response in scripts/pd_payout_cache/ so reruns are free.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PAID_VALUES = [
  1, 2, 3, 4, 5, 6, 8, 9, 10, 15, 20, 25, 30, 35, 40, 50, 60, 75, 100, 125,
  150, 175, 200, 225, 250, 275, 300, 350, 400, 450, 500, 550, 600, 700,
];
const BUYIN = 100;
const RAKE = 0; // post-rake pool = players * buyin exactly

const cacheDir = "scripts/pd_payout_cache";
if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

async function fetchPaid(paid) {
  const players = Math.max(paid * 10, 100);
  const cacheFile = join(cacheDir, `paid_${paid}.json`);
  if (existsSync(cacheFile)) {
    return JSON.parse(readFileSync(cacheFile, "utf-8"));
  }
  const kv = `players=${players} places_paid=${paid} buyin=${BUYIN} rake=${RAKE}`;
  const url =
    "https://www.primedope.com/prime.php?p=tournament-variance-calculator&sub_routine=payout_info&args=" +
    encodeURIComponent(kv).replace(/%20/g, " ");
  await new Promise((r) => setTimeout(r, 1000));
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 pd-curve-dump" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for paid=${paid}`);
  const json = await res.json();
  writeFileSync(cacheFile, JSON.stringify(json, null, 2));
  return json;
}

// Expand PD's "place" field (either a number or "a - b") into one row per
// place, then convert dollar prizes to fractions of the true prizepool.
function expandPayoutInfo(paid, players, info) {
  const pool = players * BUYIN; // rake=0
  const fractions = new Array(paid).fill(0);
  for (const row of info) {
    const prizeFrac = row.prize / pool;
    if (typeof row.place === "number") {
      fractions[row.place - 1] = prizeFrac;
    } else {
      const [lo, hi] = row.place.split("-").map((s) => parseInt(s.trim(), 10));
      for (let p = lo; p <= hi; p++) fractions[p - 1] = prizeFrac;
    }
  }
  return fractions;
}

const curves = [];
for (const paid of PAID_VALUES) {
  process.stdout.write(`  paid=${String(paid).padStart(4)} … `);
  const json = await fetchPaid(paid);
  const players = parseInt(json.meta.args.players, 10);
  const fractions = expandPayoutInfo(paid, players, json.payoutInfo);
  const sum = fractions.reduce((a, b) => a + b, 0);
  console.log(`ok (sum=${sum.toFixed(4)})`);
  curves.push({ paid, fractions });
}

writeFileSync("scripts/pd_payout_curves.json", JSON.stringify(curves));
console.log(`\nwrote ${curves.length} curves`);

// Also print the top-10 of each curve so we can eyeball the shape.
console.log("\ntop-10 of each curve:");
for (const c of curves) {
  const top = c.fractions
    .slice(0, 10)
    .map((f) => (f * 100).toFixed(2) + "%")
    .join(" ");
  console.log(`  paid=${String(c.paid).padStart(4)}  ${top}`);
}
