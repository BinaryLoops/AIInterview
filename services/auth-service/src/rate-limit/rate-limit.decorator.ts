import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key used by the RateLimit guard.
 */
export const RATE_LIMIT_METADATA = 'rate_limit_options';

/**
 * Options for a rate‑limit policy.
 */
export interface RateLimitOptions {
  /** Maximum number of requests allowed within the time window */
  limit: number;
  /** Time window in seconds */
  ttl: number;
}

/**
 * Decorator to attach a rate‑limit policy to a route handler.
 *
 * Example:
 *   @RateLimit({ limit: 5, ttl: 60 })
 */
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_METADATA, options);
