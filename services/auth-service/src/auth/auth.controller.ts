import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { AuthConfigService } from '../config/auth-config.service.js';
import {
  AuthService,
  type ForgotPasswordResponse,
  type LoginResponse,
  type RefreshResponse,
  type RegisterResponse,
  type ResetPasswordResponse,
  type VerifyEmailResponse,
  type VerifyLoginOtpResponse,
} from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { VerifyLoginOtpDto } from './dto/verify-login-otp.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { LogoutDto } from './dto/logout.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import type { RevokeSessionResult } from '../session/session.types.js';
import { Public } from '../authorization/public.decorator.js';

/**
 * Controller exposing public authentication endpoints.
 * Mounts standard `/auth` prefixed routes.
 *
 * ## Security Guarantees:
 * 1. Strict Browser / Native Delivery Separation: Browser clients receive refresh tokens
 *    exclusively via HttpOnly cookies and never in JavaScript-readable JSON. Native clients
 *    (signaled via `X-Client-Type: native`) receive tokens in the JSON response without cookies.
 * 2. Origin & Referer CSRF Defense: Cookie-authenticated operations (/auth/refresh and /auth/logout)
 *    verify the `Origin` or `Referer` header against allowed configuration origins.
 * 3. Matching Cookie Lifecycle: Cookie setting and clearing use identical `path`, `httpOnly`,
 *    `secure`, and `sameSite` parameters.
 * 4. Trusted Proxy Inspection: `X-Forwarded-For` headers are only inspected when `trustProxy`
 *    is enabled; untrusted direct requests use the verified socket address.
 */
