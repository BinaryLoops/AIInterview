import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedPrincipal, AuthenticatedRequest } from './authorization.types.js';

/**
 * Parameter decorator to extract the authenticated principal (or a property thereof)
 * from the incoming request.
 *
 * Example:
 *   @Get('profile')
 *   getProfile(@CurrentUser() user: AuthenticatedPrincipal) { ... }
 *
 *   @Get('id')
 *   getId(@CurrentUser('id') userId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedPrincipal | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request?.user;
    if (!user) {
      return undefined;
    }
    return data ? user[data] : user;
  },
);
