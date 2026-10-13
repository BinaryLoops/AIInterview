import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AccountStatus,
  Prisma,
  SecurityEventType,
  OtpPurpose,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { PasswordPolicyService } from '../password/password-policy.service.js';
import { PasswordHashingService } from '../password/password-hashing.service.js';
import { PasswordHistoryService } from '../password/password-history.service.js';
import { OtpService } from '../otp/otp.service.js';
import { EmailService } from '../email/email.service.js';
import { EmailDeliveryError } from '../email/email.types.js';
import { OtpServiceError } from '../otp/otp.types.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { SessionService } from '../session/session.service.js';
import { TokenService } from '../token/token.service.js';
import { AuthService } from './auth.service.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { VerifyLoginOtpDto } from './dto/verify-login-otp.dto.js';
import type { RefreshTokenDto } from './dto/refresh-token.dto.js';
import type { LogoutDto } from './dto/logout.dto.js';
import type { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import type { ResetPasswordDto } from './dto/reset-password.dto.js';

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

describe('AuthService', () => {
  let service: AuthService;
  let mockPrisma: any;
  let mockTx: any;
  let mockPasswordPolicyService: any;
  let mockPasswordHashingService: any;
  let mockPasswordHistoryService: any;
  let mockOtpService: any;
  let mockEmailService: any;
  let mockRateLimitService: any;
  let mockSessionService: any;
  let mockTokenService: any;

  const validPassword = 'SecurePassword123!';
  const hashedPassword = '$argon2id$v=19$m=65536,t=3,p=1$mockHash$mockDigest';
  const testUserId = '11111111-1111-1111-1111-111111111111';
  const candidateRoleId = '22222222-2222-2222-2222-222222222222';

  const defaultDto: RegisterDto = {
    fullName: 'Jane Doe',
    email: 'jane.doe@example.com',
    mobileNumber: '+1 555-123-4567',
    password: validPassword,
    passwordConfirmation: validPassword,
    termsAccepted: true,
  };

  beforeEach(async () => {
    mockTx = {
      user: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: testUserId,
          email: 'jane.doe@example.com',
          mobileNumber: '+15551234567',
          emailVerified: false,
          accountStatus: AccountStatus.ACTIVE,
          createdAt: new Date('2026-10-12T00:00:00.000Z'),
        }),
        update: vi.fn().mockResolvedValue({
          id: testUserId,
          email: 'jane.doe@example.com',
          emailVerified: true,
        }),
      },
      role: {
        upsert: vi.fn().mockResolvedValue({
          id: candidateRoleId,
          name: 'CANDIDATE',
        }),
      },
      userRole: {
        create: vi.fn().mockResolvedValue({
          id: 'user-role-1',
          userId: testUserId,
          roleId: candidateRoleId,
        }),
      },
      passwordHistory: {
        create: vi.fn().mockResolvedValue({
          id: 'pw-hist-1',
          userId: testUserId,
          passwordHash: hashedPassword,
        }),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      securityEvent: {
        create: vi.fn().mockResolvedValue({
          id: 'sec-event-1',
          eventType: SecurityEventType.ROLE_ASSIGNED,
          userId: testUserId,
        }),
      },
    };

    mockPrisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: testUserId,
          email: 'jane.doe@example.com',
          emailVerified: false,
        }),
        update: vi.fn().mockResolvedValue({
          id: testUserId,
          email: 'jane.doe@example.com',
          emailVerified: true,
        }),
      },
      securityEvent: {
        create: vi.fn().mockResolvedValue({
          id: 'sec-event-1',
          eventType: SecurityEventType.LOGIN_FAILURE,
          userId: testUserId,
        }),
      },
      role: {
        findUnique: vi.fn(),
      },
      userRole: {
        findUnique: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
      $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
    };


    mockPasswordPolicyService = {
      validate: vi.fn().mockReturnValue({ valid: true, violations: [] }),
    };

    mockPasswordHashingService = {
      hash: vi.fn().mockResolvedValue(hashedPassword),
      verify: vi.fn().mockResolvedValue(true),
    };

    mockPasswordHistoryService = {
      isPasswordReused: vi.fn().mockResolvedValue(false),
      recordPasswordHash: vi.fn().mockResolvedValue({
        id: 'pw-hist-1',
        userId: testUserId,
        passwordHash: hashedPassword,
      }),
    };

    mockRateLimitService = {
      isAllowed: vi.fn().mockResolvedValue(true),
      isExceeded: vi.fn().mockResolvedValue(false),
      recordFailure: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
    };

    mockOtpService = {
      issueOtp: vi.fn().mockResolvedValue({
        challengeId: 'otp-challenge-123',
        code: '123456',
        expiresAt: new Date(Date.now() + 600000),
      }),
      verifyAndConsumeOtp: vi.fn().mockResolvedValue({
        success: true,
        status: 'SUCCESS',
        challengeId: 'otp-challenge-123',
        userId: testUserId,
      }),
    };

    mockEmailService = {
      sendOtpEmail: vi.fn().mockResolvedValue({
        success: true,
        messageId: 'mock-msg-id',
        correlationId: 'mock-corr-id',
      }),
    };

    mockSessionService = {
      createSession: vi.fn().mockResolvedValue({
        sessionId: 'sess-uuid-1',
        rawRefreshToken: 'sess-uuid-1.mockSecretToken12345678901234567890',
        expiresAt: new Date(Date.now() + 604800000),
        userId: testUserId,
      }),
      rotateSession: vi.fn().mockResolvedValue({
        sessionId: 'sess-uuid-2',
        rawRefreshToken: 'sess-uuid-2.mockRotatedSecret1234567890123456',
        expiresAt: new Date(Date.now() + 604800000),
        userId: testUserId,
      }),
      revokeSession: vi.fn().mockResolvedValue({
        success: true,
        message: 'Logged out successfully.',
      }),
      revokeAllUserSessions: vi.fn().mockResolvedValue(1),
    };

    mockTokenService = {
      generateAccessToken: vi.fn().mockResolvedValue({
        token: 'mock.signed.access.token',
        tokenType: 'Bearer',
        expiresIn: 900,
        claims: {
          sub: testUserId,
          email: 'jane.doe@example.com',
          roles: ['CANDIDATE'],
          sid: 'sess-uuid-1',
          jti: 'jti-mock-1',
          iss: 'arep-auth-service',
          aud: 'arep-api',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 900,
        },
      }),
      verifyAccessToken: vi.fn(),
      toPrincipal: vi.fn(),
      revokeUserTokens: vi.fn().mockResolvedValue(undefined),
      revokeSessionToken: vi.fn().mockResolvedValue(undefined),
      isTokenRevoked: vi.fn().mockResolvedValue(false),
      getAccountState: vi.fn().mockResolvedValue({ status: AccountStatus.ACTIVE, roles: ['CANDIDATE'] }),
      invalidateAccountState: vi.fn().mockResolvedValue(undefined),
    };


    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PasswordPolicyService, useValue: mockPasswordPolicyService },
        { provide: PasswordHashingService, useValue: mockPasswordHashingService },
        { provide: PasswordHistoryService, useValue: mockPasswordHistoryService },
        { provide: OtpService, useValue: mockOtpService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: RateLimitService, useValue: mockRateLimitService },
        { provide: SessionService, useValue: mockSessionService },
        { provide: TokenService, useValue: mockTokenService },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('successful candidate registration', () => {
    it('creates candidate user, assigns CANDIDATE role, hashes password, and triggers OTP email', async () => {
      const result = await service.register(defaultDto);

      // 1. Password policy and hashing
      expect(mockPasswordPolicyService.validate).toHaveBeenCalledWith(validPassword);
      expect(mockPasswordHashingService.hash).toHaveBeenCalledWith(validPassword);

      // 2. Database transaction called
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

      // 3. User created with normalized values
      expect(mockTx.user.create).toHaveBeenCalledWith({
        data: {
          email: 'jane.doe@example.com',
          mobileNumber: '+15551234567',
          passwordHash: hashedPassword,
          emailVerified: false,
          accountStatus: AccountStatus.ACTIVE,
        },
        select: expect.any(Object),
      });

      // 4. Role strictly set to CANDIDATE
      expect(mockTx.role.upsert).toHaveBeenCalledWith({
        where: { name: 'CANDIDATE' },
        update: {},
        create: {
          name: 'CANDIDATE',
          description: 'Standard candidate role',
        },
      });
      expect(mockTx.userRole.create).toHaveBeenCalledWith({
        data: {
          userId: testUserId,
          roleId: candidateRoleId,
        },
      });

      // 5. Password history and security event logged
      expect(mockTx.passwordHistory.create).toHaveBeenCalledWith({
        data: {
          userId: testUserId,
          passwordHash: hashedPassword,
        },
      });
      expect(mockTx.securityEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: SecurityEventType.ROLE_ASSIGNED,
          userId: testUserId,
          metadata: expect.objectContaining({
            role: 'CANDIDATE',
            fullName: 'Jane Doe',
            termsAccepted: true,
          }),
        }),
      });

      // 6. OTP issued outside DB transaction
      expect(mockOtpService.issueOtp).toHaveBeenCalledWith({
        identifier: 'jane.doe@example.com',
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        userId: testUserId,
      });

      // 7. Verification email sent outside DB transaction
      expect(mockEmailService.sendOtpEmail).toHaveBeenCalledWith({
        recipientEmail: 'jane.doe@example.com',
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        otpCode: '123456',
      });

      // 8. Public response sanitization (no passwordHash, no OTP code, no verifiers)
      expect(result).toEqual({
        id: testUserId,
        email: 'jane.doe@example.com',
        fullName: 'Jane Doe',
        mobileNumber: '+15551234567',
        emailVerified: false,
        accountStatus: AccountStatus.ACTIVE,
        createdAt: expect.any(Date),
        emailDelivery: {
          sent: true,
          message: 'Verification email sent successfully.',
        },
      });
      expect((result as any).passwordHash).toBeUndefined();
      expect((result as any).password).toBeUndefined();
      expect((result as any).code).toBeUndefined();
      expect((result as any).otp).toBeUndefined();
    });

    it('normalizes uppercase email and whitespace in fullName and mobile', async () => {
      await service.register({
        ...defaultDto,
        fullName: '  Jane   Elizabeth   Doe  ',
        email: '  JANE.DOE@Example.COM  ',
        mobileNumber: ' (555) 123-4567 ',
      });

      expect(mockTx.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'jane.doe@example.com',
          mobileNumber: '+5551234567',
        }),
        select: expect.any(Object),
      });

      expect(mockTx.securityEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            role: 'CANDIDATE',
            fullName: 'Jane Elizabeth Doe',
            termsAccepted: true,
          }),
        }),
      });
    });

    it('allows optional mobileNumber to be omitted without error', async () => {
      mockTx.user.create.mockResolvedValueOnce({
        id: testUserId,
        email: 'jane.doe@example.com',
        mobileNumber: null,
        emailVerified: false,
        accountStatus: AccountStatus.ACTIVE,
        createdAt: new Date(),
      });

      const { mobileNumber, ...withoutMobile } = defaultDto;
      const result = await service.register(withoutMobile);

      expect(mockTx.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          mobileNumber: null,
        }),
        select: expect.any(Object),
      });
      expect(result.mobileNumber).toBeNull();
    });

    it('strictly assigns CANDIDATE role and never privileged roles', async () => {
      await service.register({
        ...defaultDto,
        email: 'candidate.strict@example.com',
      });

      expect(mockTx.role.upsert).toHaveBeenCalledWith({
        where: { name: 'CANDIDATE' },
        update: {},
        create: {
          name: 'CANDIDATE',
          description: 'Standard candidate role',
        },
      });

      expect(mockTx.userRole.create).toHaveBeenCalledWith({
        data: {
          userId: testUserId,
          roleId: candidateRoleId,
        },
      });

      expect(mockTx.securityEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            role: 'CANDIDATE',
          }),
        }),
      });
    });
  });

  describe('duplicate constraint handling', () => {
    it('throws 409 Conflict when an account with the same email already exists', async () => {
      mockTx.user.findFirst.mockResolvedValue({
        email: 'jane.doe@example.com',
        mobileNumber: '+19999999999',
      });

      await expect(service.register(defaultDto)).rejects.toThrow(
        /email address already exists/i,
      );
      expect(mockTx.user.create).not.toHaveBeenCalled();
    });

    it('throws 409 Conflict when an account with the same mobile number already exists', async () => {
      mockTx.user.findFirst.mockResolvedValue({
        email: 'other@example.com',
        mobileNumber: '+15551234567',
      });

      await expect(service.register(defaultDto)).rejects.toThrow(
        /mobile number already exists/i,
      );
      expect(mockTx.user.create).not.toHaveBeenCalled();
    });

    it('handles Prisma P2002 race condition on email safely', async () => {
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '5.15.0',
          meta: { target: ['email'] },
        },
      );
      mockTx.user.create.mockRejectedValue(p2002Error);

      await expect(service.register(defaultDto)).rejects.toThrow(
        /email address already exists/i,
      );
    });

    it('handles Prisma P2002 race condition on mobile safely', async () => {
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '5.15.0',
          meta: { target: ['mobile_number'] },
        },
      );
      mockTx.user.create.mockRejectedValue(p2002Error);

      await expect(service.register(defaultDto)).rejects.toThrow(
        /mobile number already exists/i,
      );
    });
  });

  describe('input validation and security controls', () => {
    it('rejects when password confirmation does not match', async () => {
      await expect(
        service.register({
          ...defaultDto,
          passwordConfirmation: 'DifferentPassword123!',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.register({
          ...defaultDto,
          passwordConfirmation: 'DifferentPassword123!',
        }),
      ).rejects.toThrow(/confirmation does not match/i);
    });

    it('rejects when password confirmation is missing', async () => {
      const { passwordConfirmation, ...missingConfirm } = defaultDto;
      await expect(service.register(missingConfirm as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when terms acceptance is false', async () => {
      await expect(
        service.register({
          ...defaultDto,
          termsAccepted: false,
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.register({
          ...defaultDto,
          termsAccepted: false,
        }),
      ).rejects.toThrow(/must accept the terms/i);
    });

    it('rejects when terms acceptance is missing (undefined)', async () => {
      const dtoWithoutTerms = { ...defaultDto };
      delete (dtoWithoutTerms as any).termsAccepted;
      delete (dtoWithoutTerms as any).agreeTerms;

      await expect(service.register(dtoWithoutTerms)).rejects.toThrow(BadRequestException);
      await expect(service.register(dtoWithoutTerms)).rejects.toThrow(/must accept the terms/i);
    });

    it('rejects when password policy is violated', async () => {
      mockPasswordPolicyService.validate.mockReturnValueOnce({
        valid: false,
        violations: [
          { rule: 'min_length', message: 'Password must be at least 12 characters long.' },
          { rule: 'special', message: 'Password must contain at least one special character.' },
        ],
      });

      await expect(service.register(defaultDto)).rejects.toThrow(BadRequestException);
      expect(mockPasswordHashingService.hash).not.toHaveBeenCalled();
    });

    it('rejects malformed mobile numbers containing letters', async () => {
      await expect(
        service.register({
          ...defaultDto,
          mobileNumber: '+1-555-CALL-NOW',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects malformed mobile numbers that are too short (< 7 digits)', async () => {
      await expect(
        service.register({
          ...defaultDto,
          mobileNumber: '+12345',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects malformed mobile numbers that are too long (> 15 digits)', async () => {
      await expect(
        service.register({
          ...defaultDto,
          mobileNumber: '+1234567890123456',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects empty mobile number string if provided', async () => {
      await expect(
        service.register({
          ...defaultDto,
          mobileNumber: '   ',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('email failure resilience and boundaries', () => {
    it('keeps user created and reports delivery failure when SMTP fails', async () => {
      mockEmailService.sendOtpEmail.mockRejectedValueOnce(
        new EmailDeliveryError('SMTP connection timeout'),
      );

      const result = await service.register(defaultDto);

      // Account was successfully created in PostgreSQL
      expect(mockTx.user.create).toHaveBeenCalledTimes(1);
      expect(result.id).toBe(testUserId);
      expect(result.emailVerified).toBe(false);

      // Email delivery failed safely without throwing or deleting the user
      expect(result.emailDelivery.sent).toBe(false);
      expect(result.emailDelivery.message).toMatch(
        /verification email could not be delivered/i,
      );
    });

    it('keeps user created and reports failure when OTP challenge issuance fails', async () => {
      mockOtpService.issueOtp.mockRejectedValueOnce(
        new OtpServiceError('Database unavailable for OTP challenge'),
      );

      const result = await service.register(defaultDto);

      expect(mockTx.user.create).toHaveBeenCalledTimes(1);
      expect(result.id).toBe(testUserId);
      expect(result.emailDelivery.sent).toBe(false);
      expect(result.emailDelivery.message).toMatch(
        /verification code could not be issued/i,
      );
      expect(mockEmailService.sendOtpEmail).not.toHaveBeenCalled();
    });
  });

  describe('email verification (verifyEmail)', () => {
    const validVerifyDto = {
      email: 'jane.doe@example.com',
      otp: '123456',
    };

    it('successfully verifies email, marks user verified, and logs audit event', async () => {
      const result = await service.verifyEmail(validVerifyDto);

      // 1. Validated user lookup
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'jane.doe@example.com' },
        select: { id: true, email: true, emailVerified: true },
      });

      // 2. Bound strictly to identifier and EMAIL_VERIFICATION purpose
      expect(mockOtpService.verifyAndConsumeOtp).toHaveBeenCalledWith({
        identifier: 'jane.doe@example.com',
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        code: '123456',
      });

      // 3. Updated user and recorded audit event atomically
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockTx.user.update).toHaveBeenCalledWith({
        where: { id: testUserId },
        data: { emailVerified: true },
      });
      expect(mockTx.securityEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: SecurityEventType.EMAIL_VERIFIED,
          userId: testUserId,
          metadata: {
            challengeId: 'otp-challenge-123',
          },
        },
      });

      // 4. Returns clean, sanitized response without secrets
      expect(result).toEqual({
        success: true,
        message: 'Email address verified successfully.',
        email: 'jane.doe@example.com',
        emailVerified: true,
      });
      expect((result as any).passwordHash).toBeUndefined();
      expect((result as any).otp).toBeUndefined();
      expect((result as any).verifierHash).toBeUndefined();
    });

    it('supports code property alias as an alternative to otp', async () => {
      const result = await service.verifyEmail({
        email: 'jane.doe@example.com',
        code: '654321',
      });

      expect(mockOtpService.verifyAndConsumeOtp).toHaveBeenCalledWith({
        identifier: 'jane.doe@example.com',
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        code: '654321',
      });
      expect(result.success).toBe(true);
    });

    it('normalizes uppercase email and leading/trailing whitespace', async () => {
      await service.verifyEmail({
        email: '   JANE.DOE@EXAMPLE.COM   ',
        otp: '123456',
      });

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'jane.doe@example.com' },
        select: { id: true, email: true, emailVerified: true },
      });
      expect(mockOtpService.verifyAndConsumeOtp).toHaveBeenCalledWith({
        identifier: 'jane.doe@example.com',
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        code: '123456',
      });
    });

    describe('input validation before invoking OTP service', () => {
      it('rejects missing verification code without calling OTP service', async () => {
        await expect(
          service.verifyEmail({ email: 'jane.doe@example.com' } as any),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.verifyEmail({ email: 'jane.doe@example.com' } as any),
        ).rejects.toThrow(/code is required/i);
        expect(mockOtpService.verifyAndConsumeOtp).not.toHaveBeenCalled();
      });

      it('rejects non-numeric codes without calling OTP service', async () => {
        await expect(
          service.verifyEmail({ email: 'jane.doe@example.com', otp: 'abcdef' }),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.verifyEmail({ email: 'jane.doe@example.com', otp: 'abcdef' }),
        ).rejects.toThrow(/exactly 6 digits/i);
        expect(mockOtpService.verifyAndConsumeOtp).not.toHaveBeenCalled();
      });

      it('rejects codes shorter than 6 digits without calling OTP service', async () => {
        await expect(
          service.verifyEmail({ email: 'jane.doe@example.com', otp: '12345' }),
        ).rejects.toThrow(BadRequestException);
        expect(mockOtpService.verifyAndConsumeOtp).not.toHaveBeenCalled();
      });

      it('rejects codes longer than 6 digits without calling OTP service', async () => {
        await expect(
          service.verifyEmail({ email: 'jane.doe@example.com', otp: '1234567' }),
        ).rejects.toThrow(BadRequestException);
        expect(mockOtpService.verifyAndConsumeOtp).not.toHaveBeenCalled();
      });
    });

    describe('user state and identification checks', () => {
      it('throws NotFoundException when user does not exist', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce(null);

        await expect(service.verifyEmail(validVerifyDto)).rejects.toThrow(
          /no user account found/i,
        );
        expect(mockOtpService.verifyAndConsumeOtp).not.toHaveBeenCalled();
      });

      it('rejects when email is already verified', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({
          id: testUserId,
          email: 'jane.doe@example.com',
          emailVerified: true,
        });

        await expect(service.verifyEmail(validVerifyDto)).rejects.toThrow(
          /already verified/i,
        );
        expect(mockOtpService.verifyAndConsumeOtp).not.toHaveBeenCalled();
      });
    });

    describe('OTP verification failure states and reuse prevention', () => {
      it('rejects invalid OTP code', async () => {
        mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
          success: false,
          status: 'INVALID_CODE',
        });

        await expect(service.verifyEmail(validVerifyDto)).rejects.toThrow(
          /invalid verification code/i,
        );
        expect(mockTx.user.update).not.toHaveBeenCalled();
      });

      it('rejects expired OTP code', async () => {
        mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
          success: false,
          status: 'EXPIRED',
        });

        await expect(service.verifyEmail(validVerifyDto)).rejects.toThrow(
          /code has expired/i,
        );
        expect(mockTx.user.update).not.toHaveBeenCalled();
      });

      it('rejects already consumed OTP code preventing reuse', async () => {
        mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
          success: false,
          status: 'ALREADY_CONSUMED',
        });

        await expect(service.verifyEmail(validVerifyDto)).rejects.toThrow(
          /already been consumed/i,
        );
        expect(mockTx.user.update).not.toHaveBeenCalled();
      });

      it('rejects exhausted OTP code exceeding attempt limit', async () => {
        mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
          success: false,
          status: 'EXHAUSTED',
        });

        await expect(service.verifyEmail(validVerifyDto)).rejects.toThrow(
          /exceeded the maximum number of attempts/i,
        );
        expect(mockTx.user.update).not.toHaveBeenCalled();
      });

      it('rejects when no pending OTP challenge exists for identifier', async () => {
        mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
          success: false,
          status: 'NOT_FOUND',
        });

        await expect(service.verifyEmail(validVerifyDto)).rejects.toThrow(
          /no pending verification code found/i,
        );
        expect(mockTx.user.update).not.toHaveBeenCalled();
      });
    });

    describe('safe error handling and transactional consistency boundaries', () => {
      it('handles user lookup database error safely without leaking details', async () => {
        mockPrisma.user.findUnique.mockRejectedValueOnce(
          new Error('Connection terminated unexpectedly'),
        );

        await expect(service.verifyEmail(validVerifyDto)).rejects.toThrow(
          /verification failed due to a server error/i,
        );
        expect(mockOtpService.verifyAndConsumeOtp).not.toHaveBeenCalled();
      });

      it('handles OtpService unexpected database error safely', async () => {
        mockOtpService.verifyAndConsumeOtp.mockRejectedValueOnce(
          new OtpServiceError('OTP table unreachable'),
        );

        await expect(service.verifyEmail(validVerifyDto)).rejects.toThrow(
          /verification failed due to a server error/i,
        );
      });

      it('handles user update failure safely after OTP consumption (documented consistency limitation)', async () => {
        // OtpService consumed the OTP atomically
        mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
          success: true,
          status: 'SUCCESS',
          challengeId: 'otp-challenge-123',
          userId: testUserId,
        });

        // The subsequent user update transaction encounters an error
        mockPrisma.$transaction.mockRejectedValueOnce(
          new Error('Deadlock detected during user update'),
        );

        await expect(service.verifyEmail(validVerifyDto)).rejects.toThrow(
          /failed to update email verification status/i,
        );
      });
    });
  });

  describe('login endpoint (POST /auth/login)', () => {
    const validLoginDto: LoginDto = {
      email: 'jane.doe@example.com',
      password: validPassword,
    };
    const clientIp = '203.0.113.195';

    const mockActiveUser = {
      id: testUserId,
      email: 'jane.doe@example.com',
      passwordHash: hashedPassword,
      emailVerified: true,
      accountStatus: AccountStatus.ACTIVE,
    };

    it('successfully validates credentials, issues LOGIN OTP challenge, and returns unauthenticated challenge state', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUser);
      mockPasswordHashingService.verify.mockResolvedValueOnce(true);

      const response = await service.login(validLoginDto, clientIp);

      // Verify response structure — no sessions issued, pending OTP
      expect(response).toEqual({
        authenticated: false,
        nextStep: 'VERIFY_LOGIN_OTP',
        email: 'jane.doe@example.com',
        message: expect.stringMatching(/verification code/i),
        otpDelivery: {
          sent: true,
          message: expect.stringMatching(/verification code has been sent/i),
        },
      });

      // Verify OTP issued with purpose LOGIN
      expect(mockOtpService.issueOtp).toHaveBeenCalledWith({
        identifier: 'jane.doe@example.com',
        purpose: OtpPurpose.LOGIN,
        userId: testUserId,
      });

      // Verify OTP delivery dispatched
      expect(mockEmailService.sendOtpEmail).toHaveBeenCalledWith({
        recipientEmail: 'jane.doe@example.com',
        purpose: OtpPurpose.LOGIN,
        otpCode: '123456',
      });

      // Assert password-only login NEVER issues a session
      expect(mockSessionService.createSession).not.toHaveBeenCalled();

      // Verify OTP_REQUESTED security audit event recorded
      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: SecurityEventType.OTP_REQUESTED,
          userId: testUserId,
          ipAddress: clientIp,
          metadata: {
            purpose: OtpPurpose.LOGIN,
            challengeId: 'otp-challenge-123',
          },
        },
      });
    });

    describe('failed-login protection and brute force throttling', () => {
      it('blocks request when IP sliding-window limit is exceeded', async () => {
        mockRateLimitService.isExceeded.mockImplementation(async (key: string) => {
          if (key.startsWith('login:ip:')) return true;
          return false;
        });

        await expect(service.login(validLoginDto, clientIp)).rejects.toThrow(
          UnauthorizedException,
        );
        await expect(service.login(validLoginDto, clientIp)).rejects.toThrow(
          /too many failed login attempts from this ip/i,
        );

        // Does not query database or run expensive hash verify
        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
        expect(mockPasswordHashingService.verify).not.toHaveBeenCalled();
      });

      it('blocks request when account sliding-window limit is exceeded', async () => {
        mockRateLimitService.isExceeded.mockImplementation(async (key: string) => {
          if (key.startsWith('login:acct:')) return true;
          return false;
        });

        await expect(service.login(validLoginDto, clientIp)).rejects.toThrow(
          UnauthorizedException,
        );
        await expect(service.login(validLoginDto, clientIp)).rejects.toThrow(
          /too many failed login attempts for this account/i,
        );

        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
        expect(mockPasswordHashingService.verify).not.toHaveBeenCalled();
      });
    });

    describe('anti-enumeration and timing attack protection', () => {
      it('returns identical generic 401 when email does not exist and runs dummy hash verification', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce(null);

        await expect(service.login(validLoginDto, clientIp)).rejects.toThrow(
          new UnauthorizedException('Invalid email address or password.'),
        );

        // Dummy hash verify executed to mitigate timing enumeration
        expect(mockPasswordHashingService.verify).toHaveBeenCalledTimes(1);

        // Audit log records failure without exposing userId
        expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith({
          data: {
            eventType: SecurityEventType.LOGIN_FAILURE,
            userId: null,
            ipAddress: clientIp,
            metadata: { reason: 'invalid_credentials' },
          },
        });

        expect(mockOtpService.issueOtp).not.toHaveBeenCalled();
      });

      it('returns identical generic 401 when password does not match', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUser);
        mockPasswordHashingService.verify.mockResolvedValueOnce(false);

        await expect(service.login(validLoginDto, clientIp)).rejects.toThrow(
          new UnauthorizedException('Invalid email address or password.'),
        );

        // Audit log records failure with userId
        expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith({
          data: {
            eventType: SecurityEventType.LOGIN_FAILURE,
            userId: testUserId,
            ipAddress: clientIp,
            metadata: { reason: 'invalid_credentials' },
          },
        });

        expect(mockOtpService.issueOtp).not.toHaveBeenCalled();
      });
    });

    describe('account status and verification enforcement', () => {
      it('rejects suspended accounts with 403 Forbidden', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({
          ...mockActiveUser,
          accountStatus: AccountStatus.SUSPENDED,
        });
        mockPasswordHashingService.verify.mockResolvedValueOnce(true);

        await expect(service.login(validLoginDto, clientIp)).rejects.toThrow(
          'Your account has been suspended. Please contact support.',
        );

        expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith({
          data: {
            eventType: SecurityEventType.LOGIN_FAILURE,
            userId: testUserId,
            ipAddress: clientIp,
            metadata: { reason: 'account_suspended' },
          },
        });

        expect(mockOtpService.issueOtp).not.toHaveBeenCalled();
      });

      it('rejects deactivated accounts with 403 Forbidden', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({
          ...mockActiveUser,
          accountStatus: AccountStatus.DEACTIVATED,
        });
        mockPasswordHashingService.verify.mockResolvedValueOnce(true);

        await expect(service.login(validLoginDto, clientIp)).rejects.toThrow(
          'Your account has been deactivated. Please contact support to restore access.',
        );

        expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith({
          data: {
            eventType: SecurityEventType.LOGIN_FAILURE,
            userId: testUserId,
            ipAddress: clientIp,
            metadata: { reason: 'account_deactivated' },
          },
        });

        expect(mockOtpService.issueOtp).not.toHaveBeenCalled();
      });

      it('rejects unverified email accounts with 403 Forbidden', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({
          ...mockActiveUser,
          emailVerified: false,
        });
        mockPasswordHashingService.verify.mockResolvedValueOnce(true);

        await expect(service.login(validLoginDto, clientIp)).rejects.toThrow(
          'Email address not verified. Please verify your email before logging in.',
        );

        expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith({
          data: {
            eventType: SecurityEventType.LOGIN_FAILURE,
            userId: testUserId,
            ipAddress: clientIp,
            metadata: { reason: 'email_not_verified' },
          },
        });

        expect(mockOtpService.issueOtp).not.toHaveBeenCalled();
      });
    });

    describe('email delivery failure resilience', () => {
      it('returns safe response with otpDelivery.sent false when SMTP delivery fails', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUser);
        mockPasswordHashingService.verify.mockResolvedValueOnce(true);
        mockEmailService.sendOtpEmail.mockRejectedValueOnce(
          new Error('SMTP connection timed out'),
        );

        const response = await service.login(validLoginDto, clientIp);

        expect(response.authenticated).toBe(false);
        expect(response.nextStep).toBe('VERIFY_LOGIN_OTP');
        expect(response.otpDelivery.sent).toBe(false);
        expect(response.otpDelivery.message).toMatch(/unable to deliver the login code/i);

        // The OTP challenge itself was still issued
        expect(mockOtpService.issueOtp).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('verifyLoginOtp endpoint (POST /auth/verify-login-otp)', () => {
    const validVerifyLoginDto: VerifyLoginOtpDto = {
      email: 'jane.doe@example.com',
      otp: '123456',
    };
    const clientIp = '203.0.113.55';

    const mockActiveUserWithRoles = {
      id: testUserId,
      email: 'jane.doe@example.com',
      accountStatus: AccountStatus.ACTIVE,
      emailVerified: true,
      userRoles: [{ role: { name: 'CANDIDATE' } }],
    };

    it('issues an active session ONLY after login OTP is verified and consumed', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUserWithRoles);
      mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
        success: true,
        status: 'SUCCESS',
        challengeId: 'otp-challenge-123',
      });

      const response = await service.verifyLoginOtp(validVerifyLoginDto, {
        ipAddress: clientIp,
        userAgent: 'TestBrowser',
      });

      expect(response).toEqual({
        success: true,
        message: 'Login successful.',
        accessToken: 'mock.signed.access.token',
        tokenType: 'Bearer',
        expiresIn: 900,
        session: {
          id: 'sess-uuid-1',
          refreshToken: 'sess-uuid-1.mockSecretToken12345678901234567890',
          expiresAt: expect.any(Date),
        },
        user: {
          id: testUserId,
          email: 'jane.doe@example.com',
          roles: ['CANDIDATE'],
        },
      });

      // OTP service consumed OTP
      expect(mockOtpService.verifyAndConsumeOtp).toHaveBeenCalledWith({
        identifier: 'jane.doe@example.com',
        purpose: OtpPurpose.LOGIN,
        code: '123456',
      });

      // Session service called with server-controlled userId
      expect(mockSessionService.createSession).toHaveBeenCalledWith({
        userId: testUserId,
        ipAddress: clientIp,
        userAgent: 'TestBrowser',
      });

      // Security audit events logged
      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: SecurityEventType.OTP_VERIFIED,
          userId: testUserId,
          ipAddress: clientIp,
          metadata: {
            purpose: OtpPurpose.LOGIN,
            challengeId: 'otp-challenge-123',
          },
        },
      });
      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: SecurityEventType.LOGIN_SUCCESS,
          userId: testUserId,
          sessionId: 'sess-uuid-1',
          ipAddress: clientIp,
        },
      });
    });

    it('supports code property alias as an alternative to otp', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUserWithRoles);
      mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
        success: true,
        status: 'SUCCESS',
        challengeId: 'otp-challenge-123',
      });

      const response = await service.verifyLoginOtp({
        email: 'jane.doe@example.com',
        code: '654321',
      });

      expect(response.success).toBe(true);
      expect(mockOtpService.verifyAndConsumeOtp).toHaveBeenCalledWith({
        identifier: 'jane.doe@example.com',
        purpose: OtpPurpose.LOGIN,
        code: '654321',
      });
    });

    it('rejects missing or malformed verification code without consuming OTP or issuing session', async () => {
      await expect(
        service.verifyLoginOtp({ email: 'jane.doe@example.com', otp: '12345' }),
      ).rejects.toThrow('Verification code must be exactly 6 digits.');

      expect(mockOtpService.verifyAndConsumeOtp).not.toHaveBeenCalled();
      expect(mockSessionService.createSession).not.toHaveBeenCalled();
    });

    it('rejects nonexistent user accounts with 404', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.verifyLoginOtp(validVerifyLoginDto)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockSessionService.createSession).not.toHaveBeenCalled();
    });

    it('rejects suspended accounts with 403', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        ...mockActiveUserWithRoles,
        accountStatus: AccountStatus.SUSPENDED,
      });

      await expect(service.verifyLoginOtp(validVerifyLoginDto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockSessionService.createSession).not.toHaveBeenCalled();
    });

    it('rejects unverified email accounts with 403', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        ...mockActiveUserWithRoles,
        emailVerified: false,
      });

      await expect(service.verifyLoginOtp(validVerifyLoginDto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockSessionService.createSession).not.toHaveBeenCalled();
    });

    it('rejects when OTP code is invalid without issuing session', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUserWithRoles);
      mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
        success: false,
        status: 'INVALID_CODE',
      });

      await expect(service.verifyLoginOtp(validVerifyLoginDto)).rejects.toThrow(
        'Invalid verification code.',
      );
      expect(mockSessionService.createSession).not.toHaveBeenCalled();
    });

    it('rejects when OTP is expired without issuing session', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUserWithRoles);
      mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
        success: false,
        status: 'EXPIRED',
      });

      await expect(service.verifyLoginOtp(validVerifyLoginDto)).rejects.toThrow(
        'Verification code has expired. Please log in again.',
      );
      expect(mockSessionService.createSession).not.toHaveBeenCalled();
    });
  });

  describe('refresh endpoint (POST /auth/refresh)', () => {
    it('delegates to SessionService.rotateSession and returns rotated session and new access token', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: testUserId,
        email: 'jane.doe@example.com',
        accountStatus: AccountStatus.ACTIVE,
        emailVerified: true,
        userRoles: [{ role: { name: 'CANDIDATE' } }],
      });

      const response = await service.refresh(
        { refreshToken: 'sess-uuid-1.mockSecretToken12345678901234567890' },
        { ipAddress: '198.51.100.99', userAgent: 'NewBrowser' },
      );

      expect(mockSessionService.rotateSession).toHaveBeenCalledWith(
        'sess-uuid-1.mockSecretToken12345678901234567890',
        { ipAddress: '198.51.100.99', userAgent: 'NewBrowser' },
      );

      expect(mockTokenService.generateAccessToken).toHaveBeenCalledWith({
        userId: testUserId,
        email: 'jane.doe@example.com',
        roles: ['CANDIDATE'],
        sessionId: 'sess-uuid-2',
      });

      expect(response).toEqual({
        success: true,
        message: 'Session refreshed successfully.',
        accessToken: 'mock.signed.access.token',
        tokenType: 'Bearer',
        expiresIn: 900,
        session: {
          id: 'sess-uuid-2',
          refreshToken: 'sess-uuid-2.mockRotatedSecret1234567890123456',
          expiresAt: expect.any(Date),
        },
        user: {
          id: testUserId,
          email: 'jane.doe@example.com',
          roles: ['CANDIDATE'],
        },
      });
    });

    it('rejects refresh when user account is suspended with 403 Forbidden', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: testUserId,
        email: 'jane.doe@example.com',
        accountStatus: AccountStatus.SUSPENDED,
        emailVerified: true,
        userRoles: [{ role: { name: 'CANDIDATE' } }],
      });

      await expect(
        service.refresh({ refreshToken: 'sess-uuid-1.secret12345678901234567890' }),
      ).rejects.toThrow('Account is not active.');
    });

    it('rejects refresh when user account is deactivated with 403 Forbidden', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: testUserId,
        email: 'jane.doe@example.com',
        accountStatus: AccountStatus.DEACTIVATED,
        emailVerified: true,
        userRoles: [{ role: { name: 'CANDIDATE' } }],
      });

      await expect(
        service.refresh({ refreshToken: 'sess-uuid-1.secret12345678901234567890' }),
      ).rejects.toThrow('Account is not active.');
    });

    it('rejects refresh when user account email is unverified with 403 Forbidden', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: testUserId,
        email: 'jane.doe@example.com',
        accountStatus: AccountStatus.ACTIVE,
        emailVerified: false,
        userRoles: [{ role: { name: 'CANDIDATE' } }],
      });

      await expect(
        service.refresh({ refreshToken: 'sess-uuid-1.secret12345678901234567890' }),
      ).rejects.toThrow('Email address not verified.');
    });
  });

  describe('logout endpoint (POST /auth/logout)', () => {
    it('delegates to SessionService.revokeSession', async () => {
      const response = await service.logout(
        { refreshToken: 'sess-uuid-1.mockSecretToken12345678901234567890' },
        '198.51.100.99',
      );

      expect(mockSessionService.revokeSession).toHaveBeenCalledWith(
        'sess-uuid-1.mockSecretToken12345678901234567890',
        '198.51.100.99',
      );

      expect(response).toEqual({
        success: true,
        message: 'Logged out successfully.',
      });
    });
  });

  describe('forgotPassword endpoint (POST /auth/forgot-password)', () => {
    const validForgotDto: ForgotPasswordDto = {
      email: 'jane.doe@example.com',
    };
    const clientIp = '203.0.113.10';

    const mockActiveUser = {
      id: testUserId,
      email: 'jane.doe@example.com',
      accountStatus: AccountStatus.ACTIVE,
      emailVerified: true,
    };

    it('successfully issues PASSWORD_RESET OTP, sends email, and logs audit event for eligible user', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUser);
      mockOtpService.issueOtp.mockResolvedValueOnce({
        challengeId: 'otp-challenge-reset-1',
        code: '654321',
        expiresAt: new Date(Date.now() + 600000),
      });

      const response = await service.forgotPassword(validForgotDto, clientIp);

      expect(response).toEqual({
        success: true,
        message: 'If an account exists with this email address, password reset instructions have been sent.',
      });

      expect(mockOtpService.issueOtp).toHaveBeenCalledWith({
        identifier: 'jane.doe@example.com',
        purpose: OtpPurpose.PASSWORD_RESET,
        userId: testUserId,
      });

      expect(mockEmailService.sendOtpEmail).toHaveBeenCalledWith({
        recipientEmail: 'jane.doe@example.com',
        purpose: OtpPurpose.PASSWORD_RESET,
        otpCode: '654321',
      });

      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: SecurityEventType.PASSWORD_RESET_REQUEST,
          userId: testUserId,
          ipAddress: clientIp,
          metadata: {
            challengeId: 'otp-challenge-reset-1',
          },
        },
      });
    });

    it('returns identical success response for unknown account without issuing OTP or sending email (privacy preservation)', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      const response = await service.forgotPassword({ email: 'unknown.user@example.com' }, clientIp);

      expect(response).toEqual({
        success: true,
        message: 'If an account exists with this email address, password reset instructions have been sent.',
      });

      expect(mockOtpService.issueOtp).not.toHaveBeenCalled();
      expect(mockEmailService.sendOtpEmail).not.toHaveBeenCalled();
    });

    it('returns identical success response for suspended account without issuing OTP or sending email', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        ...mockActiveUser,
        accountStatus: AccountStatus.SUSPENDED,
      });

      const response = await service.forgotPassword(validForgotDto, clientIp);

      expect(response).toEqual({
        success: true,
        message: 'If an account exists with this email address, password reset instructions have been sent.',
      });

      expect(mockOtpService.issueOtp).not.toHaveBeenCalled();
      expect(mockEmailService.sendOtpEmail).not.toHaveBeenCalled();
      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: SecurityEventType.PASSWORD_RESET_REQUEST,
          userId: testUserId,
          ipAddress: clientIp,
          metadata: { reason: 'ineligible_account_suspended' },
        },
      });
    });

    it('returns identical success response for unverified account without issuing OTP or sending email', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        ...mockActiveUser,
        emailVerified: false,
      });

      const response = await service.forgotPassword(validForgotDto, clientIp);

      expect(response).toEqual({
        success: true,
        message: 'If an account exists with this email address, password reset instructions have been sent.',
      });

      expect(mockOtpService.issueOtp).not.toHaveBeenCalled();
      expect(mockEmailService.sendOtpEmail).not.toHaveBeenCalled();
      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: SecurityEventType.PASSWORD_RESET_REQUEST,
          userId: testUserId,
          ipAddress: clientIp,
          metadata: { reason: 'ineligible_account_unverified' },
        },
      });
    });

    it('enforces IP-level rate limiting and rejects when limit is exceeded', async () => {
      mockRateLimitService.isAllowed.mockResolvedValueOnce(false); // IP blocked

      await expect(service.forgotPassword(validForgotDto, clientIp)).rejects.toThrow(
        /too many password reset requests from this ip/i,
      );

      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('enforces account-level rate limiting using privacy-preserving hashed email key', async () => {
      mockRateLimitService.isAllowed
        .mockResolvedValueOnce(true) // IP allowed
        .mockResolvedValueOnce(false); // Account blocked

      await expect(service.forgotPassword(validForgotDto, clientIp)).rejects.toThrow(
        /too many password reset requests for this account/i,
      );

      expect(mockRateLimitService.isAllowed).toHaveBeenNthCalledWith(
        2,
        expect.stringMatching(/^forgot:acct:[0-9a-f]{32}$/),
        expect.any(Object),
      );
      // Ensure raw email is NEVER part of the rate-limit key
      expect(mockRateLimitService.isAllowed.mock.calls[1][0]).not.toContain('jane.doe@example.com');
    });

    it('handles email delivery failure without leaking internal details or claiming success', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUser);
      mockOtpService.issueOtp.mockResolvedValueOnce({
        challengeId: 'otp-challenge-reset-1',
        code: '654321',
        expiresAt: new Date(Date.now() + 600000),
      });
      mockEmailService.sendOtpEmail.mockRejectedValueOnce(
        new Error('SMTP transport connection refused to internal.mail.host:25'),
      );

      await expect(service.forgotPassword(validForgotDto, clientIp)).rejects.toThrow(
        'Unable to deliver password reset email. Please try again later.',
      );
    });

    it('handles database error during user lookup safely', async () => {
      mockPrisma.user.findUnique.mockRejectedValueOnce(new Error('PostgreSQL connection dropped'));

      await expect(service.forgotPassword(validForgotDto, clientIp)).rejects.toThrow(
        'Password reset request failed due to a server error.',
      );
    });
  });

  describe('resetPassword endpoint (POST /auth/reset-password)', () => {
    const validResetDto: ResetPasswordDto = {
      email: 'jane.doe@example.com',
      otp: '654321',
      newPassword: 'BrandNewSecurePassword123!',
      passwordConfirmation: 'BrandNewSecurePassword123!',
    };
    const clientIp = '203.0.113.10';

    const mockActiveUser = {
      id: testUserId,
      email: 'jane.doe@example.com',
      passwordHash: hashedPassword,
      accountStatus: AccountStatus.ACTIVE,
      emailVerified: true,
    };

    it('completes valid password reset: verifies OTP, checks policy/history, updates DB in transaction, and revokes active sessions', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUser);
      mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
        success: true,
        status: 'SUCCESS',
        challengeId: 'otp-challenge-reset-1',
        userId: testUserId,
      });
      mockPasswordHashingService.verify.mockResolvedValueOnce(false); // Does not match current password
      mockPasswordHistoryService.isPasswordReused.mockResolvedValueOnce(false); // Does not match history
      mockPasswordHashingService.hash.mockResolvedValueOnce('$argon2id$v=19$newHash');

      const response = await service.resetPassword(validResetDto, { ipAddress: clientIp });

      expect(response).toEqual({
        success: true,
        message: 'Password has been reset successfully. Please sign in with your new password.',
      });

      // OTP verified for PASSWORD_RESET purpose
      expect(mockOtpService.verifyAndConsumeOtp).toHaveBeenCalledWith({
        identifier: 'jane.doe@example.com',
        purpose: OtpPurpose.PASSWORD_RESET,
        code: '654321',
      });

      // Password policy validated
      expect(mockPasswordPolicyService.validate).toHaveBeenCalledWith('BrandNewSecurePassword123!');

      // Current password checked
      expect(mockPasswordHashingService.verify).toHaveBeenCalledWith(hashedPassword, 'BrandNewSecurePassword123!');

      // History checked
      expect(mockPasswordHistoryService.isPasswordReused).toHaveBeenCalledWith(testUserId, 'BrandNewSecurePassword123!');

      // Hashed with Argon2id
      expect(mockPasswordHashingService.hash).toHaveBeenCalledWith('BrandNewSecurePassword123!');

      // Transaction executed
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockTx.user.update).toHaveBeenCalledWith({
        where: { id: testUserId },
        data: { passwordHash: '$argon2id$v=19$newHash' },
      });
      expect(mockTx.passwordHistory.create).toHaveBeenCalledWith({
        data: {
          userId: testUserId,
          passwordHash: '$argon2id$v=19$newHash',
        },
      });
      expect(mockTx.securityEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: SecurityEventType.PASSWORD_RESET_COMPLETE,
          userId: testUserId,
          ipAddress: clientIp,
        },
      });

      // All active sessions revoked
      expect(mockSessionService.revokeAllUserSessions).toHaveBeenCalledWith(testUserId, 'password_reset');
    });

    it('supports alias properties: code, password, confirmPassword', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUser);
      mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
        success: true,
        status: 'SUCCESS',
        challengeId: 'otp-challenge-reset-1',
      });
      mockPasswordHashingService.verify.mockResolvedValueOnce(false);
      mockPasswordHistoryService.isPasswordReused.mockResolvedValueOnce(false);
      mockPasswordHashingService.hash.mockResolvedValueOnce('$argon2id$v=19$newHash');

      const response = await service.resetPassword({
        email: 'jane.doe@example.com',
        code: '654321',
        password: 'BrandNewSecurePassword123!',
        confirmPassword: 'BrandNewSecurePassword123!',
      });

      expect(response.success).toBe(true);
      expect(mockOtpService.verifyAndConsumeOtp).toHaveBeenCalledWith({
        identifier: 'jane.doe@example.com',
        purpose: OtpPurpose.PASSWORD_RESET,
        code: '654321',
      });
    });

    it('rejects missing or malformed OTP code', async () => {
      await expect(
        service.resetPassword({
          ...validResetDto,
          otp: '123',
        }),
      ).rejects.toThrow('Verification code must be exactly 6 digits.');
    });

    it('rejects password confirmation mismatch', async () => {
      await expect(
        service.resetPassword({
          ...validResetDto,
          passwordConfirmation: 'MismatchedPassword123!',
        }),
      ).rejects.toThrow('Password confirmation does not match new password.');
    });

    it('rejects password that violates password policy', async () => {
      mockPasswordPolicyService.validate.mockReturnValueOnce({
        valid: false,
        violations: [{ rule: 'min_length', message: 'Password must be at least 12 characters long.' }],
      });

      await expect(service.resetPassword(validResetDto)).rejects.toThrow(BadRequestException);

      expect(mockOtpService.verifyAndConsumeOtp).not.toHaveBeenCalled();
    });

    it('rejects nonexistent user account with 404', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.resetPassword(validResetDto)).rejects.toThrow(NotFoundException);
      expect(mockOtpService.verifyAndConsumeOtp).not.toHaveBeenCalled();
    });

    it('rejects suspended account with 403', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        ...mockActiveUser,
        accountStatus: AccountStatus.SUSPENDED,
      });

      await expect(service.resetPassword(validResetDto)).rejects.toThrow(ForbiddenException);
      expect(mockOtpService.verifyAndConsumeOtp).not.toHaveBeenCalled();
    });

    it('rejects unverified account with 403', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        ...mockActiveUser,
        emailVerified: false,
      });

      await expect(service.resetPassword(validResetDto)).rejects.toThrow(ForbiddenException);
      expect(mockOtpService.verifyAndConsumeOtp).not.toHaveBeenCalled();
    });

    it('rejects invalid OTP code', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUser);
      mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
        success: false,
        status: 'INVALID_CODE',
      });

      await expect(service.resetPassword(validResetDto)).rejects.toThrow(
        'Invalid verification code.',
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects expired OTP code', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUser);
      mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
        success: false,
        status: 'EXPIRED',
      });

      await expect(service.resetPassword(validResetDto)).rejects.toThrow(
        'Verification code has expired. Please request a new password reset.',
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects already consumed OTP code preventing reuse and concurrent replay attacks', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUser);
      mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
        success: false,
        status: 'ALREADY_CONSUMED',
      });

      await expect(service.resetPassword(validResetDto)).rejects.toThrow(
        'Verification code has already been consumed.',
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects exhausted OTP code exceeding attempt limit', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUser);
      mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
        success: false,
        status: 'EXHAUSTED',
      });

      await expect(service.resetPassword(validResetDto)).rejects.toThrow(
        'Verification code has exceeded the maximum number of attempts.',
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects new password matching current password', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUser);
      mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
        success: true,
        status: 'SUCCESS',
      });
      mockPasswordHashingService.verify.mockResolvedValueOnce(true); // Matches current password!

      await expect(service.resetPassword(validResetDto)).rejects.toThrow(
        'New password cannot be the same as your current password.',
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects new password matching historical password hashes', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUser);
      mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
        success: true,
        status: 'SUCCESS',
      });
      mockPasswordHashingService.verify.mockResolvedValueOnce(false);
      mockPasswordHistoryService.isPasswordReused.mockResolvedValueOnce(true); // Matches history!

      await expect(service.resetPassword(validResetDto)).rejects.toThrow(
        'New password cannot be one of your recently used passwords.',
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('handles database transaction error safely and throws safe 500 error', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockActiveUser);
      mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
        success: true,
        status: 'SUCCESS',
      });
      mockPasswordHashingService.verify.mockResolvedValueOnce(false);
      mockPasswordHistoryService.isPasswordReused.mockResolvedValueOnce(false);
      mockPasswordHashingService.hash.mockResolvedValueOnce('$argon2id$v=19$newHash');
      mockPrisma.$transaction.mockRejectedValueOnce(new Error('PostgreSQL deadlock on update'));

      await expect(service.resetPassword(validResetDto)).rejects.toThrow(
        'Password reset failed due to a server error.',
      );
    });
  });

  describe('Security Audit Logging and Secret Redaction', () => {
    it('never records raw passwords, raw OTPs, refresh tokens, access tokens, or password hashes to securityEvent', async () => {
      // 1. Perform registration
      await service.register(defaultDto);

      // Verify that no secret strings leaked into event metadata
      for (const call of mockTx.securityEvent.create.mock.calls) {
        const metadata = JSON.stringify(call[0]?.data?.metadata ?? {});
        expect(metadata).not.toContain(validPassword);
        expect(metadata).not.toContain(hashedPassword);
        expect(metadata).not.toContain('mockSecretToken');
        expect(metadata).not.toContain('123456'); // raw OTP
      }
    });

    it('revokes all active sessions upon password reset', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: testUserId,
        email: 'jane.doe@example.com',
        passwordHash: hashedPassword,
        accountStatus: AccountStatus.ACTIVE,
        emailVerified: true,
      });
      mockOtpService.verifyAndConsumeOtp.mockResolvedValueOnce({
        success: true,
        status: 'SUCCESS',
        challengeId: 'otp-challenge-123',
      });
      mockPasswordHashingService.verify.mockResolvedValueOnce(false);
      mockPasswordHistoryService.isPasswordReused.mockResolvedValueOnce(false);
      mockPasswordHashingService.hash.mockResolvedValueOnce('$argon2id$v=19$newHash');
      mockPrisma.$transaction.mockResolvedValueOnce(undefined);

      await service.resetPassword({
        email: 'jane.doe@example.com',
        otp: '123456',
        newPassword: 'BrandNewPassword123!',
        passwordConfirmation: 'BrandNewPassword123!',
      });

      expect(mockSessionService.revokeAllUserSessions).toHaveBeenCalledWith(
        testUserId,
        'password_reset',
      );
      expect(mockTokenService.revokeUserTokens).toHaveBeenCalledWith(
        testUserId,
        'password_reset',
      );
      expect(mockTokenService.invalidateAccountState).toHaveBeenCalledWith(testUserId);
    });
  });

  // ===========================================================================
  // Account Status & Role Lifecycle Management
  // ===========================================================================
  describe('Account Status & Role Lifecycle Management', () => {
    describe('updateAccountStatus', () => {
      it('suspends user, updates database, records audit event, and revokes sessions and access tokens', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({
          id: testUserId,
          accountStatus: AccountStatus.ACTIVE,
        });
        mockPrisma.$transaction.mockResolvedValueOnce([{}, {}]);

        const result = await service.updateAccountStatus(
          testUserId,
          AccountStatus.SUSPENDED,
          'policy_violation',
        );

        expect(result.success).toBe(true);
        expect(result.user.accountStatus).toBe(AccountStatus.SUSPENDED);
        expect(mockPrisma.$transaction).toHaveBeenCalledWith([
          expect.anything(),
          expect.anything(),
        ]);
        expect(mockTokenService.invalidateAccountState).toHaveBeenCalledWith(testUserId);
        expect(mockSessionService.revokeAllUserSessions).toHaveBeenCalledWith(
          testUserId,
          'policy_violation',
        );
        expect(mockTokenService.revokeUserTokens).toHaveBeenCalledWith(
          testUserId,
          'policy_violation',
        );
      });

      it('rejects status update when actor lacks administrator privileges', async () => {
        const candidateActor: any = {
          id: 'actor-cand-1',
          roles: ['CANDIDATE'],
        };

        await expect(
          service.updateAccountStatus(
            testUserId,
            AccountStatus.SUSPENDED,
            'test',
            candidateActor,
          ),
        ).rejects.toThrow(ForbiddenException);
      });
    });

    describe('assignRole', () => {
      it('assigns role, records ROLE_ASSIGNED event, and revokes prior tokens to force refresh', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({ id: testUserId });
        mockPrisma.role.findUnique.mockResolvedValueOnce({ id: 'role-recruiter-id', name: 'RECRUITER' });
        mockPrisma.userRole.findUnique.mockResolvedValueOnce(null);
        mockPrisma.$transaction.mockResolvedValueOnce([{}, {}]);

        const adminActor: any = { id: 'admin-1', roles: ['ADMIN'] };
        const result = await service.assignRole(testUserId, 'RECRUITER' as any, adminActor);

        expect(result.success).toBe(true);
        expect(mockTokenService.invalidateAccountState).toHaveBeenCalledWith(testUserId);
        expect(mockTokenService.revokeUserTokens).toHaveBeenCalledWith(testUserId, 'role_assigned');
      });
    });

    describe('revokeRole', () => {
      it('revokes role, records ROLE_REVOKED event, and revokes tokens and sessions immediately', async () => {
        mockPrisma.role.findUnique.mockResolvedValueOnce({ id: 'role-admin-id', name: 'ADMIN' });
        mockPrisma.userRole.findUnique.mockResolvedValueOnce({ id: 'ur-1', userId: testUserId, roleId: 'role-admin-id' });
        mockPrisma.$transaction.mockResolvedValueOnce([{}, {}]);

        const superAdminActor: any = { id: 'super-1', roles: ['SUPER_ADMIN'] };
        const result = await service.revokeRole(testUserId, 'ADMIN' as any, superAdminActor);

        expect(result.success).toBe(true);
        expect(mockTokenService.invalidateAccountState).toHaveBeenCalledWith(testUserId);
        expect(mockTokenService.revokeUserTokens).toHaveBeenCalledWith(testUserId, 'role_revoked');
        expect(mockSessionService.revokeAllUserSessions).toHaveBeenCalledWith(testUserId, 'role_revoked');
      });
    });
  });
});

