import { OtpPurpose } from '@prisma/client';

export interface SendOtpEmailParams {
  /** Recipient email address. */
  recipientEmail: string;
  /** Schema purpose for the OTP. */
  purpose: OtpPurpose;
  /** 6-digit numeric OTP code. */
  otpCode: string;
  /** Optional TTL duration in seconds for display in email copy (defaults to 600). */
  ttlSeconds?: number;
  /** Optional non-sensitive correlation ID for tracing. */
  correlationId?: string;
}

export interface SendOtpEmailResult {
  /** Whether the SMTP transport accepted the message. */
  success: boolean;
  /** Message ID assigned by SMTP server or library. */
  messageId?: string;
  /** Correlation ID for tracing. */
  correlationId: string;
}

/**
 * Sanitized exception thrown on email delivery failure.
 * Never includes passwords, SMTP credentials, email bodies, or raw socket details.
 */
export class EmailDeliveryError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

/**
 * Carefully masks an email address for safe operational logging.
 * Example: "john.doe@example.com" -> "j***e@example.com"
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) {
    return '***';
  }
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (!domain) {
    return '***';
  }

  const maskedLocal =
    local.length <= 2
      ? `${local[0]}***`
      : `${local[0]}***${local[local.length - 1]}`;

  return `${maskedLocal}@${domain}`;
}

/**
 * Safely escapes HTML special characters to prevent HTML injection.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
