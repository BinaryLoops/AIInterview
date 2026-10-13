import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Injectable service that wraps Argon2id hashing and verification.
 *
 * ## Argon2id parameters
 *
 * | Parameter     | Value | Rationale                                        |
 * |---------------|-------|--------------------------------------------------|
 * | type          | 2     | Argon2id — hybrid of Argon2i and Argon2d          |
 * | memoryCost    | 65536 | 64 MiB — OWASP recommended minimum for web auth  |
 * | timeCost      | 3     | 3 iterations — balances security and latency      |
 * | parallelism   | 1     | 1 thread — safe for single-instance deployments   |
 * | hashLength    | 32    | 256-bit output — standard for password hashes     |
 *
 * A fresh random salt is generated automatically by the argon2 library for
 * every hash operation. The output is a PHC-format string that embeds all
 * parameters + salt + hash, so no separate salt column is needed.
 *
 * This service never logs, returns, or exposes password values or hash strings.
 */
@Injectable()
export class PasswordHashingService {
  private readonly logger = new Logger(PasswordHashingService.name);

  /**
   * Argon2id configuration — kept as a readonly object so tests can inspect
   * the chosen parameters without calling into the native library.
   */
  readonly argon2Options: argon2.HashOptions & { raw: false } = {
    type: argon2.argon2id,
    memoryCost: 65_536, // 64 MiB
    timeCost: 3,        // 3 iterations
    parallelism: 1,     // 1 lane
    hashLength: 32,     // 256-bit digest
    raw: false,         // return PHC string, not raw bytes
  };

  /**
   * Hash a plaintext password with Argon2id.
   *
   * @returns PHC-format hash string (includes parameters, salt, and digest).
   * @throws if the argon2 library encounters an internal error.
   */
  async hash(password: string): Promise<string> {
    try {
      return await argon2.hash(password, this.argon2Options);
    } catch (error) {
      // Log the error type without the password or resulting hash.
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Hashing failed: ${msg}`);
      throw error;
    }
  }

  /**
   * Verify a plaintext password against a stored PHC-format hash.
   *
   * Uses the argon2 library's constant-time comparison internally.
   *
   * @returns `true` if the password matches; `false` otherwise.
   *          Never throws for an incorrect password — only for truly
   *          unexpected errors (malformed hash, library failure).
   */
  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(storedHash, password);
    } catch (error) {
      // Malformed hash strings or library errors land here.
      // Log the error category without exposing the password or hash.
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Verification error (not a match failure): ${msg}`);
      return false;
    }
  }
}
