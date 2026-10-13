import nodemailer from 'nodemailer';

/**
 * Controlled in-memory mailbox for capturing OTP emails during integration testing.
 * Allows test cases to extract the OTP challenge code without printing secrets to logs.
 */
export class TestInbox {
  private messages: Array<{
    to: string;
    subject: string;
    text: string;
    html: string;
  }> = [];

  /**
   * Creates a custom nodemailer transporter that captures messages in-memory.
   */
  createTransporter(): nodemailer.Transporter {
    return nodemailer.createTransport({
      name: 'test-inbox',
      version: '1.0.0',
      send: (mail: any, callback: (err: Error | null, info: any) => void) => {
        const data = mail.data || {};
        this.messages.push({
          to: String(data.to || '').toLowerCase().trim(),
          subject: String(data.subject || ''),
          text: String(data.text || ''),
          html: String(data.html || ''),
        });
        callback(null, { messageId: `msg-${Date.now()}` });
      },
    } as any);
  }

  /**
   * Directly records an OTP message for testing without requiring SMTP transport.
   */
  recordOtp(recipient: string, otpCode: string): void {
    this.messages.push({
      to: recipient.toLowerCase().trim(),
      subject: 'Verification Code',
      text: `Your verification code is ${otpCode}.`,
      html: `<p>Your verification code is ${otpCode}.</p>`,
    });
  }

  /**
   * Retrieves the most recently dispatched 6-digit OTP code for the given recipient.
   */
  getLastOtpFor(recipient: string): string | null {
    const normalized = recipient.toLowerCase().trim();
    const matches = this.messages.filter((m) => m.to === normalized);
    if (matches.length === 0) return null;
    const last = matches[matches.length - 1];
    if (!last) return null;
    const match = last.text.match(/\b\d{6}\b/);
    return match ? match[0] : null;
  }

  /**
   * Clears all captured messages.
   */
  clear(): void {
    this.messages = [];
  }
}
