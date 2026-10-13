import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { AccountStatus, OtpPurpose, OtpState, SecurityEventType } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../database/prisma.service.js';
import { AuthConfigService } from '../config/auth-config.service.js';
import { OtpService } from '../otp/otp.service.js';
import { SessionService } from '../session/session.service.js';
import { TokenService } from '../token/token.service.js';
import { PasswordHistoryService } from '../password/password-history.service.js';
import { PasswordHashingService } from '../password/password-hashing.service.js';
import { PasswordPolicyService } from '../password/password-policy.service.js';
import { AuthService } from '../auth/auth.service.js';
import { EmailService } from '../email/email.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { RedisService } from '../database/redis.service.js';
import { InMemoryPrismaService } from './in-memory-prisma.js';

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

describe('Deterministic Concurrency, Transaction Boundaries, and Distributed-State Consistency', () => {
  let inMemoryPrisma: InMemoryPrismaService;
  let otpService: OtpService;
  let sessionService: SessionService;
  let tokenService: TokenService;
  let passwordHistoryService: PasswordHistoryService;
  let authService: AuthService;
  let hashingService: PasswordHashingService;

  const validSecret = 'test_secret_for_unit_tests_at_least_32_chars!';
  const testEmail = 'candidate.audit@example.com';
  const testUserId = '11111111-1111-4111-8111-111111111111';

  const mockConfigService = {
    jwt: {
      secret: validSecret,
      issuer: 'arep-auth-service-test',
      audience: 'arep-api-test',
      expiresInSeconds: 900,
    },
    session: {
      refreshTokenTtlDays: 7,
    },
    snapshot: {
      otp: {
        hmacSecret: 'otp_test_hmac_secret_at_least_32_characters_long',
        ttlSeconds: 600,
        maxAttempts: 5,
      },
      jwt: {
        secret: validSecret,
        issuer: 'arep-auth-service-test',
        audience: 'arep-api-test',
        expiresInSeconds: 900,
      },
      session: {
        refreshTokenTtlDays: 7,
      },
      redis: {
        enabled: true,
        host: '127.0.0.1',
        port: 6379,
      },
    },
  };

  beforeEach(async () => {
    inMemoryPrisma = new InMemoryPrismaService();
    inMemoryPrisma.reset();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        OtpService,
        SessionService,
        TokenService,
        PasswordPolicyService,
        PasswordHashingService,
        PasswordHistoryService,
        RateLimitService,
        {
          provide: PrismaService,
          useValue: inMemoryPrisma,
        },
        {
          provide: AuthConfigService,
          useValue: mockConfigService,
        },
        {
          provide: RedisService,
          useValue: {
            getClient: () => null,
            isHealthy: async () => false,
          },
        },
        {
          provide: EmailService,
          useValue: {
            sendOtpEmail: vi.fn().mockResolvedValue({ success: true }),
          },
        },
      ],
    }).compile();

    authService = moduleRef.get(AuthService);
    otpService = moduleRef.get(OtpService);
    sessionService = moduleRef.get(SessionService);
    tokenService = moduleRef.get(TokenService);
    passwordHistoryService = moduleRef.get(PasswordHistoryService);
    hashingService = moduleRef.get(PasswordHashingService);

    // Seed a standard verified user
    await inMemoryPrisma.user.create({
      data: {
        id: testUserId,
        email: testEmail,
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=1$oldHash$oldDigest',
        emailVerified: true,
        accountStatus: AccountStatus.ACTIVE,
      },
    });
  });

  describe('1. Two requests attempting to consume the same OTP concurrently', () => {
    it('allows exactly one consumer to succeed and marks subsequent attempt ALREADY_CONSUMED via atomic CAS', async () => {
      // Issue a valid OTP
      const issued = await otpService.issueOtp({
        identifier: testEmail,
        purpose: OtpPurpose.LOGIN,
        userId: testUserId,
      });

      // Launch two concurrent verifyAndConsumeOtp calls with the identical code
      const [result1, result2] = await Promise.all([
        otpService.verifyAndConsumeOtp({
          identifier: testEmail,
          purpose: OtpPurpose.LOGIN,
          code: issued.code,
        }),
        otpService.verifyAndConsumeOtp({
          identifier: testEmail,
          purpose: OtpPurpose.LOGIN,
          code: issued.code,
        }),
      ]);

      const successes = [result1, result2].filter((r) => r.success);
      const failures = [result1, result2].filter((r) => !r.success);

      expect(successes).toHaveLength(1);
      expect(successes[0]!.status).toBe('SUCCESS');

      expect(failures).toHaveLength(1);
      expect(failures[0]!.status).toBe('ALREADY_CONSUMED');

      // The challenge in the database must be strictly CONSUMED with attemptCount = 1
      const storedChallenge = inMemoryPrisma.otpChallenges.get(issued.challengeId);
      expect(storedChallenge?.state).toBe(OtpState.CONSUMED);
      expect(storedChallenge?.attemptCount).toBe(1);
    });

    it('rejects concurrent verifyEmail attempts: exactly one receives 200 OK and second receives 400 ALREADY_CONSUMED', async () => {
      // Create unverified user
      const unverifiedUserId = randomUUID();
      const unverifiedEmail = 'unverified.racer@example.com';
      await inMemoryPrisma.user.create({
        data: {
          id: unverifiedUserId,
          email: unverifiedEmail,
          emailVerified: false,
          accountStatus: AccountStatus.ACTIVE,
        },
      });

      const issued = await otpService.issueOtp({
        identifier: unverifiedEmail,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        userId: unverifiedUserId,
      });

      const [res1, res2] = await Promise.allSettled([
        authService.verifyEmail({ email: unverifiedEmail, code: issued.code }),
        authService.verifyEmail({ email: unverifiedEmail, code: issued.code }),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
      expect(rejectedReason).toBeInstanceOf(BadRequestException);
      expect((rejectedReason as Error).message).toMatch(/already been consumed/i);

      // Verify user is marked verified
      const updatedUser = inMemoryPrisma.users.get(unverifiedUserId);
      expect(updatedUser?.emailVerified).toBe(true);
    });
  });

  describe('2. Two concurrent refresh requests using the same refresh token', () => {
    it('enforces single-use rotation via atomic CAS: exactly one rotation succeeds, second fails with 401 Unauthorized', async () => {
      const session = await sessionService.createSession({
        userId: testUserId,
        ipAddress: '198.51.100.1',
        userAgent: 'Browser-A',
      });

      const rawToken = session.rawRefreshToken;

      // Two concurrent refresh requests with the same token
      const [res1, res2] = await Promise.allSettled([
        sessionService.rotateSession(rawToken),
        sessionService.rotateSession(rawToken),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
      expect(rejectedReason).toBeInstanceOf(UnauthorizedException);
      expect((rejectedReason as Error).message).toMatch(
        /Concurrent refresh attempt detected|Token reuse detected/i,
      );

      // Old session is revoked, and exactly 1 new active session exists
      const oldSession = inMemoryPrisma.authSessions.get(session.sessionId);
      expect(oldSession?.revokedAt).not.toBeNull();

      const userSessions = Array.from(inMemoryPrisma.authSessions.values()).filter(
        (s) => s.userId === testUserId && s.revokedAt === null,
      );
      expect(userSessions).toHaveLength(1);
    });
  });

  describe('3. Database failure between OTP consumption and corresponding user/session update', () => {
    it('leaves OTP burned in CONSUMED state if user update fails during verifyEmail, preventing replay', async () => {
      const unverifiedUserId = randomUUID();
      const unverifiedEmail = 'db.fail.email@example.com';
      await inMemoryPrisma.user.create({
        data: {
          id: unverifiedUserId,
          email: unverifiedEmail,
          emailVerified: false,
          accountStatus: AccountStatus.ACTIVE,
        },
      });

      const issued = await otpService.issueOtp({
        identifier: unverifiedEmail,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        userId: unverifiedUserId,
      });

      // Inject a database failure on user update
      const originalUpdate = inMemoryPrisma.user.update;
      inMemoryPrisma.user.update = vi.fn().mockRejectedValueOnce(
        new Error('PostgreSQL connection dropped during user update'),
      );

      // The call fails with 500 InternalServerErrorException
      await expect(
        authService.verifyEmail({ email: unverifiedEmail, code: issued.code }),
      ).rejects.toThrow(InternalServerErrorException);

      // Restore original update
      inMemoryPrisma.user.update = originalUpdate;

      // Security check: OTP challenge must remain strictly CONSUMED in DB
      const challenge = inMemoryPrisma.otpChallenges.get(issued.challengeId);
      expect(challenge?.state).toBe(OtpState.CONSUMED);

      // Subsequent attempt with the same OTP is rejected (no pending challenge / already consumed)
      await expect(
        authService.verifyEmail({ email: unverifiedEmail, code: issued.code }),
      ).rejects.toThrow(/already been consumed|No pending verification code found/i);
    });

    it('leaves OTP burned in CONSUMED state if session creation fails during verifyLoginOtp, preventing replay', async () => {
      const issued = await otpService.issueOtp({
        identifier: testEmail,
        purpose: OtpPurpose.LOGIN,
        userId: testUserId,
      });

      // Inject failure on sessionService.createSession
      const createSessionSpy = vi.spyOn(sessionService, 'createSession').mockRejectedValueOnce(
        new InternalServerErrorException('Database failure creating auth session'),
      );

      await expect(
        authService.verifyLoginOtp({ email: testEmail, code: issued.code }),
      ).rejects.toThrow(InternalServerErrorException);

      createSessionSpy.mockRestore();

      // Challenge remains burned as CONSUMED
      const challenge = inMemoryPrisma.otpChallenges.get(issued.challengeId);
      expect(challenge?.state).toBe(OtpState.CONSUMED);

      // Replay attempt fails with rejection
      await expect(
        authService.verifyLoginOtp({ email: testEmail, code: issued.code }),
      ).rejects.toThrow(/already been consumed|No pending login verification code found/i);
    });
  });

  describe('4. Password-history checks during password changes', () => {
    it('enforces 5-entry limit: prunes oldest entries and prevents reusing any of the 5 most recent passwords', async () => {
      const hashSpy = vi
        .spyOn(hashingService, 'hash')
        .mockImplementation(async (pw: string) => `mock-hash:${pw}`);
      const verifySpy = vi
        .spyOn(hashingService, 'verify')
        .mockImplementation(async (hash: string, candidate: string) => hash === `mock-hash:${candidate}`);

      const passwords = [
        'HistoryPass1!Alpha',
        'HistoryPass2!Bravo',
        'HistoryPass3!Charlie',
        'HistoryPass4!Delta',
        'HistoryPass5!Echo',
      ];

      // Record 5 passwords in history
      for (const pw of passwords) {
        const hash = await hashingService.hash(pw);
        await passwordHistoryService.recordPasswordHash(testUserId, hash);
      }

      // Check all 5 are considered reused
      for (const pw of passwords) {
        const isReused = await passwordHistoryService.isPasswordReused(testUserId, pw);
        expect(isReused).toBe(true);
      }

      // Adding a 6th password prunes the oldest ('HistoryPass1!Alpha')
      const pass6 = 'HistoryPass6!Foxtrot';
      const hash6 = await hashingService.hash(pass6);
      await passwordHistoryService.recordPasswordHash(testUserId, hash6);

      const storedHistories = await inMemoryPrisma.passwordHistory.findMany({
        where: { userId: testUserId },
      });
      expect(storedHistories).toHaveLength(5);

      // Oldest password (passwords[0]) is no longer in history
      const isOldestReused = await passwordHistoryService.isPasswordReused(testUserId, passwords[0]!);
      expect(isOldestReused).toBe(false);

      // 6th password is now recognized as reused
      const isNewReused = await passwordHistoryService.isPasswordReused(testUserId, pass6);
      expect(isNewReused).toBe(true);

      hashSpy.mockRestore();
      verifySpy.mockRestore();
    });
  });

  describe('5. Redis failures during revocation, cache invalidation, and account-state lookup', () => {
    let mockFailingRedis: any;

    beforeEach(() => {
      mockFailingRedis = {
        getClient: () => ({
          get: vi.fn().mockRejectedValue(new Error('Redis connection failure')),
          set: vi.fn().mockRejectedValue(new Error('Redis connection failure')),
          del: vi.fn().mockRejectedValue(new Error('Redis connection failure')),
          mGet: vi.fn().mockRejectedValue(new Error('Redis connection failure')),
        }),
      };
    });

    it('fails closed and throws ServiceUnavailableException when Redis fails during revokeUserTokens', async () => {
      const failingTokenService = new TokenService(
        mockConfigService as any,
        mockFailingRedis,
        inMemoryPrisma as any,
      );

      await expect(
        failingTokenService.revokeUserTokens(testUserId, 'security_revocation'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('fails closed and throws ServiceUnavailableException when Redis fails during revokeSessionToken', async () => {
      const failingTokenService = new TokenService(
        mockConfigService as any,
        mockFailingRedis,
        inMemoryPrisma as any,
      );

      await expect(
        failingTokenService.revokeSessionToken(randomUUID(), 'logout'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('fails closed and throws ServiceUnavailableException when Redis fails during isTokenRevoked', async () => {
      const failingTokenService = new TokenService(
        mockConfigService as any,
        mockFailingRedis,
        inMemoryPrisma as any,
      );

      // An un-cached token verification attempt must fail closed rather than assuming valid
      await expect(
        failingTokenService.isTokenRevoked(testUserId, randomUUID(), Math.floor(Date.now() / 1000)),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('gracefully falls back to authoritative PostgreSQL L3 lookup when Redis fails during getAccountState', async () => {
      // Mark user as SUSPENDED in PostgreSQL DB
      await inMemoryPrisma.user.update({
        where: { id: testUserId },
        data: { accountStatus: AccountStatus.SUSPENDED },
      });

      const failingTokenService = new TokenService(
        mockConfigService as any,
        mockFailingRedis,
        inMemoryPrisma as any,
      );

      const state = await failingTokenService.getAccountState(testUserId);
      expect(state.status).toBe(AccountStatus.SUSPENDED);
    });
  });

  describe('6. A security-event write failing after underlying security action succeeds', () => {
    it('session revocation succeeds during logout even if securityEvent.create fails', async () => {
      const session = await sessionService.createSession({
        userId: testUserId,
        ipAddress: '198.51.100.1',
      });

      // Mock securityEvent.create to throw a database error
      const originalCreate = inMemoryPrisma.securityEvent.create;
      inMemoryPrisma.securityEvent.create = vi.fn().mockRejectedValueOnce(
        new Error('Audit partition full / disk error'),
      );

      const result = await sessionService.revokeSession(session.rawRefreshToken, '198.51.100.1');
      expect(result.success).toBe(true);
      expect(result.message).toMatch(/logged out successfully/i);

      // The session is still successfully revoked in DB
      const stored = inMemoryPrisma.authSessions.get(session.sessionId);
      expect(stored?.revokedAt).not.toBeNull();

      inMemoryPrisma.securityEvent.create = originalCreate;
    });

    it('replay containment revokes all sessions even if securityEvent.create fails', async () => {
      const session = await sessionService.createSession({
        userId: testUserId,
      });

      // Revoke the session once
      await sessionService.revokeSession(session.rawRefreshToken);

      // Mock securityEvent.create to throw
      const originalCreate = inMemoryPrisma.securityEvent.create;
      inMemoryPrisma.securityEvent.create = vi.fn().mockRejectedValueOnce(
        new Error('Audit table constraint violation'),
      );

      // Attempting to rotate the already-revoked session triggers token reuse containment
      await expect(
        sessionService.rotateSession(session.rawRefreshToken),
      ).rejects.toThrow(/Token reuse detected\. All sessions for this account have been revoked/i);

      inMemoryPrisma.securityEvent.create = originalCreate;
    });

    it('verifyLoginOtp issues session and tokens even if securityEvent.create fails during audit logging', async () => {
      const issued = await otpService.issueOtp({
        identifier: testEmail,
        purpose: OtpPurpose.LOGIN,
        userId: testUserId,
      });

      // Mock securityEvent.create to throw
      const originalCreate = inMemoryPrisma.securityEvent.create;
      inMemoryPrisma.securityEvent.create = vi.fn().mockRejectedValue(
        new Error('Transient audit table lock'),
      );

      const response = await authService.verifyLoginOtp(
        { email: testEmail, code: issued.code },
        { ipAddress: '127.0.0.1' },
      );

      expect(response.success).toBe(true);
      expect(response.accessToken).toBeDefined();
      expect(response.session.id).toBeDefined();

      inMemoryPrisma.securityEvent.create = originalCreate;
    });
  });
});
