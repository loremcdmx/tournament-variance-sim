import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import lzString from "lz-string";
import dictionary from "../src/lib/i18n/dict.ts";
const { DICT } = dictionary;
const { decompressFromEncodedURIComponent } = lzString;

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3468";
const expectedVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const out = resolve(process.env.SMOKE_OUT_DIR ?? "scripts/smoke-out/bughunt-release");
mkdirSync(out, { recursive: true });
const report = { baseUrl, startedAt: new Date().toISOString(), cases: [] };
const text = (key) => DICT[key].ru;
const controls = {
  scheduleRepeats: 1, samples: 1000, bankroll: 0, seed: 42,
  finishModelId: "powerlaw-realdata-influenced", alphaOverride: null,
  usePrimedopePayouts: true, usePrimedopeFinishModel: true, usePrimedopeRakeMath: true,
  compareEnabled: false, compareMode: "primedope", modelPresetId: "naive",
  roiStdErr: 0, roiShockPerTourney: 0, roiShockPerSession: 0, roiDriftSigma: 0,
  tiltFastGain: 0, tiltFastScale: 0, tiltSlowGain: 0, tiltSlowThreshold: 0,
  tiltSlowMinDuration: 500, tiltSlowRecoveryFrac: 0.5,
  itmGlobalEnabled: true, itmGlobalPct: 15, rakebackPct: 20,
};
const row = { id: "r1", label: "Audit freeze", players: 200, buyIn: 50,
  rake: 0.1, roi: 0.1, payoutStructure: "mtt-standard", gameType: "freezeout", count: 10 };
const fixture = (patch = {}, rows = [row]) => ({ v: 2, schedule: rows, controls: { ...controls, ...patch } });
let browser;

