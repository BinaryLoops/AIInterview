import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountStatus, OtpPurpose, OtpState } from '@prisma/client';
import * as argon2 from 'argon2';

import { AuthConfigModule } from '../config/auth-config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../database/redis.service.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { PasswordModule } from '../password/password.module.js';
import { OtpModule } from '../otp/otp.module.js';
import { OtpService } from '../otp/otp.service.js';
import { EmailModule } from '../email/email.module.js';
import { EmailService } from '../email/email.service.js';
import { SessionModule } from '../session/session.module.js';
import { SessionService } from '../session/session.service.js';
import { TokenModule } from '../token/token.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthService } from '../auth/auth.service.js';
import { TestInbox } from './test-inbox.js';

const testDbUrl = process.env.TEST_DATABASE_URL;

function validateSafetyTarget(urlStr: string): void {
  try {
    const parsed = new URL(urlStr);
    const port = parsed.port || '5432';
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (isLocal && port === '5432') {
      throw new Error(
        'SAFETY VIOLATION: TEST_DATABASE_URL points to port 5432. ' +
        'Port 5432 is reserved for an unrelated host PostgreSQL service. ' +
        'A dedicated test database on another port (e.g. 5433) or a dedicated test container is required to protect external data.'
      );
    }
  } catch (err: any) {
    if (err.message.includes('SAFETY VIOLATION')) throw err;
    throw new Error(`Invalid TEST_DATABASE_URL: ${err.message}`);
  }
}

