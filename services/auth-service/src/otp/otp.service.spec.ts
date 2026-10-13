import crypto from 'node:crypto';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { OtpPurpose, OtpState } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { AuthConfigService } from '../config/auth-config.service.js';
import { OtpService } from './otp.service.js';
import { OtpServiceError } from './otp.types.js';

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

describe('OtpService', () => {
  let service: OtpService;
  let mockPrisma: any;
  let mockConfigService: any;

  const testSecret = 'test_otp_hmac_secret_32_characters_long_for_testing';
  const testEmail = 'user@example.com';

  beforeEach(async () => {
    mockPrisma = {
      otpChallenge: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
    };

    mockConfigService = {
      snapshot: {
        otp: {
          hmacSecret: testSecret,
          ttlSeconds: 600,
          maxAttempts: 5,
        },
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = moduleRef.get(OtpService);
  });

  describe('code generation & format', () => {
    it('generates a 6-digit numeric string', () => {
      const code = service.generateNumericCode();
      expect(typeof code).toBe('string');
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^\d{6}$/);
    });

    it('strictly preserves leading zeroes for low numbers', () => {
      const randomSpy = vi.spyOn(crypto, 'randomInt') as any;

      randomSpy.mockReturnValueOnce(7);
      expect(service.generateNumericCode()).toBe('000007');

      randomSpy.mockReturnValueOnce(42);
      expect(service.generateNumericCode()).toBe('000042');

      randomSpy.mockReturnValueOnce(0);
      expect(service.generateNumericCode()).toBe('000000');

      randomSpy.mockReturnValueOnce(999999);
      expect(service.generateNumericCode()).toBe('999999');

      randomSpy.mockRestore();
    });
  });

  describe('verifier computation & security', () => {
    it('computes a 64-character hex HMAC-SHA256 verifier', () => {
      const verifier = service.computeVerifier('123456', testEmail, OtpPurpose.EMAIL_VERIFICATION);
      expect(typeof verifier).toBe('string');
      expect(verifier).toHaveLength(64);
      expect(verifier).toMatch(/^[0-9a-f]{64}$/);
    });

    it('binds verifier to identifier and purpose', () => {
      const v1 = service.computeVerifier('123456', testEmail, OtpPurpose.EMAIL_VERIFICATION);
      const v2 = service.computeVerifier('123456', testEmail, OtpPurpose.LOGIN);
      const v3 = service.computeVerifier('123456', 'other@example.com', OtpPurpose.EMAIL_VERIFICATION);

      expect(v1).not.toBe(v2);
      expect(v1).not.toBe(v3);
    });

    it('performs timing-safe comparison correctly', () => {
      const v1 = service.computeVerifier('123456', testEmail, OtpPurpose.EMAIL_VERIFICATION);
      const v2 = service.computeVerifier('123456', testEmail, OtpPurpose.EMAIL_VERIFICATION);
      const v3 = service.computeVerifier('654321', testEmail, OtpPurpose.EMAIL_VERIFICATION);

      expect(service.safeCompare(v1, v2)).toBe(true);
      expect(service.safeCompare(v1, v3)).toBe(false);
      expect(service.safeCompare(v1, 'different-length')).toBe(false);
    });
  });

  describe('issueOtp', () => {
    it('creates a challenge and invalidates previous pending challenges for the same identifier and purpose', async () => {
      const createdChallenge = {
        id: 'challenge-uuid-1',
        identifier: testEmail,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        state: OtpState.PENDING,
        createdAt: new Date(),
      };
      mockPrisma.otpChallenge.create.mockResolvedValue(createdChallenge);
      mockPrisma.otpChallenge.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.issueOtp({
        identifier: '  USER@EXAMPLE.COM  ',
        purpose: OtpPurpose.EMAIL_VERIFICATION,
      });

      expect(result.challengeId).toBe('challenge-uuid-1');
      expect(result.code).toMatch(/^\d{6}$/);
      expect(result.expiresAt).toBeInstanceOf(Date);

      // Verify invalidation of previous pending challenges
      expect(mockPrisma.otpChallenge.updateMany).toHaveBeenCalledWith({
        where: {
          identifier: testEmail,
          purpose: OtpPurpose.EMAIL_VERIFICATION,
          state: OtpState.PENDING,
        },
        data: {
          state: OtpState.INVALIDATED,
        },
      });

      // Verify insertion with normalized email
      expect(mockPrisma.otpChallenge.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          identifier: testEmail,
          purpose: OtpPurpose.EMAIL_VERIFICATION,
          state: OtpState.PENDING,
          attemptCount: 0,
          maxAttempts: 5,
        }),
      });
    });

    it('fails closed and throws OtpServiceError on database error', async () => {
      mockPrisma.otpChallenge.updateMany.mockRejectedValue(new Error('DB disconnect'));

      await expect(
        service.issueOtp({
          identifier: testEmail,
          purpose: OtpPurpose.EMAIL_VERIFICATION,
        }),
      ).rejects.toThrow(OtpServiceError);
    });
  });

  describe('verifyAndConsumeOtp', () => {
    it('successfully consumes a valid pending challenge', async () => {
      const validCode = '123456';
      const verifierHash = service.computeVerifier(validCode, testEmail, OtpPurpose.EMAIL_VERIFICATION);
      const futureExpiry = new Date(Date.now() + 60_000);

      const challenge = {
        id: 'c-1',
        identifier: testEmail,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        verifierHash,
        expiresAt: futureExpiry,
        attemptCount: 0,
        maxAttempts: 5,
        state: OtpState.PENDING,
        userId: 'user-uuid-1',
      };

      mockPrisma.otpChallenge.findFirst.mockResolvedValue(challenge);
      mockPrisma.otpChallenge.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.verifyAndConsumeOtp({
        identifier: testEmail,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        code: validCode,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('SUCCESS');
      expect(result.challengeId).toBe('c-1');
      expect(result.userId).toBe('user-uuid-1');

      // Verify atomic update to CONSUMED
      expect(mockPrisma.otpChallenge.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 'c-1',
          state: OtpState.PENDING,
        }),
        data: {
          state: OtpState.CONSUMED,
          attemptCount: { increment: 1 },
        },
      });
    });

    it('prevents concurrent double consumption if state was changed concurrently', async () => {
      const validCode = '123456';
      const verifierHash = service.computeVerifier(validCode, testEmail, OtpPurpose.EMAIL_VERIFICATION);

      const challenge = {
        id: 'c-1',
        identifier: testEmail,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        verifierHash,
        expiresAt: new Date(Date.now() + 60_000),
        attemptCount: 0,
        maxAttempts: 5,
        state: OtpState.PENDING,
      };

      mockPrisma.otpChallenge.findFirst.mockResolvedValue(challenge);
      // Simulate race condition: updateMany affected 0 rows because another worker consumed it
      mockPrisma.otpChallenge.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.verifyAndConsumeOtp({
        identifier: testEmail,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        code: validCode,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('ALREADY_CONSUMED');
    });

    it('rejects candidate with incorrect code and increments attemptCount', async () => {
      const actualCode = '123456';
      const wrongCode = '654321';
      const verifierHash = service.computeVerifier(actualCode, testEmail, OtpPurpose.EMAIL_VERIFICATION);

      const challenge = {
        id: 'c-1',
        identifier: testEmail,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        verifierHash,
        expiresAt: new Date(Date.now() + 60_000),
        attemptCount: 2,
        maxAttempts: 5,
        state: OtpState.PENDING,
      };

      mockPrisma.otpChallenge.findFirst.mockResolvedValue(challenge);
      mockPrisma.otpChallenge.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.verifyAndConsumeOtp({
        identifier: testEmail,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        code: wrongCode,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('INVALID_CODE');
      expect(mockPrisma.otpChallenge.updateMany).toHaveBeenCalledWith({
        where: { id: 'c-1', state: OtpState.PENDING },
        data: {
          attemptCount: { increment: 1 },
          state: OtpState.PENDING,
        },
      });
    });

    it('invalidates challenge when reaching max attempts', async () => {
      const actualCode = '123456';
      const wrongCode = '654321';
      const verifierHash = service.computeVerifier(actualCode, testEmail, OtpPurpose.EMAIL_VERIFICATION);

      const challenge = {
        id: 'c-1',
        identifier: testEmail,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        verifierHash,
        expiresAt: new Date(Date.now() + 60_000),
        attemptCount: 4, // Next attempt hits 5 (maxAttempts)
        maxAttempts: 5,
        state: OtpState.PENDING,
      };

      mockPrisma.otpChallenge.findFirst.mockResolvedValue(challenge);
      mockPrisma.otpChallenge.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.verifyAndConsumeOtp({
        identifier: testEmail,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        code: wrongCode,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('EXHAUSTED');
      expect(mockPrisma.otpChallenge.updateMany).toHaveBeenCalledWith({
        where: { id: 'c-1', state: OtpState.PENDING },
        data: {
          attemptCount: { increment: 1 },
          state: OtpState.INVALIDATED,
        },
      });
    });

    it('rejects expired challenge and marks state as EXPIRED', async () => {
      const challenge = {
        id: 'c-1',
        identifier: testEmail,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        verifierHash: 'somehash',
        expiresAt: new Date(Date.now() - 10_000), // Past
        attemptCount: 0,
        maxAttempts: 5,
        state: OtpState.PENDING,
      };

      mockPrisma.otpChallenge.findFirst.mockResolvedValue(challenge);
      mockPrisma.otpChallenge.update.mockResolvedValue({ ...challenge, state: OtpState.EXPIRED });

      const result = await service.verifyAndConsumeOtp({
        identifier: testEmail,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        code: '123456',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('EXPIRED');
      expect(mockPrisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { state: OtpState.EXPIRED },
      });
    });

    it('rejects challenge that was already CONSUMED', async () => {
      const challenge = {
        id: 'c-1',
        identifier: testEmail,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        verifierHash: 'somehash',
        expiresAt: new Date(Date.now() + 60_000),
        attemptCount: 1,
        maxAttempts: 5,
        state: OtpState.CONSUMED,
      };

      mockPrisma.otpChallenge.findFirst.mockResolvedValue(challenge);

      const result = await service.verifyAndConsumeOtp({
        identifier: testEmail,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        code: '123456',
        challengeId: 'c-1',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('ALREADY_CONSUMED');
    });

    it('rejects challenge when no matching record is found', async () => {
      mockPrisma.otpChallenge.findFirst.mockResolvedValue(null);

      const result = await service.verifyAndConsumeOtp({
        identifier: 'nonexistent@example.com',
        purpose: OtpPurpose.LOGIN,
        code: '123456',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('NOT_FOUND');
    });

    it('fails closed and throws OtpServiceError on database failure', async () => {
      mockPrisma.otpChallenge.findFirst.mockRejectedValue(new Error('Connection timeout'));

      await expect(
        service.verifyAndConsumeOtp({
          identifier: testEmail,
          purpose: OtpPurpose.EMAIL_VERIFICATION,
          code: '123456',
        }),
      ).rejects.toThrow(OtpServiceError);
    });
  });
});
