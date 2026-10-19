import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DICT, LOCALES } from "./dict";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("i18n dict", () => {
  it("uses tournament terminology instead of paid-entry labels in the UI", () => {
    for (const [key, entry] of Object.entries(DICT)) {
      expect(entry.ru, `${key}.ru`).not.toMatch(/платн[а-яё]*\s+вход[а-яё]*/iu);
      expect(entry.en, `${key}.en`).not.toMatch(/\bpaid[\s-]+entr(?:y|ies)\b/i);
    }
  });

  it.each(["chart.longestCashless.tip", "chart.recovery.tip"] as const)(
    "keeps the English statistical explanation in English: %s", (key) => {
      expect(DICT[key].en).not.toMatch(/[А-Яа-яЁё]/);
      expect(DICT[key].ru).toMatch(/[А-Яа-яЁё]/);
    },
  );

  it.each(["step", "linear", "tilt"] as const)(
    "does not present the spliced Mystery finish shape (%s) as real Mystery data", (variant) => {
      for (const key of [
        `model.mystery-realdata-${variant}`,
        `finishModel.mystery-realdata-${variant}`,
      ] as const) {
        expect(DICT[key].en, key).not.toMatch(/real[s-]?data/i);
        expect(DICT[key].ru, key).not.toMatch(/реал/i);
        expect(DICT[key].en, key).toMatch(/PKO.*(freeze|freezeout)/i);
        expect(DICT[key].ru, key).toMatch(/склейк.*PKO.*(фриз|фризаут)/i);
      }
    },
  );

  it("describes the empty Empirical model as the uniform fallback the engine uses", () => {
    expect(DICT["emp.none"].en).toMatch(/uniform/i);
    expect(DICT["emp.none"].en).not.toMatch(/power-?law/i);
    expect(DICT["emp.none"].ru).toMatch(/равномерн/i);
    expect(DICT["emp.none"].ru).not.toMatch(/power-?law/i);
  });

  it("leaves no printf placeholder in any string", () => {
    const hits: string[] = [];
    for (const [key, entry] of Object.entries(DICT)) {
      for (const loc of LOCALES) {
        if (/%(?:\d+\$)?[sdif]\b/.test((entry as Record<string, string>)[loc])) hits.push(`${key}.${loc}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("ends the infeasible-shape hint without a dangling percent sign", () => {
    expect(DICT["shape.infeasible"].en).not.toMatch(/%/);
    expect(DICT["shape.infeasible"].ru).not.toMatch(/%/);
  });

  it("names no count N that no code fills in: the best and worst real run tooltips", () => {
    for (const key of ["chart.traj.likelihood.bestReal", "chart.traj.likelihood.worstReal"] as const) {
      expect(DICT[key].en, `${key}.en`).not.toMatch(/\bN\b/);
      expect(DICT[key].ru, `${key}.ru`).not.toMatch(/\bN\b/);
      expect(DICT[key].en, `${key}.en`).toMatch(/all the simulated runs/);
    }
  });

  it("quotes the BR leaderboard tournaments field by the label it has in each language", () => {
    const label = DICT["controls.brLeaderboard.tournaments"];
    const hint = DICT["controls.brLeaderboard.observedUsernameHint"];
    expect(hint.en).toContain(`“${label.en}”`);
    expect(hint.ru).toContain(`«${label.ru}»`);
  });

  it("says the Uniform and Empirical models do not apply the row ROI, and are not PrimeDope's model", () => {
    const help = DICT["help.finishModel"];
    const uniformLine = (text: string) => text.split("\n").find((l) => /Uniform/.test(l)) ?? "";
    expect(uniformLine(help.en)).toMatch(/ROI is not applied/i);
    expect(uniformLine(help.ru)).toMatch(/ROI не применяется/);
    expect(uniformLine(help.en)).not.toMatch(/PrimeDope/i);
    expect(uniformLine(help.ru)).not.toMatch(/PrimeDope/i);
    expect(uniformLine(help.en)).not.toMatch(/same lift/i);
    expect(DICT["emp.none"].en).toMatch(/ROI target is not applied/i);
    expect(DICT["emp.none"].ru).toMatch(/цель по ROI не применяется/i);
  });

  it("does not claim a positive leaderboard shift leaves drawdown unchanged", () => {
    const title = DICT["chart.lbCashflow.title"];
    expect(title.en).not.toMatch(/doesn't change drawdown|monotone/i);
    expect(title.ru).not.toMatch(/не меняет просад|монотонн/i);
    expect(title.en).toMatch(/shallower/i);
    expect(title.ru).toMatch(/мельче/i);
  });

  it("says slow tilt is switched off, not triggered by any drawdown, when its threshold or duration is dead", () => {
    for (const key of ["sanity.tilt-slow-no-threshold", "sanity.tilt-slow-no-min-duration"] as const) {
      expect(DICT[key].en, key).not.toMatch(/any non-zero drawdown/i);
      expect(DICT[key].en, key).toMatch(/switched off/i);
      expect(DICT[key].ru, key).not.toMatch(/любой ненулевой просадке/i);
      expect(DICT[key].ru, key).toMatch(/выключен/i);
    }
  });

  it("says only the EV preview averages a field-size range; the payout ladder shows the midpoint", () => {
    // PayoutStructureCard reads derivePreviewRowEconomics at the range midpoint;
    // only the single-tournament EV preview mixes the sizes (previewFieldMixture).
    const hint = DICT["row.fieldHint"];
    const sentences = (text: string) => text.split(/(?<=[.!?])\s+/u);
    const checks = [
      { text: hint.en, mean: /\bmean\b/i, payout: /payout/i, midpoint: /midpoint/i, preview: /preview/i },
      { text: hint.ru, mean: /средн/i, payout: /выплат/i, midpoint: /середин/i, preview: /превью/i },
    ];
    for (const { text, mean, payout, midpoint, preview } of checks) {
      const averaging = sentences(text).filter((s) => mean.test(s));
      expect(averaging.length, text).toBe(1);
      expect(averaging[0], text).toMatch(preview);
      expect(averaging[0], text).not.toMatch(payout);
      const midpointSentence = sentences(text).find((s) => midpoint.test(s));
      expect(midpointSentence, text).toMatch(payout);
    }
  });

  it("says the run link keeps the run's seed instead of drawing a fresh one", () => {
    const hint = DICT["runExport.copyLink.hint"];
    expect(hint.en).not.toMatch(/fresh seed/i);
    expect(hint.en).toMatch(/\bseed\b/i);
    expect(hint.ru).not.toMatch(/свеж/i);
    expect(hint.ru).toMatch(/сид/i);
  });

  it("every entry covers every locale with a non-empty string", () => {
    for (const [key, entry] of Object.entries(DICT)) {
      for (const loc of LOCALES) {
        const val = (entry as Record<string, string>)[loc];
        expect(typeof val, `${key}.${loc}`).toBe("string");
        expect(val.length, `${key}.${loc} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("has no duplicate top-level keys in source (TS object-literal dedup hides them)", () => {
    // TS' object-literal dedup + the `as const satisfies` wrapper silently
    // collapse duplicate keys to the last one — the type checker won't
    // catch them once both keys exist on the Entry shape. So we scan the
    // source file textually and flag any repeated `"group.key":` header.
    const src = readFileSync(join(HERE, "dict.ts"), "utf8");
    const re = /^\s{2}"([^"]+)":\s*\{/gm;
    const seen = new Map<string, number>();
    const dups: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const key = m[1];
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n === 2) dups.push(key);
    }
    expect(dups, `duplicate dict keys: ${dups.join(", ")}`).toEqual([]);
    expect(seen.size).toBe(Object.keys(DICT).length);
  });
});
