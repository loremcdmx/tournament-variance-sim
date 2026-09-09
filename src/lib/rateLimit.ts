export interface RateLimitDecision {
  allowed: boolean;
  /** Whole seconds until the next token; only meaningful when `allowed` is false. */
  retryAfterSec: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Per-key token bucket held in process memory. Vercel functions are
 * short-lived, so this is a soft brake against a click-happy tab, not a
 * security boundary — resulthub does its own throttling upstream.
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly refillPerMs: number;

  constructor(
    private readonly capacity: number,
    refillPerMinute: number,
    private readonly maxKeys = 10_000,
  ) {
    this.refillPerMs = refillPerMinute / 60_000;
  }

  take(key: string, now: number): RateLimitDecision {
    const bucket = this.buckets.get(key) ?? {
      tokens: this.capacity,
      updatedAt: now,
    };
    const elapsed = Math.max(0, now - bucket.updatedAt);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
    bucket.updatedAt = now;
    // Map insertion order tracks least-recently-used keys. Enforce the cap
    // on successful requests too: a fresh client always starts allowed.
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    this.pruneIfCrowded(now);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterSec: 0 };
    }
    const waitMs = (1 - bucket.tokens) / this.refillPerMs;
    this.pruneIfCrowded(now);
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)) };
  }

  private pruneIfCrowded(now: number): void {
    if (this.buckets.size <= this.maxKeys) return;
    const fullRefillMs = this.capacity / this.refillPerMs;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt >= fullRefillMs) this.buckets.delete(key);
    }
    while (this.buckets.size > Math.max(1, this.maxKeys)) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}
