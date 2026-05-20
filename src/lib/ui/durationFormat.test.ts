import { describe, expect, it } from "vitest";
import { formatDurationRu, formatRoughDurationRu } from "./durationFormat";

describe("duration formatting", () => {
  it("carries rounded 60 seconds into the next minute for exact ETA", () => {
    expect(formatDurationRu(59_600)).toBe("1 мин");
    expect(formatDurationRu(119_600)).toBe("2 мин");
  });

  it("carries rounded 60 seconds into the next minute for rough ETA", () => {
    expect(formatRoughDurationRu(20 * 60_000 + 59_600)).toBe("21 мин");
  });

  it("keeps ordinary minute remainders readable", () => {
    expect(formatDurationRu(82_400)).toBe("1 мин 22 с");
    expect(formatRoughDurationRu(82_400)).toBe("1 мин 20 с");
  });
});
