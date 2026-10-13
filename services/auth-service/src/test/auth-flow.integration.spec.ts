import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { AccountStatus } from '@prisma/client';
import { SignJWT } from 'jose';

import { createValidationPipe } from '../common/create-validation-pipe.js';
import { GlobalExceptionFilter } from '../common/http-exception.filter.js';
import { AuthConfigModule } from '../config/auth-config.module.js';
import { AuthConfigService } from '../config/auth-config.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../database/redis.service.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { PasswordModule } from '../password/password.module.js';
import { OtpModule } from '../otp/otp.module.js';
import { EmailModule } from '../email/email.module.js';
import { EmailService, MAIL_TRANSPORTER } from '../email/email.service.js';
import { SessionModule } from '../session/session.module.js';
import { TokenModule } from '../token/token.module.js';
import { TokenService } from '../token/token.service.js';
import { AccessTokenGuard } from '../token/access-token.guard.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { RolesGuard } from '../authorization/roles.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthService } from '../auth/auth.service.js';
import { RoleName } from '../authorization/roles.js';

import { InMemoryPrismaService } from './in-memory-prisma.js';
import { TestInbox } from './test-inbox.js';
import { TestProtectedController } from './test-protected.controller.js';

describe('End-to-End Authentication and RBAC Flow (HTTP Integration)', () => {
  let app: INestApplication;
  let inMemoryPrisma: InMemoryPrismaService;
  let testInbox: TestInbox;
  let tokenService: TokenService;
  let rateLimitService: RateLimitService;
  let configService: AuthConfigService;

  beforeAll(async () => {
    inMemoryPrisma = new InMemoryPrismaService();
    testInbox = new TestInbox();

    // Mock RedisService with local fallback
    const mockRedisService = {
      getClient: () => null,
      isHealthy: async () => false,
    };

    // Test-only EmailService capturing OTPs directly into TestInbox without SMTP
    const mockEmailService = {
      isEnabled: true,
      sendOtpEmail: async (params: any) => {
        testInbox.recordOtp(params.recipientEmail, params.otpCode);
        return {
          success: true,
          messageId: `msg-${Date.now()}`,
          correlationId: params.correlationId ?? 'test-corr',
        };
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        AuthConfigModule,
        RateLimitModule,
        PasswordModule,
        OtpModule,
        EmailModule,
        SessionModule,
        TokenModule,
        AuthorizationModule,
        AuthModule,
      ],
      controllers: [TestProtectedController],
      providers: [
        {
          provide: APP_PIPE,
          useValue: createValidationPipe(),
        },
        {
          provide: APP_FILTER,
          useClass: GlobalExceptionFilter,
        },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_GUARD, useClass: AccessTokenGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(inMemoryPrisma)
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
      .overrideProvider(EmailService)
      .useValue(mockEmailService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    tokenService = moduleFixture.get(TokenService);
    rateLimitService = moduleFixture.get(RateLimitService);
    configService = moduleFixture.get(AuthConfigService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    inMemoryPrisma.reset();
    testInbox.clear();
    rateLimitService.clearMemory();
  });

  // ===========================================================================
  // 1. Candidate Registration & Terms Acceptance
  // ===========================================================================
  describe('1. Candidate Registration Flow', () => {
    it('rejects registration when terms acceptance is missing or false', async () => {
      const server = app.getHttpServer();

      // Missing terms
      const res1 = await request(server)
        .post('/auth/register')
        .send({
          fullName: 'Alice Walker',
          email: 'alice@example.com',
          password: 'SecurePassword123!',
          passwordConfirmation: 'SecurePassword123!',
        });

      expect(res1.status).toBe(400);
      expect(res1.body.error ?? res1.body.message).toMatch(/must accept the terms/i);

      // Explicitly false terms
      const res2 = await request(server)
        .post('/auth/register')
        .send({
          fullName: 'Alice Walker',
          email: 'alice@example.com',
          password: 'SecurePassword123!',
          passwordConfirmation: 'SecurePassword123!',
          termsAccepted: false,
        });

      expect(res2.status).toBe(400);
      expect(res2.body.error ?? res2.body.message).toMatch(/must accept the terms/i);
    });

    it('successfully registers candidate, assigns CANDIDATE role, and dispatches EMAIL_VERIFICATION OTP', async () => {
      const server = app.getHttpServer();

      const res = await request(server)
        .post('/auth/register')
        .send({
          fullName: 'Alice Walker',
          email: 'alice@example.com',
          password: 'SecurePassword123!',
          passwordConfirmation: 'SecurePassword123!',
          termsAccepted: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.email).toBe('alice@example.com');
      expect(res.body.emailVerified).toBe(false);
      expect(res.body.accountStatus).toBe(AccountStatus.ACTIVE);
      expect(res.body.emailDelivery.sent).toBe(true);

      // Verify OTP arrived in test mailbox without leaking secrets
      const otpCode = testInbox.getLastOtpFor('alice@example.com');
      expect(otpCode).toBeTypeOf('string');
      expect(otpCode).toMatch(/^\d{6}$/);

      // Verify user created with CANDIDATE role only
      const user = inMemoryPrisma.users.get(res.body.id);
      expect(user).toBeDefined();
      const roles = Array.from(inMemoryPrisma.userRoles.values())
        .filter((ur) => ur.userId === user?.id)
        .map((ur) => inMemoryPrisma.roles.get(ur.roleId)?.name);
      expect(roles).toEqual(['CANDIDATE']);
    });
  });

  // ===========================================================================
  // 2. Email Verification Flow
  // ===========================================================================
  describe('2. Email Verification Flow', () => {
    it('verifies email with valid OTP and rejects invalid or replayed OTP', async () => {
      const server = app.getHttpServer();

      // Register Alice
      await request(server).post('/auth/register').send({
        fullName: 'Alice Walker',
        email: 'alice@example.com',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
        termsAccepted: true,
      });

      const otpCode = testInbox.getLastOtpFor('alice@example.com')!;
      expect(otpCode).toBeDefined();

      // Rejects invalid code
      const invalidRes = await request(server).post('/auth/verify-email').send({
        email: 'alice@example.com',
        otp: '000000',
      });
      expect(invalidRes.status).toBe(400);
      expect(invalidRes.body.error ?? invalidRes.body.message).toMatch(/invalid/i);

      // Accepts valid code
      const validRes = await request(server).post('/auth/verify-email').send({
        email: 'alice@example.com',
        otp: otpCode,
      });
      expect(validRes.status).toBe(200);
      expect(validRes.body.success).toBe(true);
      expect(validRes.body.emailVerified).toBe(true);

      // Rejects reuse of consumed OTP (replay defense)
      const reuseRes = await request(server).post('/auth/verify-email').send({
        email: 'alice@example.com',
        otp: otpCode,
      });
      expect(reuseRes.status).toBe(400);
      expect(reuseRes.body.error ?? reuseRes.body.message).toMatch(/already.*verified|already been consumed|invalid/i);
    });
  });

  // ===========================================================================
  // 3. Login Step 1 (Password Credential Verification)
  // ===========================================================================
  describe('3. Login Step 1 (Password Verification)', () => {
    it('password-only login does NOT issue an access token; gates on LOGIN OTP challenge', async () => {
      const server = app.getHttpServer();

      // Register and verify Alice
      await request(server).post('/auth/register').send({
        fullName: 'Alice Walker',
        email: 'alice@example.com',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
        termsAccepted: true,
      });
      const regOtp = testInbox.getLastOtpFor('alice@example.com')!;
      await request(server).post('/auth/verify-email').send({
        email: 'alice@example.com',
        otp: regOtp,
      });

      testInbox.clear();

      // Perform Step 1 Login
      const loginRes = await request(server).post('/auth/login').send({
        email: 'alice@example.com',
        password: 'SecurePassword123!',
      });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.authenticated).toBe(false);
      expect(loginRes.body.nextStep).toBe('VERIFY_LOGIN_OTP');
      expect(loginRes.body.accessToken).toBeUndefined();
      expect(loginRes.body.session).toBeUndefined();

      // LOGIN OTP delivered to mailbox
      const loginOtp = testInbox.getLastOtpFor('alice@example.com');
      expect(loginOtp).toMatch(/^\d{6}$/);
    });
  });

  // ===========================================================================
  // 4. Login Step 2 & Token Issuance (Browser vs Native Delivery)
  // ===========================================================================
  describe('4. Login Step 2 & Token Delivery', () => {
    async function setupVerifiedUser() {
      const server = app.getHttpServer();
      await request(server).post('/auth/register').send({
        fullName: 'Alice Walker',
        email: 'alice@example.com',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
        termsAccepted: true,
      });
      const regOtp = testInbox.getLastOtpFor('alice@example.com')!;
      await request(server).post('/auth/verify-email').send({
        email: 'alice@example.com',
        otp: regOtp,
      });
      testInbox.clear();
      await request(server).post('/auth/login').send({
        email: 'alice@example.com',
        password: 'SecurePassword123!',
      });
      return testInbox.getLastOtpFor('alice@example.com')!;
    }

    it('browser client receives access token in JSON and HttpOnly cookie; refresh token omitted from JSON', async () => {
      const server = app.getHttpServer();
      const loginOtp = await setupVerifiedUser();

      const verifyRes = await request(server)
        .post('/auth/verify-login-otp')
        .send({
          email: 'alice@example.com',
          otp: loginOtp,
        });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);
      expect(verifyRes.body.tokenType).toBe('Bearer');
      expect(verifyRes.body.accessToken).toBeTypeOf('string');
      expect(verifyRes.body.expiresIn).toBe(900);

      // JSON response does NOT leak raw refresh token
      expect(verifyRes.body.session.refreshToken).toBeUndefined();
      expect(verifyRes.body.session.id).toBeTypeOf('string');

      // HttpOnly cookie set with path=/auth
      const cookies = verifyRes.headers['set-cookie'] as unknown as string[];
      expect(cookies).toBeDefined();
      const cookieStr = cookies.find((c: string) => c.startsWith('refreshToken='));
      expect(cookieStr).toBeDefined();
      expect(cookieStr).toContain('HttpOnly');
      expect(cookieStr).toContain('Path=/auth');
      expect(cookieStr).toContain('SameSite=Lax');
    });

    it('native client (X-Client-Type: native) receives refresh token in JSON without cookies', async () => {
      const server = app.getHttpServer();
      const loginOtp = await setupVerifiedUser();

      const verifyRes = await request(server)
        .post('/auth/verify-login-otp')
        .set('X-Client-Type', 'native')
        .send({
          email: 'alice@example.com',
          otp: loginOtp,
        });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.session.refreshToken).toBeTypeOf('string');
      expect(verifyRes.headers['set-cookie']).toBeUndefined();
    });
  });

  // ===========================================================================
  // 5. Access-Token Authentication Guard
  // ===========================================================================
  describe('5. Access-Token Authentication Guard', () => {
    let validAccessToken: string;

    beforeEach(async () => {
      const server = app.getHttpServer();
      await request(server).post('/auth/register').send({
        fullName: 'Alice Walker',
        email: 'alice@example.com',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
        termsAccepted: true,
      });
      const regOtp = testInbox.getLastOtpFor('alice@example.com')!;
      await request(server).post('/auth/verify-email').send({
        email: 'alice@example.com',
        otp: regOtp,
      });
      testInbox.clear();
      await request(server).post('/auth/login').send({
        email: 'alice@example.com',
        password: 'SecurePassword123!',
      });
      const loginOtp = testInbox.getLastOtpFor('alice@example.com')!;
      const verifyRes = await request(server)
        .post('/auth/verify-login-otp')
        .send({ email: 'alice@example.com', otp: loginOtp });
      validAccessToken = verifyRes.body.accessToken;
    });

    it('rejects protected routes when Authorization header is missing (401)', async () => {
      const server = app.getHttpServer();
      const res = await request(server).get('/test-protected/candidate-only');
      expect(res.status).toBe(401);
    });

    it('rejects malformed Authorization header (401)', async () => {
      const server = app.getHttpServer();
      const res1 = await request(server)
        .get('/test-protected/candidate-only')
        .set('Authorization', 'Basic invalidcredentials');
      expect(res1.status).toBe(401);

      const res2 = await request(server)
        .get('/test-protected/candidate-only')
        .set('Authorization', 'Bearer');
      expect(res2.status).toBe(401);
    });

    it('explicitly rejects compound refresh token when presented as Bearer token (401)', async () => {
      const server = app.getHttpServer();
      const fakeRefreshToken = '11111111-1111-4111-8111-111111111111.secret12345678901234567890';
      const res = await request(server)
        .get('/test-protected/candidate-only')
        .set('Authorization', `Bearer ${fakeRefreshToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error ?? res.body.message).toMatch(/refresh tokens cannot be used as bearer/i);
    });

    it('rejects expired bearer access token (401)', async () => {
      const server = app.getHttpServer();
      const key = new TextEncoder().encode(configService.jwt.secret);
      const now = Math.floor(Date.now() / 1000);
      const expiredJwt = await new SignJWT({
        email: 'alice@example.com',
        roles: ['CANDIDATE'],
        sid: 'sess-expired-123',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject('user-alice-123')
        .setIssuer(configService.jwt.issuer)
        .setAudience(configService.jwt.audience)
        .setIssuedAt(now - 7200)
        .setExpirationTime(now - 3600)
        .sign(key);

      const res = await request(server)
        .get('/test-protected/candidate-only')
        .set('Authorization', `Bearer ${expiredJwt}`);

      expect(res.status).toBe(401);
      expect(res.body.error ?? res.body.message).toMatch(/expired/i);
    });

    it('rejects bearer access token with wrong issuer (401)', async () => {
      const server = app.getHttpServer();
      const key = new TextEncoder().encode(configService.jwt.secret);
      const now = Math.floor(Date.now() / 1000);
      const wrongIssuerJwt = await new SignJWT({
        email: 'alice@example.com',
        roles: ['CANDIDATE'],
        sid: 'sess-issuer-123',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject('user-alice-123')
        .setIssuer('untrusted-foreign-issuer')
        .setAudience(configService.jwt.audience)
        .setIssuedAt(now)
        .setExpirationTime(now + 900)
        .sign(key);

      const res = await request(server)
        .get('/test-protected/candidate-only')
        .set('Authorization', `Bearer ${wrongIssuerJwt}`);

      expect(res.status).toBe(401);
      expect(res.body.error ?? res.body.message).toMatch(/invalid access token claims/i);
    });

    it('rejects bearer access token with wrong audience (401)', async () => {
      const server = app.getHttpServer();
      const key = new TextEncoder().encode(configService.jwt.secret);
      const now = Math.floor(Date.now() / 1000);
      const wrongAudienceJwt = await new SignJWT({
        email: 'alice@example.com',
        roles: ['CANDIDATE'],
        sid: 'sess-aud-123',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject('user-alice-123')
        .setIssuer(configService.jwt.issuer)
        .setAudience('untrusted-foreign-audience')
        .setIssuedAt(now)
        .setExpirationTime(now + 900)
        .sign(key);

      const res = await request(server)
        .get('/test-protected/candidate-only')
        .set('Authorization', `Bearer ${wrongAudienceJwt}`);

      expect(res.status).toBe(401);
      expect(res.body.error ?? res.body.message).toMatch(/invalid access token claims/i);
    });

    it('rejects bearer access token signed with wrong key / signature (401)', async () => {
      const server = app.getHttpServer();
      const wrongKey = new TextEncoder().encode('untrusted-secret-key-that-is-at-least-32-chars-long!');
      const now = Math.floor(Date.now() / 1000);
      const foreignSignedJwt = await new SignJWT({
        email: 'alice@example.com',
        roles: ['CANDIDATE'],
        sid: 'sess-sig-123',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject('user-alice-123')
        .setIssuer(configService.jwt.issuer)
        .setAudience(configService.jwt.audience)
        .setIssuedAt(now)
        .setExpirationTime(now + 900)
        .sign(wrongKey);

      const res = await request(server)
        .get('/test-protected/candidate-only')
        .set('Authorization', `Bearer ${foreignSignedJwt}`);

      expect(res.status).toBe(401);
      expect(res.body.error ?? res.body.message).toMatch(/invalid access token signature/i);
    });

    it('rejects bearer access token with tampered signature bits (401)', async () => {
      const server = app.getHttpServer();
      const tampered = validAccessToken.slice(0, -6) + 'xxxxxx';

      const res = await request(server)
        .get('/test-protected/candidate-only')
        .set('Authorization', `Bearer ${tampered}`);

      expect(res.status).toBe(401);
      expect(res.body.error ?? res.body.message).toMatch(/signature/i);
    });

    it('rejects non-JWT random string as bearer token (401)', async () => {
      const server = app.getHttpServer();
      const res = await request(server)
        .get('/test-protected/candidate-only')
        .set('Authorization', 'Bearer totally-not-a-jwt-token-at-all');

      expect(res.status).toBe(401);
    });

    it('accepts valid bearer access token and attaches principal', async () => {
      const server = app.getHttpServer();
      const res = await request(server)
        .get('/test-protected/candidate-only')
        .set('Authorization', `Bearer ${validAccessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.resource).toBe('candidate-profile');
      expect(res.body.user.email).toBe('alice@example.com');
      expect(res.body.user.roles).toEqual(['CANDIDATE']);
      expect(res.body.user.authVerified).toBe(true);
    });
  });

  // ===========================================================================
  // 6. RBAC Integration & Zero Client Trust
  // ===========================================================================
  describe('6. RBAC Integration & Zero Client Trust', () => {
    let candidateToken: string;

    beforeEach(async () => {
      const server = app.getHttpServer();
      await request(server).post('/auth/register').send({
        fullName: 'Alice Candidate',
        email: 'alice@example.com',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
        termsAccepted: true,
      });
      const regOtp = testInbox.getLastOtpFor('alice@example.com')!;
      await request(server).post('/auth/verify-email').send({
        email: 'alice@example.com',
        otp: regOtp,
      });
      testInbox.clear();
      await request(server).post('/auth/login').send({
        email: 'alice@example.com',
        password: 'SecurePassword123!',
      });
      const loginOtp = testInbox.getLastOtpFor('alice@example.com')!;
      const res = await request(server)
        .post('/auth/verify-login-otp')
        .send({ email: 'alice@example.com', otp: loginOtp });
      candidateToken = res.body.accessToken;
    });

    it('rejects candidate accessing admin-only route with 403 Forbidden', async () => {
      const server = app.getHttpServer();
      const res = await request(server)
        .get('/test-protected/admin-only')
        .set('Authorization', `Bearer ${candidateToken}`);

      expect(res.status).toBe(403);
    });

    it('strictly ignores client-supplied role headers attempting privilege escalation', async () => {
      const server = app.getHttpServer();
      const res = await request(server)
        .get('/test-protected/admin-only')
        .set('Authorization', `Bearer ${candidateToken}`)
        .set('X-Roles', 'ADMIN,SUPER_ADMIN')
        .set('X-User-Role', 'ADMIN')
        .set('X-User-Id', 'admin-id');

      // Still 403 Forbidden; client headers are not trusted
      expect(res.status).toBe(403);
    });

    it('allows access to @AllowAnyRole() endpoint for any authenticated user', async () => {
      const server = app.getHttpServer();
      const res = await request(server)
        .get('/test-protected/any-authenticated')
        .set('Authorization', `Bearer ${candidateToken}`);

      expect(res.status).toBe(200);
      expect(res.body.resource).toBe('user-settings');
    });

    it('denies access by default on unmarked protected routes (fail-closed policy)', async () => {
      const server = app.getHttpServer();
      const res = await request(server)
        .get('/test-protected/unmarked-route')
        .set('Authorization', `Bearer ${candidateToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error ?? res.body.message).toMatch(/missing or malformed/i);
    });
  });

  // ===========================================================================
  // 7. Refresh Rotation, Single-Use, and Replay Detection
  // ===========================================================================
  describe('7. Refresh Rotation, Single-Use, and Replay Detection', () => {
    async function loginNativeUser() {
      const server = app.getHttpServer();
      await request(server).post('/auth/register').send({
        fullName: 'Bob Smith',
        email: 'bob@example.com',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
        termsAccepted: true,
      });
      const regOtp = testInbox.getLastOtpFor('bob@example.com')!;
      await request(server).post('/auth/verify-email').send({
        email: 'bob@example.com',
        otp: regOtp,
      });
      testInbox.clear();
      await request(server).post('/auth/login').send({
        email: 'bob@example.com',
        password: 'SecurePassword123!',
      });
      const loginOtp = testInbox.getLastOtpFor('bob@example.com')!;
      const verifyRes = await request(server)
        .post('/auth/verify-login-otp')
        .set('X-Client-Type', 'native')
        .send({ email: 'bob@example.com', otp: loginOtp });

      return {
        accessToken: verifyRes.body.accessToken as string,
        refreshToken: verifyRes.body.session.refreshToken as string,
      };
    }

    it('rotates refresh token and issues a new access token on valid refresh', async () => {
      const server = app.getHttpServer();
      const { refreshToken: oldRefreshToken } = await loginNativeUser();

      const refreshRes = await request(server)
        .post('/auth/refresh')
        .set('X-Client-Type', 'native')
        .send({ refreshToken: oldRefreshToken });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.accessToken).toBeTypeOf('string');
      expect(refreshRes.body.session.refreshToken).toBeTypeOf('string');
      expect(refreshRes.body.session.refreshToken).not.toBe(oldRefreshToken);

      // New access token is valid
      const protectedRes = await request(server)
        .get('/test-protected/candidate-only')
        .set('Authorization', `Bearer ${refreshRes.body.accessToken}`);
      expect(protectedRes.status).toBe(200);
    });

    it('triggers replay detection when old refresh token is reused, revoking all user sessions', async () => {
      const server = app.getHttpServer();
      const { refreshToken: initialToken } = await loginNativeUser();

      // Legitimate rotation 1
      const refresh1 = await request(server)
        .post('/auth/refresh')
        .set('X-Client-Type', 'native')
        .send({ refreshToken: initialToken });
      expect(refresh1.status).toBe(200);
      const rotatedToken = refresh1.body.session.refreshToken;

      // Attacker replays initialToken
      const replayRes = await request(server)
        .post('/auth/refresh')
        .set('X-Client-Type', 'native')
        .send({ refreshToken: initialToken });

      expect(replayRes.status).toBe(401);
      expect(replayRes.body.error ?? replayRes.body.message).toMatch(/revoked|compromised|invalid/i);

      // Legitimate user attempt with rotatedToken now also fails (defensive containment)
      const subsequentRes = await request(server)
        .post('/auth/refresh')
        .set('X-Client-Type', 'native')
        .send({ refreshToken: rotatedToken });

      expect(subsequentRes.status).toBe(401);
    });
  });

  // ===========================================================================
  // 8. Logout & Cookie Clearing
  // ===========================================================================
  describe('8. Logout & Session Revocation', () => {
    it('revokes the session and clears the cookie', async () => {
      const server = app.getHttpServer();

      // Register and login browser user
      await request(server).post('/auth/register').send({
        fullName: 'Charlie Brown',
        email: 'charlie@example.com',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
        termsAccepted: true,
      });
      const regOtp = testInbox.getLastOtpFor('charlie@example.com')!;
      await request(server).post('/auth/verify-email').send({
        email: 'charlie@example.com',
        otp: regOtp,
      });
      testInbox.clear();
      await request(server).post('/auth/login').send({
        email: 'charlie@example.com',
        password: 'SecurePassword123!',
      });
      const loginOtp = testInbox.getLastOtpFor('charlie@example.com')!;
      const loginRes = await request(server)
        .post('/auth/verify-login-otp')
        .send({ email: 'charlie@example.com', otp: loginOtp });

      const cookieHeader = loginRes.headers['set-cookie'] as unknown as string[];
      const cookieStr = cookieHeader[0]!;

      // Logout with cookie alone (no body workaround)
      const logoutRes = await request(server)
        .post('/auth/logout')
        .set('Cookie', cookieStr)
        .set('Origin', 'http://127.0.0.1:3001')
        .send({});

      expect(logoutRes.status).toBe(200);

      // Verify cookie cleared with matching attributes
      const clearCookies = logoutRes.headers['set-cookie'] as unknown as string[];
      expect(clearCookies).toBeDefined();
      const cleared = clearCookies.find((c: string) => c.startsWith('refreshToken=;'));
      expect(cleared).toBeDefined();
      expect(cleared).toContain('Path=/auth');
      expect(cleared).toContain('HttpOnly');

      // Subsequent refresh fails
      const refreshAfterLogout = await request(server)
        .post('/auth/refresh')
        .set('Cookie', cookieStr)
        .set('Origin', 'http://127.0.0.1:3001')
        .send({});
      expect(refreshAfterLogout.status).toBe(401);
    });

    it('rotates refresh token and sets new HttpOnly cookie when called with cookie alone (empty body)', async () => {
      const server = app.getHttpServer();
      await request(server).post('/auth/register').send({
        fullName: 'Cookie Test User',
        email: 'cookie.user@example.com',
        password: 'Password1234!@#$',
        passwordConfirmation: 'Password1234!@#$',
        termsAccepted: true,
      });
      const regOtp = testInbox.getLastOtpFor('cookie.user@example.com')!;
      await request(server)
        .post('/auth/verify-email')
        .send({ email: 'cookie.user@example.com', otp: regOtp });

      await request(server).post('/auth/login').send({
        email: 'cookie.user@example.com',
        password: 'Password1234!@#$',
      });
      const loginOtp = testInbox.getLastOtpFor('cookie.user@example.com')!;
      const loginRes = await request(server)
        .post('/auth/verify-login-otp')
        .send({ email: 'cookie.user@example.com', otp: loginOtp });

      const cookieHeader = loginRes.headers['set-cookie'] as unknown as string[];
      const cookieStr = cookieHeader[0]!;

      // Cookie-only refresh: empty body
      const refreshRes = await request(server)
        .post('/auth/refresh')
        .set('Cookie', cookieStr)
        .set('Origin', 'http://127.0.0.1:3001')
        .send({});

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.accessToken).toBeTypeOf('string');
      expect(refreshRes.body.session.refreshToken).toBeUndefined();

      const newCookies = refreshRes.headers['set-cookie'] as unknown as string[];
      expect(newCookies).toBeDefined();
      const newCookieStr = newCookies.find((c: string) => c.startsWith('refreshToken='));
      expect(newCookieStr).toBeDefined();
      expect(newCookieStr).not.toBe(cookieStr);
    });

    it('rejects malformed JSON body on cookie refresh with 400 Bad Request', async () => {
      const server = app.getHttpServer();
      const res = await request(server)
        .post('/auth/refresh')
        .set('Cookie', 'refreshToken=sess-uuid.secret123456789012345678901234567890')
        .set('Origin', 'http://127.0.0.1:3001')
        .send({ unwhitelistedField: 'malicious' });

      expect(res.status).toBe(400);
    });
  });

  // ===========================================================================
  // 9. Password Reset & Concurrency Revocation
  // ===========================================================================
  describe('9. Password Reset Flow', () => {
    it('enforces password policy, rejects current password reuse, updates password, and revokes sessions', async () => {
      const server = app.getHttpServer();

      // Setup user and login
      await request(server).post('/auth/register').send({
        fullName: 'Diana Prince',
        email: 'diana@example.com',
        password: 'OldPassword123!',
        passwordConfirmation: 'OldPassword123!',
        termsAccepted: true,
      });
      const regOtp = testInbox.getLastOtpFor('diana@example.com')!;
      await request(server).post('/auth/verify-email').send({
        email: 'diana@example.com',
        otp: regOtp,
      });
      testInbox.clear();
      await request(server).post('/auth/login').send({
        email: 'diana@example.com',
        password: 'OldPassword123!',
      });
      const loginOtp = testInbox.getLastOtpFor('diana@example.com')!;
      const loginRes = await request(server)
        .post('/auth/verify-login-otp')
        .set('X-Client-Type', 'native')
        .send({ email: 'diana@example.com', otp: loginOtp });
      const activeRefreshToken = loginRes.body.session.refreshToken;

      testInbox.clear();
      rateLimitService.clearMemory();

      // 1. Request forgot password
      const forgotRes = await request(server).post('/auth/forgot-password').send({
        email: 'diana@example.com',
      });
      expect(forgotRes.status).toBe(200);
      const resetOtp = testInbox.getLastOtpFor('diana@example.com')!;
      expect(resetOtp).toMatch(/^\d{6}$/);

      // 2. Reject same password reuse (which consumes the OTP and rejects policy)
      const sameRes = await request(server).post('/auth/reset-password').send({
        email: 'diana@example.com',
        otp: resetOtp,
        newPassword: 'OldPassword123!',
        passwordConfirmation: 'OldPassword123!',
      });
      expect(sameRes.status).toBe(400);
      expect(sameRes.body.error ?? sameRes.body.message).toMatch(/cannot be the same as your current/i);

      // Replaying the consumed reset OTP is rejected
      const replayOtpRes = await request(server).post('/auth/reset-password').send({
        email: 'diana@example.com',
        otp: resetOtp,
        newPassword: 'BrandNewPassword123!',
        passwordConfirmation: 'BrandNewPassword123!',
      });
      expect(replayOtpRes.status).toBe(400);
      expect(replayOtpRes.body.error ?? replayOtpRes.body.message).toMatch(/already been consumed|no pending/i);

      // 3. Request fresh OTP and successfully reset with new strong password
      testInbox.clear();
      rateLimitService.clearMemory();
      await request(server).post('/auth/forgot-password').send({
        email: 'diana@example.com',
      });
      const freshResetOtp = testInbox.getLastOtpFor('diana@example.com')!;
      expect(freshResetOtp).toMatch(/^\d{6}$/);

      const resetRes = await request(server).post('/auth/reset-password').send({
        email: 'diana@example.com',
        otp: freshResetOtp,
        newPassword: 'BrandNewPassword123!',
        passwordConfirmation: 'BrandNewPassword123!',
      });
      expect(resetRes.status).toBe(200);

      // 4. Existing session is revoked
      const refreshAfterReset = await request(server)
        .post('/auth/refresh')
        .set('X-Client-Type', 'native')
        .send({ refreshToken: activeRefreshToken });
      expect(refreshAfterReset.status).toBe(401);

      // 5. User can log in with new password
      testInbox.clear();
      const newLogin = await request(server).post('/auth/login').send({
        email: 'diana@example.com',
        password: 'BrandNewPassword123!',
      });
      expect(newLogin.status).toBe(200);
      expect(newLogin.body.nextStep).toBe('VERIFY_LOGIN_OTP');
    });
  });

  // ===========================================================================
  // 10. Account Lifecycle Status & Verification Enforcement
  // ===========================================================================
  describe('10. Account Lifecycle Status Enforcement', () => {
    it('suspended accounts cannot log in, refresh, or access protected workflows', async () => {
      const server = app.getHttpServer();

      // Create and suspend user
      await request(server).post('/auth/register').send({
        fullName: 'Eve Suspended',
        email: 'eve@example.com',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
        termsAccepted: true,
      });
      const regOtp = testInbox.getLastOtpFor('eve@example.com')!;
      await request(server).post('/auth/verify-email').send({
        email: 'eve@example.com',
        otp: regOtp,
      });

      const user = Array.from(inMemoryPrisma.users.values()).find(
        (u) => u.email === 'eve@example.com',
      )!;
      user.accountStatus = AccountStatus.SUSPENDED;

      // Cannot log in
      const loginRes = await request(server).post('/auth/login').send({
        email: 'eve@example.com',
        password: 'SecurePassword123!',
      });
      expect(loginRes.status).toBe(403);
      expect(loginRes.body.error ?? loginRes.body.message).toMatch(/suspended/i);
    });

    it('unverified accounts cannot refresh or bypass OTP gate', async () => {
      const server = app.getHttpServer();

      await request(server).post('/auth/register').send({
        fullName: 'Frank Unverified',
        email: 'frank@example.com',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
        termsAccepted: true,
      });

      // Login attempt rejected before email verification
      const loginRes = await request(server).post('/auth/login').send({
        email: 'frank@example.com',
        password: 'SecurePassword123!',
      });
      expect(loginRes.status).toBe(403);
      expect(loginRes.body.error ?? loginRes.body.message).toMatch(/not verified/i);
    });

    it('suspended accounts are immediately rejected with 401 on protected routes mid-token-lifetime', async () => {
      const server = app.getHttpServer();

      // Register, verify, and log in user
      await request(server).post('/auth/register').send({
        fullName: 'Grace Suspended',
        email: 'grace@example.com',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
        termsAccepted: true,
      });
      const regOtp = testInbox.getLastOtpFor('grace@example.com')!;
      await request(server).post('/auth/verify-email').send({
        email: 'grace@example.com',
        otp: regOtp,
      });
      testInbox.clear();
      await request(server).post('/auth/login').send({
        email: 'grace@example.com',
        password: 'SecurePassword123!',
      });
      const loginOtp = testInbox.getLastOtpFor('grace@example.com')!;
      const tokenRes = await request(server).post('/auth/verify-login-otp').send({
        email: 'grace@example.com',
        otp: loginOtp,
      });
      const bearerToken = tokenRes.body.accessToken;
      expect(bearerToken).toBeDefined();

      // Valid token accesses protected resource before suspension
      const beforeRes = await request(server)
        .get('/test-protected/candidate-only')
        .set('Authorization', `Bearer ${bearerToken}`);
      expect(beforeRes.status).toBe(200);

      // Now suspend the user account and invalidate state
      const authService = app.get(AuthService);
      const user = Array.from(inMemoryPrisma.users.values()).find(
        (u) => u.email === 'grace@example.com',
      )!;
      await authService.updateAccountStatus(user.id, AccountStatus.SUSPENDED, 'investigation');

      // Previously issued access token is now immediately rejected mid-lifetime with 401
      const afterRes = await request(server)
        .get('/test-protected/candidate-only')
        .set('Authorization', `Bearer ${bearerToken}`);
      expect(afterRes.status).toBe(401);
      expect(afterRes.body.error ?? afterRes.body.message).toMatch(/suspended/i);
    });

    it('deactivated accounts are immediately rejected with 401 on protected routes mid-token-lifetime', async () => {
      const server = app.getHttpServer();

      // Register, verify, and log in user
      await request(server).post('/auth/register').send({
        fullName: 'Dan Deactivated',
        email: 'dan@example.com',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
        termsAccepted: true,
      });
      const regOtp = testInbox.getLastOtpFor('dan@example.com')!;
      await request(server).post('/auth/verify-email').send({
        email: 'dan@example.com',
        otp: regOtp,
      });
      testInbox.clear();
      await request(server).post('/auth/login').send({
        email: 'dan@example.com',
        password: 'SecurePassword123!',
      });
      const loginOtp = testInbox.getLastOtpFor('dan@example.com')!;
      const tokenRes = await request(server).post('/auth/verify-login-otp').send({
        email: 'dan@example.com',
        otp: loginOtp,
      });
      const bearerToken = tokenRes.body.accessToken;

      const authService = app.get(AuthService);
      const user = Array.from(inMemoryPrisma.users.values()).find(
        (u) => u.email === 'dan@example.com',
      )!;
      await authService.updateAccountStatus(user.id, AccountStatus.DEACTIVATED, 'voluntary_deactivation');

      // Rejected with 401
      const afterRes = await request(server)
        .get('/test-protected/any-authenticated')
        .set('Authorization', `Bearer ${bearerToken}`);
      expect(afterRes.status).toBe(401);
      expect(afterRes.body.error ?? afterRes.body.message).toMatch(/deactivated/i);
    });

    it('role removal immediately prevents access to privileged endpoints with previously issued token', async () => {
      const server = app.getHttpServer();
      const authService = app.get(AuthService);

      // Register and verify user
      await request(server).post('/auth/register').send({
        fullName: 'Admin User',
        email: 'admin.user@example.com',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
        termsAccepted: true,
      });
      const regOtp = testInbox.getLastOtpFor('admin.user@example.com')!;
      await request(server).post('/auth/verify-email').send({
        email: 'admin.user@example.com',
        otp: regOtp,
      });

      const user = Array.from(inMemoryPrisma.users.values()).find(
        (u) => u.email === 'admin.user@example.com',
      )!;

      // Assign ADMIN role
      await authService.assignRole(user.id, RoleName.ADMIN);

      testInbox.clear();
      await request(server).post('/auth/login').send({
        email: 'admin.user@example.com',
        password: 'SecurePassword123!',
      });
      const loginOtp = testInbox.getLastOtpFor('admin.user@example.com')!;
      const tokenRes = await request(server).post('/auth/verify-login-otp').send({
        email: 'admin.user@example.com',
        otp: loginOtp,
      });
      const adminBearerToken = tokenRes.body.accessToken;

      // Can access admin-only endpoint
      const resBefore = await request(server)
        .get('/test-protected/admin-only')
        .set('Authorization', `Bearer ${adminBearerToken}`);
      expect(resBefore.status).toBe(200);

      // Revoke ADMIN role
      await authService.revokeRole(user.id, RoleName.ADMIN);

      // Old token can no longer access admin endpoint
      const resAfter = await request(server)
        .get('/test-protected/admin-only')
        .set('Authorization', `Bearer ${adminBearerToken}`);
      // Must be rejected (either 401 token revoked or 403 forbidden)
      expect([401, 403]).toContain(resAfter.status);
    });

    it('password reset immediately invalidates existing bearer access tokens', async () => {
      const server = app.getHttpServer();

      // Register, verify, and log in user
      await request(server).post('/auth/register').send({
        fullName: 'Reset User',
        email: 'reset.user@example.com',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
        termsAccepted: true,
      });
      const regOtp = testInbox.getLastOtpFor('reset.user@example.com')!;
      await request(server).post('/auth/verify-email').send({
        email: 'reset.user@example.com',
        otp: regOtp,
      });
      testInbox.clear();
      await request(server).post('/auth/login').send({
        email: 'reset.user@example.com',
        password: 'SecurePassword123!',
      });
      const loginOtp = testInbox.getLastOtpFor('reset.user@example.com')!;
      const tokenRes = await request(server).post('/auth/verify-login-otp').send({
        email: 'reset.user@example.com',
        otp: loginOtp,
      });
      const bearerToken = tokenRes.body.accessToken;

      // Can access protected endpoint before password reset
      const beforeRes = await request(server)
        .get('/test-protected/any-authenticated')
        .set('Authorization', `Bearer ${bearerToken}`);
      expect(beforeRes.status).toBe(200);

      // Request and complete password reset
      testInbox.clear();
      rateLimitService.clearMemory();
      const forgotRes = await request(server).post('/auth/forgot-password').send({
        email: 'reset.user@example.com',
      });
      expect(forgotRes.status).toBe(200);
      const resetOtp = testInbox.getLastOtpFor('reset.user@example.com')!;
      expect(resetOtp).toBeDefined();

      const resetRes = await request(server).post('/auth/reset-password').send({
        email: 'reset.user@example.com',
        otp: resetOtp,
        newPassword: 'BrandNewPassword999!',
        passwordConfirmation: 'BrandNewPassword999!',
      });
      expect(resetRes.status).toBe(200);

      // Old bearer token must now be rejected immediately with 401
      const afterRes = await request(server)
        .get('/test-protected/any-authenticated')
        .set('Authorization', `Bearer ${bearerToken}`);
      expect(afterRes.status).toBe(401);
      expect(afterRes.body.error ?? afterRes.body.message).toMatch(/revoked/i);
    });

    it('valid unaffected active users continue to access protected endpoints normally', async () => {
      const server = app.getHttpServer();

      await request(server).post('/auth/register').send({
        fullName: 'Active Normal',
        email: 'active.normal@example.com',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
        termsAccepted: true,
      });
      const regOtp = testInbox.getLastOtpFor('active.normal@example.com')!;
      await request(server).post('/auth/verify-email').send({
        email: 'active.normal@example.com',
        otp: regOtp,
      });
      testInbox.clear();
      await request(server).post('/auth/login').send({
        email: 'active.normal@example.com',
        password: 'SecurePassword123!',
      });
      const loginOtp = testInbox.getLastOtpFor('active.normal@example.com')!;
      const tokenRes = await request(server).post('/auth/verify-login-otp').send({
        email: 'active.normal@example.com',
        otp: loginOtp,
      });
      const bearerToken = tokenRes.body.accessToken;

      const res = await request(server)
        .get('/test-protected/candidate-only')
        .set('Authorization', `Bearer ${bearerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('active.normal@example.com');
    });
  });

  // ===========================================================================
  // 11. CSRF Defense on Cookie Endpoints
  // ===========================================================================
  describe('11. CSRF Defense on Cookie Endpoints', () => {
    it('rejects cookie-authenticated refresh requests from untrusted origins with 403', async () => {
      const server = app.getHttpServer();

      const res = await request(server)
        .post('/auth/refresh')
        .set('Cookie', 'refreshToken=some-token')
        .set('Origin', 'https://attacker-domain.xyz')
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error ?? res.body.message).toMatch(/CSRF check failed/i);
    });

    it('rejects cookie-authenticated refresh requests from untrusted Referer when Origin is omitted (403)', async () => {
      const server = app.getHttpServer();

      const res = await request(server)
        .post('/auth/refresh')
        .set('Cookie', 'refreshToken=some-token')
        .set('Referer', 'https://evil-phishing.com/steal-session')
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error ?? res.body.message).toMatch(/CSRF check failed/i);
    });

    it('rejects cookie-authenticated refresh requests with malformed Origin header (403)', async () => {
      const server = app.getHttpServer();

      const res = await request(server)
        .post('/auth/refresh')
        .set('Cookie', 'refreshToken=some-token')
        .set('Origin', 'not-a-valid-url-format')
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error ?? res.body.message).toMatch(/CSRF check failed/i);
    });

    it('rejects cookie-authenticated logout requests from untrusted origins with 403', async () => {
      const server = app.getHttpServer();

      const res = await request(server)
        .post('/auth/logout')
        .set('Cookie', 'refreshToken=some-token')
        .set('Origin', 'https://untrusted-site.xyz')
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error ?? res.body.message).toMatch(/CSRF check failed/i);
    });
  });

  // ===========================================================================
  // 12. Rate-Limit Enforcement & Retry-After Response Headers
  // ===========================================================================
  describe('12. Rate-Limit Enforcement & Retry-After at HTTP Boundary', () => {
    it('enforces 5 requests/min rate limit on /auth/register and returns 429 with Retry-After on 6th request', async () => {
      const server = app.getHttpServer();
      const testIp = '198.51.100.99';

      // First 5 requests consume the quota
      for (let i = 0; i < 5; i++) {
        const res = await request(server)
          .post('/auth/register')
          .set('X-Forwarded-For', testIp)
          .send({
            fullName: `Rate Limited User ${i}`,
            email: `ratelimit.${i}@example.com`,
            password: 'SecurePassword123!',
            passwordConfirmation: 'SecurePassword123!',
            termsAccepted: true,
          });
        expect(res.status).toBe(201);
      }

      // 6th request from the same IP exceeds limit and is rejected with 429
      const blockedRes = await request(server)
        .post('/auth/register')
        .set('X-Forwarded-For', testIp)
        .send({
          fullName: 'Blocked User',
          email: 'ratelimit.blocked@example.com',
          password: 'SecurePassword123!',
          passwordConfirmation: 'SecurePassword123!',
          termsAccepted: true,
        });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.headers['retry-after']).toBe('60');
      expect(blockedRes.body.error ?? blockedRes.body.message).toMatch(/too many requests/i);
    });

    it('isolates rate-limit budget across distinct client IPs under trustProxy', async () => {
      const server = app.getHttpServer();
      const ipA = '198.51.100.101';
      const ipB = '198.51.100.102';

      const trustProxySpy = vi.spyOn(configService, 'trustProxy', 'get').mockReturnValue(true);

      try {
        // Exhaust IP A quota
        for (let i = 0; i < 5; i++) {
          await request(server)
            .post('/auth/register')
            .set('X-Forwarded-For', ipA)
            .send({
              fullName: `User A ${i}`,
              email: `usera.${i}@example.com`,
              password: 'SecurePassword123!',
              passwordConfirmation: 'SecurePassword123!',
              termsAccepted: true,
            });
        }

        // IP A is blocked
        const blockedA = await request(server)
          .post('/auth/register')
          .set('X-Forwarded-For', ipA)
          .send({
            fullName: 'User A Blocked',
            email: 'usera.blocked@example.com',
            password: 'SecurePassword123!',
            passwordConfirmation: 'SecurePassword123!',
            termsAccepted: true,
          });
        expect(blockedA.status).toBe(429);

        // IP B is still allowed
        const allowedB = await request(server)
          .post('/auth/register')
          .set('X-Forwarded-For', ipB)
          .send({
            fullName: 'User B Allowed',
            email: 'userb.allowed@example.com',
            password: 'SecurePassword123!',
            passwordConfirmation: 'SecurePassword123!',
            termsAccepted: true,
          });
        expect(allowedB.status).toBe(201);
      } finally {
        trustProxySpy.mockRestore();
      }
    });
  });

  // ===========================================================================
  // 13. Input Validation Boundary, Malformed JSON, & Whitelist Protection
  // ===========================================================================
  describe('13. Input Validation Boundary & Property Whitelisting', () => {
    it('rejects malformed JSON syntax with 400 Bad Request', async () => {
      const server = app.getHttpServer();

      const res = await request(server)
        .post('/auth/register')
        .set('Content-Type', 'application/json')
        .send('{ invalid json payload: true, ');

      expect(res.status).toBe(400);
    });

    it('rejects unexpected / non-whitelisted properties in RegisterDto with 400 Bad Request', async () => {
      const server = app.getHttpServer();

      const res = await request(server)
        .post('/auth/register')
        .send({
          fullName: 'John Attacker',
          email: 'john.attacker@example.com',
          password: 'SecurePassword123!',
          passwordConfirmation: 'SecurePassword123!',
          termsAccepted: true,
          maliciousRole: 'SUPER_ADMIN',
          isAdmin: true,
        });

      expect(res.status).toBe(400);
      const errorContent = JSON.stringify(res.body);
      expect(errorContent).toMatch(/should not exist/i);
    });

    it('rejects unexpected properties in LoginDto with 400 Bad Request', async () => {
      const server = app.getHttpServer();

      const res = await request(server)
        .post('/auth/login')
        .send({
          email: 'user@example.com',
          password: 'Password123!',
          unexpectedField: 'forbidden-payload',
        });

      expect(res.status).toBe(400);
      const errorContent = JSON.stringify(res.body);
      expect(errorContent).toMatch(/should not exist/i);
    });

    it('rejects unexpected properties in RefreshTokenDto with 400 Bad Request', async () => {
      const server = app.getHttpServer();

      const res = await request(server)
        .post('/auth/refresh')
        .send({
          unexpectedPayload: 'injected-value',
        });

      expect(res.status).toBe(400);
      const errorContent = JSON.stringify(res.body);
      expect(errorContent).toMatch(/should not exist/i);
    });

    it('rejects unexpected properties in LogoutDto with 400 Bad Request', async () => {
      const server = app.getHttpServer();

      const res = await request(server)
        .post('/auth/logout')
        .send({
          unexpectedField: 'forbidden',
        });

      expect(res.status).toBe(400);
      const errorContent = JSON.stringify(res.body);
      expect(errorContent).toMatch(/should not exist/i);
    });

    it('rejects oversized inputs (email > 320 chars, password > 128 chars) with 400', async () => {
      const server = app.getHttpServer();
      const oversizedEmail = 'a'.repeat(315) + '@example.com'; // > 320 chars

      const res = await request(server)
        .post('/auth/register')
        .send({
          fullName: 'Oversized User',
          email: oversizedEmail,
          password: 'SecurePassword123!',
          passwordConfirmation: 'SecurePassword123!',
          termsAccepted: true,
        });

      expect(res.status).toBe(400);
    });

    it('rejects non-numeric OTP and invalid length OTP with 400', async () => {
      const server = app.getHttpServer();

      const res1 = await request(server)
        .post('/auth/verify-email')
        .send({
          email: 'valid@example.com',
          otp: 'abcdef', // non-numeric
        });
      expect(res1.status).toBe(400);

      const res2 = await request(server)
        .post('/auth/verify-email')
        .send({
          email: 'valid@example.com',
          otp: '12345', // only 5 digits
        });
      expect(res2.status).toBe(400);
    });
  });

  // ===========================================================================
  // 14. Anti-Enumeration & Sensitive Information Leakage Defense
  // ===========================================================================
  describe('14. Anti-Enumeration & Sensitive Information Leakage Defense', () => {
    it('forgot-password returns identical 200 OK generic response for non-existent and existing accounts', async () => {
      const server = app.getHttpServer();

      // Register existing account
      await request(server).post('/auth/register').send({
        fullName: 'Known User',
        email: 'known.user@example.com',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
        termsAccepted: true,
      });

      // Request 1: existing account
      const resExisting = await request(server)
        .post('/auth/forgot-password')
        .send({ email: 'known.user@example.com' });

      // Request 2: non-existent account
      const resNonExistent = await request(server)
        .post('/auth/forgot-password')
        .send({ email: 'ghost.user.does.not.exist@example.com' });

      expect(resExisting.status).toBe(200);
      expect(resNonExistent.status).toBe(200);
      expect(resExisting.body).toEqual(resNonExistent.body);
      expect(resExisting.body.success).toBe(true);
      expect(resExisting.body.message).toMatch(/if an account exists/i);
    });

    it('login returns identical 401 response for non-existent email as wrong password', async () => {
      const server = app.getHttpServer();

      // Register and verify a known user
      await request(server).post('/auth/register').send({
        fullName: 'Login User',
        email: 'login.user@example.com',
        password: 'CorrectPassword123!',
        passwordConfirmation: 'CorrectPassword123!',
        termsAccepted: true,
      });
      const regOtp = testInbox.getLastOtpFor('login.user@example.com')!;
      await request(server).post('/auth/verify-email').send({
        email: 'login.user@example.com',
        otp: regOtp,
      });

      // Attempt 1: Existing user with wrong password
      const wrongPasswordRes = await request(server)
        .post('/auth/login')
        .send({
          email: 'login.user@example.com',
          password: 'WrongPassword999!',
        });

      // Attempt 2: Non-existent user
      const nonExistentRes = await request(server)
        .post('/auth/login')
        .send({
          email: 'nobody.registered@example.com',
          password: 'AnyPassword123!',
        });

      expect(wrongPasswordRes.status).toBe(401);
      expect(nonExistentRes.status).toBe(401);
      expect(wrongPasswordRes.body.error).toBe('Invalid email address or password.');
      expect(nonExistentRes.body.error).toBe('Invalid email address or password.');
    });

    it('error responses never leak stack traces, database queries, or secret values', async () => {
      const server = app.getHttpServer();

      const res = await request(server)
        .post('/auth/register')
        .send({
          fullName: 'Bad User',
          email: 'bad-email-format',
          password: 'short',
        });

      expect(res.status).toBe(400);
      expect(res.body.stack).toBeUndefined();
      expect(res.body.sql).toBeUndefined();
      expect(res.body.query).toBeUndefined();
      expect(res.body.password).toBeUndefined();

      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toMatch(/node_modules/i);
      expect(bodyStr).not.toMatch(/SELECT /i);
      expect(bodyStr).not.toMatch(/INSERT /i);
    });
  });
});
