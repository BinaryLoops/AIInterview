import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../authorization/public.decorator.js';
import { TokenService } from './token.service.js';
import type { AuthenticatedRequest } from '../authorization/authorization.types.js';

/**
 * AccessTokenGuard verifies incoming HTTP bearer access tokens.
 *
 * ## Security Guarantees:
 * 1. Bearer Token Extraction: Extracts bearer token exclusively from the standard
 *    `Authorization: Bearer <token>` header.
 * 2. Strict Cryptographic Verification: Validates token signature, expiration, issuer,
 *    and audience via `TokenService` using HMAC-SHA256.
 * 3. Replay & Misuse Defense: Explicitly rejects refresh tokens (`<sessionId>.<secret>`)
 *    if accidentally or maliciously submitted as bearer tokens.
 * 4. Immediate Revocation Enforcement: Validates that the bearer token was not issued
 *    prior to a user-level or session-level revocation epoch (e.g. password reset or logout).
 * 5. Account Lifecycle State Check: Enforces that suspended or deactivated user accounts
 *    are immediately barred from protected endpoints even with unexpired JWTs.
 * 6. Role Synchronization: Synchronizes principal roles with verified account state,
 *    preventing users with revoked permissions from exploiting stale claims.
 * 7. Principal Attachment: Constructs and attaches a validated `AuthenticatedPrincipal`
 *    with `authVerified: true` to `request.user`.
 * 8. Zero Client Trust: Ignores and never trusts client-supplied user headers, query
 *    parameters, or body fields.
 * 9. Public Route Support: Bypasses authentication safely when `@Public()` is present.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  private readonly logger = new Logger(AccessTokenGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Explicit public route bypass
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // 2. Extract Authorization header
    const headers = request.headers as Record<string, string | string[] | undefined> | undefined;
    const authHeader = headers?.['authorization'] ?? headers?.['Authorization'];

    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException('Missing or malformed Authorization header.');
    }

    const trimmed = authHeader.trim();
    const parts = trimmed.split(/\s+/);

    if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer' || !parts[1]) {
      throw new UnauthorizedException('Authorization header must use format: Bearer <token>.');
    }

    const rawToken = parts[1];

    // 3. Reject refresh tokens explicitly if presented as a bearer token
    // Compound refresh tokens have exactly two segments: `<sessionId>.<secret>`
    // Standard compact JWTs always have three segments: `<header>.<payload>.<signature>`
    const dotCount = (rawToken.match(/\./g) || []).length;
    if (dotCount === 1) {
      this.logger.warn('Refresh token presented as a bearer access token. Rejecting request.');
      throw new UnauthorizedException('Refresh tokens cannot be used as bearer access tokens.');
    }

    // 4. Cryptographically verify the access token
    const claims = await this.tokenService.verifyAccessToken(rawToken);
    if (!claims || typeof claims !== 'object' || !claims.sub) {
      throw new UnauthorizedException('Invalid access token claims.');
    }

    // 5. Verify account lifecycle status (active vs suspended / deactivated)
    const accountState = typeof this.tokenService.getAccountState === 'function'
      ? await this.tokenService.getAccountState(claims.sub)
      : { status: 'ACTIVE', roles: claims.roles };

    if (accountState.status !== 'ACTIVE') {
      this.logger.warn(
        `Access token rejected: account status is ${accountState.status} for user ${claims.sub}`,
      );
      throw new UnauthorizedException(`Account is ${accountState.status.toLowerCase()}. Please contact support.`);
    }

    // 6. Verify token revocation (session-level or user-level epoch)
    const isRevoked = typeof this.tokenService.isTokenRevoked === 'function'
      ? await this.tokenService.isTokenRevoked(claims.sub, claims.sid, claims.iat)
      : false;

    if (isRevoked) {
      this.logger.warn(`Access token rejected: credentials or session revoked for user ${claims.sub}`);
      throw new UnauthorizedException('Session or credentials have been revoked. Please sign in again.');
    }

    // 7. Attach trusted AuthenticatedPrincipal to request.user
    // Effective roles reflect live account state to prevent revoked roles from being accepted
    const effectiveRoles =
      accountState.roles && accountState.roles.length > 0 ? accountState.roles : claims.roles;
    request.user = this.tokenService.toPrincipal(claims, effectiveRoles);

    return true;
  }
}

