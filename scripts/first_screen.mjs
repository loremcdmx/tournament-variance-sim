import { chromium } from "playwright";
import { resolve } from "node:path";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// Overlay red border at y=800 to mark the fold
await page.addStyleTag({
  content: `body::after{content:'';position:fixed;left:0;right:0;top:800px;height:2px;background:red;z-index:99999;pointer-events:none}`,
});

await page.screenshot({
  path: resolve("scripts/layout-audit-out/first-screen-1280-before.png"),
  fullPage: false,
});

// Measure y-position of key elements
const measured = await page.evaluate(() => {
  const find = (sel, match) => {
    for (const el of document.querySelectorAll(sel)) {
      if (el.textContent && match.test(el.textContent)) {
        const r = el.getBoundingClientRect();
        return {
          text: el.textContent.slice(0, 40).trim(),
          y: Math.round(r.top),
          h: Math.round(r.height),
        };
      }
    }
    return null;
  };
  return {
    h1: (() => {
      const el = document.querySelector("h1");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { y: Math.round(r.top), h: Math.round(r.height) };
    })(),
    scenarioGrid: find("div", /BREAD|Bread|Demo|ДЕМО|СЦЕНАРИЙ/i),
    section01: find("h2, [class*='section']", /01|SCHEDULE|РАСПИСАНИЕ/i),
    runBtn: (() => {
      const btns = [...document.querySelectorAll("button")];
      const b = btns.find((b) => /run|запуст/i.test(b.textContent || ""));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { y: Math.round(r.top), text: b.textContent?.slice(0, 20) };
    })(),
    docH: document.documentElement.scrollHeight,
  };
});
console.log(JSON.stringify(measured, null, 2));

await browser.close();
