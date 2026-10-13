import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key indicating that a protected endpoint is accessible by any
 * authenticated principal with at least one canonical role.
 */
export const ALLOW_ANY_ROLE_KEY = 'allow_any_role';

/**
 * Decorator to explicitly mark a protected route as accessible to any authenticated
 * user regardless of specific role, avoiding accidental exposure of unmarked endpoints.
 *
 * Example:
 *   @AllowAnyRole()
 *   @Get('profile')
 */
export const AllowAnyRole = () => SetMetadata(ALLOW_ANY_ROLE_KEY, true);

/**
 * Convenience alias for @AllowAnyRole.
 */
export const RequireAuth = AllowAnyRole;
