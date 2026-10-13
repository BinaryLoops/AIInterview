import { Controller, Get } from '@nestjs/common';
import { RequireRoles } from '../authorization/roles.decorator.js';
import { AllowAnyRole } from '../authorization/allow-any-role.decorator.js';
import { CurrentUser } from '../authorization/current-user.decorator.js';
import { RoleName } from '../authorization/roles.js';
import type { AuthenticatedPrincipal } from '../authorization/authorization.types.js';

/**
 * Controller mounted exclusively in the integration test suite to verify
 * RBAC, decorator ordering, unauthenticated rejection, and fail-closed policies.
 */
@Controller('test-protected')
export class TestProtectedController {
  @Get('candidate-only')
  @RequireRoles(RoleName.CANDIDATE)
  getCandidateResource(@CurrentUser() user: AuthenticatedPrincipal) {
    return { status: 'success', resource: 'candidate-profile', user };
  }

  @Get('admin-only')
  @RequireRoles(RoleName.ADMIN)
  getAdminResource(@CurrentUser() user: AuthenticatedPrincipal) {
    return { status: 'success', resource: 'admin-dashboard', user };
  }

  @Get('any-authenticated')
  @AllowAnyRole()
  getAnyAuthenticated(@CurrentUser() user: AuthenticatedPrincipal) {
    return { status: 'success', resource: 'user-settings', user };
  }

  @Get('unmarked-route')
  getUnmarkedRoute(@CurrentUser() user: AuthenticatedPrincipal) {
    return { status: 'success', resource: 'unmarked', user };
  }
}
