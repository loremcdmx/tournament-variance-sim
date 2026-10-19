import { describe, expect, it } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { sanityMessage } from "./sanityMessage";

describe("sanityMessage", () => {
  const template = DICT["sanity.row-zero-count"].en;

  it("names the row", () => {
    expect(sanityMessage(template, "Sunday")).toMatch(/^Row Sunday: count = 0/);
  });

  it.each(["$$$ Mid", "x$&y", "a$'b", "a$`b", "$1 $<name>", "{row}"])(
    "prints the label %s as typed",
    (label) => {
      expect(sanityMessage(template, label)).toMatch(
        new RegExp(`^Row ${label.replace(/[$.*+?^${}()|[\]\\]/g, "\\$&")}: count = 0`),
      );
    },
  );

  it("leaves a global finding untouched", () => {
    expect(sanityMessage("No bankroll set")).toBe("No bankroll set");
  });
});
