import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
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
import { maskEmail } from '../email/email.types.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { SessionService } from '../session/session.service.js';
import { TokenService } from '../token/token.service.js';
import { RolePrivilegeService } from '../authorization/role-privilege.service.js';
import { isRoleName, type RoleName } from '../authorization/roles.js';
import type { AuthenticatedPrincipal } from '../authorization/authorization.types.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { VerifyEmailDto } from './dto/verify-email.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { VerifyLoginOtpDto } from './dto/verify-login-otp.dto.js';
import type { RefreshTokenDto } from './dto/refresh-token.dto.js';
import type { LogoutDto } from './dto/logout.dto.js';
import type { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import type { ResetPasswordDto } from './dto/reset-password.dto.js';
import type { RevokeSessionResult } from '../session/session.types.js';

export interface ForgotPasswordResponse {
  success: boolean;
  message: string;
}

export interface ResetPasswordResponse {
  success: boolean;
  message: string;
}

export interface EmailDeliveryStatus {
  sent: boolean;
  message: string;
}

export interface VerifyEmailResponse {
  success: boolean;
  message: string;
  email: string;
  emailVerified: boolean;
}

export interface RegisterResponse {
  id: string;
  email: string;
  fullName: string;
  mobileNumber: string | null;
  emailVerified: boolean;
  accountStatus: AccountStatus;
  createdAt: Date;
  emailDelivery: EmailDeliveryStatus;
}

export interface LoginResponse {
  /**
   * Always false at this stage — the session is issued only after the
   * login OTP is verified in a subsequent endpoint (next task).
   */
  authenticated: false;
  /**
   * The next action the client must take.
   */
  nextStep: 'VERIFY_LOGIN_OTP';
  /**
   * The email address the OTP was delivered to (masked in plain-text for UX).
   */
  email: string;
  /**
   * Safe description shown to the client.
   */
  message: string;
  /**
   * Whether the OTP delivery succeeded. If false the client must retry
   * or request a resend — the credentials are still valid.
   */
  otpDelivery: {
    sent: boolean;
    message: string;
  };
}

export interface VerifyLoginOtpResponse {
  success: boolean;
  message: string;
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  session: {
    id: string;
    refreshToken: string;
    expiresAt: Date;
  };
  user: {
    id: string;
    email: string;
    roles: string[];
  };
}

export interface RefreshResponse {
  success: boolean;
  message: string;
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  session: {
    id: string;
    refreshToken: string;
    expiresAt: Date;
  };
  user?: {
    id: string;
    email: string;
    roles: string[];
  };
}

/**
 * Service orchestrating candidate registration, credential security,
 * trusted role assignment, and asynchronous verification email dispatch.
 *
 * ## Security Architecture:
 * 1. Passwords are validated using `PasswordPolicyService` and hashed with Argon2id.
 * 2. Plaintext passwords and confirmation values are NEVER stored, logged, or returned.
 * 3. Only the ordinary `CANDIDATE` role is assigned through server-side logic. Client payloads
 *    cannot choose privileged roles (ADMIN, SUPER_ADMIN, etc.) or manipulate user identities.
 * 4. Email uniqueness and mobile uniqueness constraints are enforced safely without exposing
 *    internal database structure or stack traces.
 * 5. Database transaction boundary: User creation, role assignment, initial password history,
 *    and security event logging are committed atomically inside PostgreSQL.
 * 6. Email delivery is intentionally decoupled outside the database transaction. If SMTP
 *    transport fails, the account is not silently rolled back or deleted; a safe response informs
 *    the user that verification can be requested again.
 */
/**
 * Sliding-window limit for failed logins per IP: 10 attempts in 15 minutes.
 * Choosing a generous window avoids permanently locking out legitimate users
 * who mistype their password a few times from the same network NAT.
 */
const IP_FAIL_LIMIT: { limit: number; ttl: number } = { limit: 10, ttl: 900 };

/**
 * Sliding-window limit for failed logins per account: 5 attempts in 15 minutes.
 * Lower than the IP limit to limit per-account brute force while avoiding
 * permanent denial-of-service for the victim (the counter resets after 15 min).
 */
const ACCOUNT_FAIL_LIMIT: { limit: number; ttl: number } = { limit: 5, ttl: 900 };

/**
 * Sliding-window limit for forgot-password requests per IP: 10 attempts in 15 minutes.
 */
const FORGOT_IP_LIMIT: { limit: number; ttl: number } = { limit: 10, ttl: 900 };

/**
 * Sliding-window limit for forgot-password requests per account: 5 attempts in 15 minutes.
 */
const FORGOT_ACCOUNT_LIMIT: { limit: number; ttl: number } = { limit: 5, ttl: 900 };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordPolicyService: PasswordPolicyService,
    private readonly passwordHashingService: PasswordHashingService,
    private readonly passwordHistoryService: PasswordHistoryService,
    private readonly otpService: OtpService,
    private readonly emailService: EmailService,
    private readonly rateLimitService: RateLimitService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    @Optional() private readonly rolePrivilegeService?: RolePrivilegeService,
  ) {}

  /**
   * Register a new candidate account.
   */
  async register(dto: RegisterDto): Promise<RegisterResponse> {
    // 1. Normalize and validate inputs
    const normalizedFullName = this.normalizeFullName(dto.fullName);
    const normalizedEmail = this.normalizeEmail(dto.email);
    const rawMobile = dto.mobileNumber ?? dto.phone;
    const normalizedMobile = this.normalizeMobileNumber(rawMobile);

    // 2. Validate password confirmation
    const confirmation = dto.passwordConfirmation ?? dto.confirmPassword;
    if (!confirmation) {
      throw new BadRequestException('Password confirmation is required.');
    }
    if (dto.password !== confirmation) {
      throw new BadRequestException('Password confirmation does not match password.');
    }

    // 3. Strictly require terms acceptance (matches registration UI requirement)
    const terms = dto.termsAccepted ?? dto.agreeTerms;
    if (terms !== true) {
      throw new BadRequestException('You must accept the terms of service and privacy policy to register.');
    }

    // 4. Validate password against policy
    const policyResult = this.passwordPolicyService.validate(dto.password);
    if (!policyResult.valid) {
      const messages = policyResult.violations.map((v) => v.message);
      throw new BadRequestException(messages);
    }

    // 5. Hash password with Argon2id
    const passwordHash = await this.passwordHashingService.hash(dto.password);

    // 6. Execute atomic user creation within database transaction
    let createdUser: {
      id: string;
      email: string;
      mobileNumber: string | null;
      emailVerified: boolean;
      accountStatus: AccountStatus;
      createdAt: Date;
    };

    try {
      createdUser = await this.prisma.$transaction(async (tx) => {
        // Pre-check for duplicate email or mobile number
        const existing = await tx.user.findFirst({
          where: {
            OR: [
              { email: normalizedEmail },
              ...(normalizedMobile ? [{ mobileNumber: normalizedMobile }] : []),
            ],
          },
          select: {
            email: true,
            mobileNumber: true,
          },
        });

        if (existing) {
          if (existing.email === normalizedEmail) {
            throw new ConflictException('An account with this email address already exists.');
          }
          if (normalizedMobile && existing.mobileNumber === normalizedMobile) {
            throw new ConflictException('An account with this mobile number already exists.');
          }
          throw new ConflictException('An account with these details already exists.');
        }

        // Ensure ordinary CANDIDATE role exists
        const candidateRole = await tx.role.upsert({
          where: { name: 'CANDIDATE' },
          update: {},
          create: {
            name: 'CANDIDATE',
            description: 'Standard candidate role',
          },
        });

        // Create User entity
        const user = await tx.user.create({
          data: {
            email: normalizedEmail,
            mobileNumber: normalizedMobile,
            passwordHash,
            emailVerified: false,
            accountStatus: AccountStatus.ACTIVE,
          },
          select: {
            id: true,
            email: true,
            mobileNumber: true,
            emailVerified: true,
            accountStatus: true,
            createdAt: true,
          },
        });

        // Assign CANDIDATE role
        await tx.userRole.create({
          data: {
            userId: user.id,
            roleId: candidateRole.id,
          },
        });

        // Record initial password history entry
        await tx.passwordHistory.create({
          data: {
            userId: user.id,
            passwordHash,
          },
        });

        // Log security audit event (Role assigned)
        await tx.securityEvent.create({
          data: {
            eventType: SecurityEventType.ROLE_ASSIGNED,
            userId: user.id,
            metadata: {
              role: 'CANDIDATE',
              fullName: normalizedFullName,
              termsAccepted: true,
              termsVersion: '1.0',
              termsAcceptedAt: new Date().toISOString(),
            },
          },
        });

        return user;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = (error.meta?.target as string[] | string | undefined) ?? [];
        const targetStr = Array.isArray(target) ? target.join(',') : String(target);
        if (targetStr.includes('email')) {
          throw new ConflictException('An account with this email address already exists.');
        }
        if (targetStr.includes('mobile')) {
          throw new ConflictException('An account with this mobile number already exists.');
        }
        throw new ConflictException('An account with these details already exists.');
      }

      if (error instanceof ConflictException || error instanceof BadRequestException) {
        throw error;
      }

      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Registration database error: ${msg}`);
      throw new InternalServerErrorException('Registration failed due to a server error.');
    }

    // 7. Outside the DB transaction: initiate OTP challenge and email delivery
    let emailDelivery: EmailDeliveryStatus = {
      sent: false,
      message: 'Verification email has not been sent.',
    };

    try {
      const otpResult = await this.otpService.issueOtp({
        identifier: normalizedEmail,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        userId: createdUser.id,
      });

      try {
        await this.emailService.sendOtpEmail({
          recipientEmail: normalizedEmail,
          purpose: OtpPurpose.EMAIL_VERIFICATION,
          otpCode: otpResult.code,
        });

        emailDelivery = {
          sent: true,
          message: 'Verification email sent successfully.',
        };
      } catch (emailError) {
        const masked = maskEmail(normalizedEmail);
        this.logger.warn(
          `Verification email delivery failed for user ${createdUser.id} (${masked}): ${
            emailError instanceof Error ? emailError.message : String(emailError)
          }`,
        );
        emailDelivery = {
          sent: false,
          message:
            'Account created, but verification email could not be delivered. Please request a new verification code.',
        };
      }
    } catch (otpError) {
      this.logger.error(
        `Failed to issue verification OTP for user ${createdUser.id}: ${
          otpError instanceof Error ? otpError.message : String(otpError)
        }`,
      );
      emailDelivery = {
        sent: false,
        message:
          'Account created, but verification code could not be issued. Please request a verification code.',
      };
    }

    // 8. Return sanitized response — NEVER includes passwordHash, OTP code, or verifiers
    return {
      id: createdUser.id,
      email: createdUser.email,
      fullName: normalizedFullName,
      mobileNumber: createdUser.mobileNumber,
      emailVerified: createdUser.emailVerified,
      accountStatus: createdUser.accountStatus,
      createdAt: createdUser.createdAt,
      emailDelivery,
    };
  }

  /**
   * Verifies a user's email address using a six-digit OTP challenge.
   *
   * ## Transactional & Consistency Boundaries:
   * 1. OtpService.verifyAndConsumeOtp encapsulates its own atomic transaction boundary
   *    to conditionally transition the OTP challenge from PENDING to CONSUMED while ensuring
   *    failed attempt increments and invalidations are durably committed against brute-force attacks.
   * 2. After atomic OTP consumption, the user's `emailVerified` flag and audit log (`EMAIL_VERIFIED`)
   *    are updated inside a database transaction.
   * 3. If the user update fails, the OTP remains consumed to protect against replay attacks, and
   *    the user can request a fresh verification challenge.
   */
  async verifyEmail(dto: VerifyEmailDto): Promise<VerifyEmailResponse> {
    // 1. Validate code input strictly
    const rawCode = dto.otp ?? dto.code;
    if (!rawCode) {
      throw new BadRequestException('Verification code is required.');
    }
    if (!/^\d{6}$/.test(rawCode)) {
      throw new BadRequestException('Verification code must be exactly 6 digits.');
    }

    // 2. Normalize email identifier
    const normalizedEmail = this.normalizeEmail(dto.email);

    // 3. Locate user
    let user: { id: string; email: string; emailVerified: boolean } | null;
    try {
      user = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, email: true, emailVerified: true },
      });
    } catch (dbError) {
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      this.logger.error(`Database error looking up user during verification: ${msg}`);
      throw new InternalServerErrorException('Verification failed due to a server error.');
    }

    if (!user) {
      throw new NotFoundException('No user account found with this email address.');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email address is already verified.');
    }

    // 4. Atomically verify and consume OTP challenge bound to identifier and EMAIL_VERIFICATION purpose
    let verificationResult;
    try {
      verificationResult = await this.otpService.verifyAndConsumeOtp({
        identifier: normalizedEmail,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        code: rawCode,
      });
    } catch (otpError) {
      const msg = otpError instanceof Error ? otpError.message : String(otpError);
      this.logger.error(`Error verifying OTP challenge: ${msg}`);
      throw new InternalServerErrorException('Verification failed due to a server error.');
    }

    if (!verificationResult.success) {
      switch (verificationResult.status) {
        case 'ALREADY_CONSUMED':
          throw new BadRequestException('Verification code has already been consumed.');
        case 'EXPIRED':
          throw new BadRequestException('Verification code has expired. Please request a new code.');
        case 'EXHAUSTED':
          throw new BadRequestException(
            'Verification code has exceeded the maximum number of attempts. Please request a new code.',
          );
        case 'INVALID_CODE':
          throw new BadRequestException('Invalid verification code.');
        case 'NOT_FOUND':
          throw new BadRequestException('No pending verification code found for this email address.');
        default:
          throw new BadRequestException('Invalid verification code.');
      }
    }

    // 5. Update user to verified and record security event atomically
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { emailVerified: true },
        });

        await tx.securityEvent.create({
          data: {
            eventType: SecurityEventType.EMAIL_VERIFIED,
            userId: user.id,
            metadata: {
              challengeId: verificationResult.challengeId,
            },
          },
        });
      });
    } catch (updateError) {
      const msg = updateError instanceof Error ? updateError.message : String(updateError);
      this.logger.error(`Database error marking email verified for user ${user.id}: ${msg}`);
      throw new InternalServerErrorException('Failed to update email verification status.');
    }

    // 6. Return minimal sanitized response
    return {
      success: true,
      message: 'Email address verified successfully.',
      email: user.email,
      emailVerified: true,
    };
  }

  /**
   * Authenticate a user with email and password.
   *
   * ## Login Flow (two-step with OTP gate)
   * Valid credentials alone do NOT grant an authenticated session.
   * After credential and account-state checks succeed, a LOGIN-purpose OTP
   * challenge is issued and delivered to the registered email. The client
   * must then call the (future) /auth/verify-login-otp endpoint to obtain
   * a session. This endpoint returns `authenticated: false` with `nextStep:
   * 'VERIFY_LOGIN_OTP'` to make the pending step unambiguous.
   *
   * ## Failed-Login Protection (no schema change required)
   * The Prisma schema has no `failedAttemptCount` or `lockedAt` column on
   * `User`. Adding one would require a migration (Prompt 16 scope boundary:
   * do not modify schema). Instead, two sliding-window counters are maintained
   * via the existing `RateLimitService` (Redis-backed with in-memory fallback):
   *
   *   - `login:ip:<ip>`      — 10 failures per 15 minutes per IP
   *   - `login:acct:<hash>`  — 5 failures per 15 minutes per account email
   *
   * The account key uses a one-way hash of the normalised email so the raw
   * address is never stored in Redis. Counters reset automatically via TTL,
   * which prevents a permanent denial-of-service caused by an attacker
   * repeatedly submitting wrong passwords for a victim account.
   *
   * Both counters are checked BEFORE any credential verification so that
   * a blocked IP or account never reaches the Argon2 hasher (CPU savings)
   * and never leaks timing information.
   *
   * ## Anti-Enumeration Design
   * If the email is unknown OR the password is wrong, the same generic
   * `401 Unauthorized` message is returned. The failed-login counter for
   * an unknown email is still incremented (on the IP key only, since there
   * is no account to bind to) to limit enumeration via timing.
   */
  async login(dto: LoginDto, ipAddress: string): Promise<LoginResponse> {
    const normalizedEmail = this.normalizeEmail(dto.email);

    // 1. Check IP-level sliding-window failure counter BEFORE any DB or hash work.
    const ipKey = `login:ip:${ipAddress}`;
    const ipExceeded = await this.rateLimitService.isExceeded(ipKey, IP_FAIL_LIMIT.limit);
    if (ipExceeded) {
      throw new UnauthorizedException(
        'Too many failed login attempts from this IP address. Please try again later.',
      );
    }

    // 2. Check account-level sliding-window failure counter using a hashed email key.
    const { createHash } = await import('node:crypto');
    const emailHash = createHash('sha256').update(normalizedEmail).digest('hex').slice(0, 32);
    const acctKey = `login:acct:${emailHash}`;
    const acctExceeded = await this.rateLimitService.isExceeded(acctKey, ACCOUNT_FAIL_LIMIT.limit);
    if (acctExceeded) {
      this.logger.warn(`Account-level login rate limit hit for key ${emailHash}`);
      throw new UnauthorizedException(
        'Too many failed login attempts for this account. Please try again later.',
      );
    }

    // 3. Look up the user. We load the passwordHash regardless of whether the
    //    account exists so that both paths spend similar wall-clock time.
    let user: {
      id: string;
      email: string;
      passwordHash: string | null;
      emailVerified: boolean;
      accountStatus: AccountStatus;
    } | null;

    try {
      user = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: {
          id: true,
          email: true,
          passwordHash: true,
          emailVerified: true,
          accountStatus: true,
        },
      });
    } catch (dbError) {
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      this.logger.error(`Database error during user lookup in login: ${msg}`);
      throw new InternalServerErrorException('Login failed due to a server error.');
    }

    // 4. Verify password. If user is null we run a dummy verify to prevent
    //    timing attacks that would reveal whether an email exists.
    let passwordMatches = false;
    if (user?.passwordHash) {
      try {
        passwordMatches = await this.passwordHashingService.verify(
          user.passwordHash,
          dto.password,
        );
      } catch (hashError) {
        const msg = hashError instanceof Error ? hashError.message : String(hashError);
        this.logger.error(`Password verification error during login: ${msg}`);
        throw new InternalServerErrorException('Login failed due to a server error.');
      }
    } else {
      // No user or no passwordHash — run a dummy hash to equalize timing.
      await this.passwordHashingService.verify(
        '$argon2id$v=19$m=65536,t=3,p=1$dummysalt123456789012345678901=$dummyhash123456789012345678901234567890=',
        dto.password,
      ).catch(() => false);
    }

    // 5. Reject with a generic response if user not found or password wrong.
    if (!user || !passwordMatches) {
      // Record failure on both IP and account sliding-window limiters
      await this.rateLimitService.recordFailure(ipKey, IP_FAIL_LIMIT);
      await this.rateLimitService.recordFailure(acctKey, ACCOUNT_FAIL_LIMIT);

      // Log a LOGIN_FAILURE event. For unknown email we log without userId.
      try {
        await this.prisma.securityEvent.create({
          data: {
            eventType: SecurityEventType.LOGIN_FAILURE,
            userId: user?.id ?? null,
            ipAddress,
            metadata: { reason: 'invalid_credentials' },
          },
        });
      } catch (logError) {
        const msg = logError instanceof Error ? logError.message : String(logError);
        this.logger.warn(`Failed to record LOGIN_FAILURE event: ${msg}`);
      }
      throw new UnauthorizedException('Invalid email address or password.');
    }

    // Credentials verified: reset account-level failure counter to prevent accidental lockout
    await this.rateLimitService.reset(acctKey);

    // 6. Account state checks — use specific, safe messages (not credential-related).
    if (user.accountStatus === AccountStatus.SUSPENDED) {
      try {
        await this.prisma.securityEvent.create({
          data: {
            eventType: SecurityEventType.LOGIN_FAILURE,
            userId: user.id,
            ipAddress,
            metadata: { reason: 'account_suspended' },
          },
        });
      } catch { /* best-effort */ }
      throw new ForbiddenException(
        'Your account has been suspended. Please contact support.',
      );
    }

    if (user.accountStatus === AccountStatus.DEACTIVATED) {
      try {
        await this.prisma.securityEvent.create({
          data: {
            eventType: SecurityEventType.LOGIN_FAILURE,
            userId: user.id,
            ipAddress,
            metadata: { reason: 'account_deactivated' },
          },
        });
      } catch { /* best-effort */ }
      throw new ForbiddenException(
        'Your account has been deactivated. Please contact support to restore access.',
      );
    }

    // 7. Email verification check — unverified accounts may not receive a
    //    full login OTP since they haven't confirmed identity ownership yet.
    if (!user.emailVerified) {
      try {
        await this.prisma.securityEvent.create({
          data: {
            eventType: SecurityEventType.LOGIN_FAILURE,
            userId: user.id,
            ipAddress,
            metadata: { reason: 'email_not_verified' },
          },
        });
      } catch { /* best-effort */ }
      throw new ForbiddenException(
        'Email address not verified. Please verify your email before logging in.',
      );
    }

    // --- Credentials and account state are valid. ---
    // Reset is implicit: the sliding window will naturally expire, which avoids
    // a permanent lockout even if an attacker guesses wrong many times.

    // 8. Issue a LOGIN-purpose OTP and deliver it to the registered email.
    let otpResult: { challengeId: string; code: string; expiresAt: Date };
    try {
      otpResult = await this.otpService.issueOtp({
        identifier: normalizedEmail,
        purpose: OtpPurpose.LOGIN,
        userId: user.id,
      });
    } catch (otpError) {
      const msg = otpError instanceof Error ? otpError.message : String(otpError);
      this.logger.error(`Failed to issue LOGIN OTP for user ${user.id}: ${msg}`);
      throw new InternalServerErrorException(
        'Login failed due to a server error. Please try again.',
      );
    }

    // 9. Record OTP_REQUESTED audit event (no OTP code or verifier included).
    try {
      await this.prisma.securityEvent.create({
        data: {
          eventType: SecurityEventType.OTP_REQUESTED,
          userId: user.id,
          ipAddress,
          metadata: {
            purpose: OtpPurpose.LOGIN,
            challengeId: otpResult.challengeId,
          },
        },
      });
    } catch (logError) {
      const msg = logError instanceof Error ? logError.message : String(logError);
      this.logger.warn(`Failed to record OTP_REQUESTED event for user ${user.id}: ${msg}`);
    }

    // 10. Deliver the OTP via email (outside any transaction — if SMTP fails
    //     the OTP challenge still exists; the client can request a resend).
    let otpDelivery: { sent: boolean; message: string };
    try {
      await this.emailService.sendOtpEmail({
        recipientEmail: normalizedEmail,
        purpose: OtpPurpose.LOGIN,
        otpCode: otpResult.code,
      });
      otpDelivery = {
        sent: true,
        message: 'A login verification code has been sent to your email.',
      };
    } catch (emailError) {
      const masked = maskEmail(normalizedEmail);
      this.logger.warn(
        `Login OTP delivery failed for user ${user.id} (${masked}): ${
          emailError instanceof Error ? emailError.message : String(emailError)
        }`,
      );
      otpDelivery = {
        sent: false,
        message:
          'We were unable to deliver the login code. Please try again or request a resend.',
      };
    }

    // 11. Return a safe, non-authenticated response. The client must complete
    //     OTP verification before any session is issued.
    return {
      authenticated: false,
      nextStep: 'VERIFY_LOGIN_OTP',
      email: user.email,
      message:
        'Credentials verified. Please check your email for a login verification code.',
      otpDelivery,
    };
  }

  /**
   * Completes candidate / recruiter authentication by verifying the 6-digit LOGIN OTP challenge.
   *
   * ## Security Gate:
   * Sessions are NEVER issued from the password check alone. Only after the OTP has been
   * verified and atomically consumed by `OtpService` does this method invoke `SessionService.createSession()`.
   * Client-supplied flags or user IDs are never trusted.
   */
  async verifyLoginOtp(
    dto: VerifyLoginOtpDto,
    context?: { ipAddress?: string; userAgent?: string },
  ): Promise<VerifyLoginOtpResponse> {
    const normalizedEmail = this.normalizeEmail(dto.email);
    const otpCode = dto.otp ?? dto.code;

    if (!otpCode) {
      throw new BadRequestException('Verification code is required.');
    }
    if (!/^\d{6}$/.test(otpCode)) {
      throw new BadRequestException('Verification code must be exactly 6 digits.');
    }

    // 1. Look up user and assignable roles
    let user: {
      id: string;
      email: string;
      accountStatus: AccountStatus;
      emailVerified: boolean;
      userRoles: { role: { name: string } }[];
    } | null;

    try {
      user = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: {
          id: true,
          email: true,
          accountStatus: true,
          emailVerified: true,
          userRoles: {
            select: {
              role: {
                select: { name: true },
              },
            },
          },
        },
      });
    } catch (dbError) {
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      this.logger.error(`Database error during user lookup in verifyLoginOtp: ${msg}`);
      throw new InternalServerErrorException('Login verification failed due to a server error.');
    }

    if (!user) {
      throw new NotFoundException('No user account found for the specified email address.');
    }

    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(`Account is ${user.accountStatus.toLowerCase()}. Please contact support.`);
    }

    if (!user.emailVerified) {
      throw new ForbiddenException('Email address not verified. Please verify your email before logging in.');
    }

    // 2. Atomically verify and consume OTP challenge
    let otpResult: { success: boolean; status: string; challengeId?: string };
    try {
      otpResult = await this.otpService.verifyAndConsumeOtp({
        identifier: normalizedEmail,
        purpose: OtpPurpose.LOGIN,
        code: otpCode,
      });
    } catch (otpError) {
      const msg = otpError instanceof Error ? otpError.message : String(otpError);
      this.logger.error(`OtpService error during verifyLoginOtp for user ${user.id}: ${msg}`);
      throw new InternalServerErrorException('Login verification failed due to a server error.');
    }

    if (!otpResult.success) {
      try {
        await this.prisma.securityEvent.create({
          data: {
            eventType: SecurityEventType.OTP_FAILED,
            userId: user.id,
            ipAddress: context?.ipAddress,
            metadata: {
              purpose: OtpPurpose.LOGIN,
              status: otpResult.status,
            },
          },
        });
      } catch { /* best effort */ }

      switch (otpResult.status) {
        case 'INVALID_CODE':
          throw new BadRequestException('Invalid verification code.');
        case 'EXPIRED':
          throw new BadRequestException('Verification code has expired. Please log in again.');
        case 'ALREADY_CONSUMED':
          throw new BadRequestException('Verification code has already been consumed.');
        case 'EXHAUSTED':
          throw new BadRequestException('Verification code has exceeded the maximum number of attempts.');
        default:
          throw new BadRequestException('No pending login verification code found. Please log in again.');
      }
    }

    // 3. Log OTP_VERIFIED audit event
    try {
      await this.prisma.securityEvent.create({
        data: {
          eventType: SecurityEventType.OTP_VERIFIED,
          userId: user.id,
          ipAddress: context?.ipAddress,
          metadata: {
            purpose: OtpPurpose.LOGIN,
            challengeId: otpResult.challengeId,
          },
        },
      });
    } catch { /* best effort */ }

    // 4. Issue authenticated session via SessionService (server-controlled, trusted userId)
    const session = await this.sessionService.createSession({
      userId: user.id,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    // 5. Log LOGIN_SUCCESS audit event
    try {
      await this.prisma.securityEvent.create({
        data: {
          eventType: SecurityEventType.LOGIN_SUCCESS,
          userId: user.id,
          sessionId: session.sessionId,
          ipAddress: context?.ipAddress,
        },
      });
    } catch { /* best effort */ }

    const roles = user.userRoles.map((ur) => ur.role.name) as RoleName[];

    // 6. Issue cryptographically signed short-lived access token
    const tokenResult = await this.tokenService.generateAccessToken({
      userId: user.id,
      email: user.email,
      roles,
      sessionId: session.sessionId,
    });

    return {
      success: true,
      message: 'Login successful.',
      accessToken: tokenResult.token,
      tokenType: 'Bearer',
      expiresIn: tokenResult.expiresIn,
      session: {
        id: session.sessionId,
        refreshToken: session.rawRefreshToken,
        expiresAt: session.expiresAt,
      },
      user: {
        id: user.id,
        email: user.email,
        roles,
      },
    };
  }

  /**
   * Refreshes an active session with single-use refresh token rotation and replay detection.
   */
  async refresh(
    dto: RefreshTokenDto,
    context?: { ipAddress?: string; userAgent?: string },
  ): Promise<RefreshResponse> {
    if (!dto.refreshToken) {
      throw new UnauthorizedException('Refresh token is required.');
    }
    const rotated = await this.sessionService.rotateSession(dto.refreshToken, context);

    // Look up current user roles from trusted database state
    let user: {
      id: string;
      email: string;
      accountStatus: AccountStatus;
      emailVerified: boolean;
      userRoles: { role: { name: string } }[];
    } | null;

    try {
      user = await this.prisma.user.findUnique({
        where: { id: rotated.userId },
        select: {
          id: true,
          email: true,
          accountStatus: true,
          emailVerified: true,
          userRoles: {
            select: {
              role: {
                select: { name: true },
              },
            },
          },
        },
      });
    } catch (dbError) {
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      this.logger.error(`Database error looking up user during session refresh: ${msg}`);
      throw new InternalServerErrorException('Failed to refresh session due to a server error.');
    }

    if (!user || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException('Account is not active.');
    }

    if (!user.emailVerified) {
      throw new ForbiddenException('Email address not verified.');
    }

    const roles = user.userRoles.map((ur) => ur.role.name) as RoleName[];

    // Generate new short-lived access token with current roles
    const tokenResult = await this.tokenService.generateAccessToken({
      userId: user.id,
      email: user.email,
      roles,
      sessionId: rotated.sessionId,
    });

    return {
      success: true,
      message: 'Session refreshed successfully.',
      accessToken: tokenResult.token,
      tokenType: 'Bearer',
      expiresIn: tokenResult.expiresIn,
      session: {
        id: rotated.sessionId,
        refreshToken: rotated.rawRefreshToken,
        expiresAt: rotated.expiresAt,
      },
      user: {
        id: user.id,
        email: user.email,
        roles,
      },
    };
  }

  /**
   * Revokes an authentication session (logout).
   */
  async logout(dto: LogoutDto, ipAddress?: string): Promise<RevokeSessionResult> {
    if (!dto.refreshToken) {
      return { success: true, message: 'Logged out successfully.' };
    }
    return this.sessionService.revokeSession(dto.refreshToken, ipAddress);
  }

  /**
   * Initiates a password-reset flow by generating a 6-digit PASSWORD_RESET OTP
   * and delivering it to the user's verified email.
   *
   * ## Anti-Enumeration & Privacy Guarantees:
   * 1. Unknown, unverified, suspended, or deactivated accounts return the exact same public status (200 OK)
   *    and response shape as an eligible account without disclosing account existence or status.
   * 2. Raw email addresses are NEVER stored in rate-limit keys (hashed with SHA-256).
   * 3. OTP codes and verifiers are NEVER returned, logged, or stored in audit metadata.
   * 4. Email delivery failures are safely sanitized without disclosing account existence or leaking internal transport details.
   */
  async forgotPassword(
    dto: ForgotPasswordDto,
    clientIp?: string,
  ): Promise<ForgotPasswordResponse> {
    const normalizedEmail = this.normalizeEmail(dto.email);

    // 1. IP-level rate limiting
    const ipKey = clientIp ? `forgot:ip:${clientIp}` : 'forgot:ip:unknown';
    const ipAllowed = await this.rateLimitService.isAllowed(ipKey, FORGOT_IP_LIMIT);
    if (!ipAllowed) {
      throw new HttpException(
        'Too many password reset requests from this IP address. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2. Account-level rate limiting with privacy-preserving SHA-256 hash
    const emailHash = createHash('sha256').update(normalizedEmail).digest('hex').slice(0, 32);
    const acctKey = `forgot:acct:${emailHash}`;
    const acctAllowed = await this.rateLimitService.isAllowed(acctKey, FORGOT_ACCOUNT_LIMIT);
    if (!acctAllowed) {
      this.logger.warn(`Account-level forgot-password rate limit hit for key ${emailHash}`);
      throw new HttpException(
        'Too many password reset requests for this account. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const genericSuccessResponse: ForgotPasswordResponse = {
      success: true,
      message: 'If an account exists with this email address, password reset instructions have been sent.',
    };

    // 3. Look up user account
    let user: {
      id: string;
      email: string;
      accountStatus: AccountStatus;
      emailVerified: boolean;
    } | null = null;

    try {
      user = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: {
          id: true,
          email: true,
          accountStatus: true,
          emailVerified: true,
        },
      });
    } catch (dbError) {
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      this.logger.error(`Database error during user lookup in forgotPassword: ${msg}`);
      throw new InternalServerErrorException('Password reset request failed due to a server error.');
    }

    // 4. Ineligible accounts (nonexistent, suspended, deactivated, or unverified)
    // Return identical response to prevent account enumeration
    if (!user) {
      return genericSuccessResponse;
    }

    if (user.accountStatus !== AccountStatus.ACTIVE) {
      try {
        await this.prisma.securityEvent.create({
          data: {
            eventType: SecurityEventType.PASSWORD_RESET_REQUEST,
            userId: user.id,
            ipAddress: clientIp,
            metadata: { reason: `ineligible_account_${user.accountStatus.toLowerCase()}` },
          },
        });
      } catch { /* best effort */ }
      return genericSuccessResponse;
    }

    if (!user.emailVerified) {
      try {
        await this.prisma.securityEvent.create({
          data: {
            eventType: SecurityEventType.PASSWORD_RESET_REQUEST,
            userId: user.id,
            ipAddress: clientIp,
            metadata: { reason: 'ineligible_account_unverified' },
          },
        });
      } catch { /* best effort */ }
      return genericSuccessResponse;
    }

    // 5. Eligible account: Issue PASSWORD_RESET OTP
    let otpResult: { challengeId: string; code: string; expiresAt: Date };
    try {
      otpResult = await this.otpService.issueOtp({
        identifier: normalizedEmail,
        purpose: OtpPurpose.PASSWORD_RESET,
        userId: user.id,
      });
    } catch (otpError) {
      const msg = otpError instanceof Error ? otpError.message : String(otpError);
      this.logger.error(`Failed to issue PASSWORD_RESET OTP for user ${user.id}: ${msg}`);
      throw new InternalServerErrorException('Unable to process password reset request due to a server error.');
    }

    // 6. Record PASSWORD_RESET_REQUEST security event (no secrets or raw emails)
    try {
      await this.prisma.securityEvent.create({
        data: {
          eventType: SecurityEventType.PASSWORD_RESET_REQUEST,
          userId: user.id,
          ipAddress: clientIp,
          metadata: {
            challengeId: otpResult.challengeId,
          },
        },
      });
    } catch (logError) {
      const msg = logError instanceof Error ? logError.message : String(logError);
      this.logger.warn(`Failed to record PASSWORD_RESET_REQUEST event for user ${user.id}: ${msg}`);
    }

    // 7. Deliver OTP email
    try {
      await this.emailService.sendOtpEmail({
        recipientEmail: normalizedEmail,
        purpose: OtpPurpose.PASSWORD_RESET,
        otpCode: otpResult.code,
      });
    } catch (emailError) {
      const masked = maskEmail(normalizedEmail);
      const msg = emailError instanceof Error ? emailError.message : String(emailError);
      this.logger.error(`Failed to deliver password reset email for user ${user.id} (${masked}): ${msg}`);
      throw new InternalServerErrorException('Unable to deliver password reset email. Please try again later.');
    }

    return genericSuccessResponse;
  }

  /**
   * Completes password reset by validating inputs, verifying/consuming OTP,
   * enforcing password policy and history constraints, hashing with Argon2id,
   * atomically updating database records, and revoking all active sessions.
   */
  async resetPassword(
    dto: ResetPasswordDto,
    context?: { ipAddress?: string; userAgent?: string },
  ): Promise<ResetPasswordResponse> {
    const normalizedEmail = this.normalizeEmail(dto.email);
    const otpCode = dto.otp ?? dto.code;
    const newPassword = dto.newPassword ?? dto.password;
    const confirmation = dto.passwordConfirmation ?? dto.confirmPassword;

    if (!otpCode) {
      throw new BadRequestException('Verification code is required.');
    }
    if (!/^\d{6}$/.test(otpCode)) {
      throw new BadRequestException('Verification code must be exactly 6 digits.');
    }
    if (!newPassword) {
      throw new BadRequestException('New password is required.');
    }
    if (!confirmation) {
      throw new BadRequestException('Password confirmation is required.');
    }
    if (newPassword !== confirmation) {
      throw new BadRequestException('Password confirmation does not match new password.');
    }

    // 1. Enforce password policy
    const policyResult = this.passwordPolicyService.validate(newPassword);
    if (!policyResult.valid) {
      const messages = policyResult.violations.map((v) => v.message);
      throw new BadRequestException(messages);
    }

    // 2. Look up user account
    let user: {
      id: string;
      email: string;
      passwordHash: string | null;
      accountStatus: AccountStatus;
      emailVerified: boolean;
    } | null = null;

    try {
      user = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: {
          id: true,
          email: true,
          passwordHash: true,
          accountStatus: true,
          emailVerified: true,
        },
      });
    } catch (dbError) {
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      this.logger.error(`Database error during user lookup in resetPassword: ${msg}`);
      throw new InternalServerErrorException('Password reset failed due to a server error.');
    }

    if (!user) {
      throw new NotFoundException('No user account found for the specified email address.');
    }

    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(`Account is ${user.accountStatus.toLowerCase()}. Please contact support.`);
    }

    if (!user.emailVerified) {
      throw new ForbiddenException('Email address not verified. Please verify your email before resetting your password.');
    }

    // 3. Atomically verify and consume OTP challenge
    let otpResult: { success: boolean; status: string; challengeId?: string };
    try {
      otpResult = await this.otpService.verifyAndConsumeOtp({
        identifier: normalizedEmail,
        purpose: OtpPurpose.PASSWORD_RESET,
        code: otpCode,
      });
    } catch (otpError) {
      const msg = otpError instanceof Error ? otpError.message : String(otpError);
      this.logger.error(`OtpService error during resetPassword for user ${user.id}: ${msg}`);
      throw new InternalServerErrorException('Password reset failed due to a server error.');
    }

    if (!otpResult.success) {
      try {
        await this.prisma.securityEvent.create({
          data: {
            eventType: SecurityEventType.OTP_FAILED,
            userId: user.id,
            ipAddress: context?.ipAddress,
            metadata: {
              purpose: OtpPurpose.PASSWORD_RESET,
              status: otpResult.status,
            },
          },
        });
      } catch { /* best effort */ }

      switch (otpResult.status) {
        case 'INVALID_CODE':
          throw new BadRequestException('Invalid verification code.');
        case 'EXPIRED':
          throw new BadRequestException('Verification code has expired. Please request a new password reset.');
        case 'ALREADY_CONSUMED':
          throw new BadRequestException('Verification code has already been consumed.');
        case 'EXHAUSTED':
          throw new BadRequestException('Verification code has exceeded the maximum number of attempts.');
        default:
          throw new BadRequestException('No pending password reset verification code found. Please request a new code.');
      }
    }

    try {
      await this.prisma.securityEvent.create({
        data: {
          eventType: SecurityEventType.OTP_VERIFIED,
          userId: user.id,
          ipAddress: context?.ipAddress,
          metadata: {
            purpose: OtpPurpose.PASSWORD_RESET,
            challengeId: otpResult.challengeId,
          },
        },
      });
    } catch { /* best effort */ }

    // 4. Reject reuse of current password
    if (user.passwordHash) {
      let matchesCurrent = false;
      try {
        matchesCurrent = await this.passwordHashingService.verify(user.passwordHash, newPassword);
      } catch (verifyError) {
        const msg = verifyError instanceof Error ? verifyError.message : String(verifyError);
        this.logger.error(`Verification error against current password for user ${user.id}: ${msg}`);
        throw new InternalServerErrorException('Password reset failed due to a server error.');
      }
      if (matchesCurrent) {
        throw new BadRequestException('New password cannot be the same as your current password.');
      }
    }

    // 5. Reject reuse of historical passwords (last 5 entries)
    let isReused = false;
    try {
      isReused = await this.passwordHistoryService.isPasswordReused(user.id, newPassword);
    } catch (pwHistError) {
      const msg = pwHistError instanceof Error ? pwHistError.message : String(pwHistError);
      this.logger.error(`PasswordHistoryService error during resetPassword for user ${user.id}: ${msg}`);
      throw new InternalServerErrorException('Password reset failed due to a server error.');
    }
    if (isReused) {
      throw new BadRequestException('New password cannot be one of your recently used passwords.');
    }

    // 6. Hash new password with Argon2id
    const newPasswordHash = await this.passwordHashingService.hash(newPassword);

    // 7. Atomic transaction: update user password, insert history, prune history, record event
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: newPasswordHash },
        });

        await tx.passwordHistory.create({
          data: {
            userId: user.id,
            passwordHash: newPasswordHash,
          },
        });

        const excess = await tx.passwordHistory.findMany({
          where: { userId: user.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 5,
          select: { id: true },
        });

        if (excess.length > 0) {
          await tx.passwordHistory.deleteMany({
            where: { id: { in: excess.map((e: any) => e.id) } },
          });
        }

        await tx.securityEvent.create({
          data: {
            eventType: SecurityEventType.PASSWORD_RESET_COMPLETE,
            userId: user.id,
            ipAddress: context?.ipAddress,
          },
        });
      });
    } catch (dbError) {
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      this.logger.error(`Database transaction error during password reset for user ${user.id}: ${msg}`);
      throw new InternalServerErrorException('Password reset failed due to a server error.');
    }

    // 8. Revoke all active sessions and access tokens
    try {
      await this.sessionService.revokeAllUserSessions(user.id, 'password_reset');
      await this.tokenService.revokeUserTokens(user.id, 'password_reset');
      await this.tokenService.invalidateAccountState(user.id);
    } catch (sessionError) {
      const msg = sessionError instanceof Error ? sessionError.message : String(sessionError);
      this.logger.error(`Session revocation error during password reset for user ${user.id}: ${msg}`);
      // Best effort/log; password is already successfully reset
    }

    return {
      success: true,
      message: 'Password has been reset successfully. Please sign in with your new password.',
    };
  }

  /**
   * Updates a user's account lifecycle status (ACTIVE, SUSPENDED, DEACTIVATED).
   *
   * Security & Invalidation:
   * 1. Records an audit event (ACCOUNT_SUSPENDED, ACCOUNT_DEACTIVATED, or ACCOUNT_REACTIVATED).
   * 2. Evicts account state caches (L1 memory, L2 Redis).
   * 3. When moving to SUSPENDED or DEACTIVATED, immediately invalidates all active sessions
   *    and revokes all issued access tokens so protected requests cannot continue.
   */
  async updateAccountStatus(
    userId: string,
    newStatus: AccountStatus,
    reason?: string,
    actor?: AuthenticatedPrincipal,
  ): Promise<{ success: boolean; message: string; user: { id: string; accountStatus: AccountStatus } }> {
    if (actor && !actor.roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN')) {
      throw new ForbiddenException('Only administrators can update account status.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, accountStatus: true },
    });

    if (!user) {
      throw new NotFoundException('User account not found.');
    }

    let eventType: SecurityEventType;
    if (newStatus === AccountStatus.SUSPENDED) {
      eventType = SecurityEventType.ACCOUNT_SUSPENDED;
    } else if (newStatus === AccountStatus.DEACTIVATED) {
      eventType = SecurityEventType.ACCOUNT_DEACTIVATED;
    } else {
      eventType = SecurityEventType.ACCOUNT_REACTIVATED;
    }

    try {
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: userId },
          data: { accountStatus: newStatus },
        }),
        this.prisma.securityEvent.create({
          data: {
            eventType,
            userId,
            metadata: {
              previousStatus: user.accountStatus,
              newStatus,
              reason: reason ?? 'status_update',
              performedBy: actor?.id ?? 'system',
            },
          },
        }),
      ]);
    } catch (dbError) {
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      this.logger.error(`Database error updating account status for user ${userId}: ${msg}`);
      throw new InternalServerErrorException('Failed to update account status due to a server error.');
    }

    // Invalidate cached account state immediately
    await this.tokenService.invalidateAccountState(userId);

    // If account was suspended or deactivated, immediately revoke all sessions and bearer tokens
    if (newStatus === AccountStatus.SUSPENDED || newStatus === AccountStatus.DEACTIVATED) {
      try {
        await this.sessionService.revokeAllUserSessions(userId, reason ?? `account_${newStatus.toLowerCase()}`);
        await this.tokenService.revokeUserTokens(userId, reason ?? `account_${newStatus.toLowerCase()}`);
      } catch (revokeErr) {
        const msg = revokeErr instanceof Error ? revokeErr.message : String(revokeErr);
        this.logger.warn(`Failed to revoke sessions/tokens after account status update for user ${userId}: ${msg}`);
      }
    }

    return {
      success: true,
      message: `Account status updated to ${newStatus}.`,
      user: { id: userId, accountStatus: newStatus },
    };
  }

  /**
   * Assigns a role to a user, checking privilege boundaries and invalidating existing tokens.
   */
  async assignRole(
    userId: string,
    roleName: RoleName,
    actor?: AuthenticatedPrincipal,
  ): Promise<{ success: boolean; message: string }> {
    if (!isRoleName(roleName)) {
      throw new BadRequestException('Invalid role name.');
    }

    if (actor && this.rolePrivilegeService) {
      this.rolePrivilegeService.assertCanAssignRole(actor.roles, roleName);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User account not found.');
    }

    const role = await this.prisma.role.findUnique({
      where: { name: roleName },
    });
    if (!role) {
      throw new NotFoundException(`Role ${roleName} not found.`);
    }

    // Check if already assigned
    const existing = await this.prisma.userRole.findUnique({
      where: { uq_user_role: { userId, roleId: role.id } },
    });
    if (existing) {
      return { success: true, message: `Role ${roleName} is already assigned.` };
    }

    try {
      await this.prisma.$transaction([
        this.prisma.userRole.create({
          data: {
            userId,
            roleId: role.id,
            assignedBy: actor?.id ?? null,
          },
        }),
        this.prisma.securityEvent.create({
          data: {
            eventType: SecurityEventType.ROLE_ASSIGNED,
            userId,
            metadata: { role: roleName, assignedBy: actor?.id ?? 'system' },
          },
        }),
      ]);
    } catch (dbError) {
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      this.logger.error(`Database error assigning role ${roleName} to user ${userId}: ${msg}`);
      throw new InternalServerErrorException('Failed to assign role due to a server error.');
    }

    // Invalidate cached account state and revoke previous tokens to enforce token refresh with updated role
    await this.tokenService.invalidateAccountState(userId);
    await this.tokenService.revokeUserTokens(userId, 'role_assigned');

    return {
      success: true,
      message: `Role ${roleName} assigned successfully.`,
    };
  }

  /**
   * Revokes a role from a user, checking privilege boundaries and immediately invalidating
   * all authorization state and active sessions so revoked permissions cannot be used.
   */
  async revokeRole(
    userId: string,
    roleName: RoleName,
    actor?: AuthenticatedPrincipal,
  ): Promise<{ success: boolean; message: string }> {
    if (!isRoleName(roleName)) {
      throw new BadRequestException('Invalid role name.');
    }

    if (actor && this.rolePrivilegeService) {
      this.rolePrivilegeService.assertCanAssignRole(actor.roles, roleName);
    }

    const role = await this.prisma.role.findUnique({
      where: { name: roleName },
    });
    if (!role) {
      throw new NotFoundException(`Role ${roleName} not found.`);
    }

    const existing = await this.prisma.userRole.findUnique({
      where: { uq_user_role: { userId, roleId: role.id } },
    });
    if (!existing) {
      return { success: true, message: `User does not possess role ${roleName}.` };
    }

    try {
      await this.prisma.$transaction([
        this.prisma.userRole.delete({
          where: { uq_user_role: { userId, roleId: role.id } },
        }),
        this.prisma.securityEvent.create({
          data: {
            eventType: SecurityEventType.ROLE_REVOKED,
            userId,
            metadata: { role: roleName, revokedBy: actor?.id ?? 'system' },
          },
        }),
      ]);
    } catch (dbError) {
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      this.logger.error(`Database error revoking role ${roleName} from user ${userId}: ${msg}`);
      throw new InternalServerErrorException('Failed to revoke role due to a server error.');
    }

    // Invalidate cached account state and revoke tokens & sessions immediately
    await this.tokenService.invalidateAccountState(userId);
    await this.tokenService.revokeUserTokens(userId, 'role_revoked');
    await this.sessionService.revokeAllUserSessions(userId, 'role_revoked');

    return {
      success: true,
      message: `Role ${roleName} revoked successfully.`,
    };
  }

  /**
   * Normalizes full name string by collapsing extra whitespace.
   */
  private normalizeFullName(raw?: string): string {
    if (!raw) {
      throw new BadRequestException('Full name is required.');
    }
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    if (trimmed.length < 2 || trimmed.length > 100) {
      throw new BadRequestException('Full name must be between 2 and 100 characters.');
    }
    return trimmed;
  }

  /**
   * Normalizes email address by trimming and lowercasing.
   */
  private normalizeEmail(raw?: string): string {
    if (!raw) {
      throw new BadRequestException('Email address is required.');
    }
    const trimmed = raw.trim().toLowerCase();
    if (trimmed.length === 0 || trimmed.length > 320 || !trimmed.includes('@')) {
      throw new BadRequestException('Invalid email address format.');
    }
    return trimmed;
  }

  /**
   * Validates and normalizes mobile numbers consistently into E.164 format (+<digits>).
   * Rejects malformed numbers (contains non-phone characters or length outside 7..15 digits).
   */
  private normalizeMobileNumber(raw?: string): string | null {
    if (raw === undefined || raw === null) {
      return null;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException('Mobile number cannot be empty if provided.');
    }
    // Only digits, leading +, spaces, hyphens, periods, and parentheses are allowed
    if (/[^0-9+\s\-().]/.test(trimmed)) {
      throw new BadRequestException('Invalid mobile number format. Contains invalid characters.');
    }

    const cleaned = trimmed.replace(/[\s\-().]/g, '');
    if (cleaned.startsWith('+')) {
      const digits = cleaned.slice(1);
      if (!/^\d{7,15}$/.test(digits)) {
        throw new BadRequestException(
          'Invalid mobile number format. Must contain between 7 and 15 digits.',
        );
      }
      return cleaned;
    } else {
      if (!/^\d{7,15}$/.test(cleaned)) {
        throw new BadRequestException(
          'Invalid mobile number format. Must contain between 7 and 15 digits.',
        );
      }
      return `+${cleaned}`;
    }
  }
}
