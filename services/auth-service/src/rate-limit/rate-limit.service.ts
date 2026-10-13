import { Injectable, Logger } from '@nestjs/common';
import { AuthConfigService } from '../config/auth-config.service.js';
import { RedisService } from '../database/redis.service.js';
import type { RateLimitOptions } from './rate-limit.decorator.js';

/**
 * In-memory fallback entry tracking request counts with explicit expiration timestamp.
 */
interface MemoryEntry {
  count: number;
  expiresAt: number; // epoch ms
}

/**
 * RateLimitService manages rate limiting backed by Redis with a bounded, self-pruning
 * in-memory fallback store when Redis is unavailable.
 *
 * ## Security Properties:
 * 1. Atomic Counter & Expiry: Evaluates Redis increment and TTL expiration atomically via Lua,
 *    preventing immortal unexpired counters in failure scenarios.
 * 2. Memory Exhaustion Defense: In-memory fallback enforces a hard cap of 10,000 entries and sweeps
 *    expired records before eviction (FIFO on excess), eliminating heap exhaustion / OOM risks.
 * 3. Fail-Safe Abuse Protection: When Redis is temporarily unavailable, the service safely falls
 *    back to the bounded local store instead of failing open and dropping rate protection.
 * 4. Separate Failure Tracking: Provides dedicated `isExceeded`, `recordFailure`, and `reset`
 *    methods so that successful logins do not penalize users while brute-force attacks are constrained.
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  static readonly MAX_MEMORY_ENTRIES = 10_000;
  private readonly memoryStore = new Map<string, MemoryEntry>();

  constructor(
    private readonly configService: AuthConfigService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Evaluates and increments the counter under `key`.
   * Returns `true` if within `options.limit`, or `false` when exceeded.
   */
  async isAllowed(key: string, options: RateLimitOptions): Promise<boolean> {
    if (this.configService.snapshot.redis.enabled) {
      const client = this.redisService.getClient();
      if (!client) {
        this.logger.warn('Redis enabled but client not available – falling back to in-memory store');
        return this.checkMemory(key, options);
      }
      try {
        let count: number;
        if (typeof client.eval === 'function') {
          // Atomic INCR + EXPIRE Lua script to guarantee TTL attachment
          const luaScript = `local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current`;
          try {
            const res = await client.eval(luaScript, {
              keys: [key],
              arguments: [options.ttl.toString()],
            });
            count = Number(res);
          } catch {
            // Backward-compatible fallback for mock clients supporting positional arguments
            const res = await (client as any).eval(luaScript, 1, key, options.ttl.toString());
            count = Number(res);
          }
        } else {
          count = await client.incr(key);
          if (count === 1) {
            await client.expire(key, options.ttl);
          }
        }
        return count <= options.limit;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Redis rate-limit error: ${msg} – falling back to memory store`);
        return this.checkMemory(key, options);
      }
    }
    // Redis disabled – use process-local bounded memory store
    return this.checkMemory(key, options);
  }

  /**
   * Checks whether the current count under `key` has already reached or exceeded `limit`
   * WITHOUT incrementing the counter.
   */
  async isExceeded(key: string, limit: number): Promise<boolean> {
    if (this.configService.snapshot.redis.enabled) {
      const client = this.redisService.getClient();
      if (client) {
        try {
          const val = await client.get(key);
          if (val !== null && val !== undefined) {
            return Number(val) >= limit;
          }
          return false;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Redis isExceeded error: ${msg} – checking memory store fallback`);
        }
      }
    }
    const entry = this.memoryStore.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.memoryStore.delete(key);
      return false;
    }
    return entry.count >= limit;
  }

  /**
   * Records an explicit failure (e.g. wrong password) by incrementing the failure key.
   */
  async recordFailure(key: string, options: RateLimitOptions): Promise<void> {
    await this.isAllowed(key, options);
  }

  /**
   * Resets / removes the counter under `key` (e.g. on successful credential verification).
   */
  async reset(key: string): Promise<void> {
    if (this.configService.snapshot.redis.enabled) {
      const client = this.redisService.getClient();
      if (client) {
        try {
          await client.del(key);
        } catch { /* best effort */ }
      }
    }
    this.memoryStore.delete(key);
  }

  /**
   * Clears all in-memory rate-limit entries (useful for test resets).
   */
  clearMemory(): void {
    this.memoryStore.clear();
  }

  /**
   * Safely prunes expired entries from in-memory store and enforces MAX_MEMORY_ENTRIES cap.
   */
  private pruneMemory(now: number): void {
    for (const [k, v] of this.memoryStore.entries()) {
      if (v.expiresAt <= now) {
        this.memoryStore.delete(k);
      }
    }
    if (this.memoryStore.size >= RateLimitService.MAX_MEMORY_ENTRIES) {
      const excess = this.memoryStore.size - RateLimitService.MAX_MEMORY_ENTRIES + 1;
      let count = 0;
      for (const k of this.memoryStore.keys()) {
        if (count >= excess) break;
        this.memoryStore.delete(k);
        count++;
      }
    }
  }

  /**
   * Evaluates request against in-memory bounded store.
   */
  private checkMemory(key: string, options: RateLimitOptions): boolean {
    const now = Date.now();
    const entry = this.memoryStore.get(key);
    if (!entry || entry.expiresAt <= now) {
      this.pruneMemory(now);
      this.memoryStore.set(key, { count: 1, expiresAt: now + options.ttl * 1000 });
      return true;
    }
    if (entry.count < options.limit) {
      entry.count += 1;
      return true;
    }
    return false;
  }
}
