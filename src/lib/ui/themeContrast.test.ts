import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FORMAT_TAB_ACCENTS } from "@/components/charts/formatTabAccents";
import {
  DARK_PARITY,
  MIN_TEXT_CONTRAST,
  STATUS_SITES,
  contrastRatio,
  evaluateAllSites,
  parseColor,
  parsePalette,
  parseThemeTokens,
  tabSites,
} from "./themeContrast";

const ROOT = resolve(__dirname, "../../..");
const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
const palette = parsePalette(
  readFileSync(join(ROOT, "node_modules/tailwindcss/theme.css"), "utf8"),
);
const themes = parseThemeTokens(css);

function sourceFiles(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && ext.test(e.name) && !/\.test\./.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

describe("contrast math", () => {
  it("matches the WCAG reference values", () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 1, g: 1, b: 1 };
    expect(contrastRatio(black, white)).toBeCloseTo(21, 6);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 6);
    const grey = parseColor("#767676");
    expect(contrastRatio(grey, white)).toBeCloseTo(4.54, 2);
  });

  it("reads a Tailwind opacity modifier as alpha", () => {
    const c = parseColor("color-mix(in oklab, #ff0000 80%, transparent)");
    expect(c.a).toBeCloseTo(0.8, 6);
    expect(c.r).toBeCloseTo(1, 6);
  });

  it("converts the Tailwind palette the way the browser does", () => {
    const emerald500 = palette["emerald-500"];
    expect(Math.round(emerald500.r * 255)).toBe(0);
    expect(Math.round(emerald500.g * 255)).toBe(188);
    expect(Math.round(emerald500.b * 255)).toBe(125);
  });
});

describe("status tokens in globals.css", () => {
  const used = new Set<string>();
  for (const site of [...STATUS_SITES, ...tabSites()]) {
    used.add(site.fg.token);
    for (const layer of site.layers ?? []) if (layer.token) used.add(layer.token);
  }

  it("defines every token a site uses in both theme blocks", () => {
    for (const token of used) {
      expect(themes.dark[token], `dark ${token}`).toBeDefined();
      expect(themes.light[token], `light ${token}`).toBeDefined();
    }
  });

  it("keeps the dark value equal to the colour the component used before", () => {
    for (const [token, spec] of Object.entries(DARK_PARITY)) {
      const have = parseColor(themes.dark[token]);
      const before = spec.css
        ? parseColor(spec.css)
        : { ...palette[spec.shade ?? ""], a: spec.alpha ?? 1 };
      expect(before.r, `${token} is a known colour`).toBeDefined();
      expect(have.a, `${token} alpha`).toBeCloseTo(before.a, 6);
      expect(have.r, `${token} r`).toBeCloseTo(before.r, 6);
      expect(have.g, `${token} g`).toBeCloseTo(before.g, 6);
      expect(have.b, `${token} b`).toBeCloseTo(before.b, 6);
    }
  });

  it("keeps the dark format-tab text at the hex the tabs used before", () => {
    const before = {
      freeze: "#c4b5fd",
      pko: "#fb7185",
      "ocean-ko": "#2dd4bf",
      mystery: "#38bdf8",
      "mystery-royale": "#f59e0b",
      mix: "#34d399",
      exact: "#86efac",
    } as const;
    for (const [format, hex] of Object.entries(before)) {
      const token = /^var\((--[a-z0-9-]+)\)$/.exec(
        FORMAT_TAB_ACCENTS[format as keyof typeof before].text,
      )?.[1];
      expect(token, `${format} text must be a theme token`).toBeDefined();
      expect(themes.dark[token as string].toLowerCase()).toBe(hex);
    }
  });

  it("reaches 4.5:1 on every surface it is drawn on, in both themes", () => {
    const failures = evaluateAllSites(themes, palette)
      .filter((r) => r.ratio < r.min)
      .map((r) => `${r.theme} ${r.ratio.toFixed(2)} ${r.id} (${r.token}, ${r.where})`);
    expect(failures).toEqual([]);
  });

  it("holds every light-theme pair to 4.5:1 with no exemption", () => {
    const failures = evaluateAllSites(themes, palette)
      .filter((r) => r.theme === "light" && r.ratio < MIN_TEXT_CONTRAST)
      .map((r) => `${r.ratio.toFixed(2)} ${r.id} (${r.token})`);
    expect(failures).toEqual([]);
  });

  it("exempts only the PD matching-delta pill, whose dark value predates the token", () => {
    const exempt = [...STATUS_SITES, ...tabSites()]
      .filter((s) => s.minRatio !== undefined)
      .map((s) => s.id);
    expect(exempt).toEqual(["PD delta, matching"]);
  });
});

describe("components use the tokens", () => {
  const tsx = sourceFiles(join(ROOT, "src"), /\.tsx$/);
  const palettePrefix = String.raw`(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)`;

  it("has no fixed-palette text colour that the light theme cannot recolour", () => {
    const re = new RegExp(String.raw`\btext-${palettePrefix}-\d{2,3}\b`, "g");
    const hits: string[] = [];
    for (const file of tsx) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(re)) hits.push(`${file.replace(ROOT + "/", "")}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });

  it("has no literal hex text colour that the light theme cannot recolour", () => {
    const hits: string[] = [];
    for (const file of tsx) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/\btext-\[#[0-9a-fA-F]{3,8}\]/g)) {
        hits.push(`${file.replace(ROOT + "/", "")}: ${m[0]}`);
      }
    }
    const statCards = readFileSync(join(ROOT, "src/components/results/StatCards.tsx"), "utf8");
    for (const m of statCards.matchAll(/\bcolor: ?"#[0-9a-fA-F]{3,8}"/g)) {
      hits.push(`src/components/results/StatCards.tsx: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });

  it("has no dark-tuned rose panel fill that light text sits on", () => {
    const re = /\b(?:bg|from|to)-rose-9\d0\b/g;
    const hits: string[] = [];
    for (const file of tsx) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(re)) hits.push(`${file.replace(ROOT + "/", "")}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });

  it("only references --c-* tokens that both theme blocks define", () => {
    const files = [...tsx, ...sourceFiles(join(ROOT, "src"), /\.ts$/)];
    const missing: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/var\((--c-[a-z0-9-]+)\)/g)) {
        for (const theme of ["dark", "light"] as const) {
          if (themes[theme][m[1]] === undefined) {
            missing.push(`${file.replace(ROOT + "/", "")}: ${m[1]} (${theme})`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
