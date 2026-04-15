import { calibrateShelledItm } from "../src/lib/sim/finishModel";
import { primedopeCurveForPaid } from "../src/lib/sim/pdCurves";

const cases = [
  { label: "100p ROI+50% pure",       N: 100,  paid: 15,  itm: 0.16, roi: 0.5, shells: undefined },
  { label: "100p ROI+50% P1=1.25%",   N: 100,  paid: 15,  itm: 0.16, roi: 0.5, shells: { first: 0.0125 } },
  { label: "100p ROI+50% P1=P3=2%",   N: 100,  paid: 15,  itm: 0.16, roi: 0.5, shells: { first: 0.02, top3: 0.04 } },
  { label: "1000p ROI+20% P1=0.1%",   N: 1000, paid: 150, itm: 0.16, roi: 0.2, shells: { first: 0.001 } },
  { label: "1000p ROI+50% overlock",  N: 1000, paid: 150, itm: 0.16, roi: 0.5, shells: { first: 0.001, top3: 0.002, ft: 0.005 } },
];

for (const c of cases) {
  const curve = primedopeCurveForPaid(c.paid);
  const pool = c.N * 10 * 0.9;
  const cost = 11;
  const target = cost * (1 + c.roi);
  const r = calibrateShelledItm(
    c.N, c.paid, curve, pool, target, c.itm, c.shells, { id: "power-law" },
  );
  const P1 = (r.pmf[0] * 100).toFixed(3);
  const P3 = ((r.pmf[0] + r.pmf[1] + r.pmf[2]) * 100).toFixed(3);
  let itmSum = 0;
  for (let i = 0; i < c.paid; i++) itmSum += r.pmf[i];
  const gap = r.currentWinnings - target;
  console.log(
    `${c.label.padEnd(34)} α=${r.alpha.toFixed(2).padStart(6)}  P1=${P1}%  P3=${P3}%  ITM=${(itmSum*100).toFixed(2)}%  EW=$${r.currentWinnings.toFixed(2)} (gap ${gap >= 0 ? "+" : ""}${gap.toFixed(3)})  feasible=${r.feasible}`,
  );
}
