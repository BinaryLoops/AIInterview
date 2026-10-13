import type { OtpPurpose, OtpState } from '@prisma/client';

export type { OtpPurpose, OtpState };

export type VerifyOtpStatus =
  | 'SUCCESS'
  | 'INVALID_CODE'
  | 'EXPIRED'
  | 'EXHAUSTED'
  | 'NOT_FOUND'
  | 'ALREADY_CONSUMED';

export interface IssueOtpParams {
  /** Target identifier (e.g. email address). */
  identifier: string;
  /** Schema purpose for the challenge. */
  purpose: OtpPurpose;
  /** Optional associated user ID (UUID) if user already exists. */
  userId?: string;
}

export interface IssueOtpResult {
  /** UUID of the created OtpChallenge. */
  challengeId: string;
  /**
   * Plaintext numeric OTP code.
   *
   * IMPORTANT: This is for internal delivery service use ONLY (e.g. email sender).
   * Controllers must NEVER return this code in API responses or logs.
   */
  code: string;
  /** Expiration timestamp for the challenge. */
  expiresAt: Date;
}

export interface VerifyOtpParams {
  /** Target identifier (e.g. email address). */
  identifier: string;
  /** Schema purpose for the challenge. */
  purpose: OtpPurpose;
  /** 6-digit candidate OTP code. */
  code: string;
  /** Optional explicit challenge ID to verify against. */
  challengeId?: string;
}

export interface VerifyOtpResult {
  /** Whether the challenge was successfully verified and consumed. */
  success: boolean;
  /** Detailed result status. */
  status: VerifyOtpStatus;
  /** Challenge ID if located. */
  challengeId?: string;
  /** Associated user ID if challenge was bound to a user. */
  userId?: string | null;
}

export class OtpServiceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'OtpServiceError';
  }
}
