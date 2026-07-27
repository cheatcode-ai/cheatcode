export interface RateLimitConfig {
  capacity: number;
  refillPerSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}
