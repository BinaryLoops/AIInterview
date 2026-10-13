import { SetMetadata } from '@nestjs/common';
import type { RoleName } from './roles.js';

/**
 * Metadata key for required roles on route handlers and controller classes.
 */
export const REQUIRE_ROLES_KEY = 'require_roles';
export const ROLES_KEY = REQUIRE_ROLES_KEY;

/**
 * Decorator to enforce required roles on a route handler or controller.
 *
 * Example:
 *   @RequireRoles(RoleName.ADMIN)
 *   @RequireRoles(RoleName.ADMIN, RoleName.MODERATOR)
 */
export const RequireRoles = (...roles: RoleName[]) =>
  SetMetadata(REQUIRE_ROLES_KEY, roles);

/**
 * Convenience alias for @RequireRoles.
 */
export const Roles = RequireRoles;
