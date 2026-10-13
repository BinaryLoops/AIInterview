import {
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { SecurityEventType } from '@prisma/client';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { AuthConfigService } from '../config/auth-config.service.js';
import { TokenService } from '../token/token.service.js';
import type {
  CreateSessionParams,
  IssuedSession,
  ParsedRefreshToken,
  RevokeSessionResult,
  RotatedSession,
} from './session.types.js';

/**
 * UUID v4 validation regex for unpredictable session identifiers.
 */
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * SessionService manages the lifecycle of authentication sessions in accordance with
 * the AuthSession Prisma model:
 *
 * 1. Issuance: Generates cryptographically secure refresh tokens (`<sessionId>.<secret>`)
 *    and persists ONLY the SHA-256 hash of the secret in `AuthSession.refreshTokenHash`.
 * 2. Rotation: Enforces single-use refresh tokens. On every valid refresh, the current
 *    session is marked revoked (`revokedAt = now()`) and a fresh session row with a new
 *    secret is issued.
 * 3. Replay Protection: If an already-revoked session token is presented for refresh,
 *    token reuse is detected immediately. All active sessions for the user are revoked
 *    as a defensive compromise containment policy, and an audit event is logged.
 * 4. Concurrency Protection: Uses atomic compare-and-swap (CAS) database updates within
 *    a transaction to ensure that concurrent refresh requests cannot both succeed.
 * 5. Logout & Revocation: Idempotent and atomic session invalidation.
 * 6. Audit & Confidentiality: Raw tokens and hashes are NEVER written to logs or audit
 *    event metadata.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: AuthConfigService,
    @Optional() private readonly tokenService?: TokenService,
  ) {}


  /**
   * Hashes a high-entropy secret using SHA-256.
   * Never store raw token secrets in the database.
   */
  hashToken(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  /**
   * Generates a 256-bit cryptographically secure random secret string.
   */
  private generateSecret(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Formats an opaque compound refresh token: `<sessionId>.<secret>`.
   */
  private formatRefreshToken(sessionId: string, secret: string): string {
    return `${sessionId}.${secret}`;
  }

  /**
   * Parses and validates the compound refresh token format.
   * Throws UnauthorizedException if malformed without leaking internal structures.
   */
  parseRefreshToken(rawToken: string): ParsedRefreshToken {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const dotIndex = rawToken.indexOf('.');
    if (dotIndex === -1) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const sessionId = rawToken.slice(0, dotIndex);
    const secret = rawToken.slice(dotIndex + 1);

    if (!UUID_V4_REGEX.test(sessionId) || secret.length < 32) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    return { sessionId, secret };
  }

  /**
   * Safely compares an incoming token secret against a stored SHA-256 hash
   * in constant time to prevent timing attacks.
   */
  private verifySecretHash(secret: string, storedHash: string): boolean {
    const computedHash = this.hashToken(secret);
    const computedBuf = Buffer.from(computedHash, 'utf8');
    const storedBuf = Buffer.from(storedHash, 'utf8');

    if (computedBuf.length !== storedBuf.length) {
      return false;
    }

    return timingSafeEqual(computedBuf, storedBuf);
  }

  /**
   * Computes the explicit expiration timestamp for a new session based on
   * validated configuration.
   */
  private computeExpiresAt(): Date {
    const ttlDays = this.configService.session.refreshTokenTtlDays;
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
    return new Date(Date.now() + ttlMs);
  }

  /**
   * Issues a brand-new session for a user.
   *
   * Must ONLY be invoked by trusted server-side authentication flows (e.g. after
   * successful verification of a login OTP). Never trusts client-supplied flags.
   */
  async createSession(params: CreateSessionParams): Promise<IssuedSession> {
    const sessionId = randomUUID();
    const secret = this.generateSecret();
    const refreshTokenHash = this.hashToken(secret);
    const expiresAt = this.computeExpiresAt();

    try {
      await this.prisma.authSession.create({
        data: {
          id: sessionId,
          userId: params.userId,
          refreshTokenHash,
          expiresAt,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        },
      });
    } catch (dbError) {
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      this.logger.error(`Database error creating auth session: ${msg}`);
      throw new InternalServerErrorException('Failed to create session due to a server error.');
    }

    const rawRefreshToken = this.formatRefreshToken(sessionId, secret);

    return {
      sessionId,
      rawRefreshToken,
      expiresAt,
      userId: params.userId,
    };
  }

  /**
   * Rotates a valid refresh token and invalidates the previous session.
   *
   * Security & Anti-Replay Policies:
   * 1. If the presented token references an already-revoked session, token reuse
   *    is detected. All active sessions for the user are immediately revoked
   *    to contain potential compromise.
   * 2. If the session has expired, it is rejected.
   * 3. An atomic transaction verifies and updates `revokedAt = now()` with a
   *    compare-and-swap check (`count === 1`), ensuring concurrent refresh
   *    attempts cannot both succeed.
   * 4. A new session row is created with a new random secret and returned.
   */
  async rotateSession(
    rawRefreshToken: string,
    context?: { ipAddress?: string; userAgent?: string },
  ): Promise<RotatedSession> {
    const { sessionId, secret } = this.parseRefreshToken(rawRefreshToken);

    // 1. Look up existing session record
    let session: {
      id: string;
      userId: string;
      refreshTokenHash: string;
      expiresAt: Date;
      revokedAt: Date | null;
      ipAddress: string | null;
      userAgent: string | null;
    } | null;

    try {
      session = await this.prisma.authSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          userId: true,
          refreshTokenHash: true,
          expiresAt: true,
          revokedAt: true,
          ipAddress: true,
          userAgent: true,
        },
      });
    } catch (dbError) {
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      this.logger.error(`Database error looking up auth session for refresh: ${msg}`);
      throw new InternalServerErrorException('Failed to refresh session due to a server error.');
    }

    if (!session) {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    // 2. Replay Protection: detect reuse of an already revoked token
    if (session.revokedAt !== null) {
      const isMatchingSecret = this.verifySecretHash(secret, session.refreshTokenHash);
      if (isMatchingSecret) {
        // Confirmed replay attack: an authentic, previously rotated/revoked token was presented!
        this.logger.warn(
          `Refresh token reuse detected for session ${sessionId}. Revoking all active sessions for user ${session.userId}.`,
        );

        try {
          await this.prisma.authSession.updateMany({
            where: {
              userId: session.userId,
              revokedAt: null,
            },
            data: {
              revokedAt: new Date(),
            },
          });
        } catch (revokeError) {
          const msg = revokeError instanceof Error ? revokeError.message : String(revokeError);
          this.logger.error(`Error applying compromise revocation for user ${session.userId}: ${msg}`);
        }

        try {
          await this.prisma.securityEvent.create({
            data: {
              eventType: SecurityEventType.SESSION_REVOKED,
              userId: session.userId,
              sessionId: session.id,
              ipAddress: context?.ipAddress,
              metadata: {
                reason: 'token_reuse_detected',
              },
            },
          });
        } catch (eventError) {
          const msg = eventError instanceof Error ? eventError.message : String(eventError);
          this.logger.warn(`Failed to record replay detection security event for user ${session.userId}: ${msg}`);
        }

        if (this.tokenService) {
          try {
            await this.tokenService.revokeUserTokens(session.userId, 'token_reuse_detected');
          } catch (tokenErr) {
            const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
            this.logger.warn(`Failed to revoke user tokens on replay detection: ${msg}`);
          }
        }

        throw new UnauthorizedException(
          'Token reuse detected. All sessions for this account have been revoked.',
        );
      }

      // If secret didn't even match the revoked session, reject generically
      throw new UnauthorizedException('Invalid or expired session.');
    }

    // 3. Expiration check
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Session has expired. Please sign in again.');
    }

    // 4. Constant-time secret hash verification
    const isSecretValid = this.verifySecretHash(secret, session.refreshTokenHash);
    if (!isSecretValid) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    // 5. Generate new session credentials
    const newSessionId = randomUUID();
    const newSecret = this.generateSecret();
    const newRefreshTokenHash = this.hashToken(newSecret);
    const newExpiresAt = this.computeExpiresAt();
    const now = new Date();

    // 6. Atomic CAS rotation in a transaction to prevent concurrent race conditions
    try {
      await this.prisma.$transaction(async (tx) => {
        const updateResult = await tx.authSession.updateMany({
          where: {
            id: session.id,
            revokedAt: null,
            refreshTokenHash: session.refreshTokenHash,
          },
          data: {
            revokedAt: now,
          },
        });

        if (updateResult.count === 0) {
          // A concurrent refresh attempt won the race and rotated or revoked this session
          throw new UnauthorizedException(
            'Concurrent refresh attempt detected. Token is no longer valid.',
          );
        }

        await tx.authSession.create({
          data: {
            id: newSessionId,
            userId: session.userId,
            refreshTokenHash: newRefreshTokenHash,
            expiresAt: newExpiresAt,
            ipAddress: context?.ipAddress ?? session.ipAddress,
            userAgent: context?.userAgent ?? session.userAgent,
          },
        });
      });
    } catch (txError) {
      if (txError instanceof UnauthorizedException) {
        throw txError;
      }
      const msg = txError instanceof Error ? txError.message : String(txError);
      this.logger.error(`Transaction failed during session rotation: ${msg}`);
      throw new InternalServerErrorException('Failed to rotate session due to a server error.');
    }

    const newRawRefreshToken = this.formatRefreshToken(newSessionId, newSecret);

    return {
      sessionId: newSessionId,
      rawRefreshToken: newRawRefreshToken,
      expiresAt: newExpiresAt,
      userId: session.userId,
    };
  }

  /**
   * Revokes an existing session (logout).
   *
   * Idempotent: repeated logout requests for an already revoked or nonexistent
   * session succeed safely without error.
   */
  async revokeSession(
    rawRefreshToken: string,
    ipAddress?: string,
  ): Promise<RevokeSessionResult> {
    const { sessionId, secret } = this.parseRefreshToken(rawRefreshToken);

    let session: {
      id: string;
      userId: string;
      refreshTokenHash: string;
      revokedAt: Date | null;
    } | null;

    try {
      session = await this.prisma.authSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          userId: true,
          refreshTokenHash: true,
          revokedAt: true,
        },
      });
    } catch (dbError) {
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      this.logger.error(`Database error during session lookup for logout: ${msg}`);
      throw new InternalServerErrorException('Failed to logout due to a server error.');
    }

    if (!session) {
      // Idempotent: session doesn't exist, treat as successfully logged out
      return { success: true, message: 'Session logged out.' };
    }

    if (session.revokedAt !== null) {
      // Idempotent: already revoked, treat as successfully logged out
      return { success: true, message: 'Session already logged out.' };
    }

    // Verify token secret before revoking to prevent arbitrary session termination
    const isSecretValid = this.verifySecretHash(secret, session.refreshTokenHash);
    if (!isSecretValid) {
      throw new UnauthorizedException('Invalid session credentials.');
    }

    const now = new Date();

    try {
      await this.prisma.authSession.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });
    } catch (dbError) {
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      this.logger.error(`Database error revoking session: ${msg}`);
      throw new InternalServerErrorException('Failed to logout due to a server error.');
    }

    try {
      await this.prisma.securityEvent.create({
        data: {
          eventType: SecurityEventType.LOGOUT,
          userId: session.userId,
          sessionId: session.id,
          ipAddress,
        },
      });
    } catch (eventError) {
      const msg = eventError instanceof Error ? eventError.message : String(eventError);
      this.logger.warn(`Failed to record LOGOUT security event for session ${session.id}: ${msg}`);
    }

    if (this.tokenService) {
      try {
        await this.tokenService.revokeSessionToken(session.id, 'logout');
      } catch (tokenErr) {
        const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
        this.logger.warn(`Failed to revoke session token on logout: ${msg}`);
      }
    }

    return { success: true, message: 'Logged out successfully.' };
  }

  /**
   * Revokes all active sessions for a user (e.g. for security reset or password change).
   */
  async revokeAllUserSessions(userId: string, reason = 'user_requested'): Promise<number> {
    try {
      const result = await this.prisma.authSession.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });

      if (this.tokenService) {
        try {
          await this.tokenService.revokeUserTokens(userId, reason);
        } catch (tokenErr) {
          const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
          this.logger.warn(`Failed to revoke user tokens in revokeAllUserSessions: ${msg}`);
        }
      }

      if (result.count > 0) {
        try {
          await this.prisma.securityEvent.create({
            data: {
              eventType: SecurityEventType.SESSION_REVOKED,
              userId,
              metadata: { reason, count: result.count },
            },
          });
        } catch (eventError) {
          const msg = eventError instanceof Error ? eventError.message : String(eventError);
          this.logger.warn(`Failed to record SESSION_REVOKED audit event: ${msg}`);
        }
      }

      return result.count;
    } catch (dbError) {
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      this.logger.error(`Database error revoking all sessions for user ${userId}: ${msg}`);
      throw new InternalServerErrorException('Failed to revoke sessions due to a server error.');
    }
  }
}
