import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitService } from './rate-limit.service.js';
import { AuthConfigService } from '../config/auth-config.service.js';
import { RedisService } from '../database/redis.service.js';

describe('RateLimitService', () => {
  let service: RateLimitService;
  let mockConfigService: any;
  let mockRedisService: any;
  let mockRedisClient: any;

  beforeEach(() => {
    mockRedisClient = {
      eval: vi.fn(),
      incr: vi.fn(),
      expire: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
    };

    mockRedisService = {
      getClient: vi.fn().mockReturnValue(mockRedisClient),
    };

    mockConfigService = {
      snapshot: {
        redis: {
          enabled: false,
        },
      },
    };

    service = new RateLimitService(mockConfigService as AuthConfigService, mockRedisService as RedisService);
  });

  describe('In-Memory Fallback Store', () => {
    it('allows requests within limit and enforces TTL reset', async () => {
      const key = 'test:inmem:1';
      const options = { limit: 2, ttl: 1 };

      expect(await service.isAllowed(key, options)).toBe(true);
      expect(await service.isAllowed(key, options)).toBe(true);
      expect(await service.isAllowed(key, options)).toBe(false);

      // Fast-forward past TTL by manipulating Date.now
      const originalNow = Date.now;
      try {
        Date.now = vi.fn().mockReturnValue(originalNow() + 2000);
        expect(await service.isAllowed(key, options)).toBe(true);
      } finally {
        Date.now = originalNow;
      }
    });

    it('bounds memory usage and cleans up expired entries', async () => {
      // Fill store with expired entries
      const originalNow = Date.now;
      try {
        Date.now = vi.fn().mockReturnValue(1000);

        for (let i = 0; i < 50; i++) {
          await service.isAllowed(`key:${i}`, { limit: 1, ttl: 1 });
        }

        // Advance time past TTL
        Date.now = vi.fn().mockReturnValue(5000);

        // Next request triggers pruneMemory
        await service.isAllowed('new:key', { limit: 1, ttl: 10 });

        // Older expired entries should be swept
        expect(await service.isExceeded('key:0', 1)).toBe(false);
      } finally {
        Date.now = originalNow;
      }
    });

    it('evaluates isExceeded without incrementing the counter', async () => {
      const key = 'test:isExceeded';
      const limit = 3;

      expect(await service.isExceeded(key, limit)).toBe(false);

      await service.recordFailure(key, { limit, ttl: 60 });
      await service.recordFailure(key, { limit, ttl: 60 });
      expect(await service.isExceeded(key, limit)).toBe(false);

      await service.recordFailure(key, { limit, ttl: 60 });
      expect(await service.isExceeded(key, limit)).toBe(true);
    });

    it('resets the counter under key upon success', async () => {
      const key = 'test:reset';
      const limit = 2;

      await service.recordFailure(key, { limit, ttl: 60 });
      await service.recordFailure(key, { limit, ttl: 60 });
      expect(await service.isExceeded(key, limit)).toBe(true);

      await service.reset(key);
      expect(await service.isExceeded(key, limit)).toBe(false);
    });
  });

  describe('Redis-Backed Rate Limiter', () => {
    beforeEach(() => {
      mockConfigService.snapshot.redis.enabled = true;
    });

    it('executes atomic Lua script with keys and TTL arguments', async () => {
      mockRedisClient.eval.mockResolvedValue(1);

      const key = 'rl:ip:127.0.0.1';
      const allowed = await service.isAllowed(key, { limit: 5, ttl: 60 });

      expect(allowed).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call(\'INCR\', KEYS[1])'),
        {
          keys: [key],
          arguments: ['60'],
        },
      );
    });

    it('returns false when Redis atomic counter exceeds limit', async () => {
      mockRedisClient.eval.mockResolvedValue(6);

      const key = 'rl:ip:127.0.0.1';
      const allowed = await service.isAllowed(key, { limit: 5, ttl: 60 });

      expect(allowed).toBe(false);
    });

    it('fails safe to in-memory store when Redis throws error', async () => {
      mockRedisClient.eval.mockRejectedValue(new Error('Redis connection refused'));

      const key = 'rl:ip:fallback';
      // First hit succeeds via in-memory fallback
      expect(await service.isAllowed(key, { limit: 1, ttl: 60 })).toBe(true);
      // Second hit exceeds in-memory limit (fail-safe protection preserved!)
      expect(await service.isAllowed(key, { limit: 1, ttl: 60 })).toBe(false);
    });

    it('checks Redis isExceeded and resets key cleanly', async () => {
      mockRedisClient.get.mockResolvedValue('5');

      const isExceeded = await service.isExceeded('login:acct:hash123', 5);
      expect(isExceeded).toBe(true);

      await service.reset('login:acct:hash123');
      expect(mockRedisClient.del).toHaveBeenCalledWith('login:acct:hash123');
    });
  });
});