async function boot(state, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((state) => {
    if (!localStorage.getItem("bughunt-initialized")) {
      localStorage.setItem("tvs:state", JSON.stringify(state));
      localStorage.setItem("tvs:locale", "ru");
      localStorage.setItem("tvs:mode", "mtt");
      localStorage.setItem("tvs:cash-input", JSON.stringify({ type: "cash", wrBb100: 5,
        sdBb100: 100, hands: 10000, nSimulations: 100, bbSize: 1, baseSeed: 42 }));
      localStorage.setItem("bughunt-initialized", "1");
    }
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 4 });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (value) => {
      window.__copiedText = value;
    } } });
    window.__workerEvents = [];
    const observed = new WeakSet();
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...rest) {
      if (!observed.has(this)) {
        observed.add(this);
        this.addEventListener("message", ({data}) => {
          if (data.type === "build-result") window.__workerEvents.push({
            type: "completed", jobId: data.jobId, calibrationMode: data.result.calibrationMode,
            tournaments: data.result.tournamentsPerSample, mean: data.result.stats.mean,
            risk: data.result.stats.riskOfRuin,
          });
        });
      }
      if (message.type === "shard") window.__workerEvents.push({
        type: "requested", jobId: message.jobId, calibrationMode: message.calibrationMode,
        seed: message.input.seed, bankroll: message.input.bankroll,
        tournaments: message.input.schedule.reduce((n,r) => n + r.count, 0) * message.input.scheduleRepeats,
        pdPayouts: message.input.usePrimedopePayouts,
        pdFinish: message.input.usePrimedopeFinishModel,
      });
      return post.call(this, message, ...rest);
    };
  }, state);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const issues = [];
  page.on("pageerror", e => issues.push(e.message));
  page.on("console", e => { if (e.type() === "error") issues.push(e.text()); });
  await page.goto(`${baseUrl.replace(/\/$/, "")}/?admin=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: text("mode.tab.cash"), exact: true }).waitFor();
  await page.getByText(`v${expectedVersion}`, { exact: true }).first().waitFor({ state: "attached" });
  return { page, context, issues };
}

async function settleBatch(page, passes = 1) {
  await page.waitForFunction(n => window.__workerEvents.filter(e => e.type === "completed").length >= n, 5 * passes);
  await page.locator("#results-top").waitFor();
}
async function workerEvents(page) { return page.evaluate(() => window.__workerEvents); }
async function screenshot(page, name) {
  const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(overflow.document <= overflow.viewport + 1, `horizontal overflow: ${JSON.stringify(overflow)}`);
  await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: false });
  return overflow;
}
async function check(name, state, body, viewport) {
  const { page, context, issues } = await boot(state, viewport);
  try {
    const evidence = await body(page);
    assert.deepEqual(issues, [], `browser errors: ${issues.join("; ")}`);
    report.cases.push({ name, ok: true, evidence, workerEvents: await workerEvents(page) });
    console.log(`PASS ${name}`);
  } catch (error) {
    await page.screenshot({ path: resolve(out, `${name}-failure.png`), fullPage: true });
    writeFileSync(resolve(out, `${name}-failure.txt`), await page.locator("body").innerText());
    report.cases.push({ name, ok: false, error: String(error), stack: error.stack, issues, workerEvents: await workerEvents(page) });
    throw error;
  } finally { await context.close(); }
}

try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.SMOKE_BROWSER_CHANNEL ? { channel: process.env.SMOKE_BROWSER_CHANNEL } : {}) });
  for (const kind of ["top-heavy", "bounty"]) {
    const bounty = kind === "bounty";
    const biasKey = bounty ? "bountyEvBias" : "itmTopHeavyBias";
    const sliderLabel = text(bounty ? "preview.evBias.label" : "preview.topHeavyBias.label");
    const rows = [{ ...row, ...(bounty ? { gameType: "pko", bountyFraction: 0.5 } : {}) }];
    await check(`ev-slider-${kind}-commits`, fixture({}, rows), async page => {
      const slider = page.getByRole("slider", { name: sliderLabel, exact: true });
      await slider.waitFor();
      await slider.press("ArrowRight");
      // A changed thumb alone is insufficient: quick keyup previously committed
      // the stale controlled DOM value before the draft animation frame ran.
      await page.waitForFunction(({ biasKey, sign }) => {
        const saved = JSON.parse(localStorage.getItem("tvs:state"));
        return (saved.schedule[0][biasKey] ?? 0) * sign > 0;
      }, { biasKey, sign: bounty ? -1 : 1 });
      const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("tvs:state")).schedule[0]);
      assert.equal(persisted.roi, row.roi);
      assert.equal(await slider.evaluate(el => document.activeElement === el), true, "committed before blur");
      if (!bounty) {
        const manual = page.getByRole("spinbutton", { name: sliderLabel, exact: true });
        await manual.fill("60");
        await manual.press("Enter");
        await page.waitForFunction(() => Math.abs(JSON.parse(localStorage.getItem("tvs:state")).schedule[0].itmTopHeavyBias - 0.2) < 1e-6);
        const card = slider.locator("..").locator("..").locator("..");
        await card.getByRole("button", { name: text("preview.evBias.reset"), exact: true }).click();
        await page.waitForFunction(() => !JSON.parse(localStorage.getItem("tvs:state")).schedule[0].itmTopHeavyBias);
      }
      return { biasKey, committedBeforeBlur: persisted[biasKey], roiPreserved: true };
    });
  }

  await check("completed-input-snapshot", fixture(), async page => {
    await page.getByRole("button", { name: text("controls.run"), exact: true }).click();
    await settleBatch(page);
    const before = await workerEvents(page);
    await page.getByRole("spinbutton", { name: text("controls.bankroll"), exact: true }).fill("100");
    const distance = page.locator("label").filter({ hasText: text("controls.scheduleRepeats") }).locator('input[type="number"]').first();
    await distance.fill("20");
    await distance.blur();
    await page.getByText(text("results.inputsChanged"), { exact: true }).waitFor();
    assert.equal((await workerEvents(page)).length, before.length);
    const displayed = await page.locator("#results-top").innerText();
    assert.ok(displayed.includes(text("stat.bankrollOff")));
    assert.match(displayed, /по 10 турнир/);
    await page.getByRole("button", { name: text("runExport.copyLink"), exact: true }).click();
    const link = await page.evaluate(() => window.__copiedText);
    const shared = JSON.parse(decompressFromEncodedURIComponent(link.split("#s=")[1]));
    assert.equal(shared.controls.bankroll, 0);
    assert.equal(shared.schedule[0].count * shared.controls.scheduleRepeats, 10);
    assert.equal(shared.schedule[0].itmRate, undefined);
    await page.locator("#results-top").scrollIntoViewIfNeeded();
    const overflow = await screenshot(page, "frozen-result");
    await page.evaluate(() => { window.__workerEvents = []; });
    await distance.fill("30");
    await page.getByRole("button", { name: text("controls.run"), exact: true }).click();
    await settleBatch(page);
    const requests = (await workerEvents(page)).filter(e => e.type === "requested");
    assert.ok(requests.every(e => e.tournaments === 30 && e.bankroll === 100));
    assert.ok(!(await page.locator("#results-top").innerText()).includes(text("stat.bankrollOff")));
    await page.goto(link, { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(name => [...document.querySelectorAll("label")].some(el =>
      el.textContent.includes(name) && el.querySelector('input[type="number"]')?.value === "10"), text("controls.scheduleRepeats"));
    await page.getByRole("button", { name: text("controls.run"), exact: true }).click();
    await settleBatch(page);
    const imported = (await workerEvents(page)).filter(e => e.type === "requested");
    assert.ok(imported.length > 0);
    assert.equal(imported[0].seed, shared.controls.seed, "a freshly opened share link retains its seed");
    assert.ok(imported.every(e => e.tournaments === 10 && e.bankroll === 0), "share link restores completed inputs");
    assert.equal((await workerEvents(page)).find(e => e.type === "completed").mean,
      before.find(e => e.type === "completed").mean, "shared run reproduces the same numeric result");
    return { originalTournaments: 10, firstClickTournaments: 30, sharedSeedReproduced: true, shared, overflow };
  });

  await check("running-shortcut-does-not-restart", fixture({ samples: 10000 }, [{ ...row, count: 10000 }]), async page => {
    await page.getByRole("button", { name: text("controls.run"), exact: true }).click();
    await page.waitForFunction(() => window.__workerEvents.some(e => e.type === "requested"));
    const stop = page.getByRole("button", { name: new RegExp(`^${text("controls.stop")} `) });
    await stop.waitFor();
    await page.keyboard.press("Control+Enter");
    await page.keyboard.press("Meta+Enter");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const events = await workerEvents(page);
    const jobs = [...new Set(events.filter(e => e.type === "requested").map(e => e.jobId))];
    assert.equal(jobs.length, 1);
    assert.equal(events.some(e => e.type === "completed"), false);
    await stop.click();
    await page.getByRole("button", { name: text("controls.run"), exact: true }).waitFor();
    return { foregroundJobs: jobs.length, cancelledAfterShortcutCheck: true };
  });

  await check("cash-tabs-and-escape", fixture(), async page => {
    await page.getByRole("button", { name: text("mode.tab.cash"), exact: true }).click();
    const bb = page.getByLabel(text("cash.bbSize.label"), { exact: true });
    await bb.fill("0");
    await bb.press("Escape");
    assert.equal(await bb.inputValue(), "1");
    const before = (await workerEvents(page)).length;
    await page.keyboard.press("Control+Enter");
    await page.getByRole("button", { name: text("cash.run"), exact: true }).click();
    const odds = page.getByText(text("cash.chart.odds.title"));
    await odds.waitFor();
    const heading = page.getByRole("heading", { name: text("cash.section.results.title"), exact: true });
    await heading.waitFor();
    assert.equal((await workerEvents(page)).length, before);
    await page.getByRole("button", { name: text("mode.tab.mtt"), exact: true }).click();
    await page.getByRole("button", { name: text("mode.tab.cash"), exact: true }).click();
    assert.equal(await heading.isVisible(), true);
    assert.equal(await odds.isVisible(), true);
    return { bbAfterEscape: await bb.inputValue(), resultSurvivesTabs: true, overflow: await screenshot(page, "cash-retained") };
  });

  await check("atomic-csv-import", fixture(), async page => {
    await page.getByRole("button", { name: text("row.import"), exact: true }).click();
    await page.locator("textarea").fill("Valid,500,50+5,10,100,mtt-standard\nLost,abc,50+5,10,100,mtt-standard");
    await page.getByRole("button", { name: text("row.importReplace"), exact: true }).click();
    assert.equal(await page.locator("textarea").isVisible(), true);
    assert.equal(await page.locator('[id^="schedule-row-"]').count(), 1);
    assert.equal(await page.locator('#schedule-row-r1 input[type="text"]').first().inputValue(), "Audit freeze");
    return { unchangedSchedule: true, errorsVisible: true };
  });

  for (const preset of ["naive", "primedope"]) {
    await check(`pd-${preset}-cache`, fixture({ modelPresetId: preset, compareEnabled: true }), async page => {
      await page.getByRole("button", { name: text("controls.run"), exact: true }).click();
      await settleBatch(page, 2);
      const toggle = page.getByRole("checkbox", { name: text("chart.trajectory.pdPayouts"), exact: true });
      await page.evaluate(() => { window.__workerEvents = []; });
      await toggle.uncheck();
      await page.waitForFunction(() => window.__workerEvents.some(e => e.type === "completed"));
      await page.waitForFunction(label => [...document.querySelectorAll("label")].some(el => el.textContent.trim() === label && el.querySelector("input")?.checked === false), text("chart.trajectory.pdPayouts"));
      const requests = (await workerEvents(page)).filter(e => e.type === "requested");
      assert.ok(requests.length > 0 && requests.every(e => e.calibrationMode === "primedope-binary-itm" && !e.pdPayouts));
      await page.getByRole("button", { name: text("seedBatch.next"), exact: true }).click();
      await page.waitForFunction(label => [...document.querySelectorAll("label")].some(el => el.textContent.trim() === label && el.querySelector("input")?.checked === true), text("chart.trajectory.pdPayouts"));
      assert.equal(await toggle.isChecked(), true);
      await page.getByRole("button", { name: text("seedBatch.prev"), exact: true }).click();
      await page.waitForFunction(label => [...document.querySelectorAll("label")].some(el => el.textContent.trim() === label && el.querySelector("input")?.checked === false), text("chart.trajectory.pdPayouts"));
      assert.equal(await toggle.isChecked(), false);
      await page.getByRole("button", { name: text("runExport.copyLink"), exact: true }).click();
      const shared = JSON.parse(decompressFromEncodedURIComponent((await page.evaluate(() => window.__copiedText)).split("#s=")[1]));
      assert.equal(shared.controls.usePrimedopePayouts, false);
      return { preset, actualPass: requests[0].calibrationMode, cachedFlagsRestored: true };
    });
  }

  await check("mobile-default-and-results", fixture(), async page => {
    const initialOverflow = await screenshot(page, "mobile-default");
    await page.getByRole("button", { name: text("controls.run"), exact: true }).click();
    await settleBatch(page);
    await page.locator("#results-top").scrollIntoViewIfNeeded();
    return { initialOverflow, resultsOverflow: await screenshot(page, "mobile-results") };
  }, { width: 390, height: 844 });
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  writeFileSync(resolve(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, cases: report.cases.map(({ name, ok, error }) => ({ name, ok, error })), error: report.error, out }, null, 2));
}
