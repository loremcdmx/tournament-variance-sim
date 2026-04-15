import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const VIEWPORTS = [
  { name: "mobile-375", width: 375, height: 812 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "laptop-1024", width: 1024, height: 768 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "wide-1440", width: 1440, height: 900 },
];

const OUT = resolve("scripts/layout-audit-out");
mkdirSync(OUT, { recursive: true });

const URL = "http://localhost:3000/";

const browser = await chromium.launch();

// Track layout findings per viewport
const findings = {};

for (const vp of VIEWPORTS) {
  findings[vp.name] = [];
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errs.push(`console: ${msg.text()}`);
  });

  await page.goto(URL, { waitUntil: "networkidle" });

  // Click Run. The button text is RU/EN — try both.
  const runBtn = page
    .locator("button")
    .filter({ hasText: /run|запустить|симул|go/i })
    .first();
  try {
    await runBtn.waitFor({ state: "visible", timeout: 5000 });
    await runBtn.click();
  } catch {
    findings[vp.name].push("Run button not found");
  }

  // Wait for results to render (look for a known chart label / table row).
  try {
    await page.waitForFunction(
      () => document.body.innerText.length > 4000,
      null,
      { timeout: 30000 },
    );
  } catch {
    findings[vp.name].push("results not rendered within 30s");
  }

  // Small settle
  await page.waitForTimeout(500);

  const full = resolve(OUT, `${vp.name}.png`);
  await page.screenshot({ path: full, fullPage: true });

  // Overflow check: any element whose scrollWidth > clientWidth inside main
  const overflows = await page.evaluate(() => {
    const out = [];
    const all = document.querySelectorAll("main *");
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === "auto" || cs.overflowX === "scroll") continue;
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        const r = el.getBoundingClientRect();
        if (r.width < 20) continue;
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 80),
          sw: el.scrollWidth,
          cw: el.clientWidth,
          w: Math.round(r.width),
          txt: (el.innerText || "").slice(0, 40),
        });
      }
    }
    return out.slice(0, 30);
  });

  // Measure specific suspicious elements:
  //  - AFS slider row (inside ConvergenceChart — find by aria-label "AFS")
  //  - DistributionChart bars inside DownswingsCard streaks
  const afsRow = await page.evaluate(() => {
    const el = document.querySelector('input[aria-label="AFS"]');
    if (!el) return null;
    const row = el.closest("div");
    if (!row) return null;
    const r = row.getBoundingClientRect();
    const kids = [...row.children].map((c) => {
      const cr = c.getBoundingClientRect();
      return { tag: c.tagName.toLowerCase(), w: Math.round(cr.width) };
    });
    return { rowW: Math.round(r.width), kids };
  });

  const streakCharts = await page.evaluate(() => {
    // Find headings matching 'break-even' / 'без ИТМ' / 'отмазка'
    const hs = [...document.querySelectorAll("h3, h4, h5, div")];
    const targets = hs.filter((h) => {
      const t = (h.innerText || "").toLowerCase();
      return (
        /break|ноль|cashless|без итм|recovery|отмаз/.test(t) && t.length < 60
      );
    });
    const found = [];
    for (const h of targets) {
      // Walk up to card parent, then find svg inside
      let p = h;
      for (let i = 0; i < 6 && p; i++) p = p.parentElement;
      const root = p || h.parentElement;
      const svg = root && root.querySelector("svg");
      if (svg) {
        const r = svg.getBoundingClientRect();
        found.push({
          title: h.innerText.slice(0, 30),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    // Deduplicate by title
    const seen = new Set();
    return found.filter((f) => {
      if (seen.has(f.title)) return false;
      seen.add(f.title);
      return true;
    });
  });

  findings[vp.name].push({ errs, overflows, afsRow, streakCharts });

  await ctx.close();
}

await browser.close();

console.log(JSON.stringify(findings, null, 2));
