import fs from "node:fs";
import path from "node:path";
import {
  validateSample,
  type PayoutSample,
} from "../../src/lib/sim/realPayouts";

export function loadAllSamples(dir?: string): PayoutSample[] {
  const resolved = dir ?? path.join(process.cwd(), "data", "payout-samples");
  if (!fs.existsSync(resolved)) return [];
  const files = fs
    .readdirSync(resolved)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const out: PayoutSample[] = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(resolved, f), "utf8");
    const s = JSON.parse(raw) as PayoutSample;
    validateSample(s);
    out.push(s);
  }
  return out;
}
