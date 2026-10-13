import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { SecurityEventType } from '@prisma/client';
import { SessionService } from './session.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuthConfigService } from '../config/auth-config.service.js';

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

describe('SessionService', () => {
  let service: SessionService;
  let mockPrisma: any;
  let mockAuthConfigService: any;

  const testUserId = '11111111-1111-4111-8111-111111111111';
  const testSessionId = '22222222-2222-4222-8222-222222222222';
  const testSecret = 'a'.repeat(43); // 43 characters base64url

  beforeEach(async () => {
    mockPrisma = {
      authSession: {
        create: vi.fn().mockImplementation(async ({ data }: any) => ({
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      securityEvent: {
        create: vi.fn().mockResolvedValue({ id: 'sec-event-1' }),
      },
      $transaction: vi.fn().mockImplementation(async (arg: any) => {
        if (typeof arg === 'function') {
          return arg(mockPrisma);
        }
        return Promise.all(arg);
      }),
    };

    mockAuthConfigService = {
      session: {
        refreshTokenTtlDays: 7,
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthConfigService, useValue: mockAuthConfigService },
      ],
    }).compile();

    service = moduleRef.get(SessionService);
  });

  describe('Session issuance (createSession)', () => {
    it('generates an unpredictable UUID session ID and persists only SHA-256 hashed secret in AuthSession', async () => {
      const result = await service.createSession({
        userId: testUserId,
        ipAddress: '198.51.100.1',
        userAgent: 'Mozilla/5.0 TestBrowser',
      });

      expect(result.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(result.userId).toBe(testUserId);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // The raw refresh token is formatted as <sessionId>.<secret>
      const parts = result.rawRefreshToken.split('.');
      expect(parts).toHaveLength(2);
      expect(parts[0]).toBe(result.sessionId);
      const rawSecret = parts[1]!;
      expect(rawSecret.length).toBeGreaterThanOrEqual(32);

      // Verify Prisma call received hashed token, NEVER raw secret
      expect(mockPrisma.authSession.create).toHaveBeenCalledWith({
        data: {
          id: result.sessionId,
          userId: testUserId,
          refreshTokenHash: expect.any(String),
          expiresAt: result.expiresAt,
          ipAddress: '198.51.100.1',
          userAgent: 'Mozilla/5.0 TestBrowser',
        },
      });

      const calledData = mockPrisma.authSession.create.mock.calls[0][0].data;
      expect(calledData.refreshTokenHash).not.toBe(rawSecret);
      expect(calledData.refreshTokenHash).toBe(service.hashToken(rawSecret));
    });

    it('handles database creation errors safely without leaking internal errors', async () => {
      mockPrisma.authSession.create.mockRejectedValueOnce(
        new Error('PostgreSQL connection dropped'),
      );

      await expect(
        service.createSession({ userId: testUserId }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('Token parsing and formatting (parseRefreshToken)', () => {
    it('accepts valid compound refresh token', () => {
      const token = `${testSessionId}.${testSecret}`;
      const parsed = service.parseRefreshToken(token);

      expect(parsed.sessionId).toBe(testSessionId);
      expect(parsed.secret).toBe(testSecret);
    });

    it('rejects malformed tokens without period separator', () => {
      expect(() => service.parseRefreshToken('invalidtokenwithoutperiod')).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects tokens with non-UUID session identifiers', () => {
      expect(() => service.parseRefreshToken(`not-a-uuid.${testSecret}`)).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects tokens with short secrets', () => {
      expect(() => service.parseRefreshToken(`${testSessionId}.short`)).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('Refresh token rotation (rotateSession)', () => {
    it('rotates a valid session: atomically invalidates old session and issues new session', async () => {
      const rawToken = `${testSessionId}.${testSecret}`;
      const hashedSecret = service.hashToken(testSecret);

      mockPrisma.authSession.findUnique.mockResolvedValueOnce({
        id: testSessionId,
        userId: testUserId,
        refreshTokenHash: hashedSecret,
        expiresAt: new Date(Date.now() + 86400000), // 1 day in future
        revokedAt: null,
        ipAddress: '127.0.0.1',
        userAgent: 'OldAgent',
      });

      const result = await service.rotateSession(rawToken, {
        ipAddress: '198.51.100.2',
        userAgent: 'NewAgent',
      });

      expect(result.userId).toBe(testUserId);
      expect(result.sessionId).not.toBe(testSessionId);
      expect(result.rawRefreshToken).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\..+$/i,
      );

      // Verify CAS revocation of the old session
      expect(mockPrisma.authSession.updateMany).toHaveBeenCalledWith({
        where: {
          id: testSessionId,
          revokedAt: null,
          refreshTokenHash: hashedSecret,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      });

      // Verify new session was created with new credentials
      expect(mockPrisma.authSession.create).toHaveBeenCalledWith({
        data: {
          id: result.sessionId,
          userId: testUserId,
          refreshTokenHash: expect.any(String),
          expiresAt: expect.any(Date),
          ipAddress: '198.51.100.2',
          userAgent: 'NewAgent',
        },
      });
    });

    it('rejects expired sessions', async () => {
      const rawToken = `${testSessionId}.${testSecret}`;
      const hashedSecret = service.hashToken(testSecret);

      mockPrisma.authSession.findUnique.mockResolvedValueOnce({
        id: testSessionId,
        userId: testUserId,
        refreshTokenHash: hashedSecret,
        expiresAt: new Date(Date.now() - 10000), // Expired in past
        revokedAt: null,
      });

      await expect(service.rotateSession(rawToken)).rejects.toThrow(
        'Session has expired. Please sign in again.',
      );
    });

    it('rejects incorrect token secrets', async () => {
      const rawToken = `${testSessionId}.${testSecret}`;
      const differentHash = service.hashToken('different-secret-12345678901234567890');

      mockPrisma.authSession.findUnique.mockResolvedValueOnce({
        id: testSessionId,
        userId: testUserId,
        refreshTokenHash: differentHash,
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
      });

      await expect(service.rotateSession(rawToken)).rejects.toThrow(
        /invalid refresh token/i,
      );
    });

    it('detects token reuse on already-revoked session and revokes all user sessions as compromise containment', async () => {
      const rawToken = `${testSessionId}.${testSecret}`;
      const hashedSecret = service.hashToken(testSecret);

      mockPrisma.authSession.findUnique.mockResolvedValueOnce({
        id: testSessionId,
        userId: testUserId,
        refreshTokenHash: hashedSecret,
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: new Date(Date.now() - 5000), // Already rotated/revoked!
      });

      await expect(service.rotateSession(rawToken)).rejects.toThrow(
        'Token reuse detected. All sessions for this account have been revoked.',
      );

      // Verify compromise policy: all active sessions for that user were revoked
      expect(mockPrisma.authSession.updateMany).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      });

      // Verify audit event recorded without logging raw token or hash
      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: SecurityEventType.SESSION_REVOKED,
          userId: testUserId,
          sessionId: testSessionId,
          ipAddress: undefined,
          metadata: {
            reason: 'token_reuse_detected',
          },
        },
      });
    });

    it('prevents concurrent refresh race conditions via compare-and-swap update count', async () => {
      const rawToken = `${testSessionId}.${testSecret}`;
      const hashedSecret = service.hashToken(testSecret);

      mockPrisma.authSession.findUnique.mockResolvedValueOnce({
        id: testSessionId,
        userId: testUserId,
        refreshTokenHash: hashedSecret,
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
      });

      // Simulate concurrent refresh: CAS update returns count: 0 because another worker won the race
      mockPrisma.authSession.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.rotateSession(rawToken)).rejects.toThrow(
        'Concurrent refresh attempt detected. Token is no longer valid.',
      );

      // New session was NOT created
      expect(mockPrisma.authSession.create).not.toHaveBeenCalled();
    });
  });

  describe('Session revocation (logout)', () => {
    it('revokes an active session atomically and logs a LOGOUT audit event', async () => {
      const rawToken = `${testSessionId}.${testSecret}`;
      const hashedSecret = service.hashToken(testSecret);

      mockPrisma.authSession.findUnique.mockResolvedValueOnce({
        id: testSessionId,
        userId: testUserId,
        refreshTokenHash: hashedSecret,
        revokedAt: null,
      });

      const result = await service.revokeSession(rawToken, '198.51.100.3');

      expect(result).toEqual({
        success: true,
        message: 'Logged out successfully.',
      });

      expect(mockPrisma.authSession.updateMany).toHaveBeenCalledWith({
        where: {
          id: testSessionId,
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      });

      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: SecurityEventType.LOGOUT,
          userId: testUserId,
          sessionId: testSessionId,
          ipAddress: '198.51.100.3',
        },
      });
    });

    it('is safe and idempotent when session was already revoked', async () => {
      const rawToken = `${testSessionId}.${testSecret}`;
      const hashedSecret = service.hashToken(testSecret);

      mockPrisma.authSession.findUnique.mockResolvedValueOnce({
        id: testSessionId,
        userId: testUserId,
        refreshTokenHash: hashedSecret,
        revokedAt: new Date(),
      });

      const result = await service.revokeSession(rawToken);

      expect(result).toEqual({
        success: true,
        message: 'Session already logged out.',
      });
      expect(mockPrisma.authSession.updateMany).not.toHaveBeenCalled();
    });

    it('is safe and idempotent when session does not exist in DB', async () => {
      const rawToken = `${testSessionId}.${testSecret}`;
      mockPrisma.authSession.findUnique.mockResolvedValueOnce(null);

      const result = await service.revokeSession(rawToken);

      expect(result).toEqual({
        success: true,
        message: 'Session logged out.',
      });
    });

    it('rejects logout when token secret does not match stored hash', async () => {
      const rawToken = `${testSessionId}.${testSecret}`;
      const mismatchedHash = service.hashToken('wrong-secret-12345678901234567890');

      mockPrisma.authSession.findUnique.mockResolvedValueOnce({
        id: testSessionId,
        userId: testUserId,
        refreshTokenHash: mismatchedHash,
        revokedAt: null,
      });

      await expect(service.revokeSession(rawToken)).rejects.toThrow(
        'Invalid session credentials.',
      );
    });
  });

  describe('revokeAllUserSessions', () => {
    it('revokes all active sessions for a user and records SESSION_REVOKED event', async () => {
      mockPrisma.authSession.updateMany.mockResolvedValueOnce({ count: 3 });

      const count = await service.revokeAllUserSessions(testUserId, 'password_change');

      expect(count).toBe(3);
      expect(mockPrisma.authSession.updateMany).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      });

      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: SecurityEventType.SESSION_REVOKED,
          userId: testUserId,
          metadata: {
            reason: 'password_change',
            count: 3,
          },
        },
      });
    });

    it('successfully returns revoked count even if audit event logging fails', async () => {
      mockPrisma.authSession.updateMany.mockResolvedValueOnce({ count: 2 });
      mockPrisma.securityEvent.create.mockRejectedValueOnce(new Error('Audit log DB failure'));

      const count = await service.revokeAllUserSessions(testUserId, 'password_reset');

      expect(count).toBe(2);
      expect(mockPrisma.authSession.updateMany).toHaveBeenCalled();
    });

    it('notifies TokenService to revoke user tokens when TokenService is injected', async () => {
      const mockTokenService: any = {
        revokeUserTokens: vi.fn().mockResolvedValue(undefined),
      };
      const serviceWithToken = new SessionService(mockPrisma, mockAuthConfigService, mockTokenService);
      mockPrisma.authSession.updateMany.mockResolvedValueOnce({ count: 1 });

      await serviceWithToken.revokeAllUserSessions(testUserId, 'admin_revoke');

      expect(mockTokenService.revokeUserTokens).toHaveBeenCalledWith(testUserId, 'admin_revoke');
    });
  });
});

