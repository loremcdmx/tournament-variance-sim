import { describe, expect, it } from "vitest";

import { TokenBucketLimiter } from "./rateLimit";

describe("TokenBucketLimiter", () => {
  it("allows up to capacity in a burst, then refuses with a retry hint", () => {
    const limiter = new TokenBucketLimiter(3, 60);
    expect(limiter.take("a", 0).allowed).toBe(true);
    expect(limiter.take("a", 0).allowed).toBe(true);
    expect(limiter.take("a", 0).allowed).toBe(true);
    const refused = limiter.take("a", 0);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSec).toBe(1);
  });

  it("refills over time and caps at capacity", () => {
    const limiter = new TokenBucketLimiter(2, 60);
    limiter.take("a", 0);
    limiter.take("a", 0);
    expect(limiter.take("a", 500).allowed).toBe(false);
    expect(limiter.take("a", 1000).allowed).toBe(true);
    expect(limiter.take("a", 60_000).allowed).toBe(true);
    expect(limiter.take("a", 60_000).allowed).toBe(true);
    expect(limiter.take("a", 60_000).allowed).toBe(false);
  });

  it("keeps keys independent", () => {
    const limiter = new TokenBucketLimiter(1, 60);
    expect(limiter.take("a", 0).allowed).toBe(true);
    expect(limiter.take("a", 0).allowed).toBe(false);
    expect(limiter.take("b", 0).allowed).toBe(true);
  });

  it("drops idle keys once the map grows past its cap", () => {
    const limiter = new TokenBucketLimiter(1, 60, 2);
    limiter.take("a", 0);
    limiter.take("b", 0);
    limiter.take("c", 0);
    limiter.take("c", 0);
    limiter.take("c", 5000);
    expect(limiter.take("a", 5000).allowed).toBe(true);
  });
});
