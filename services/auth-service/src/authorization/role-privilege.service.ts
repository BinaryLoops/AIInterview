import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { RoleName, type RoleName as RoleNameType } from './roles.js';
import type { AuthenticatedPrincipal } from './authorization.types.js';

/**
 * Service enforcing role assignment privilege boundaries and preventing
 * privilege escalation.
 *
 * ## Privilege Boundary Rules:
 * 1. Public callers (no actor) cannot assign any role. Public registration strictly
 *    hardcodes CANDIDATE assignment inside a database transaction.
 * 2. Non-administrative users (CANDIDATE, RECRUITER, COMPANY_HR, MODERATOR) cannot
 *    grant or revoke any roles.
 * 3. Ordinary administrators (ADMIN) can manage operational roles (CANDIDATE,
 *    RECRUITER, COMPANY_HR, MODERATOR, ADMIN).
 * 4. Privilege Escalation Prevention: An ordinary ADMIN CANNOT grant SUPER_ADMIN.
 * 5. Only SUPER_ADMIN can grant or assign the SUPER_ADMIN role.
 */
@Injectable()
export class RolePrivilegeService {
  private readonly logger = new Logger(RolePrivilegeService.name);

  /**
   * Evaluates whether an actor possessing `actorRoles` is authorized to grant `targetRole`.
   */
  canAssignRole(actorRoles: RoleNameType[], targetRole: RoleNameType): boolean {
    if (!actorRoles || !Array.isArray(actorRoles) || actorRoles.length === 0) {
      return false;
    }

    // Only SUPER_ADMIN can grant SUPER_ADMIN
    if (targetRole === RoleName.SUPER_ADMIN) {
      return actorRoles.includes(RoleName.SUPER_ADMIN);
    }

    // SUPER_ADMIN can grant any role
    if (actorRoles.includes(RoleName.SUPER_ADMIN)) {
      return true;
    }

    // ADMIN can grant any role EXCEPT SUPER_ADMIN
    if (actorRoles.includes(RoleName.ADMIN)) {
      return true;
    }

    // Non-admins cannot grant any role
    return false;
  }

  /**
   * Asserts that an actor has the authority to grant `targetRole`.
   * Throws `ForbiddenException` with specific privilege escalation messaging when unauthorized.
   */
  assertCanAssignRole(actorRoles: RoleNameType[], targetRole: RoleNameType): void {
    if (!this.canAssignRole(actorRoles, targetRole)) {
      if (targetRole === RoleName.SUPER_ADMIN && actorRoles?.includes(RoleName.ADMIN)) {
        this.logger.warn(
          'Privilege escalation attempt: Ordinary administrator attempted to grant Super Admin privileges.',
        );
        throw new ForbiddenException(
          'Unauthorized privilege escalation: Ordinary administrators cannot grant Super Admin privileges.',
        );
      }

      this.logger.warn(
        `Privilege boundary violation: Actor with roles [${actorRoles?.join(', ')}] attempted to grant ${targetRole}.`,
      );
      throw new ForbiddenException(
        `Unauthorized privilege escalation: Insufficient permissions to grant ${targetRole} role.`,
      );
    }
  }

  /**
   * Convenience assertion taking a full AuthenticatedPrincipal.
   */
  validateRoleAssignment(actor: AuthenticatedPrincipal, targetRole: RoleNameType): void {
    if (!actor || !actor.roles) {
      throw new ForbiddenException('Unauthorized: Missing authenticated principal for role assignment.');
    }
    this.assertCanAssignRole(actor.roles, targetRole);
  }
}
