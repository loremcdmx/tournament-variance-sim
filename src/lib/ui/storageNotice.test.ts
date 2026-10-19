import { describe, expect, it } from "vitest";
import { nextStorageNotice } from "./storageNotice";

describe("nextStorageNotice", () => {
  it("raises the notice when the first write is refused", () => {
    expect(nextStorageNotice("ok", false)).toBe("failed");
    expect(nextStorageNotice("failed", false)).toBe("failed");
  });

  it("does not nag again after a dismissal while writes keep failing", () => {
    expect(nextStorageNotice("dismissed", false)).toBe("dismissed");
  });

  it("clears itself, and re-arms the next failure, once a write lands", () => {
    expect(nextStorageNotice("failed", true)).toBe("ok");
    expect(nextStorageNotice("dismissed", true)).toBe("ok");
    expect(nextStorageNotice(nextStorageNotice("dismissed", true), false)).toBe("failed");
  });
});
