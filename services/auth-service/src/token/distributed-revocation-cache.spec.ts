import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { TokenService } from './token.service.js';
import { SessionService } from '../session/session.service.js';
import { AuthConfigService } from '../config/auth-config.service.js';
import { RoleName } from '../authorization/roles.js';

describe('Distributed Token Revocation and Cache Consistency Audit', () => {
  const validSecret = 'test_secret_for_unit_tests_at_least_32_chars!';
  const validIssuer = 'arep-auth-service-test';
  const validAudience = 'arep-api-test';
  const validTtl = 900;

  let mockConfigService: any;
  let mockPrismaService: any;

  // Shared in-memory Redis store simulating a real distributed Redis cluster across instances
  class MockRedisStore {
    public data = new Map<string, string>();
    public failAllOperations = false;
    public failKeys = new Set<string>();

    getClient() {
      return {
        get: vi.fn(async (key: string) => {
          if (this.failAllOperations || this.failKeys.has(key)) {
            throw new Error('Redis connection failure on GET');
          }
          return this.data.get(key) ?? null;
        }),
        set: vi.fn(async (key: string, value: string) => {
          if (this.failAllOperations || this.failKeys.has(key)) {
            throw new Error('Redis connection failure on SET');
          }
          this.data.set(key, value);
          return 'OK';
        }),
        del: vi.fn(async (key: string) => {
          if (this.failAllOperations || this.failKeys.has(key)) {
            throw new Error('Redis connection failure on DEL');
          }
          this.data.delete(key);
          return 1;
        }),
        mGet: vi.fn(async (keys: string[]) => {
          if (this.failAllOperations) {
            throw new Error('Redis connection failure on MGET');
          }
          return keys.map((k) => (this.failKeys.has(k) ? null : this.data.get(k) ?? null));
        }),
      };
    }
  }

  let sharedRedis: MockRedisStore;

  beforeEach(() => {
    sharedRedis = new MockRedisStore();

    mockConfigService = {
      jwt: {
        secret: validSecret,
        issuer: validIssuer,
        audience: validAudience,
        expiresInSeconds: validTtl,
      },
      session: {
        refreshTokenTtlDays: 7,
      },
      snapshot: {
        redis: {
          enabled: true,
          host: '127.0.0.1',
          port: 6379,
        },
      },
    };

    mockPrismaService = {
      user: {
        findUnique: vi.fn(),
      },
      authSession: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      securityEvent: {
        create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      },
      $transaction: vi.fn(async (arg: any) => {
        if (typeof arg === 'function') {
          return arg(mockPrismaService);
        }
        return Promise.all(arg);
      }),
    };
  });

  // ===========================================================================
  // 1. Redis Lookup Failures (Fail-Closed Enforcement)
  // ===========================================================================
  describe('1. Redis Lookup Failures & Fail-Closed Enforcement', () => {
    it('fails closed (throws 503 ServiceUnavailableException) when Redis mGet fails during revocation check for an un-cached token', async () => {
      sharedRedis.failAllOperations = true;

      const redisService = { getClient: () => sharedRedis.getClient() };
      const tokenService = new TokenService(
        mockConfigService as AuthConfigService,
        redisService as any,
        mockPrismaService,
      );

      const userId = 'un-cached-user-1';
      const sessionId = 'un-cached-sess-1';
      const issuedAt = Math.floor(Date.now() / 1000);

      // Must fail closed with 503 instead of silently returning false (failing open)
      await expect(tokenService.isTokenRevoked(userId, sessionId, issuedAt)).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(tokenService.isTokenRevoked(userId, sessionId, issuedAt)).rejects.toThrow(
        /Authentication revocation registry is unavailable/i,
      );
    });

    it('fails closed when Redis client is disconnected/null while redis.enabled is true', async () => {
      const redisService = { getClient: () => null };
      const tokenService = new TokenService(
        mockConfigService as AuthConfigService,
        redisService as any,
        mockPrismaService,
      );

      const userId = 'user-null-redis';
      const sessionId = 'sess-null-redis';
      const issuedAt = Math.floor(Date.now() / 1000);

      await expect(tokenService.isTokenRevoked(userId, sessionId, issuedAt)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('immediately honors process-local revocation without hitting Redis even if Redis is failing', async () => {
      sharedRedis.failAllOperations = true;

      const redisService = { getClient: () => sharedRedis.getClient() };
      const tokenService = new TokenService(
        mockConfigService as AuthConfigService,
        redisService as any,
        mockPrismaService,
      );

      const userId = 'local-revoked-user';
      const nowSec = Math.floor(Date.now() / 1000);

      // Force into local memory store directly (simulating pre-existing local revocation)
      (tokenService as any).localRevokedUsers.set(userId, nowSec);

      // Local fast-path returns true immediately (0ms) without contacting failing Redis
      const isRevoked = await tokenService.isTokenRevoked(userId, 'sess-any', nowSec - 5);
      expect(isRevoked).toBe(true);
    });
  });

  // ===========================================================================
  // 2. Redis Invalidation & Write Failures
  // ===========================================================================
  describe('2. Redis Invalidation & Write Failures', () => {
    it('throws ServiceUnavailableException when Redis write fails during revokeUserTokens', async () => {
      sharedRedis.failAllOperations = true;

      const redisService = { getClient: () => sharedRedis.getClient() };
      const tokenService = new TokenService(
        mockConfigService as AuthConfigService,
        redisService as any,
        mockPrismaService,
      );

      await expect(tokenService.revokeUserTokens('user-1', 'suspension')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException when Redis write fails during revokeSessionToken', async () => {
      sharedRedis.failAllOperations = true;

      const redisService = { getClient: () => sharedRedis.getClient() };
      const tokenService = new TokenService(
        mockConfigService as AuthConfigService,
        redisService as any,
        mockPrismaService,
      );

      await expect(tokenService.revokeSessionToken('sess-1', 'logout')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException when Redis delete fails during invalidateAccountState', async () => {
      sharedRedis.failAllOperations = true;

      const redisService = { getClient: () => sharedRedis.getClient() };
      const tokenService = new TokenService(
        mockConfigService as AuthConfigService,
        redisService as any,
        mockPrismaService,
      );

      await expect(tokenService.invalidateAccountState('user-1')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  // ===========================================================================
  // 3. Stale Account-State Caches Across Two Service Instances
  // ===========================================================================
  describe('3. Stale Account-State Caches Across Instances', () => {
    it('ensures Instance B immediately observes account state invalidation performed by Instance A', async () => {
      const redisService = { getClient: () => sharedRedis.getClient() };

      const instanceA = new TokenService(
        mockConfigService as AuthConfigService,
        redisService as any,
        mockPrismaService,
      );
      const instanceB = new TokenService(
        mockConfigService as AuthConfigService,
        redisService as any,
        mockPrismaService,
      );

      const userId = 'user-cache-consistency-1';

      // 1. Initial database query returns ACTIVE CANDIDATE
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        accountStatus: AccountStatus.ACTIVE,
        userRoles: [{ role: { name: 'CANDIDATE' } }],
      });

      // Instance A queries account state and populates Redis
      const stateA = await instanceA.getAccountState(userId);
      expect(stateA.status).toBe(AccountStatus.ACTIVE);
      expect(stateA.roles).toEqual([RoleName.CANDIDATE]);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledTimes(1);

      // Instance B reads from Redis shared cache (0 DB queries)
      const stateB1 = await instanceB.getAccountState(userId);
      expect(stateB1.status).toBe(AccountStatus.ACTIVE);
      expect(stateB1.roles).toEqual([RoleName.CANDIDATE]);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledTimes(1);

      // 2. User is suspended on Instance A
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        accountStatus: AccountStatus.SUSPENDED,
        userRoles: [{ role: { name: 'CANDIDATE' } }],
      });

      await instanceA.invalidateAccountState(userId);
      expect(sharedRedis.data.has(`auth:account_state:${userId}`)).toBe(false);

      // 3. Instance B queries account state: observes eviction in Redis and reloads fresh DB state
      const stateB2 = await instanceB.getAccountState(userId);
      expect(stateB2.status).toBe(AccountStatus.SUSPENDED);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================================================
  // 4. Revocation Key Expiry
  // ===========================================================================
  describe('4. Revocation Key Expiry Invariant', () => {
    it('rejects expired tokens cryptographically with 401 even after Redis revocation key has expired and been removed', async () => {
      const redisService = { getClient: () => sharedRedis.getClient() };
      const tokenService = new TokenService(
        mockConfigService as AuthConfigService,
        redisService as any,
        mockPrismaService,
      );

      const userId = 'user-key-expired';
      const pastSeconds = Math.floor(Date.now() / 1000) - 1000; // Issued 1000s ago

      // Generate a token with issued-at and expired timestamps in the past
      const { SignJWT } = await import('jose');
      const key = new TextEncoder().encode(validSecret);
      const expiredToken = await new SignJWT({
        email: 'user@example.com',
        roles: [RoleName.CANDIDATE],
        sid: 'sess-old',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(userId)
        .setIssuer(validIssuer)
        .setAudience(validAudience)
        .setIssuedAt(pastSeconds)
        .setExpirationTime(pastSeconds + validTtl) // Expired 100s ago
        .sign(key);

      // Confirm Redis does NOT contain any revocation key for this user (it expired after 900s)
      expect(sharedRedis.data.has(`auth:revoked:user:${userId}`)).toBe(false);

      // Token verification fails cryptographically before revocation lookup is ever reached
      await expect(tokenService.verifyAccessToken(expiredToken)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(tokenService.verifyAccessToken(expiredToken)).rejects.toThrow(
        /Access token has expired/i,
      );
    });
  });

  // ===========================================================================
  // 5. Two Service Instances with Independent Memory Caches
  // ===========================================================================
  describe('5. Two Service Instances with Independent Memory Caches', () => {
    it('rejects a token on Instance B immediately after it was revoked on Instance A', async () => {
      const redisService = { getClient: () => sharedRedis.getClient() };

      const instanceA = new TokenService(
        mockConfigService as AuthConfigService,
        redisService as any,
        mockPrismaService,
      );
      const instanceB = new TokenService(
        mockConfigService as AuthConfigService,
        redisService as any,
        mockPrismaService,
      );

      const userId = 'user-cross-instance-1';
      const sessionId = 'sess-cross-instance-1';

      // 1. Issue token on Instance A
      const tokenResult = await instanceA.generateAccessToken({
        userId,
        email: 'user@example.com',
        roles: [RoleName.CANDIDATE],
        sessionId,
      });

      // 2. Token is initially valid on Instance B
      const isRevokedBefore = await instanceB.isTokenRevoked(
        userId,
        sessionId,
        tokenResult.claims.iat,
      );
      expect(isRevokedBefore).toBe(false);

      // 3. User is revoked on Instance A
      await instanceA.revokeUserTokens(userId, 'user_logout');

      // Verify Instance A's local memory has it, but Instance B's local memory does NOT
      expect((instanceA as any).localRevokedUsers.has(userId)).toBe(true);
      expect((instanceB as any).localRevokedUsers.has(userId)).toBe(false);

      // 4. Token presented to Instance B: Instance B checks Redis, discovers the revocation, and rejects it
      const isRevokedAfter = await instanceB.isTokenRevoked(
        userId,
        sessionId,
        tokenResult.claims.iat,
      );
      expect(isRevokedAfter).toBe(true);

      // Instance B has now populated its local memory with the discovered epoch
      expect((instanceB as any).localRevokedUsers.has(userId)).toBe(true);
    });
  });

  // ===========================================================================
  // 6. Same-Second Token Issuance Across Instances
  // ===========================================================================
  describe('6. Same-Second Token Issuance Across Instances', () => {
    it('guarantees that a new token issued on Instance B after revocation on Instance A in the same second has iat > revokedAt', async () => {
      const redisService = { getClient: () => sharedRedis.getClient() };

      const instanceA = new TokenService(
        mockConfigService as AuthConfigService,
        redisService as any,
        mockPrismaService,
      );
      const instanceB = new TokenService(
        mockConfigService as AuthConfigService,
        redisService as any,
        mockPrismaService,
      );

      const userId = 'user-same-second-1';
      const sessionIdOld = 'sess-old-1';
      const sessionIdNew = 'sess-new-1';

      // 1. Revoke on Instance A at current second T
      await instanceA.revokeUserTokens(userId, 'password_change');
      const redisRevokedAt = parseInt(sharedRedis.data.get(`auth:revoked:user:${userId}`)!, 10);

      // 2. In the exact same second, Instance B issues a new token (e.g. user logs in again)
      const newTokenResult = await instanceB.generateAccessToken({
        userId,
        email: 'user@example.com',
        roles: [RoleName.CANDIDATE],
        sessionId: sessionIdNew,
      });

      // The new token's iat must be strictly greater than the revocation timestamp
      expect(newTokenResult.claims.iat).toBeGreaterThan(redisRevokedAt);

      // 3. The new token is accepted as valid on BOTH Instance A and Instance B
      const isRevokedOnA = await instanceA.isTokenRevoked(
        userId,
        sessionIdNew,
        newTokenResult.claims.iat,
      );
      expect(isRevokedOnA).toBe(false);

      const isRevokedOnB = await instanceB.isTokenRevoked(
        userId,
        sessionIdNew,
        newTokenResult.claims.iat,
      );
      expect(isRevokedOnB).toBe(false);

      // 4. An old token with iat <= redisRevokedAt remains revoked on both instances
      const isOldRevokedOnA = await instanceA.isTokenRevoked(
        userId,
        sessionIdOld,
        redisRevokedAt,
      );
      expect(isOldRevokedOnA).toBe(true);

      const isOldRevokedOnB = await instanceB.isTokenRevoked(
        userId,
        sessionIdOld,
        redisRevokedAt,
      );
      expect(isOldRevokedOnB).toBe(true);
    });
  });

  // ===========================================================================
  // 7. Concurrent Refresh / Replay Detection
  // ===========================================================================
  describe('7. Concurrent Refresh / Replay Protection', () => {
    it('enforces atomic single-use: concurrent refresh winner succeeds while loser gets 401', async () => {
      const redisService = { getClient: () => sharedRedis.getClient() };
      const tokenService = new TokenService(
        mockConfigService as AuthConfigService,
        redisService as any,
        mockPrismaService,
      );

      const sessionService = new SessionService(
        mockPrismaService,
        mockConfigService as AuthConfigService,
        tokenService,
      );

      const sessionId = randomUUID();
      const secret = 'valid_secret_length_at_least_32_characters!';
      const rawRefreshToken = `${sessionId}.${secret}`;
      const tokenHash = (sessionService as any).hashToken(secret);
      const userId = 'user-concurrent-refresh';

      // Mock session found in database
      mockPrismaService.authSession.findUnique.mockResolvedValue({
        id: sessionId,
        userId,
        refreshTokenHash: tokenHash,
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      });

      // Simulate atomic CAS: first transaction update succeeds (count = 1), second sees count = 0
      let callCount = 0;
      mockPrismaService.authSession.updateMany.mockImplementation(async () => {
        callCount++;
        return { count: callCount === 1 ? 1 : 0 };
      });

      // Launch two concurrent rotateSession requests with the identical refresh token
      const [res1, res2] = await Promise.allSettled([
        sessionService.rotateSession(rawRefreshToken),
        sessionService.rotateSession(rawRefreshToken),
      ]);

      // Exactly one succeeds
      expect(res1.status === 'fulfilled' || res2.status === 'fulfilled').toBe(true);
      expect(res1.status === 'rejected' || res2.status === 'rejected').toBe(true);

      const rejectedResult = res1.status === 'rejected' ? res1 : res2;
      if (rejectedResult.status === 'rejected') {
        expect(rejectedResult.reason).toBeInstanceOf(UnauthorizedException);
        expect((rejectedResult.reason as Error).message).toMatch(
          /Concurrent refresh attempt detected/i,
        );
      }
    });

    it('triggers full compromise revocation when an already rotated/revoked token is replayed', async () => {
      const redisService = { getClient: () => sharedRedis.getClient() };
      const tokenService = new TokenService(
        mockConfigService as AuthConfigService,
        redisService as any,
        mockPrismaService,
      );

      const sessionService = new SessionService(
        mockPrismaService,
        mockConfigService as AuthConfigService,
        tokenService,
      );

      const sessionId = randomUUID();
      const secret = 'valid_secret_length_at_least_32_characters!';
      const rawRefreshToken = `${sessionId}.${secret}`;
      const tokenHash = (sessionService as any).hashToken(secret);
      const userId = 'user-replay-attack-target';

      // Mock session already revoked in database
      mockPrismaService.authSession.findUnique.mockResolvedValue({
        id: sessionId,
        userId,
        refreshTokenHash: tokenHash,
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: new Date(Date.now() - 5000), // Revoked 5 seconds ago!
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      });

      // When replaying the rotated token, rotateSession detects replay
      await expect(sessionService.rotateSession(rawRefreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(sessionService.rotateSession(rawRefreshToken)).rejects.toThrow(
        /Token reuse detected\. All sessions for this account have been revoked/i,
      );

      // Assert that all sessions in DB were revoked
      expect(mockPrismaService.authSession.updateMany).toHaveBeenCalledWith({
        where: { userId, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });

      // Assert that Redis received user-level token revocation
      expect(sharedRedis.data.has(`auth:revoked:user:${userId}`)).toBe(true);
    });
  });
});
