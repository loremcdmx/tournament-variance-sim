import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SimulationResult } from "@/lib/sim/types";

// The provider renders Russian on the server; the hooks are swapped to read
// either locale from the dictionary.
const ui = vi.hoisted(() => ({ locale: "en" as "en" | "ru" }));
vi.mock("@/lib/i18n/LocaleProvider", async () => {
  const { DICT } = await import("@/lib/i18n/dict");
  return {
    useLocale: () => ({ locale: ui.locale }),
    useT: () => (key: keyof typeof DICT) => DICT[key][ui.locale],
  };
});

import { CalibrationNotices } from "./PrimedopeDiagnostics";

describe("a ranged row's calibration notice", () => {
  const result = {
    calibrationWarnings: [{
      rowId: "r", kind: "target-unreachable", targetWinnings: 14.3, actualWinnings: 12.978, fieldSize: 1500,
    }],
  } as SimulationResult;

  it("groups the field size the way the interface prints numbers", () => {
    ui.locale = "en";
    expect(renderToStaticMarkup(<CalibrationNotices result={result} />))
      .toContain("The biggest miss is at a field of 1,500: requested $14.30, modeled $12.98");
    ui.locale = "ru";
    expect(renderToStaticMarkup(<CalibrationNotices result={result} />))
      .toContain("Наибольший промах — при размере поля 1 500: запрошено $14,30, смоделировано $12,98");
  });
});
