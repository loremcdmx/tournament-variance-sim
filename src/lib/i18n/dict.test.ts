import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DICT, LOCALES } from "./dict";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("i18n dict", () => {
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
