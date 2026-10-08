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