@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: AuthConfigService,
  ) {}

  /**
   * Securely sets the rotated refresh token as an HttpOnly, SameSite=Lax cookie.
   */
  private setRefreshTokenCookie(res: any, refreshToken: string): void {
    if (!res || typeof res.cookie !== 'function') return;
    const isProduction = this.configService.nodeEnv === 'production';
    const ttlDays = this.configService.session.refreshTokenTtlDays;
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/auth',
      maxAge: ttlDays * 24 * 60 * 60 * 1000,
    });
  }

  /**
   * Securely clears the refresh token cookie upon logout.
   */
  private clearRefreshTokenCookie(res: any): void {
    if (!res || typeof res.clearCookie !== 'function') return;
    const isProduction = this.configService.nodeEnv === 'production';
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/auth',
    });
  }

  /**
   * Determines whether the caller is explicitly a native/mobile non-browser client.
   */
  private isNativeClient(req?: any): boolean {
    const rawHeader = req?.headers?.['x-client-type'];
    const val = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (typeof val === 'string') {
      const lower = val.toLowerCase().trim();
      return lower === 'native' || lower === 'mobile' || lower === 'cli';
    }
    return false;
  }

  /**
   * Resolves the refresh token from either the incoming HttpOnly cookie or the JSON request body.
   */
  private extractRefreshToken(
    dtoToken?: string,
    req?: any,
  ): { token: string; isFromCookie: boolean } {
    const cookieHeader = req?.headers?.cookie ?? req?.headers?.Cookie;
    if (typeof cookieHeader === 'string') {
      const match = cookieHeader.match(/(?:^|;\s*)refreshToken=([^;]+)/);
      if (match && match[1]) {
        return { token: decodeURIComponent(match[1]), isFromCookie: true };
      }
    }

    if (dtoToken && typeof dtoToken === 'string' && dtoToken.trim().length > 0) {
      return { token: dtoToken.trim(), isFromCookie: false };
    }

    return { token: '', isFromCookie: false };
  }

  private isOriginAllowed(value: string): boolean {
    if (typeof this.configService.isAllowedOrigin === 'function') {
      return this.configService.isAllowedOrigin(value);
    }
    try {
      const u = new URL(value);
      const appUrl = new URL(this.configService.appBaseUrl);
      if (this.configService.nodeEnv === 'production') {
        return u.origin === appUrl.origin;
      }
      return (
        u.origin === appUrl.origin ||
        u.hostname === 'localhost' ||
        u.hostname === '127.0.0.1'
      );
    } catch {
      return false;
    }
  }

  /**
   * Validates request Origin and Referer for cookie-authenticated endpoints (CSRF defense).
   */
  private validateCsrf(req?: any, isCookieAuth = false): void {
    if (!isCookieAuth) return;

    const origin = req?.headers?.origin ?? req?.headers?.Origin;
    if (origin && typeof origin === 'string') {
      try {
        new URL(origin);
      } catch {
        throw new ForbiddenException('CSRF check failed: malformed origin header.');
      }
      if (!this.isOriginAllowed(origin)) {
        throw new ForbiddenException('CSRF check failed: untrusted request origin.');
      }
      return;
    }

    // Check Referer when Origin is absent
    const referer = req?.headers?.referer ?? req?.headers?.Referer;
    if (referer && typeof referer === 'string') {
      try {
        new URL(referer);
      } catch {
        throw new ForbiddenException('CSRF check failed: malformed referer header.');
      }
      if (!this.isOriginAllowed(referer)) {
        throw new ForbiddenException('CSRF check failed: untrusted request referer.');
      }
    }
  }

  /**
   * Strips refresh tokens from the JSON response when cookie delivery is active.
   */
  private sanitizeSessionResponse<
    T extends { session: { id: string; refreshToken?: string; expiresAt: Date } },
  >(result: T, useCookies: boolean): T {
    if (!useCookies) {
      return result;
    }
    const { refreshToken: _, ...sanitizedSession } = result.session;
    return {
      ...result,
      session: sanitizedSession,
    } as T;
  }

  /**
   * Helper extracting normalized client IP and User-Agent headers with trusted proxy validation.
   */
  private extractContext(req?: any, ip?: string): { clientIp: string; userAgent?: string } {
    let clientIp = '';
    if (this.configService.trustProxy) {
      const forwarded = req?.headers?.['x-forwarded-for'];
      const forwardedIp = Array.isArray(forwarded)
        ? forwarded[0]
        : typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : undefined;
      clientIp = forwardedIp || ip || req?.ip || req?.socket?.remoteAddress || '127.0.0.1';
    } else {
      // Untrusted proxy mode: strictly ignore forwarded headers
      clientIp = ip || req?.socket?.remoteAddress || req?.connection?.remoteAddress || req?.ip || '127.0.0.1';
    }
    const userAgent = typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
    return { clientIp, userAgent };
  }

  /**
   * Public registration endpoint for candidates.
   *
   * Rate limited to 5 requests per 60 seconds per IP address to mitigate abuse.
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ limit: 5, ttl: 60 })
  async register(@Body() dto: RegisterDto): Promise<RegisterResponse> {
    return this.authService.register(dto);
  }

  /**
   * Public email verification endpoint using six-digit OTP.
   *
   * Rate limited to 5 requests per 60 seconds per IP address to protect against brute-force attacks.
   */
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, ttl: 60 })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<VerifyEmailResponse> {
    return this.authService.verifyEmail(dto);
  }

  /**
   * Public login endpoint (Step 1).
   *
   * Verifies credentials and account state, protects against brute-force via
   * sliding-window failed-attempt tracking, and initiates a LOGIN OTP challenge.
   *
   * Rate limited to 10 requests per 60 seconds per IP at the HTTP guard level.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, ttl: 60 })
  async login(
    @Body() dto: LoginDto,
    @Ip() ip?: string,
    @Req() req?: any,
  ): Promise<LoginResponse> {
    const { clientIp } = this.extractContext(req, ip);
    return this.authService.login(dto, clientIp);
  }

  /**
   * Completes authentication by verifying login OTP and issuing an active session (Step 2).
   *
   * Rate limited to 5 requests per 60 seconds per IP to mitigate OTP guessing attacks.
   */
  @Post('verify-login-otp')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, ttl: 60 })
  async verifyLoginOtp(
    @Body() dto: VerifyLoginOtpDto,
    @Ip() ip?: string,
    @Req() req?: any,
    @Res({ passthrough: true }) res?: any,
  ): Promise<VerifyLoginOtpResponse> {
    const { clientIp, userAgent } = this.extractContext(req, ip);
    const result = await this.authService.verifyLoginOtp(dto, { ipAddress: clientIp, userAgent });

    const isNative = this.isNativeClient(req);
    if (!isNative) {
      this.setRefreshTokenCookie(res, result.session.refreshToken);
      return this.sanitizeSessionResponse(result, true);
    }

    return result;
  }

  /**
   * Refreshes an active session with single-use refresh token rotation.
   *
   * Rate limited to 10 requests per 60 seconds per IP.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, ttl: 60 })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Ip() ip?: string,
    @Req() req?: any,
    @Res({ passthrough: true }) res?: any,
  ): Promise<RefreshResponse> {
    const { clientIp, userAgent } = this.extractContext(req, ip);
    const { token: resolvedToken, isFromCookie } = this.extractRefreshToken(dto?.refreshToken, req);

    if (!resolvedToken) {
      throw new UnauthorizedException('Refresh token is required.');
    }

    // CSRF protection on cookie-based refresh
    this.validateCsrf(req, isFromCookie);

    const result = await this.authService.refresh(
      { refreshToken: resolvedToken },
      { ipAddress: clientIp, userAgent },
    );

    const isNative = !isFromCookie && this.isNativeClient(req);
    if (!isNative) {
      this.setRefreshTokenCookie(res, result.session.refreshToken);
      return this.sanitizeSessionResponse(result, true);
    }

    return result;
  }

  /**
   * Revokes the current session (logout).
   *
   * Rate limited to 10 requests per 60 seconds per IP. Idempotent.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, ttl: 60 })
  async logout(
    @Body() dto: LogoutDto,
    @Ip() ip?: string,
    @Req() req?: any,
    @Res({ passthrough: true }) res?: any,
  ): Promise<RevokeSessionResult> {
    const { clientIp } = this.extractContext(req, ip);
    const { token: resolvedToken, isFromCookie } = this.extractRefreshToken(dto?.refreshToken, req);

    // CSRF protection on cookie-based logout
    this.validateCsrf(req, isFromCookie);

    if (!resolvedToken) {
      this.clearRefreshTokenCookie(res);
      return { success: true, message: 'Logged out successfully.' };
    }

    const result = await this.authService.logout({ refreshToken: resolvedToken }, clientIp);
    this.clearRefreshTokenCookie(res);
    return result;
  }

  /**
   * Initiates password reset flow by delivering a PASSWORD_RESET OTP to the user email.
   *
   * Rate limited to 5 requests per 60 seconds per IP at the HTTP guard level.
   */
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, ttl: 60 })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Ip() ip?: string,
    @Req() req?: any,
  ): Promise<ForgotPasswordResponse> {
    const { clientIp } = this.extractContext(req, ip);
    return this.authService.forgotPassword(dto, clientIp);
  }

  /**
   * Completes password reset by verifying OTP and applying new password.
   *
   * Rate limited to 5 requests per 60 seconds per IP at the HTTP guard level.
   */
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, ttl: 60 })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Ip() ip?: string,
    @Req() req?: any,
  ): Promise<ResetPasswordResponse> {
    const { clientIp, userAgent } = this.extractContext(req, ip);
    return this.authService.resetPassword(dto, { ipAddress: clientIp, userAgent });
  }
}
