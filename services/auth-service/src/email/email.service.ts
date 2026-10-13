import crypto from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { AuthConfigService } from '../config/auth-config.service.js';
import {
  type SendOtpEmailParams,
  type SendOtpEmailResult,
  EmailDeliveryError,
  maskEmail,
} from './email.types.js';
import { buildOtpEmailContent } from './email-templates.js';

export const MAIL_TRANSPORTER = 'MAIL_TRANSPORTER';

/**
 * Injectable service responsible for sending templated OTP emails via SMTP.
 *
 * ## Security Guarantees:
 * 1. Never logs OTP codes, email bodies, credentials, or raw socket/transport responses.
 * 2. Only logs masked recipient emails (e.g. `u***r@example.com`) alongside a correlation ID.
 * 3. Sanitizes all transport errors into safe `EmailDeliveryError` exceptions.
 * 4. Applies finite TCP connection, greeting, and socket timeouts from configuration.
 * 5. Rejects unsupported purposes (such as `MOBILE_VERIFICATION`).
 * 6. Escapes all template HTML to eliminate injection risks.
 *
 * Note: Delivery success signifies SMTP server acceptance (e.g. 250 OK); it does not guarantee
 * that the recipient's inbox delivered or the user opened the message.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter | null;

  constructor(
    private readonly configService: AuthConfigService,
    @Optional() @Inject(MAIL_TRANSPORTER) customTransporter?: nodemailer.Transporter,
  ) {
    if (customTransporter) {
      this.transporter = customTransporter;
    } else if (this.configService.snapshot.smtp.enabled) {
      const smtp = this.configService.snapshot.smtp;
      const timeoutMs = smtp.timeoutMs || 5000;

      this.transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth:
          smtp.authRequired && smtp.username && smtp.password
            ? {
                user: smtp.username,
                pass: smtp.password,
              }
            : undefined,
        connectionTimeout: timeoutMs,
        greetingTimeout: timeoutMs,
        socketTimeout: timeoutMs * 2,
      });
    } else {
      this.transporter = null;
    }
  }

  /**
   * Check whether email delivery is enabled in the current environment.
   */
  get isEnabled(): boolean {
    return this.configService.snapshot.smtp.enabled;
  }

  /**
   * Deliver an OTP email to the specified recipient for an approved purpose.
   *
   * @param params - Email parameters including recipient, purpose, code, and optional TTL.
   * @returns Structured delivery outcome containing messageId and correlationId.
   * @throws EmailDeliveryError if disabled, purpose unsupported, or delivery fails.
   */
  async sendOtpEmail(params: SendOtpEmailParams): Promise<SendOtpEmailResult> {
    const correlationId = params.correlationId ?? crypto.randomUUID();
    const maskedRecipient = maskEmail(params.recipientEmail);

    if (!this.configService.snapshot.smtp.enabled || !this.transporter) {
      this.logger.warn(
        `Email delivery skipped for ${maskedRecipient} [correlation: ${correlationId}]: SMTP disabled in configuration`,
      );
      throw new EmailDeliveryError('Email delivery service is disabled in configuration.');
    }

    // Validate recipient email syntax at high level
    const normalizedRecipient = params.recipientEmail.trim();
    if (!normalizedRecipient.includes('@') || normalizedRecipient.length > 320) {
      throw new EmailDeliveryError('Invalid recipient email address format.');
    }

    // Build purpose-appropriate content (throws EmailDeliveryError on unsupported purpose)
    const content = buildOtpEmailContent(
      params.purpose,
      params.otpCode,
      params.ttlSeconds ?? this.configService.snapshot.otp.ttlSeconds,
    );

    const fromAddress = this.configService.snapshot.smtp.from;

    try {
      const info = await this.transporter.sendMail({
        from: fromAddress,
        to: normalizedRecipient,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });

      // Minimal safe operational logging - NEVER logs OTP or body
      this.logger.log(
        `OTP email sent to ${maskedRecipient} [correlation: ${correlationId}]`,
      );

      return {
        success: true,
        messageId: info.messageId,
        correlationId,
      };
    } catch (error) {
      const isTimeout =
        error instanceof Error &&
        (error.message.toLowerCase().includes('timeout') ||
          (error as any).code === 'ETIMEDOUT' ||
          (error as any).code === 'ESOCKETTIMEDOUT');

      // Minimal safe error log - NEVER leaks credentials or raw response
      this.logger.error(
        `Failed to deliver email to ${maskedRecipient} [correlation: ${correlationId}]: ${
          isTimeout ? 'connection timeout' : 'transport error'
        }`,
      );

      const safeMessage = isTimeout
        ? 'Email delivery failed due to a connection timeout.'
        : 'Email delivery failed due to an SMTP transport error.';

      throw new EmailDeliveryError(safeMessage, error);
    }
  }
}
