import { Injectable, Logger } from '@nestjs/common';
import type { PasswordHistory } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { PasswordHashingService } from './password-hashing.service.js';

/**
 * Maximum number of password history entries retained and checked per user.
 */
export const PASSWORD_HISTORY_LIMIT = 5;

/**
 * Custom error thrown when password history operations fail (e.g., database errors).
 * Propagated so callers can fail closed rather than incorrectly assuming
 * a password was not reused.
 */
export class PasswordHistoryError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'PasswordHistoryError';
  }
}

/**
 * Injectable service that manages password history and prevents password reuse.
 *
 * ## Responsibilities:
 * 1. Checks whether a proposed password matches any of the user's most recent 5
 *    stored password hashes using Argon2id constant-time verification.
 * 2. Records newly authorized password hashes into the `PasswordHistory` model.
 * 3. Prunes older entries to enforce the 5-password retention limit.
 *
 * ## Retention Semantics:
 * - At most 5 password hashes are retained per user in `PasswordHistory`.
 * - When a new password is set or changed, `recordPasswordHash` stores the new hash.
 * - Consequently, the newest entry in `PasswordHistory` represents the current active password,
 *   and up to 4 older entries represent previously used passwords (total 5).
 * - Checking the newest 5 entries therefore prevents reusing both the current password
 *   and the 4 most recent predecessor passwords.
 *
 * ## Security Rules:
 * - Plaintext passwords and hash strings are NEVER logged.
 * - Verification is executed sequentially (bounded concurrency = 1) and short-circuits
 *   on the first match to minimize CPU and memory pressure from Argon2.
 * - Database outages or query failures throw `PasswordHistoryError` to ensure callers
 *   fail closed.
 * - Callers must authenticate and authorize the password change, and validate the new password
 *   against `PasswordPolicyService`, before recording history.
 */
@Injectable()
export class PasswordHistoryService {
  private readonly logger = new Logger(PasswordHistoryService.name);
  readonly historyLimit = PASSWORD_HISTORY_LIMIT;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashingService: PasswordHashingService,
  ) {}

  /**
   * Check whether a proposed candidate password matches any of the user's
   * most recent 5 stored password hashes.
   *
   * Hashes are evaluated sequentially using `PasswordHashingService.verify()`.
   * The check short-circuits immediately upon the first match.
   *
   * @param userId - Unique identifier of the user (UUID)
   * @param candidatePassword - Raw plaintext password proposed by the user
   * @returns `true` if the candidate password matches any of the newest 5 hashes; `false` otherwise.
   * @throws `PasswordHistoryError` if database query or unexpected verification failure occurs (fail closed).
   */
  async isPasswordReused(userId: string, candidatePassword: string): Promise<boolean> {
    let recentEntries: Array<{ id: string; passwordHash: string }>;

    try {
      recentEntries = await this.prisma.passwordHistory.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PASSWORD_HISTORY_LIMIT,
        select: { id: true, passwordHash: true },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Database error checking password history: ${msg}`);
      throw new PasswordHistoryError('Database error occurred while checking password history.', error);
    }

    if (!recentEntries || recentEntries.length === 0) {
      return false;
    }

    // Verify candidate password sequentially against stored hashes (bounded concurrency = 1)
    for (const entry of recentEntries) {
      try {
        const matches = await this.hashingService.verify(entry.passwordHash, candidatePassword);
        if (matches) {
          return true;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Verification error checking password history: ${msg}`);
        throw new PasswordHistoryError('Verification error occurred while checking password history.', error);
      }
    }

    return false;
  }

  /**
   * Alias for `isPasswordReused`.
   */
  async isReused(userId: string, candidatePassword: string): Promise<boolean> {
    return this.isPasswordReused(userId, candidatePassword);
  }

  /**
   * Record a new password hash in the user's password history after a password change
   * has been successfully authorized and validated.
   *
   * Stores the newly authorized password hash, then prunes any historical entries
   * beyond the 5 newest for this user.
   *
   * ## Concurrency Limitation:
   * - Operations are grouped in a database transaction to ensure atomic insertion and pruning.
   * - Note: Under default PostgreSQL READ COMMITTED isolation, simultaneous concurrent
   *   password changes for the same user could race without explicit row-level locking
   *   (e.g., `SELECT ... FOR UPDATE` on `User`). Callers should serialize password changes
   *   per user.
   *
   * @param userId - Unique identifier of the user (UUID)
   * @param passwordHash - Argon2id PHC hash string of the new password
   * @returns The created `PasswordHistory` record
   * @throws `PasswordHistoryError` if database operation fails.
   */
  async recordPasswordHash(userId: string, passwordHash: string): Promise<PasswordHistory> {
    try {
      const executeTx = async (tx: any): Promise<PasswordHistory> => {
        // 1. Insert the new password history entry
        const created = await tx.passwordHistory.create({
          data: {
            userId,
            passwordHash,
          },
        });

        // 2. Query excess entries beyond the newest PASSWORD_HISTORY_LIMIT
        const excessEntries = await tx.passwordHistory.findMany({
          where: { userId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: PASSWORD_HISTORY_LIMIT,
          select: { id: true },
        });

        // 3. Prune excess entries
        if (excessEntries.length > 0) {
          const idsToDelete = excessEntries.map((e: { id: string }) => e.id);
          await tx.passwordHistory.deleteMany({
            where: {
              id: { in: idsToDelete },
            },
          });
        }

        return created;
      };

      if (typeof this.prisma.$transaction === 'function') {
        return await this.prisma.$transaction(executeTx);
      }
      return await executeTx(this.prisma);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Database error recording password history: ${msg}`);
      throw new PasswordHistoryError('Database error occurred while recording password history.', error);
    }
  }
}
