import { describe, expect, it } from "vitest";
import { tierPlacesLabel } from "./tierPlaces";

describe("tierPlacesLabel", () => {
  it("prints a single place or a range of places", () => {
    expect(tierPlacesLabel({ posLo: 19, posHi: 19 }, "varies")).toBe("19");
    expect(tierPlacesLabel({ posLo: 10, posHi: 18 }, "varies")).toBe("10–18");
  });

  it("says the places depend on the field instead of printing another field's range", () => {
    expect(tierPlacesLabel({ posLo: 28, posHi: 28, placesVary: true }, "varies")).toBe("varies");
  });
});
