import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { chromium, devices } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "scripts/smoke-out/cash-release");
mkdirSync(OUT_DIR, { recursive: true });

const START_TS = new Date().toISOString();
const CASH_INPUT_KEY = "tvs:cash-input";
const COMMON_URLS = [
  "http://127.0.0.1:3000/",
  "http://127.0.0.1:3009/",
  "http://127.0.0.1:3456/",
  "http://localhost:3000/",
  "http://localhost:3009/",
  "http://localhost:3456/",
];
const BAD_TOKENS_RE = /(?:NaN|undefined|Infinity)/g;

function normalizeUrl(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

async function probeUrl(url) {
  try {
    const res = await fetch(normalizeUrl(url), {
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return false;
    const text = await res.text();
    return /PrimeDope|tournament-variance-sim|ПАРАМЕТРЫ КЭША/i.test(text);
  } catch {
    return false;
  }
}

async function findExistingServer() {
  const urls = process.env.SMOKE_BASE_URL
    ? [process.env.SMOKE_BASE_URL]
    : COMMON_URLS;
  const seen = new Set();
  for (const raw of urls) {
    const url = normalizeUrl(raw);
    if (seen.has(url)) continue;
    seen.add(url);
    if (await probeUrl(url)) {
      return { baseUrl: url, source: "existing" };
    }
  }
  return null;
}

function startDevServer() {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      "npm",
      ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3456"],
      {
        cwd: ROOT,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const lines = [];
    let settled = false;
    let candidate = null;
    let sawExistingServer = false;

    const finish = (fn, payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      fn(payload);
    };

    const ingestLine = (line) => {
      lines.push(line);
      const localMatch = line.match(/Local:\s+(https?:\/\/\S+)/);
      if (localMatch) candidate = normalizeUrl(localMatch[1]);
      if (line.includes("Another next dev server is already running")) {
        sawExistingServer = true;
      }
      if (candidate && /Ready in/i.test(line)) {
        finish(resolvePromise, {
          baseUrl: candidate,
          child,
          source: "spawned",
          startupLog: lines.slice(),
        });
      }
    };

    const stdoutRl = readline.createInterface({ input: child.stdout });
    const stderrRl = readline.createInterface({ input: child.stderr });
    stdoutRl.on("line", ingestLine);
    stderrRl.on("line", ingestLine);

    child.on("exit", (code) => {
      stdoutRl.close();
      stderrRl.close();
      if (candidate && sawExistingServer) {
        finish(resolvePromise, {
          baseUrl: candidate,
          child: null,
          source: "existing-via-next-lock",
          startupLog: lines.slice(),
        });
        return;
      }
      finish(
        rejectPromise,
        new Error(
          `Unable to start a local server (exit ${code ?? "unknown"}).\n${lines.join("\n")}`,
        ),
      );
    });

    child.on("error", (error) => {
      stdoutRl.close();
      stderrRl.close();
      finish(rejectPromise, error);
    });

    const timeoutId = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore cleanup failure
      }
      finish(
        rejectPromise,
        new Error(`Timed out waiting for dev server.\n${lines.join("\n")}`),
      );
    }, 30_000);
  });
}

async function ensureServer() {
  const existing = await findExistingServer();
  if (existing) return existing;
  return startDevServer();
}

function buildScenarioInput(overrides = {}) {
  return {
    type: "cash",
    wrBb100: 5,
    sdBb100: 100,
    hands: 100_000,
    nSimulations: 600,
    bbSize: 1,
    rake: {
      enabled: false,
      contributedRakeBb100: 8,
      advertisedRbPct: 30,
      pvi: 1,
    },
    hoursBlock: { handsPerHour: 500 },
    riskBlock: { thresholdBb: 100 },
    baseSeed: 42,
    ...overrides,
  };
}

async function assertNoBadTokens(page, label) {
  const text = await page.locator("body").innerText();
  const bad = text.match(BAD_TOKENS_RE);
  if (bad) {
    throw new Error(
      `${label}: forbidden DOM tokens: ${[...new Set(bad)].join(", ")}`,
    );
  }
}

