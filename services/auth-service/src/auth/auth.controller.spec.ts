import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountStatus } from '@prisma/client';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { VerifyLoginOtpDto } from './dto/verify-login-otp.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { LogoutDto } from './dto/logout.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { AuthConfigService } from '../config/auth-config.service.js';

describe('AuthController', () => {
  let controller: AuthController;
  let mockAuthService: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockAuthService = {
      register: vi.fn().mockResolvedValue({
        id: 'user-uuid-123',
        email: 'test@example.com',
        fullName: 'Test Candidate',
        mobileNumber: '+15551234567',
        emailVerified: false,
        accountStatus: AccountStatus.ACTIVE,
        createdAt: new Date('2026-10-12T00:00:00.000Z'),
        emailDelivery: {
          sent: true,
          message: 'Verification email sent successfully.',
        },
      }),
      verifyEmail: vi.fn().mockResolvedValue({
        success: true,
        message: 'Email address verified successfully.',
        email: 'test@example.com',
        emailVerified: true,
      }),
      login: vi.fn().mockResolvedValue({
        authenticated: false,
        nextStep: 'VERIFY_LOGIN_OTP',
        email: 'test@example.com',
        message: 'Credentials verified. Please check your email for a login verification code.',
        otpDelivery: {
          sent: true,
          message: 'A login verification code has been sent to your email.',
        },
      }),
      verifyLoginOtp: vi.fn().mockResolvedValue({
        success: true,
        message: 'Login successful.',
        accessToken: 'mock.jwt.access.token',
        tokenType: 'Bearer',
        expiresIn: 900,
        session: {
          id: 'sess-uuid-1',
          refreshToken: 'sess-uuid-1.mockSecretToken12345678901234567890',
          expiresAt: new Date('2026-10-19T00:00:00.000Z'),
        },
        user: {
          id: 'user-uuid-123',
          email: 'test@example.com',
          roles: ['CANDIDATE'],
        },
      }),
      refresh: vi.fn().mockResolvedValue({
        success: true,
        message: 'Session refreshed successfully.',
        accessToken: 'mock.jwt.access.token',
        tokenType: 'Bearer',
        expiresIn: 900,
        session: {
          id: 'sess-uuid-2',
          refreshToken: 'sess-uuid-2.mockRotatedSecret1234567890123456',
          expiresAt: new Date('2026-10-19T00:00:00.000Z'),
        },
      }),
      logout: vi.fn().mockResolvedValue({
        success: true,
        message: 'Logged out successfully.',
      }),
      forgotPassword: vi.fn().mockResolvedValue({
        success: true,
        message: 'If an account exists with this email address, password reset instructions have been sent.',
      }),
      resetPassword: vi.fn().mockResolvedValue({
        success: true,
        message: 'Password has been reset successfully. Please sign in with your new password.',
      }),
    };

    mockConfigService = {
      nodeEnv: 'development',
      appBaseUrl: 'http://127.0.0.1:3001',
      trustProxy: true,
      session: { refreshTokenTtlDays: 7 },
      jwt: {
        secret: 'dev_jwt_secret_placeholder_at_least_32_characters_long',
        expiresInSeconds: 900,
        issuer: 'arep-auth-service',
        audience: 'arep-api',
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: AuthConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = moduleRef.get(AuthController);
  });

  it('delegates registration request to AuthService and returns safe response', async () => {
    const dto: RegisterDto = {
      fullName: 'Test Candidate',
      email: 'test@example.com',
      mobileNumber: '+15551234567',
      password: 'StrongPassword123!',
      passwordConfirmation: 'StrongPassword123!',
      termsAccepted: true,
    };

    const response = await controller.register(dto);

    expect(mockAuthService.register).toHaveBeenCalledWith(dto);
    expect(response).toEqual({
      id: 'user-uuid-123',
      email: 'test@example.com',
      fullName: 'Test Candidate',
      mobileNumber: '+15551234567',
      emailVerified: false,
      accountStatus: AccountStatus.ACTIVE,
      createdAt: expect.any(Date),
      emailDelivery: {
        sent: true,
        message: 'Verification email sent successfully.',
      },
    });
  });

  it('delegates email verification request to AuthService and returns safe response', async () => {
    const dto: VerifyEmailDto = {
      email: 'test@example.com',
      otp: '123456',
    };

    const response = await controller.verifyEmail(dto);

    expect(mockAuthService.verifyEmail).toHaveBeenCalledWith(dto);
    expect(response).toEqual({
      success: true,
      message: 'Email address verified successfully.',
      email: 'test@example.com',
      emailVerified: true,
    });
  });

  it('delegates login request to AuthService with extracted client IP', async () => {
    const dto: LoginDto = {
      email: 'test@example.com',
      password: 'StrongPassword123!',
    };

    const response = await controller.login(
      dto,
      '192.0.2.1',
      { headers: { 'x-forwarded-for': '198.51.100.42, 10.0.0.1' } },
    );

    expect(mockAuthService.login).toHaveBeenCalledWith(dto, '198.51.100.42');
    expect(response).toEqual({
      authenticated: false,
      nextStep: 'VERIFY_LOGIN_OTP',
      email: 'test@example.com',
      message: 'Credentials verified. Please check your email for a login verification code.',
      otpDelivery: {
        sent: true,
        message: 'A login verification code has been sent to your email.',
      },
    });
  });

  it('delegates login request using fallback IP when no headers are present', async () => {
    const dto: LoginDto = {
      email: 'test@example.com',
      password: 'StrongPassword123!',
    };

    await controller.login(dto, '192.0.2.1');
    expect(mockAuthService.login).toHaveBeenCalledWith(dto, '192.0.2.1');
  });

  it('delegates verifyLoginOtp request to AuthService with extracted client IP and user-agent', async () => {
    const dto: VerifyLoginOtpDto = {
      email: 'test@example.com',
      otp: '123456',
    };

    const response = await controller.verifyLoginOtp(
      dto,
      '192.0.2.1',
      {
        headers: {
          'x-forwarded-for': '198.51.100.42, 10.0.0.1',
          'user-agent': 'CustomAgent/1.0',
        },
      },
    );

    expect(mockAuthService.verifyLoginOtp).toHaveBeenCalledWith(dto, {
      ipAddress: '198.51.100.42',
      userAgent: 'CustomAgent/1.0',
    });
    expect(response.success).toBe(true);
    expect(response.session.id).toBe('sess-uuid-1');
  });

  it('delegates refresh request to AuthService', async () => {
    const dto: RefreshTokenDto = {
      refreshToken: 'sess-uuid-1.secret12345678901234567890',
    };

    const response = await controller.refresh(
      dto,
      '192.0.2.1',
      { headers: { 'user-agent': 'CustomAgent/1.0' } },
    );

    expect(mockAuthService.refresh).toHaveBeenCalledWith(dto, {
      ipAddress: '192.0.2.1',
      userAgent: 'CustomAgent/1.0',
    });
    expect(response.success).toBe(true);
    expect(response.session.id).toBe('sess-uuid-2');
  });

  it('delegates logout request to AuthService', async () => {
    const dto: LogoutDto = {
      refreshToken: 'sess-uuid-1.secret12345678901234567890',
    };

    const response = await controller.logout(dto, '192.0.2.1');

    expect(mockAuthService.logout).toHaveBeenCalledWith(dto, '192.0.2.1');
    expect(response).toEqual({
      success: true,
      message: 'Logged out successfully.',
    });
  });

  it('delegates forgotPassword request to AuthService with extracted client IP', async () => {
    const dto: ForgotPasswordDto = {
      email: 'test@example.com',
    };

    const response = await controller.forgotPassword(
      dto,
      '192.0.2.1',
      {
        headers: {
          'x-forwarded-for': '198.51.100.77',
        },
      },
    );

    expect(mockAuthService.forgotPassword).toHaveBeenCalledWith(dto, '198.51.100.77');
    expect(response).toEqual({
      success: true,
      message: 'If an account exists with this email address, password reset instructions have been sent.',
    });
  });

  it('delegates resetPassword request to AuthService with extracted client IP and user agent', async () => {
    const dto: ResetPasswordDto = {
      email: 'test@example.com',
      otp: '654321',
      newPassword: 'BrandNewSecurePassword123!',
      passwordConfirmation: 'BrandNewSecurePassword123!',
    };

    const response = await controller.resetPassword(
      dto,
      '192.0.2.1',
      {
        headers: {
          'x-forwarded-for': '198.51.100.88',
          'user-agent': 'CustomAgent/2.0',
        },
      },
    );

    expect(mockAuthService.resetPassword).toHaveBeenCalledWith(dto, {
      ipAddress: '198.51.100.88',
      userAgent: 'CustomAgent/2.0',
    });
    expect(response).toEqual({
      success: true,
      message: 'Password has been reset successfully. Please sign in with your new password.',
    });
  });

  describe('RegisterDto validation pipe behavior', () => {
    it('rejects forbidden non-whitelisted properties (e.g. attempting to inject a role)', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          {
            fullName: 'Attacker',
            email: 'attacker@example.com',
            password: 'StrongPassword123!',
            passwordConfirmation: 'StrongPassword123!',
            role: 'ADMIN',
          },
          { type: 'body', metatype: RegisterDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects invalid email format', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          {
            fullName: 'Test Candidate',
            email: 'not-an-email',
            password: 'StrongPassword123!',
            passwordConfirmation: 'StrongPassword123!',
          },
          { type: 'body', metatype: RegisterDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects short passwords under 12 characters', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          {
            fullName: 'Test Candidate',
            email: 'test@example.com',
            password: 'Short1!',
            passwordConfirmation: 'Short1!',
          },
          { type: 'body', metatype: RegisterDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects candidate registration payload containing privileged roles (role: ADMIN / SUPER_ADMIN)', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          {
            fullName: 'Test Candidate',
            email: 'test@example.com',
            password: 'StrongPassword123!',
            passwordConfirmation: 'StrongPassword123!',
            role: 'ADMIN',
          },
          { type: 'body', metatype: RegisterDto },
        ),
      ).rejects.toThrow();

      await expect(
        pipe.transform(
          {
            fullName: 'Test Candidate',
            email: 'test@example.com',
            password: 'StrongPassword123!',
            passwordConfirmation: 'StrongPassword123!',
            roles: ['SUPER_ADMIN'],
          },
          { type: 'body', metatype: RegisterDto },
        ),
      ).rejects.toThrow();
    });
  });

  describe('VerifyEmailDto validation pipe behavior', () => {
    it('accepts valid email and 6-digit numeric OTP', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      const result = await pipe.transform(
        {
          email: 'jane.doe@example.com',
          otp: '123456',
        },
        { type: 'body', metatype: VerifyEmailDto },
      );

      expect(result.email).toBe('jane.doe@example.com');
      expect(result.otp).toBe('123456');
    });

    it('accepts valid email and 6-digit numeric code alias', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      const result = await pipe.transform(
        {
          email: 'jane.doe@example.com',
          code: '654321',
        },
        { type: 'body', metatype: VerifyEmailDto },
      );

      expect(result.email).toBe('jane.doe@example.com');
      expect(result.code).toBe('654321');
    });

    it('rejects invalid email address', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          {
            email: 'not-an-email',
            otp: '123456',
          },
          { type: 'body', metatype: VerifyEmailDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects OTP shorter than 6 digits', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          {
            email: 'jane.doe@example.com',
            otp: '12345',
          },
          { type: 'body', metatype: VerifyEmailDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects OTP containing letters', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          {
            email: 'jane.doe@example.com',
            otp: '12345a',
          },
          { type: 'body', metatype: VerifyEmailDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects unwhitelisted fields (forbidNonWhitelisted)', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          {
            email: 'jane.doe@example.com',
            otp: '123456',
            isAdmin: true,
          },
          { type: 'body', metatype: VerifyEmailDto },
        ),
      ).rejects.toThrow();
    });
  });

  describe('LoginDto validation pipe behavior', () => {
    it('accepts valid email and password', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      const result = await pipe.transform(
        {
          email: 'jane.doe@example.com',
          password: 'SecretPassword123!',
        },
        { type: 'body', metatype: LoginDto },
      );

      expect(result.email).toBe('jane.doe@example.com');
      expect(result.password).toBe('SecretPassword123!');
    });

    it('rejects invalid email address', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          {
            email: 'not-an-email',
            password: 'SecretPassword123!',
          },
          { type: 'body', metatype: LoginDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects empty password', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          {
            email: 'jane.doe@example.com',
            password: '',
          },
          { type: 'body', metatype: LoginDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects password exceeding 128 characters', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          {
            email: 'jane.doe@example.com',
            password: 'a'.repeat(129),
          },
          { type: 'body', metatype: LoginDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects forbidden non-whitelisted properties (forbidNonWhitelisted)', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          {
            email: 'jane.doe@example.com',
            password: 'SecretPassword123!',
            role: 'SUPER_ADMIN',
          },
          { type: 'body', metatype: LoginDto },
        ),
      ).rejects.toThrow();
    });
  });

  describe('VerifyLoginOtpDto validation pipe behavior', () => {
    it('accepts valid email and 6-digit numeric OTP', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      const result = await pipe.transform(
        { email: 'jane.doe@example.com', otp: '123456' },
        { type: 'body', metatype: VerifyLoginOtpDto },
      );

      expect(result.email).toBe('jane.doe@example.com');
      expect(result.otp).toBe('123456');
    });

    it('accepts valid email and code alias', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      const result = await pipe.transform(
        { email: 'jane.doe@example.com', code: '654321' },
        { type: 'body', metatype: VerifyLoginOtpDto },
      );

      expect(result.email).toBe('jane.doe@example.com');
      expect(result.code).toBe('654321');
    });

    it('rejects non-numeric OTP', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          { email: 'jane.doe@example.com', otp: '12345a' },
          { type: 'body', metatype: VerifyLoginOtpDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects OTP of invalid length', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          { email: 'jane.doe@example.com', otp: '12345' },
          { type: 'body', metatype: VerifyLoginOtpDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects forbidden non-whitelisted properties (forbidNonWhitelisted)', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          { email: 'jane.doe@example.com', otp: '123456', adminOverride: true },
          { type: 'body', metatype: VerifyLoginOtpDto },
        ),
      ).rejects.toThrow();
    });
  });

  describe('RefreshTokenDto validation pipe behavior', () => {
    it('accepts omitted refresh token when delivered via cookie (empty body)', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      const result = await pipe.transform(
        {},
        { type: 'body', metatype: RefreshTokenDto },
      );

      expect(result.refreshToken).toBeUndefined();
    });

    it('accepts valid refresh token', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      const result = await pipe.transform(
        { refreshToken: 'sess-uuid-1.secret1234567890' },
        { type: 'body', metatype: RefreshTokenDto },
      );

      expect(result.refreshToken).toBe('sess-uuid-1.secret1234567890');
    });

    it('rejects empty refresh token', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          { refreshToken: '' },
          { type: 'body', metatype: RefreshTokenDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects oversized refresh token exceeding 512 characters', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          { refreshToken: 'a'.repeat(513) },
          { type: 'body', metatype: RefreshTokenDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects forbidden non-whitelisted properties (forbidNonWhitelisted)', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          { refreshToken: 'sess-uuid-1.secret1234567890', bypass: true },
          { type: 'body', metatype: RefreshTokenDto },
        ),
      ).rejects.toThrow();
    });
  });

  describe('LogoutDto validation pipe behavior', () => {
    it('accepts omitted refresh token when delivered via cookie (empty body)', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      const result = await pipe.transform(
        {},
        { type: 'body', metatype: LogoutDto },
      );

      expect(result.refreshToken).toBeUndefined();
    });

    it('accepts valid logout token', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      const result = await pipe.transform(
        { refreshToken: 'sess-uuid-1.secret1234567890' },
        { type: 'body', metatype: LogoutDto },
      );

      expect(result.refreshToken).toBe('sess-uuid-1.secret1234567890');
    });

    it('rejects empty logout token', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          { refreshToken: '' },
          { type: 'body', metatype: LogoutDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects oversized logout token exceeding 512 characters', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          { refreshToken: 'a'.repeat(513) },
          { type: 'body', metatype: LogoutDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects forbidden non-whitelisted properties on logout', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          { refreshToken: 'sess-uuid-1.secret1234567890', bypass: true },
          { type: 'body', metatype: LogoutDto },
        ),
      ).rejects.toThrow();
    });
  });

  describe('ForgotPasswordDto validation pipe behavior', () => {
    it('accepts valid email', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      const result = await pipe.transform(
        { email: 'user@example.com' },
        { type: 'body', metatype: ForgotPasswordDto },
      );

      expect(result.email).toBe('user@example.com');
    });

    it('rejects invalid email format', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          { email: 'not-an-email' },
          { type: 'body', metatype: ForgotPasswordDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects forbidden non-whitelisted properties', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          { email: 'user@example.com', unapprovedProperty: 'malicious' },
          { type: 'body', metatype: ForgotPasswordDto },
        ),
      ).rejects.toThrow();
    });
  });

  describe('ResetPasswordDto validation pipe behavior', () => {
    it('accepts valid reset password payload with newPassword and passwordConfirmation', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      const result = await pipe.transform(
        {
          email: 'user@example.com',
          otp: '123456',
          newPassword: 'BrandNewSecurePassword123!',
          passwordConfirmation: 'BrandNewSecurePassword123!',
        },
        { type: 'body', metatype: ResetPasswordDto },
      );

      expect(result.email).toBe('user@example.com');
      expect(result.otp).toBe('123456');
    });

    it('accepts alias fields: code, password, confirmPassword', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      const result = await pipe.transform(
        {
          email: 'user@example.com',
          code: '654321',
          password: 'BrandNewSecurePassword123!',
          confirmPassword: 'BrandNewSecurePassword123!',
        },
        { type: 'body', metatype: ResetPasswordDto },
      );

      expect(result.email).toBe('user@example.com');
      expect(result.code).toBe('654321');
    });

    it('rejects non-whitelisted properties (e.g. role injection)', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          {
            email: 'user@example.com',
            otp: '123456',
            newPassword: 'BrandNewSecurePassword123!',
            passwordConfirmation: 'BrandNewSecurePassword123!',
            role: 'ADMIN',
          },
          { type: 'body', metatype: ResetPasswordDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects invalid OTP length or non-numeric OTP', async () => {
      const { createValidationPipe } = await import('../common/create-validation-pipe.js');
      const pipe = createValidationPipe();

      await expect(
        pipe.transform(
          {
            email: 'user@example.com',
            otp: '12345',
            newPassword: 'BrandNewSecurePassword123!',
            passwordConfirmation: 'BrandNewSecurePassword123!',
          },
          { type: 'body', metatype: ResetPasswordDto },
        ),
      ).rejects.toThrow();

      await expect(
        pipe.transform(
          {
            email: 'user@example.com',
            otp: 'abcdef',
            newPassword: 'BrandNewSecurePassword123!',
            passwordConfirmation: 'BrandNewSecurePassword123!',
          },
          { type: 'body', metatype: ResetPasswordDto },
        ),
      ).rejects.toThrow();
    });
  });

  describe('Browser vs Native Token Delivery and CSRF Defenses', () => {
    it('sets HttpOnly cookie and omits refreshToken from JSON response for browser clients', async () => {
      const mockRes = {
        cookie: vi.fn(),
      };

      const dto: VerifyLoginOtpDto = {
        email: 'test@example.com',
        otp: '123456',
      };

      const response = await controller.verifyLoginOtp(
        dto,
        '192.0.2.1',
        { headers: {} },
        mockRes,
      );

      // HttpOnly cookie set with matched attributes
      expect(mockRes.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'sess-uuid-1.mockSecretToken12345678901234567890',
        {
          httpOnly: true,
          secure: false, // in development
          sameSite: 'lax',
          path: '/auth',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        },
      );

      // JSON response does NOT expose raw refresh token
      expect((response.session as any).refreshToken).toBeUndefined();
      expect(response.session.id).toBe('sess-uuid-1');
      expect(response.accessToken).toBeDefined();
    });

    it('returns refreshToken in JSON response and avoids setting cookies for native clients', async () => {
      const mockRes = {
        cookie: vi.fn(),
      };

      const dto: VerifyLoginOtpDto = {
        email: 'test@example.com',
        otp: '123456',
      };

      const response = await controller.verifyLoginOtp(
        dto,
        '192.0.2.1',
        { headers: { 'x-client-type': 'native' } },
        mockRes,
      );

      expect(mockRes.cookie).not.toHaveBeenCalled();
      expect((response.session as any).refreshToken).toBe(
        'sess-uuid-1.mockSecretToken12345678901234567890',
      );
    });

    it('clears refreshToken cookie upon logout using matching attributes', async () => {
      const mockRes = {
        clearCookie: vi.fn(),
      };

      const dto: LogoutDto = {
        refreshToken: '',
      };

      const response = await controller.logout(
        dto,
        '192.0.2.1',
        { headers: { cookie: 'refreshToken=sess-uuid-1.secret1234567890' } },
        mockRes,
      );

      expect(mockRes.clearCookie).toHaveBeenCalledWith('refreshToken', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/auth',
      });
      expect(response.success).toBe(true);
    });

    it('rejects cookie-authenticated refresh requests from untrusted origins (CSRF defense)', async () => {
      const mockRes = { cookie: vi.fn() };
      const req = {
        headers: {
          cookie: 'refreshToken=sess-uuid-1.secret1234567890',
          origin: 'https://malicious-attacker.com',
        },
      };

      await expect(
        controller.refresh({ refreshToken: '' }, '192.0.2.1', req, mockRes),
      ).rejects.toThrow('CSRF check failed: untrusted request origin.');
      expect(mockAuthService.refresh).not.toHaveBeenCalled();
    });

    it('rejects cookie-authenticated logout requests from untrusted referers (CSRF defense)', async () => {
      const mockRes = { clearCookie: vi.fn() };
      const req = {
        headers: {
          cookie: 'refreshToken=sess-uuid-1.secret1234567890',
          referer: 'https://evil.org/phishing',
        },
      };

      await expect(
        controller.logout({ refreshToken: '' }, '192.0.2.1', req, mockRes),
      ).rejects.toThrow('CSRF check failed: untrusted request referer.');
      expect(mockAuthService.logout).not.toHaveBeenCalled();
    });

    it('supports cookie-only refresh request with empty body object', async () => {
      const mockRes = { cookie: vi.fn() };
      const req = {
        headers: {
          cookie: 'refreshToken=sess-uuid-1.secret1234567890',
          origin: 'http://127.0.0.1:3001',
        },
      };

      const response = await controller.refresh({}, '192.0.2.1', req, mockRes);
      expect(mockAuthService.refresh).toHaveBeenCalledWith(
        { refreshToken: 'sess-uuid-1.secret1234567890' },
        expect.anything(),
      );
      expect(response.success).toBe(true);
      expect(mockRes.cookie).toHaveBeenCalledWith(
        'refreshToken',
        expect.any(String),
        expect.objectContaining({ httpOnly: true, path: '/auth' }),
      );
    });

    it('throws 401 Unauthorized when refresh is called without cookie or body token', async () => {
      const mockRes = { cookie: vi.fn() };
      const req = { headers: {} };

      await expect(
        controller.refresh({}, '192.0.2.1', req, mockRes),
      ).rejects.toThrow('Refresh token is required.');
    });

    it('supports cookie-only logout request with empty body object', async () => {
      const mockRes = { clearCookie: vi.fn() };
      const req = {
        headers: {
          cookie: 'refreshToken=sess-uuid-1.secret1234567890',
          origin: 'http://127.0.0.1:3001',
        },
      };

      const response = await controller.logout({}, '192.0.2.1', req, mockRes);
      expect(mockAuthService.logout).toHaveBeenCalledWith(
        { refreshToken: 'sess-uuid-1.secret1234567890' },
        '192.0.2.1',
      );
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'refreshToken',
        expect.objectContaining({ httpOnly: true, path: '/auth' }),
      );
      expect(response.success).toBe(true);
    });

    it('ignores client X-Forwarded-For header when trustProxy is disabled', async () => {
      mockConfigService.trustProxy = false;

      const dto: LoginDto = {
        email: 'test@example.com',
        password: 'StrongPassword123!',
      };

      await controller.login(
        dto,
        '192.0.2.1',
        {
          headers: { 'x-forwarded-for': '203.0.113.195' },
          socket: { remoteAddress: '192.0.2.1' },
        },
      );

      // AuthService receives socket IP (192.0.2.1), not spoofed IP
      expect(mockAuthService.login).toHaveBeenCalledWith(dto, '192.0.2.1');
    });
  });
});

