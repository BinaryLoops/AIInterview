import { CanActivate, ExecutionContext, Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_METADATA, type RateLimitOptions } from './rate-limit.decorator.js';
import { RateLimitService } from './rate-limit.service.js';
import { AuthConfigService } from '../config/auth-config.service.js';

/**
 * Guard that enforces a rate-limit policy defined via the @RateLimit decorator.
 *
 * ## Security Guarantees:
 * 1. Strict Proxy Trust Validation: Forwarded client IP headers (`X-Forwarded-For`) are ONLY
 *    evaluated when `trustProxy` is explicitly enabled in configuration. If `trustProxy` is false,
 *    untrusted client headers are strictly ignored and the socket remote address is used.
 * 2. Fail-Closed on Undetermined IP: Requests where client IP cannot be established are rejected
 *    with HTTP 400 Bad Request to prevent rate-limit evasion.
 * 3. Rate Exceeded Response: Throws HTTP 429 Too Many Requests with a `Retry-After` header.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
    private readonly configService: AuthConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const options: RateLimitOptions | undefined = this.reflector.get(
      RATE_LIMIT_METADATA,
      context.getHandler(),
    );
    if (!options) {
      return true;
    }

    let ip = '';
    if (this.configService.trustProxy) {
      const forwarded = request.headers?.['x-forwarded-for'];
      const forwardedIp = Array.isArray(forwarded)
        ? forwarded[0]
        : typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : undefined;
      ip = forwardedIp || request.ip || request.socket?.remoteAddress || request.connection?.remoteAddress || '';
    } else {
      // Untrusted proxy mode: strictly ignore forwarded headers to prevent spoofing
      ip = request.socket?.remoteAddress || request.connection?.remoteAddress || request.ip || '';
    }

    if (!ip) {
      this.logger.warn('Unable to determine client IP – rejecting request');
      throw new HttpException('Unable to determine client IP', HttpStatus.BAD_REQUEST);
    }
    const key = `rl:${ip}`;

    const allowed = await this.rateLimitService.isAllowed(key, options);
    if (!allowed) {
      const retryAfter = options.ttl;
      request.res?.setHeader('Retry-After', retryAfter.toString());
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
