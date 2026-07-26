import { describe, expect, it } from "vitest";
import { formatDuration, formatRoughDuration } from "./durationFormat";

describe("duration formatting", () => {
  it("carries rounded 60 seconds into the next minute for exact ETA", () => {
    expect(formatDuration(59_600, "ru")).toBe("1 мин");
    expect(formatDuration(119_600, "ru")).toBe("2 мин");
  });

  it("carries rounded 60 seconds into the next minute for rough ETA", () => {
    expect(formatRoughDuration(20 * 60_000 + 59_600, "ru")).toBe("21 мин");
  });

  it("keeps ordinary minute remainders readable", () => {
    expect(formatDuration(82_400, "ru")).toBe("1 мин 22 с");
    expect(formatRoughDuration(82_400, "ru")).toBe("1 мин 20 с");
  });
});