async function assertNoOverlap(page) {
  const econCard = page
    .locator("div.data-surface-card")
    .filter({ has: page.getByText("Экономика") })
    .first();
  const diagCard = page.locator("details.data-surface-card").first();
  const econBox = await econCard.boundingBox();
  const diagBox = await diagCard.boundingBox();
  if (!econBox || !diagBox) {
    throw new Error("Unable to measure economics/diagnostics cards");
  }
  if (diagBox.y < econBox.y + econBox.height - 1) {
    throw new Error(
      `Economics overlaps diagnostics (${econBox.y + econBox.height} > ${diagBox.y})`,
    );
  }
}

async function assertNoOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (overflow.scrollWidth > overflow.innerWidth + 1) {
    throw new Error(
      `${label}: horizontal overflow ${overflow.scrollWidth} > ${overflow.innerWidth}`,
    );
  }
  return overflow;
}

async function bootCashPage(context, baseUrl, storageEntries) {
  const page = await context.newPage();
  const issues = [];

  page.on("pageerror", (err) => {
    issues.push(`pageerror: ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      issues.push(`console.error: ${msg.text()}`);
    }
  });

  await page.addInitScript((entries) => {
    localStorage.setItem("tvs:advancedMode", "1");
    localStorage.setItem("tvs:mode", "cash");
    localStorage.setItem("tvs:locale", "ru");
    localStorage.removeItem("tvs:cash-input");
    for (const [key, value] of entries) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  }, Object.entries(storageEntries));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByText("Параметры кэша").waitFor({ state: "visible" });
  await page.getByText("Результаты кэша").waitFor({ state: "visible" });

  return { page, issues };
}

async function runCashSimulation(page) {
  await page.getByRole("button", { name: "Запустить симуляцию" }).click();
  await page.getByText("Шансы по дистанции").waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

async function runScenario(browser, baseUrl, scenario) {
  const context = await browser.newContext(scenario.contextOptions);
  const { page, issues } = await bootCashPage(
    context,
    baseUrl,
    scenario.storageEntries,
  );
  try {
    const details = await scenario.check(page);
    if (issues.length > 0) {
      throw new Error(`${scenario.name}: ${issues.join("\n")}`);
    }
    return {
      name: scenario.name,
      screenshot: scenario.screenshotFile,
      details,
    };
  } finally {
    await context.close();
  }
}

const mixedRenormInput = buildScenarioInput({
  hands: 20_000,
  nSimulations: 300,
  riskBlock: { thresholdBb: 250 },
  stakes: [
    {
      label: "NL100",
      wrBb100: 4,
      sdBb100: 90,
      bbSize: 1,
      handShare: 0.9,
      rake: {
        enabled: false,
        contributedRakeBb100: 8,
        advertisedRbPct: 30,
        pvi: 1,
      },
    },
    {
      label: "NL200",
      wrBb100: 7,
      sdBb100: 120,
      bbSize: 2,
      handShare: 0.5,
      rake: {
        enabled: false,
        contributedRakeBb100: 6,
        advertisedRbPct: 35,
        pvi: 1,
      },
    },
  ],
});

const hourlyDisabledInput = buildScenarioInput({
  hands: 25_000,
  nSimulations: 300,
  hoursBlock: null,
});

const scenarios = [
  {
    name: "desktop-default",
    screenshotFile: resolve(OUT_DIR, "desktop-default.png"),
    storageEntries: {},
    contextOptions: {
      viewport: { width: 1600, height: 2200 },
      locale: "ru-RU",
    },
    check: async (page) => {
      await runCashSimulation(page);
      await page.getByText("Диагностика симуляции").waitFor({ state: "visible" });
      await page.getByText("Ожидаемый EV").waitFor({ state: "visible" });
      await assertNoBadTokens(page, "desktop-default");
      await assertNoOverlap(page);
      const diagnosticsOpen = await page
        .locator("details.data-surface-card")
        .first()
        .evaluate((el) => el.hasAttribute("open"));
      await page.screenshot({
        path: resolve(OUT_DIR, "desktop-default.png"),
        fullPage: true,
      });
      return { diagnosticsOpen };
    },
  },
  {
    name: "desktop-mixed-renorm",
    screenshotFile: resolve(OUT_DIR, "desktop-mixed-renorm.png"),
    storageEntries: {
      [CASH_INPUT_KEY]: JSON.stringify(mixedRenormInput),
    },
    contextOptions: {
      viewport: { width: 1600, height: 2200 },
      locale: "ru-RU",
    },
    check: async (page) => {
      await page
        .getByText("Перед запуском движок перенормирует её к 1.00.")
        .waitFor({ state: "visible" });
      await runCashSimulation(page);
      await page.getByText("Из чего собирается микс").waitFor({
        state: "visible",
      });
      await page.getByText("NL100").waitFor({ state: "visible" });
      await page.getByText("NL200").waitFor({ state: "visible" });
      await page.getByText(/250 BB/).first().waitFor({ state: "visible" });
      await page.getByRole("button", { name: "$" }).click();
      await page.getByText(/\$250/).first().waitFor({ state: "visible" });
      await assertNoBadTokens(page, "desktop-mixed-renorm");
      await assertNoOverlap(page);
      await page.screenshot({
        path: resolve(OUT_DIR, "desktop-mixed-renorm.png"),
        fullPage: true,
      });
      return {
        thresholdUsdVisible: true,
      };
    },
  },
  {
    name: "desktop-hourly-disabled",
    screenshotFile: resolve(OUT_DIR, "desktop-hourly-disabled.png"),
    storageEntries: {
      [CASH_INPUT_KEY]: JSON.stringify(hourlyDisabledInput),
    },
    contextOptions: {
      viewport: { width: 1600, height: 2200 },
      locale: "ru-RU",
    },
    check: async (page) => {
      const hourlyFieldCount = await page.getByText("Раздач в час").count();
      if (hourlyFieldCount !== 0) {
        throw new Error("Hourly field should stay hidden when hoursBlock is off");
      }
      await runCashSimulation(page);
      await page
        .getByText("Чистое ожидание на выбранной дистанции.")
        .waitFor({ state: "visible" });
      const hourlyEconomicsCount = await page.getByText("EV / час").count();
      if (hourlyEconomicsCount !== 0) {
        throw new Error("Hourly EV row should stay hidden when hoursBlock is off");
      }
      await assertNoBadTokens(page, "desktop-hourly-disabled");
      await assertNoOverlap(page);
      await page.screenshot({
        path: resolve(OUT_DIR, "desktop-hourly-disabled.png"),
        fullPage: true,
      });
      return {
        hourlyFieldCount,
        hourlyEconomicsCount,
      };
    },
  },
  {
    name: "mobile-default",
    screenshotFile: resolve(OUT_DIR, "mobile-default.png"),
    storageEntries: {},
    contextOptions: {
      ...devices["iPhone 13"],
      locale: "ru-RU",
    },
    check: async (page) => {
      await runCashSimulation(page);
      const overflow = await assertNoOverflow(page, "mobile-default");
      await assertNoBadTokens(page, "mobile-default");
      await page.screenshot({
        path: resolve(OUT_DIR, "mobile-default.png"),
        fullPage: true,
      });
      return overflow;
    },
  },
];

let serverHandle = null;
const report = {
  startedAt: START_TS,
  outputDir: OUT_DIR,
};

try {
  serverHandle = await ensureServer();
  report.baseUrl = serverHandle.baseUrl;
  report.serverSource = serverHandle.source;
  if (serverHandle.startupLog?.length) {
    report.serverStartupLog = serverHandle.startupLog;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    report.scenarios = [];
    for (const scenario of scenarios) {
      const result = await runScenario(browser, serverHandle.baseUrl, scenario);
      report.scenarios.push(result);
    }
  } finally {
    await browser.close();
  }

  report.ok = true;
  writeFileSync(
    resolve(OUT_DIR, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.message : String(error);
  writeFileSync(
    resolve(OUT_DIR, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  if (serverHandle?.child) {
    try {
      serverHandle.child.kill("SIGTERM");
    } catch {
      // ignore cleanup failure
    }
  }
}
