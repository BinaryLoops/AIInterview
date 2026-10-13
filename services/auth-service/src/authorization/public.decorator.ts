import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key used to explicitly mark public routes that bypass authentication/authorization guards.
 */
export const IS_PUBLIC_KEY = 'is_public';

/**
 * Decorator to explicitly mark a route handler or controller as public.
 *
 * When applied, authorization guards permit the request without requiring an
 * authenticated principal or role metadata.
 *
 * Example:
 *   @Public()
 *   @Get('health')
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
