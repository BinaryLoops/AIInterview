import { Test } from '@nestjs/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { OtpPurpose } from '@prisma/client';
import { AuthConfigService } from '../config/auth-config.service.js';
import { EmailService, MAIL_TRANSPORTER } from './email.service.js';
import { EmailDeliveryError, maskEmail } from './email.types.js';

describe('EmailService', () => {
  let service: EmailService;
  let mockTransporter: {
    sendMail: ReturnType<typeof vi.fn>;
  };
  let mockConfigService: any;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  const testRecipient = 'candidate.user@example.com';
  const testOtp = '839201';

  beforeEach(() => {
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    mockTransporter = {
      sendMail: vi.fn(),
    };

    mockConfigService = {
      snapshot: {
        smtp: {
          enabled: true,
          authRequired: true,
          host: '127.0.0.1',
          port: 1025,
          secure: false,
          username: 'testuser',
          password: 'super-secret-password-123',
          from: 'AREP <noreply@arep.local>',
          timeoutMs: 5000,
        },
        otp: {
          ttlSeconds: 600,
          maxAttempts: 5,
        },
      },
    };
  });

  const createService = async (
    config = mockConfigService,
    transporter = mockTransporter,
  ): Promise<EmailService> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: AuthConfigService, useValue: config },
        { provide: MAIL_TRANSPORTER, useValue: transporter },
      ],
    }).compile();

    return moduleRef.get(EmailService);
  };

  describe('maskEmail helper', () => {
    it('masks local parts of email addresses cleanly', () => {
      expect(maskEmail('candidate@example.com')).toBe('c***e@example.com');
      expect(maskEmail('ab@domain.com')).toBe('a***@domain.com');
      expect(maskEmail('a@domain.com')).toBe('a***@domain.com');
      expect(maskEmail('notanemail')).toBe('***');
    });
  });

  describe('configuration handling', () => {
    it('throws EmailDeliveryError when SMTP is disabled in config', async () => {
      mockConfigService.snapshot.smtp.enabled = false;
      service = await createService(mockConfigService, null as any);

      await expect(
        service.sendOtpEmail({
          recipientEmail: testRecipient,
          purpose: OtpPurpose.EMAIL_VERIFICATION,
          otpCode: testOtp,
        }),
      ).rejects.toThrow(EmailDeliveryError);

      await expect(
        service.sendOtpEmail({
          recipientEmail: testRecipient,
          purpose: OtpPurpose.EMAIL_VERIFICATION,
          otpCode: testOtp,
        }),
      ).rejects.toThrow(/disabled in configuration/);
    });

    it('rejects malformed recipient email addresses', async () => {
      service = await createService();

      await expect(
        service.sendOtpEmail({
          recipientEmail: 'not-an-email',
          purpose: OtpPurpose.EMAIL_VERIFICATION,
          otpCode: testOtp,
        }),
      ).rejects.toThrow(EmailDeliveryError);
    });
  });

  describe('purpose-specific templates', () => {
    beforeEach(async () => {
      service = await createService();
      mockTransporter.sendMail.mockResolvedValue({ messageId: 'msg-001' });
    });

    it('delivers EMAIL_VERIFICATION with appropriate wording and OTP code', async () => {
      const result = await service.sendOtpEmail({
        recipientEmail: testRecipient,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        otpCode: testOtp,
        ttlSeconds: 600,
      });

      expect(result.success).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: testRecipient,
          from: 'AREP <noreply@arep.local>',
          subject: expect.stringContaining('Verify your email address'),
          text: expect.stringContaining(testOtp),
          html: expect.stringContaining(testOtp),
        }),
      );

      const callArgs = mockTransporter.sendMail.mock.calls[0]![0];
      expect(callArgs.text).toContain('10 minutes');
    });

    it('delivers LOGIN with login-specific security notice and OTP', async () => {
      const result = await service.sendOtpEmail({
        recipientEmail: testRecipient,
        purpose: OtpPurpose.LOGIN,
        otpCode: testOtp,
        ttlSeconds: 300,
      });

      expect(result.success).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('login verification code'),
          text: expect.stringContaining('sign-in'),
          html: expect.stringContaining(testOtp),
        }),
      );

      const callArgs = mockTransporter.sendMail.mock.calls[0]![0];
      expect(callArgs.text).toContain('5 minutes');
    });

    it('delivers PASSWORD_RESET with password-specific wording', async () => {
      const result = await service.sendOtpEmail({
        recipientEmail: testRecipient,
        purpose: OtpPurpose.PASSWORD_RESET,
        otpCode: testOtp,
      });

      expect(result.success).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('Password reset verification code'),
          text: expect.stringContaining('reset the password'),
        }),
      );
    });

    it('rejects MOBILE_VERIFICATION purpose with clear exception', async () => {
      await expect(
        service.sendOtpEmail({
          recipientEmail: testRecipient,
          purpose: OtpPurpose.MOBILE_VERIFICATION,
          otpCode: testOtp,
        }),
      ).rejects.toThrow(EmailDeliveryError);

      await expect(
        service.sendOtpEmail({
          recipientEmail: testRecipient,
          purpose: OtpPurpose.MOBILE_VERIFICATION,
          otpCode: testOtp,
        }),
      ).rejects.toThrow(/MOBILE_VERIFICATION is not supported for email delivery/);

      expect(mockTransporter.sendMail).not.toHaveBeenCalled();
    });
  });

  describe('security, sanitization & logging', () => {
    beforeEach(async () => {
      service = await createService();
    });

    it('sanitizes raw SMTP transport errors without leaking credentials or server responses', async () => {
      mockTransporter.sendMail.mockRejectedValue(
        new Error(
          '535 5.7.8 Error: authentication failed for user testuser with pass super-secret-password-123 at smtp.internal:1025',
        ),
      );

      await expect(
        service.sendOtpEmail({
          recipientEmail: testRecipient,
          purpose: OtpPurpose.EMAIL_VERIFICATION,
          otpCode: testOtp,
        }),
      ).rejects.toThrow('Email delivery failed due to an SMTP transport error.');

      // Check that error logs do not contain the secret or full recipient email
      const errorLogs = errorSpy.mock.calls.map((c: any[]) => String(c[0])).join(' ');
      expect(errorLogs).not.toContain('super-secret-password-123');
      expect(errorLogs).not.toContain(testRecipient);
      expect(errorLogs).toContain(maskEmail(testRecipient));
    });

    it('distinguishes connection timeouts with a safe timeout error message', async () => {
      const timeoutErr = new Error('Connection timeout ETIMEDOUT');
      (timeoutErr as any).code = 'ETIMEDOUT';
      mockTransporter.sendMail.mockRejectedValue(timeoutErr);

      await expect(
        service.sendOtpEmail({
          recipientEmail: testRecipient,
          purpose: OtpPurpose.LOGIN,
          otpCode: testOtp,
        }),
      ).rejects.toThrow('Email delivery failed due to a connection timeout.');

      const errorLogs = errorSpy.mock.calls.map((c: any[]) => String(c[0])).join(' ');
      expect(errorLogs).toContain('connection timeout');
      expect(errorLogs).toContain(maskEmail(testRecipient));
    });

    it('never prints OTP code, email body, or credentials in operational success logs', async () => {
      mockTransporter.sendMail.mockResolvedValue({ messageId: 'msg-999' });

      await service.sendOtpEmail({
        recipientEmail: testRecipient,
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        otpCode: testOtp,
      });

      const allLogs = logSpy.mock.calls.map((c: any[]) => String(c[0])).join(' ');
      expect(allLogs).not.toContain(testOtp);
      expect(allLogs).not.toContain('super-secret-password-123');
      expect(allLogs).not.toContain(testRecipient);
      expect(allLogs).toContain(maskEmail(testRecipient));
    });
  });
});
