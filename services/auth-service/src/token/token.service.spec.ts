import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { SignJWT } from 'jose';
import { AccountStatus } from '@prisma/client';
import { TokenService } from './token.service.js';
import { AuthConfigService } from '../config/auth-config.service.js';
import { RoleName } from '../authorization/roles.js';

describe('TokenService', () => {
  let tokenService: TokenService;
  let mockConfigService: any;
  let mockRedisService: any;
  let mockRedisClient: any;
  let mockPrismaService: any;

  const validSecret = 'test_secret_for_unit_tests_at_least_32_chars!';
  const validIssuer = 'arep-auth-service-test';
  const validAudience = 'arep-api-test';
  const validTtl = 900;

  beforeEach(() => {
    mockConfigService = {
      jwt: {
        secret: validSecret,
        issuer: validIssuer,
        audience: validAudience,
        expiresInSeconds: validTtl,
      },
      snapshot: {
        redis: {
          enabled: false,
        },
      },
    };

    mockRedisClient = {
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
      mGet: vi.fn().mockResolvedValue([null, null]),
      del: vi.fn().mockResolvedValue(1),
    };

    mockRedisService = {
      getClient: vi.fn().mockReturnValue(mockRedisClient),
    };

    mockPrismaService = {
      user: {
        findUnique: vi.fn(),
      },
    };

    tokenService = new TokenService(
      mockConfigService as AuthConfigService,
      mockRedisService,
      mockPrismaService,
    );
  });


  describe('generateAccessToken', () => {
    it('issues a signed JWT with standard claims and short-lived expiration', async () => {
      const params = {
        userId: '11111111-1111-4111-8111-111111111111',
        email: 'candidate@example.com',
        roles: [RoleName.CANDIDATE],
        sessionId: 'sess-uuid-1234',
      };

      const result = await tokenService.generateAccessToken(params);

      expect(result.token).toBeTypeOf('string');
      expect(result.token.split('.')).toHaveLength(3); // Standard compact JWT
      expect(result.tokenType).toBe('Bearer');
      expect(result.expiresIn).toBe(900);
      expect(result.claims).toMatchObject({
        sub: params.userId,
        email: params.email,
        roles: [RoleName.CANDIDATE],
        sid: params.sessionId,
        iss: validIssuer,
        aud: validAudience,
      });
      expect(result.claims.jti).toBeTypeOf('string');
      expect(result.claims.exp).toBeGreaterThan(result.claims.iat);
    });

    it('does not embed sensitive credentials in claims', async () => {
      const params = {
        userId: '11111111-1111-4111-8111-111111111111',
        email: 'candidate@example.com',
        roles: [RoleName.CANDIDATE],
        sessionId: 'sess-uuid-1234',
      };

      const result = await tokenService.generateAccessToken(params);
      const claims = result.claims as Record<string, unknown>;

      expect(claims.password).toBeUndefined();
      expect(claims.passwordHash).toBeUndefined();
      expect(claims.otp).toBeUndefined();
      expect(claims.otpCode).toBeUndefined();
      expect(claims.refreshToken).toBeUndefined();
    });
  });

  describe('verifyAccessToken', () => {
    it('verifies a valid token and extracts authenticated claims', async () => {
      const params = {
        userId: '22222222-2222-4222-8222-222222222222',
        email: 'admin@example.com',
        roles: [RoleName.ADMIN],
        sessionId: 'sess-uuid-5678',
      };

      const { token } = await tokenService.generateAccessToken(params);
      const verified = await tokenService.verifyAccessToken(token);

      expect(verified.sub).toBe(params.userId);
      expect(verified.email).toBe(params.email);
      expect(verified.roles).toEqual([RoleName.ADMIN]);
      expect(verified.sid).toBe(params.sessionId);
      expect(verified.iss).toBe(validIssuer);
      expect(verified.aud).toBe(validAudience);
    });

    it('rejects an expired access token with 401 Unauthorized', async () => {
      const key = new TextEncoder().encode(validSecret);
      // Create token expired 10 seconds ago
      const expiredToken = await new SignJWT({
        email: 'cand@example.com',
        roles: [RoleName.CANDIDATE],
        sid: 'sess-expired',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject('user-expired')
        .setIssuer(validIssuer)
        .setAudience(validAudience)
        .setIssuedAt(Math.floor(Date.now() / 1000) - 100)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
        .sign(key);

      await expect(tokenService.verifyAccessToken(expiredToken)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(tokenService.verifyAccessToken(expiredToken)).rejects.toThrow(
        'Access token has expired.',
      );
    });

    it('rejects a token signed with a different secret with 401 Unauthorized', async () => {
      const wrongKey = new TextEncoder().encode('wrong_secret_key_that_is_32_characters_long!');
      const forgedToken = await new SignJWT({
        email: 'hacker@example.com',
        roles: [RoleName.SUPER_ADMIN],
        sid: 'sess-forged',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject('user-hacker')
        .setIssuer(validIssuer)
        .setAudience(validAudience)
        .setIssuedAt()
        .setExpirationTime('900s')
        .sign(wrongKey);

      await expect(tokenService.verifyAccessToken(forgedToken)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(tokenService.verifyAccessToken(forgedToken)).rejects.toThrow(
        'Invalid access token signature.',
      );
    });

    it('rejects a token with incorrect issuer with 401 Unauthorized', async () => {
      const key = new TextEncoder().encode(validSecret);
      const wrongIssuerToken = await new SignJWT({
        email: 'user@example.com',
        roles: [RoleName.CANDIDATE],
        sid: 'sess-wrong-iss',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject('user-id')
        .setIssuer('untrusted-external-issuer')
        .setAudience(validAudience)
        .setIssuedAt()
        .setExpirationTime('900s')
        .sign(key);

      await expect(tokenService.verifyAccessToken(wrongIssuerToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token with incorrect audience with 401 Unauthorized', async () => {
      const key = new TextEncoder().encode(validSecret);
      const wrongAudToken = await new SignJWT({
        email: 'user@example.com',
        roles: [RoleName.CANDIDATE],
        sid: 'sess-wrong-aud',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject('user-id')
        .setIssuer(validIssuer)
        .setAudience('wrong-audience-api')
        .setIssuedAt()
        .setExpirationTime('900s')
        .sign(key);

      await expect(tokenService.verifyAccessToken(wrongAudToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects malformed token strings', async () => {
      await expect(tokenService.verifyAccessToken('not.a.valid.jwt')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(tokenService.verifyAccessToken('')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects token signed with unapproved algorithm (e.g. none or RS256)', async () => {
      // Create unsigned / 'none' alg token
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: 'user-1',
          email: 'user@example.com',
          roles: [RoleName.CANDIDATE],
          sid: 'sid-1',
          iss: validIssuer,
          aud: validAudience,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 900,
        }),
      ).toString('base64url');
      const noneToken = `${header}.${payload}.`;

      await expect(tokenService.verifyAccessToken(noneToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects tokens with non-canonical or empty roles in claims', async () => {
      const key = new TextEncoder().encode(validSecret);
      const invalidRolesToken = await new SignJWT({
        email: 'user@example.com',
        roles: ['HACKER_ROLE'],
        sid: 'sid-1',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject('user-id')
        .setIssuer(validIssuer)
        .setAudience(validAudience)
        .setIssuedAt()
        .setExpirationTime('900s')
        .sign(key);

      await expect(tokenService.verifyAccessToken(invalidRolesToken)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(tokenService.verifyAccessToken(invalidRolesToken)).rejects.toThrow(
        'Invalid or non-canonical roles in access token.',
      );

      const emptyRolesToken = await new SignJWT({
        email: 'user@example.com',
        roles: [],
        sid: 'sid-1',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject('user-id')
        .setIssuer(validIssuer)
        .setAudience(validAudience)
        .setIssuedAt()
        .setExpirationTime('900s')
        .sign(key);

      await expect(tokenService.verifyAccessToken(emptyRolesToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects tokens with empty or invalid subject/email/sid claims', async () => {
      const key = new TextEncoder().encode(validSecret);
      const invalidSubToken = await new SignJWT({
        email: 'user@example.com',
        roles: [RoleName.CANDIDATE],
        sid: 'sid-1',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject('   ')
        .setIssuer(validIssuer)
        .setAudience(validAudience)
        .setIssuedAt()
        .setExpirationTime('900s')
        .sign(key);

      await expect(tokenService.verifyAccessToken(invalidSubToken)).rejects.toThrow(
        'Invalid access token subject.',
      );

      const invalidEmailToken = await new SignJWT({
        email: 'not-an-email',
        roles: [RoleName.CANDIDATE],
        sid: 'sid-1',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject('user-1')
        .setIssuer(validIssuer)
        .setAudience(validAudience)
        .setIssuedAt()
        .setExpirationTime('900s')
        .sign(key);

      await expect(tokenService.verifyAccessToken(invalidEmailToken)).rejects.toThrow(
        'Invalid access token email.',
      );
    });
  });

  describe('toPrincipal', () => {
    it('maps claims to AuthenticatedPrincipal with authVerified: true', () => {
      const claims = {
        sub: 'uuid-1234',
        email: 'cand@example.com',
        roles: [RoleName.CANDIDATE],
        sid: 'sess-uuid-5678',
        jti: 'jti-1',
        iss: validIssuer,
        aud: validAudience,
        iat: 1000,
        exp: 2000,
      };

      const principal = tokenService.toPrincipal(claims);

      expect(principal).toEqual({
        id: 'uuid-1234',
        email: 'cand@example.com',
        roles: [RoleName.CANDIDATE],
        sessionId: 'sess-uuid-5678',
        authVerified: true,
      });
    });

    it('overrides principal roles when effectiveRoles is provided', () => {
      const claims = {
        sub: 'uuid-1234',
        email: 'cand@example.com',
        roles: [RoleName.ADMIN, RoleName.CANDIDATE],
        sid: 'sess-uuid-5678',
        jti: 'jti-1',
        iss: validIssuer,
        aud: validAudience,
        iat: 1000,
        exp: 2000,
      };

      const principal = tokenService.toPrincipal(claims, [RoleName.CANDIDATE]);

      expect(principal.roles).toEqual([RoleName.CANDIDATE]);
      expect(principal.roles).not.toContain(RoleName.ADMIN);
    });
  });

  describe('Revocation & Account State Tracking', () => {
    const userId = 'user-revocation-test-1';
    const sessionId = 'sess-revocation-test-1';

    describe('revokeUserTokens & isTokenRevoked', () => {
      it('revokes tokens issued before or at user revocation epoch in memory fallback', async () => {
        const issueTime = Math.floor(Date.now() / 1000);
        await tokenService.revokeUserTokens(userId, 'security_reset');

        const isRevoked = await tokenService.isTokenRevoked(userId, sessionId, issueTime);
        expect(isRevoked).toBe(true);

        // Future token issued after revocation is not revoked
        const isFutureRevoked = await tokenService.isTokenRevoked(
          userId,
          sessionId,
          issueTime + 10,
        );
        expect(isFutureRevoked).toBe(false);
      });

      it('writes to Redis when Redis is enabled', async () => {
        mockConfigService.snapshot.redis.enabled = true;

        await tokenService.revokeUserTokens(userId, 'admin_suspension');

        expect(mockRedisClient.set).toHaveBeenCalledWith(
          `auth:revoked:user:${userId}`,
          expect.any(String),
          { EX: 900 },
        );
        expect(mockRedisClient.del).toHaveBeenCalledWith(`auth:account_state:${userId}`);
      });

      it('detects user revocation from Redis when local store is cold', async () => {
        mockConfigService.snapshot.redis.enabled = true;
        const nowSec = Math.floor(Date.now() / 1000);
        mockRedisClient.mGet.mockResolvedValueOnce([String(nowSec), null]);

        const otherUserId = 'redis-user-cold';
        const isRevoked = await tokenService.isTokenRevoked(otherUserId, 'sess-cold', nowSec - 5);

        expect(isRevoked).toBe(true);
        expect(mockRedisClient.mGet).toHaveBeenCalledWith([
          `auth:revoked:user:${otherUserId}`,
          `auth:revoked:session:sess-cold`,
        ]);
      });

      it('falls back safely to in-memory store when Redis throws an error', async () => {
        mockConfigService.snapshot.redis.enabled = true;
        mockRedisClient.mGet.mockRejectedValueOnce(new Error('Redis cluster down'));

        const nowSec = Math.floor(Date.now() / 1000);
        // Revoked in local memory
        await tokenService.revokeUserTokens(userId, 'local_test');

        const isRevoked = await tokenService.isTokenRevoked(userId, sessionId, nowSec);
        expect(isRevoked).toBe(true);
      });

      it('fails closed (throws ServiceUnavailableException) when Redis throws and token is un-cached', async () => {
        mockConfigService.snapshot.redis.enabled = true;
        mockRedisClient.mGet.mockRejectedValueOnce(new Error('Redis cluster down'));

        const nowSec = Math.floor(Date.now() / 1000);
        await expect(
          tokenService.isTokenRevoked('other-user-uncached', 'other-session', nowSec),
        ).rejects.toThrow(ServiceUnavailableException);
      });
    });

    describe('revokeSessionToken', () => {
      it('revokes session-specific tokens in memory and Redis', async () => {
        mockConfigService.snapshot.redis.enabled = true;
        const nowSec = Math.floor(Date.now() / 1000);

        await tokenService.revokeSessionToken(sessionId, 'logout');

        expect(mockRedisClient.set).toHaveBeenCalledWith(
          `auth:revoked:session:${sessionId}`,
          expect.any(String),
          { EX: 900 },
        );

        const isRevoked = await tokenService.isTokenRevoked('any-user', sessionId, nowSec);
        expect(isRevoked).toBe(true);
      });
    });

    describe('getAccountState & Caching Hierarchy', () => {
      it('serves account state from L1 in-memory cache on subsequent calls within 5s', async () => {
        mockPrismaService.user.findUnique.mockResolvedValueOnce({
          accountStatus: AccountStatus.ACTIVE,
          userRoles: [{ role: { name: 'CANDIDATE' } }],
        });

        // 1st call hits DB
        const state1 = await tokenService.getAccountState(userId);
        expect(state1.status).toBe(AccountStatus.ACTIVE);
        expect(state1.roles).toEqual([RoleName.CANDIDATE]);
        expect(mockPrismaService.user.findUnique).toHaveBeenCalledTimes(1);

        // 2nd call hits L1 memory cache (0ms, zero DB queries)
        const state2 = await tokenService.getAccountState(userId);
        expect(state2.status).toBe(AccountStatus.ACTIVE);
        expect(mockPrismaService.user.findUnique).toHaveBeenCalledTimes(1);
      });

      it('reads from Redis L2 cache if L1 misses and Redis has state', async () => {
        mockConfigService.snapshot.redis.enabled = true;
        const cachedState = { status: AccountStatus.ACTIVE, roles: [RoleName.ADMIN] };
        mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(cachedState));

        const state = await tokenService.getAccountState('user-redis-cached');

        expect(state.status).toBe(AccountStatus.ACTIVE);
        expect(state.roles).toEqual([RoleName.ADMIN]);
        expect(mockPrismaService.user.findUnique).not.toHaveBeenCalled();
      });

      it('evicts cache immediately on invalidateAccountState', async () => {
        mockConfigService.snapshot.redis.enabled = true;
        mockPrismaService.user.findUnique.mockResolvedValue({
          accountStatus: AccountStatus.ACTIVE,
          userRoles: [{ role: { name: 'CANDIDATE' } }],
        });

        await tokenService.getAccountState(userId);
        expect(mockPrismaService.user.findUnique).toHaveBeenCalledTimes(1);

        // Invalidate
        await tokenService.invalidateAccountState(userId);
        expect(mockRedisClient.del).toHaveBeenCalledWith(`auth:account_state:${userId}`);

        // Next call must re-query database
        await tokenService.getAccountState(userId);
        expect(mockPrismaService.user.findUnique).toHaveBeenCalledTimes(2);
      });
    });
  });
});

