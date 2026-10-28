interface Bucket {
  tokens: number;
  updatedAtMs: number;
}

/**
 * Simple in-memory token-bucket rate limiter (per process).
 * Suitable for a single VPS instance; not shared across replicas.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxTokens: number,
    private readonly refillPerSec: number
  ) {}

  /** Returns true if the request is allowed. */
  take(key: string, cost = 1): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.maxTokens, updatedAtMs: now };
      this.buckets.set(key, bucket);
    }

    const elapsedSec = (now - bucket.updatedAtMs) / 1000;
    bucket.tokens = Math.min(
      this.maxTokens,
      bucket.tokens + elapsedSec * this.refillPerSec
    );
    bucket.updatedAtMs = now;

    if (bucket.tokens < cost) return false;
    bucket.tokens -= cost;
    return true;
  }
}
