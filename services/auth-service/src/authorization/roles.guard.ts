import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_ROLES_KEY } from './roles.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { ALLOW_ANY_ROLE_KEY } from './allow-any-role.decorator.js';
import { isRoleName, type RoleName } from './roles.js';
import type { AuthenticatedRequest } from './authorization.types.js';

/**
 * RolesGuard enforces role-based access control (RBAC) on protected endpoints.
 *
 * ## Architecture & Trust Boundaries:
 * 1. Authorization vs Authentication:
 *    RolesGuard is an *authorization* guard, not an authentication guard. It operates
 *    under the explicit prerequisite that an upstream authentication guard (AccessTokenGuard)
 *    has already verified credentials and attached a trusted `request.user` with `authVerified: true`.
 * 2. Unauthenticated Handling (401):
 *    If a protected route is accessed without a valid authenticated principal verified by
 *    the trusted authentication layer, this guard throws `UnauthorizedException` (HTTP 401).
 * 3. Insufficient Permissions (403):
 *    If an authenticated user lacks the required canonical role(s), this guard throws
 *    `ForbiddenException` (HTTP 403).
 * 4. Default to Deny (Unmarked Protection Policy):
 *    Protected routes without `@RequireRoles(...)` or `@AllowAnyRole()` metadata fail closed
 *    with `ForbiddenException` (HTTP 403). Unmarked endpoints are never silently allowed.
 * 5. Public Routes:
 *    Routes explicitly decorated with `@Public()` bypass this guard and allow access.
 * 6. Zero Client Trust:
 *    Client-supplied headers, query parameters, or request body fields are NEVER read or trusted.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Explicit public route bypass
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // 2. Extract request and authenticated principal (never trust client headers/body/query)
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request?.user;

    // 3. Unauthenticated requests to protected routes must fail with 401 Unauthorized.
    // Must be verified by the trusted upstream authentication layer (authVerified: true).
    if (
      !user ||
      typeof user !== 'object' ||
      !user.id ||
      typeof user.id !== 'string' ||
      user.authVerified !== true
    ) {
      throw new UnauthorizedException('Authentication required to access this resource.');
    }

    // 4. Check for @AllowAnyRole() explicit metadata
    const allowAnyRole = this.reflector.getAllAndOverride<boolean>(ALLOW_ANY_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (allowAnyRole) {
      if (!Array.isArray(user.roles) || user.roles.length === 0 || !user.roles.some(isRoleName)) {
        throw new ForbiddenException(
          'Access denied: you do not have permission to access this resource.',
        );
      }
      return true;
    }

    // 5. Retrieve and validate role metadata from handler or controller class
    const requiredRoles = this.reflector.getAllAndOverride<RoleName[] | undefined>(
      REQUIRE_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 6. Fail safely on missing or malformed role metadata (unmarked protected routes)
    if (
      !requiredRoles ||
      !Array.isArray(requiredRoles) ||
      requiredRoles.length === 0 ||
      !requiredRoles.every(isRoleName)
    ) {
      this.logger.warn(
        'Protected route reached with missing or malformed role metadata. Denying access by default.',
      );
      throw new ForbiddenException(
        'Access denied: route authorization configuration is missing or malformed.',
      );
    }

    // 6. Validate user's roles array
    if (!Array.isArray(user.roles) || user.roles.length === 0) {
      throw new ForbiddenException(
        'Access denied: you do not have permission to access this resource.',
      );
    }

    // 7. Verify whether user possesses at least one required role
    const hasRole = requiredRoles.some((requiredRole) => user.roles.includes(requiredRole));
    if (!hasRole) {
      throw new ForbiddenException(
        'Access denied: you do not have permission to access this resource.',
      );
    }

    return true;
  }
}