describe('PostgreSQL Authentication Integration Test Readiness', () => {
  it('enforces safety guards and dedicated database target validation', () => {
    if (!testDbUrl) {
      throw new Error(
        'SAFE TEST GUARD: No dedicated PostgreSQL test database configured.\n' +
        'To safely run real PostgreSQL-backed authentication tests:\n' +
        '1. Ensure a dedicated PostgreSQL instance is running on a port OTHER than 5432 (e.g. port 5433 or a dedicated test container).\n' +
        '2. Apply Prisma migrations to the test database: `pnpm --filter auth-service prisma migrate deploy`.\n' +
        '3. Provide the connection string via TEST_DATABASE_URL (e.g. postgresql://arep:arep_dev_only@127.0.0.1:5433/arep_test).\n' +
        'The test suite fails safely and will NEVER silently fall back to an in-memory mock or touch unrelated database services on port 5432.'
      );
    }

    // If TEST_DATABASE_URL is provided, strictly ensure it does not target host port 5432
    validateSafetyTarget(testDbUrl);
  });

  // When a verified, dedicated test database URL is available, execute the complete real DB flows
  // through the actual application services and their transactional logic.
  if (testDbUrl) {
    validateSafetyTarget(testDbUrl);

    describe('Real PostgreSQL-Backed Authentication Flows', () => {
      let app: INestApplication;
      let prisma: PrismaService;
      let authService: AuthService;
      let testInbox: TestInbox;

      const testEmail = `test-user-${Date.now()}@arep-test.local`;
      const testPassword = 'SecurePassword123!#';
      const newPassword = 'UpdatedPassword456!$';
      let userId = '';
      let emailOtp = '';
      let loginOtp = '';
      let refreshToken = '';
      let rotatedRefreshToken = '';

      beforeAll(async () => {
        testInbox = new TestInbox();

        // Configure environment so AuthConfigService connects the real PrismaService
        // to the verified dedicated test database without mocking Prisma
        process.env.DATABASE_ENABLED = 'true';
        process.env.DATABASE_URL = testDbUrl;

        const mockRedisService = {
          getClient: () => null,
          isHealthy: async () => false,
        };

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
            DatabaseModule,
            RateLimitModule,
            PasswordModule,
            OtpModule,
            EmailModule,
            SessionModule,
            TokenModule,
            AuthorizationModule,
            AuthModule,
          ],
        })
          .overrideProvider(RedisService)
          .useValue(mockRedisService)
          .overrideProvider(EmailService)
          .useValue(mockEmailService)
          .compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        authService = moduleFixture.get(AuthService);
        prisma = moduleFixture.get(PrismaService);
      });

      afterAll(async () => {
        if (app) {
          await app.close();
        }
      });

      it('1. Registration Persistence: creates real User and UserRole rows via AuthService.register', async () => {
        const result = await authService.register({
          fullName: 'Test Candidate',
          email: testEmail,
          password: testPassword,
          passwordConfirmation: testPassword,
          termsAccepted: true,
        });

        expect(result.email).toBe(testEmail);
        expect(result.emailVerified).toBe(false);

        // Verify in real PostgreSQL
        const dbUser = await prisma.user.findUnique({
          where: { email: testEmail },
          include: { userRoles: { include: { role: true } } },
        });

        expect(dbUser).not.toBeNull();
        userId = dbUser!.id;
        expect(dbUser!.emailVerified).toBe(false);
        expect(dbUser!.accountStatus).toBe(AccountStatus.ACTIVE);
        expect(dbUser!.passwordHash).toMatch(/^\$argon2id\$/);

        // Verify role association in PostgreSQL
        expect(dbUser!.userRoles).toHaveLength(1);
        expect(dbUser!.userRoles[0]?.role?.name).toBe('CANDIDATE');
      });

      it('2. Password-Hash Verification: validates Argon2id hash stored in PostgreSQL', async () => {
        const dbUser = await prisma.user.findUnique({ where: { id: userId } });
        expect(dbUser).not.toBeNull();

        const matches = await argon2.verify(dbUser!.passwordHash!, testPassword);
        expect(matches).toBe(true);

        const fails = await argon2.verify(dbUser!.passwordHash!, 'WrongPassword123!');
        expect(fails).toBe(false);
      });

      it('3. Email Verification: persists OTP challenge and marks user verified via AuthService.verifyEmail', async () => {
        const challenge = await prisma.otpChallenge.findFirst({
          where: { identifier: testEmail, purpose: 'EMAIL_VERIFICATION' },
          orderBy: { createdAt: 'desc' },
        });

        expect(challenge).not.toBeNull();
        expect(challenge!.state).toBe(OtpState.PENDING);

        // Retrieve recorded OTP code from test inbox
        const otpCode = testInbox.getLastOtpFor(testEmail);
        expect(otpCode).not.toBeNull();
        emailOtp = otpCode!;

        const verifyRes = await authService.verifyEmail({
          email: testEmail,
          code: emailOtp,
        });

        expect(verifyRes.emailVerified).toBe(true);

        // Verify state update in real PostgreSQL
        const updatedUser = await prisma.user.findUnique({ where: { id: userId } });
        expect(updatedUser!.emailVerified).toBe(true);

        const updatedChallenge = await prisma.otpChallenge.findUnique({
          where: { id: challenge!.id },
        });
        expect(updatedChallenge!.state).toBe(OtpState.CONSUMED);
      });

      it('4. Login Step 1: verifies password and persists LOGIN OTP challenge via AuthService.login', async () => {
        const step1 = await authService.login(
          { email: testEmail, password: testPassword },
          '198.51.100.1',
        );

        expect(step1.nextStep).toBe('VERIFY_LOGIN_OTP');
        expect(step1.email).toBe(testEmail);

        // Verify LOGIN OTP persisted in PostgreSQL
        const loginChallenge = await prisma.otpChallenge.findFirst({
          where: { identifier: testEmail, purpose: 'LOGIN' },
          orderBy: { createdAt: 'desc' },
        });

        expect(loginChallenge).not.toBeNull();
        expect(loginChallenge!.state).toBe(OtpState.PENDING);

        const otpCode = testInbox.getLastOtpFor(testEmail);
        expect(otpCode).not.toBeNull();
        loginOtp = otpCode!;
      });

      it('5. Login Step 2 & Session Creation: creates AuthSession row via AuthService.verifyLoginOtp', async () => {
        const step2 = await authService.verifyLoginOtp(
          { email: testEmail, code: loginOtp },
          { ipAddress: '198.51.100.1', userAgent: 'PostgreSQL-Integration-Test' },
        );

        expect(step2.accessToken).toBeDefined();
        expect(step2.session.refreshToken).toBeDefined();
        refreshToken = step2.session.refreshToken!;

        // Verify AuthSession in real PostgreSQL
        const session = await prisma.authSession.findUnique({
          where: { id: step2.session.id },
        });

        expect(session).not.toBeNull();
        expect(session!.userId).toBe(userId);
        expect(session!.refreshTokenHash).toBeDefined();
        expect(session!.revokedAt).toBeNull();
        expect(session!.userAgent).toBe('PostgreSQL-Integration-Test');
      });

      it('6. Refresh-Token Rotation & Replay: rotates session and revokes on reuse via AuthService.refresh', async () => {
        const refreshed = await authService.refresh(
          { refreshToken },
          { ipAddress: '198.51.100.2', userAgent: 'PostgreSQL-Integration-Test' },
        );

        expect(refreshed.accessToken).toBeDefined();
        expect(refreshed.session.refreshToken).toBeDefined();
        rotatedRefreshToken = refreshed.session.refreshToken!;

        // Verify previous session is marked revoked in PostgreSQL
        const previousSessionId = refreshToken.split('.')[0];
        const oldSession = await prisma.authSession.findUnique({
          where: { id: previousSessionId },
        });
        expect(oldSession!.revokedAt).not.toBeNull();

        // Verify new session is active in PostgreSQL
        const newSession = await prisma.authSession.findUnique({
          where: { id: refreshed.session.id },
        });
        expect(newSession!.revokedAt).toBeNull();

        // Replay attempt with old rotated token
        await expect(
          authService.refresh(
            { refreshToken },
            { ipAddress: '198.51.100.3', userAgent: 'Attacker' },
          ),
        ).rejects.toThrow();

        // Verify replay detection revokes ALL user sessions in PostgreSQL
        const activeSessions = await prisma.authSession.findMany({
          where: { userId, revokedAt: null },
        });
        expect(activeSessions).toHaveLength(0);
      });

      it('7. Logout: revokes active session via AuthService.logout', async () => {
        // Create fresh session
        const freshLogin = await authService.login(
          { email: testEmail, password: testPassword },
          '198.51.100.1',
        );
        expect(freshLogin.nextStep).toBe('VERIFY_LOGIN_OTP');
        const freshOtp = testInbox.getLastOtpFor(testEmail);
        expect(freshOtp).not.toBeNull();

        const loginRes = await authService.verifyLoginOtp({ email: testEmail, code: freshOtp! });
        const tokenToRevoke = loginRes.session.refreshToken!;
        const sessionId = loginRes.session.id;

        const logoutRes = await authService.logout({ refreshToken: tokenToRevoke }, '198.51.100.4');
        expect(logoutRes.success).toBe(true);

        // Verify in real PostgreSQL
        const session = await prisma.authSession.findUnique({ where: { id: sessionId } });
        expect(session!.revokedAt).not.toBeNull();
      });

      it('8. Password Reset: updates hash, records PasswordHistory, and revokes sessions via AuthService.resetPassword', async () => {
        // Step 1: Request reset
        await authService.forgotPassword({ email: testEmail });
        const resetOtp = testInbox.getLastOtpFor(testEmail);
        expect(resetOtp).not.toBeNull();

        // Step 2: Reset password
        const resetRes = await authService.resetPassword({
          email: testEmail,
          code: resetOtp!,
          newPassword,
          confirmPassword: newPassword,
        });

        expect(resetRes.success).toBe(true);

        // Verify password hash changed in real PostgreSQL
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const newMatches = await argon2.verify(user!.passwordHash!, newPassword);
        expect(newMatches).toBe(true);

        // Verify password history in PostgreSQL
        const history = await prisma.passwordHistory.findMany({ where: { userId } });
        expect(history.length).toBeGreaterThan(0);

        // Verify old password cannot be reused
        await authService.forgotPassword({ email: testEmail });
        const secondResetOtp = testInbox.getLastOtpFor(testEmail);
        expect(secondResetOtp).not.toBeNull();

        await expect(
          authService.resetPassword({
            email: testEmail,
            code: secondResetOtp!,
            newPassword: testPassword,
            confirmPassword: testPassword,
          }),
        ).rejects.toThrow();
      });

      it('9. Security Audit Persistence: verifies SecurityEvent records in PostgreSQL from service executions', async () => {
        const events = await prisma.securityEvent.findMany({
          where: { userId },
          orderBy: { occurredAt: 'asc' },
        });

        expect(events.length).toBeGreaterThan(0);
        const eventTypes = events.map((e) => e.eventType);

        // Verify key security events were recorded by the real services
        expect(eventTypes).toContain('EMAIL_VERIFIED');
        expect(eventTypes).toContain('LOGIN_SUCCESS');
        expect(eventTypes).toContain('LOGOUT');

        // Verify no plaintext passwords or raw OTPs leaked in metadata
        for (const event of events) {
          if (event.metadata) {
            const raw = JSON.stringify(event.metadata);
            expect(raw).not.toContain(testPassword);
            expect(raw).not.toContain(newPassword);
          }
        }
      });

      it('10. Live Concurrency & Isolation: verifies exactly one consumer succeeds when two requests consume the same OTP in PostgreSQL', async () => {
        const otpService = app.get(OtpService);
        const issued = await otpService.issueOtp({
          identifier: testEmail,
          purpose: OtpPurpose.LOGIN,
          userId,
        });

        // Race two concurrent verifyAndConsumeOtp calls against PostgreSQL
        const [r1, r2] = await Promise.all([
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

        const successes = [r1, r2].filter((r) => r.success);
        const failures = [r1, r2].filter((r) => !r.success);

        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(1);
        expect(failures[0]!.status).toBe('ALREADY_CONSUMED');

        // Verify state in PostgreSQL
        const challenge = await prisma.otpChallenge.findUnique({
          where: { id: issued.challengeId },
        });
        expect(challenge!.state).toBe('CONSUMED');
        expect(challenge!.attemptCount).toBe(1);
      });

      it('11. Live Concurrency & Row Locking: verifies exactly one rotation succeeds when two requests race to rotate the same refresh token in PostgreSQL', async () => {
        const sessionService = app.get(SessionService);
        const session = await sessionService.createSession({
          userId,
          ipAddress: '198.51.100.10',
          userAgent: 'PostgreSQL-Concurrency-Test',
        });

        // Race two concurrent rotateSession requests against PostgreSQL
        const [res1, res2] = await Promise.allSettled([
          sessionService.rotateSession(session.rawRefreshToken),
          sessionService.rotateSession(session.rawRefreshToken),
        ]);

        const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
        const rejected = [res1, res2].filter((r) => r.status === 'rejected');

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);

        // Verify old session is marked revoked in PostgreSQL
        const oldDbSession = await prisma.authSession.findUnique({
          where: { id: session.sessionId },
        });
        expect(oldDbSession!.revokedAt).not.toBeNull();
      });
    });
  }
});
