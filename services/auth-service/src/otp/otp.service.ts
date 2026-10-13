import crypto from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { OtpState } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { AuthConfigService } from '../config/auth-config.service.js';
import {
  type IssueOtpParams,
  type IssueOtpResult,
  type VerifyOtpParams,
  type VerifyOtpResult,
  OtpServiceError,
} from './otp.types.js';

/**
 * Injectable service responsible for issuing, verifying, and atomically consuming
 * numeric email OTP challenges.
 *
 * ## Key Security Guarantees:
 * 1. Cryptographically secure code generation via `crypto.randomInt` (never Math.random).
 * 2. Guaranteed 6-digit numeric format with leading zeros preserved via `padStart(6, '0')`.
 * 3. Protected verifier storage: Raw OTP codes are NEVER stored. Verifiers are computed using
 *    keyed HMAC-SHA256 bound to identifier, purpose, and secret from configuration.
 * 4. Constant-time verifier comparison via `crypto.timingSafeEqual` prevents timing attacks.
 * 5. Atomic single-use consumption: Conditional updates prevent concurrent double consumption.
 * 6. Replacement invalidation: Issuing a replacement challenge invalidates all prior pending
 *    challenges for that identifier and purpose.
 * 7. Rate/Attempt limiting: Exceeded attempts immediately invalidate the challenge.
 * 8. Privacy: Plaintext codes and verifier hashes are never logged or leaked.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: AuthConfigService,
  ) {}

  /**
   * Issue a new 6-digit numeric OTP challenge for the given identifier and purpose.
   *
   * Older pending challenges for the same identifier and purpose are automatically
   * invalidated to ensure only one active challenge exists at any given time.
   *
   * @param params - Target identifier, purpose, and optional associated userId.
   * @returns Generated challenge details, including plaintext code for internal delivery.
   * @throws OtpServiceError on database failure (fails closed).
   */
  async issueOtp(params: IssueOtpParams): Promise<IssueOtpResult> {
    const normalizedIdentifier = this.normalizeIdentifier(params.identifier);
    const code = this.generateNumericCode();
    const verifierHash = this.computeVerifier(code, normalizedIdentifier, params.purpose);

    const ttlSeconds = this.configService.snapshot.otp.ttlSeconds;
    const maxAttempts = this.configService.snapshot.otp.maxAttempts;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    try {
      const challenge = await this.runInTransaction(async (tx) => {
        // Invalidate any older pending challenges for this identifier & purpose
        await tx.otpChallenge.updateMany({
          where: {
            identifier: normalizedIdentifier,
            purpose: params.purpose,
            state: OtpState.PENDING,
          },
          data: {
            state: OtpState.INVALIDATED,
          },
        });

        // Create the new OTP challenge record
        return await tx.otpChallenge.create({
          data: {
            identifier: normalizedIdentifier,
            purpose: params.purpose,
            userId: params.userId,
            verifierHash,
            expiresAt,
            maxAttempts,
            attemptCount: 0,
            state: OtpState.PENDING,
          },
        });
      });

      return {
        challengeId: challenge.id,
        code,
        expiresAt,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Database error issuing OTP challenge: ${msg}`);
      throw new OtpServiceError('Failed to issue OTP challenge due to database error.', error);
    }
  }

  /**
   * Verify and atomically consume a candidate OTP code for the given identifier and purpose.
   *
   * If the candidate code is valid, the challenge transitions from `PENDING` to `CONSUMED`
   * atomically in a single conditional update. If the code is invalid, `attemptCount` is
   * incremented and, if `maxAttempts` is reached, the challenge state transitions to `INVALIDATED`.
   *
   * @param params - Verification candidate inputs.
   * @returns Structured verification result.
   * @throws OtpServiceError on database failure (fails closed).
   */
  async verifyAndConsumeOtp(params: VerifyOtpParams): Promise<VerifyOtpResult> {
    const normalizedIdentifier = this.normalizeIdentifier(params.identifier);
    const now = new Date();

    try {
      return await this.runInTransaction(async (tx) => {
        // 1. Locate the challenge
        const challenge = params.challengeId
          ? await tx.otpChallenge.findFirst({
              where: {
                id: params.challengeId,
                identifier: normalizedIdentifier,
                purpose: params.purpose,
              },
            })
          : await tx.otpChallenge.findFirst({
              where: {
                identifier: normalizedIdentifier,
                purpose: params.purpose,
                state: OtpState.PENDING,
              },
              orderBy: { createdAt: 'desc' },
            });

        if (!challenge) {
          return {
            success: false,
            status: 'NOT_FOUND',
          };
        }

        // 2. Reject already consumed challenge
        if (challenge.state === OtpState.CONSUMED) {
          return {
            success: false,
            status: 'ALREADY_CONSUMED',
            challengeId: challenge.id,
            userId: challenge.userId,
          };
        }

        // 3. Reject invalidated or exhausted challenge
        if (
          challenge.state === OtpState.INVALIDATED ||
          challenge.attemptCount >= challenge.maxAttempts
        ) {
          if (challenge.state === OtpState.PENDING) {
            await tx.otpChallenge.update({
              where: { id: challenge.id },
              data: { state: OtpState.INVALIDATED },
            });
          }
          return {
            success: false,
            status: 'EXHAUSTED',
            challengeId: challenge.id,
            userId: challenge.userId,
          };
        }

        // 4. Reject expired challenge
        if (challenge.state === OtpState.EXPIRED || challenge.expiresAt <= now) {
          if (challenge.state === OtpState.PENDING) {
            await tx.otpChallenge.update({
              where: { id: challenge.id },
              data: { state: OtpState.EXPIRED },
            });
          }
          return {
            success: false,
            status: 'EXPIRED',
            challengeId: challenge.id,
            userId: challenge.userId,
          };
        }

        // 5. Must be strictly PENDING
        if (challenge.state !== OtpState.PENDING) {
          return {
            success: false,
            status: 'NOT_FOUND',
            challengeId: challenge.id,
            userId: challenge.userId,
          };
        }

        // 6. Verify candidate code against stored verifier using constant-time comparison
        const candidateVerifier = this.computeVerifier(
          params.code,
          normalizedIdentifier,
          params.purpose,
        );
        const matches = this.safeCompare(candidateVerifier, challenge.verifierHash);

        if (matches) {
          // ATOMIC CONDITIONAL UPDATE:
          // Must match id, state PENDING, unexpired, attempts < maxAttempts.
          // In concurrent execution, exactly one transaction will see count === 1.
          const updateResult = await tx.otpChallenge.updateMany({
            where: {
              id: challenge.id,
              state: OtpState.PENDING,
              expiresAt: { gt: now },
              attemptCount: { lt: challenge.maxAttempts },
            },
            data: {
              state: OtpState.CONSUMED,
              attemptCount: { increment: 1 },
            },
          });

          if (updateResult.count !== 1) {
            // Raced with a concurrent request that already consumed the challenge
            return {
              success: false,
              status: 'ALREADY_CONSUMED',
              challengeId: challenge.id,
              userId: challenge.userId,
            };
          }

          return {
            success: true,
            status: 'SUCCESS',
            challengeId: challenge.id,
            userId: challenge.userId,
          };
        }

        // 7. Code mismatch -> increment attempt count atomically
        const nextAttemptCount = challenge.attemptCount + 1;
        const nextState =
          nextAttemptCount >= challenge.maxAttempts
            ? OtpState.INVALIDATED
            : OtpState.PENDING;

        await tx.otpChallenge.updateMany({
          where: {
            id: challenge.id,
            state: OtpState.PENDING,
          },
          data: {
            attemptCount: { increment: 1 },
            state: nextState,
          },
        });

        return {
          success: false,
          status: nextState === OtpState.INVALIDATED ? 'EXHAUSTED' : 'INVALID_CODE',
          challengeId: challenge.id,
          userId: challenge.userId,
        };
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Database error verifying OTP challenge: ${msg}`);
      throw new OtpServiceError('Failed to verify OTP challenge due to database error.', error);
    }
  }

  /**
   * Generate a 6-digit cryptographically secure numeric OTP string.
   * Leading zeroes are strictly preserved (e.g. "004812").
   */
  generateNumericCode(): string {
    const value = crypto.randomInt(0, 1_000_000);
    return value.toString().padStart(6, '0');
  }

  /**
   * Compute a keyed HMAC-SHA256 verifier bound to the identifier and purpose.
   */
  computeVerifier(code: string, identifier: string, purpose: string): string {
    const secret = this.configService.snapshot.otp.hmacSecret;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(`${identifier}:${purpose}:${code}`);
    return hmac.digest('hex');
  }

  /**
   * Normalize an identifier (email address) consistently without altering codes.
   */
  normalizeIdentifier(identifier: string): string {
    return identifier.trim().toLowerCase();
  }

  /**
   * Constant-time comparison between two hex verifier strings.
   */
  safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  }

  /**
   * Helper to execute queries inside a Prisma transaction, with fallback for mocks.
   */
  private async runInTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    if (typeof this.prisma.$transaction === 'function') {
      return await this.prisma.$transaction(fn);
    }
    return await fn(this.prisma);
  }
}
