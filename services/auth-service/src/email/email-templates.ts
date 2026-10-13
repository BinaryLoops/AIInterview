import { OtpPurpose } from '@prisma/client';
import { EmailDeliveryError, escapeHtml } from './email.types.js';

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

interface PurposeCopy {
  subject: string;
  actionText: string;
  securityNotice: string;
}

const PURPOSE_COPY_MAP: Record<
  Exclude<OtpPurpose, 'MOBILE_VERIFICATION'>,
  PurposeCopy
> = {
  [OtpPurpose.EMAIL_VERIFICATION]: {
    subject: 'Verify your email address - AREP',
    actionText:
      'Please use the verification code below to verify your email address for your AI Recruitment Preparation Ecosystem account.',
    securityNotice:
      'If you did not create an account or request this verification, please ignore this email.',
  },
  [OtpPurpose.LOGIN]: {
    subject: 'Your login verification code - AREP',
    actionText:
      'Please use the verification code below to complete your sign-in to your AI Recruitment Preparation Ecosystem account.',
    securityNotice:
      'If you did not attempt to sign in, someone else may be attempting to access your account. Please secure your account immediately.',
  },
  [OtpPurpose.PASSWORD_RESET]: {
    subject: 'Password reset verification code - AREP',
    actionText:
      'Please use the verification code below to reset the password for your AI Recruitment Preparation Ecosystem account.',
    securityNotice:
      'If you did not request a password reset, you can safely ignore this email. Your password will not change without this code.',
  },
};

/**
 * Build accessible plain-text and safe HTML email content for an approved OTP purpose.
 *
 * @throws EmailDeliveryError if the purpose is MOBILE_VERIFICATION or unsupported.
 */
export function buildOtpEmailContent(
  purpose: OtpPurpose,
  otpCode: string,
  ttlSeconds = 600,
): EmailContent {
  if (purpose === OtpPurpose.MOBILE_VERIFICATION) {
    throw new EmailDeliveryError(
      'MOBILE_VERIFICATION is not supported for email delivery. Use SMS transport instead.',
    );
  }

  const copy = PURPOSE_COPY_MAP[purpose as keyof typeof PURPOSE_COPY_MAP];
  if (!copy) {
    throw new EmailDeliveryError(
      `Unsupported OTP purpose for email delivery: ${String(purpose)}`,
    );
  }

  const sanitizedCode = escapeHtml(otpCode.trim());
  const expiryMinutes = Math.max(1, Math.ceil(ttlSeconds / 60));

  const text = [
    'AI Recruitment Preparation Ecosystem (AREP)',
    '-------------------------------------------',
    '',
    copy.actionText,
    '',
    `Verification Code: ${otpCode}`,
    '',
    `This code will expire in ${expiryMinutes} minute${expiryMinutes === 1 ? '' : 's'}.`,
    '',
    copy.securityNotice,
    '',
    'Do not share this code with anyone.',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(copy.subject)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #1f2937; margin: 0; padding: 24px; background-color: #f9fafb;">
  <div style="max-width: 560px; margin: 0 auto; padding: 32px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px;">
    <h2 style="margin-top: 0; color: #111827; font-size: 20px;">AI Recruitment Preparation Ecosystem</h2>
    <p style="margin: 16px 0; color: #374151; font-size: 15px;">${escapeHtml(copy.actionText)}</p>
    <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; text-align: center; margin: 24px 0;">
      <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #111827; font-family: monospace;">${sanitizedCode}</span>
    </div>
    <p style="margin: 16px 0; color: #6b7280; font-size: 14px;">This code will expire in ${expiryMinutes} minute${expiryMinutes === 1 ? '' : 's'}.</p>
    <p style="margin: 16px 0 0 0; color: #6b7280; font-size: 13px;">${escapeHtml(copy.securityNotice)}</p>
  </div>
</body>
</html>`;

  return {
    subject: copy.subject,
    text,
    html,
  };
}
