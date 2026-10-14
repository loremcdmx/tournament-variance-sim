import { describe, expect, it } from "vitest";

import { plural, WORDS } from "./plural";

describe("plural: loaded empirical records", () => {
  it.each([
    [1, "запись"],
    [3, "записи"],
    [9, "записей"],
    [11, "записей"],
    [21, "запись"],
    [24, "записи"],
  ])("ru %i → %s", (n, word) => {
    expect(plural("ru", n, WORDS.record)).toBe(word);
  });

  it.each([
    [1, "entry"],
    [3, "entries"],
  ])("en %i → %s", (n, word) => {
    expect(plural("en", n, WORDS.record)).toBe(word);
  });
});
