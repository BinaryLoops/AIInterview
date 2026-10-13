import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RolePrivilegeService } from './role-privilege.service.js';
import { RoleName } from './roles.js';
import type { AuthenticatedPrincipal } from './authorization.types.js';

describe('RolePrivilegeService', () => {
  let service: RolePrivilegeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RolePrivilegeService],
    }).compile();

    service = module.get<RolePrivilegeService>(RolePrivilegeService);
  });

  describe('Privilege Escalation Prevention', () => {
    it('prevents an ordinary ADMIN from assigning SUPER_ADMIN (escalation rejected)', () => {
      const actorRoles = [RoleName.ADMIN];

      expect(service.canAssignRole(actorRoles, RoleName.SUPER_ADMIN)).toBe(false);
      expect(() => service.assertCanAssignRole(actorRoles, RoleName.SUPER_ADMIN)).toThrow(
        ForbiddenException,
      );
      expect(() => service.assertCanAssignRole(actorRoles, RoleName.SUPER_ADMIN)).toThrow(
        'Unauthorized privilege escalation: Ordinary administrators cannot grant Super Admin privileges.',
      );
    });

    it('permits a SUPER_ADMIN to assign SUPER_ADMIN', () => {
      const actorRoles = [RoleName.SUPER_ADMIN];

      expect(service.canAssignRole(actorRoles, RoleName.SUPER_ADMIN)).toBe(true);
      expect(() => service.assertCanAssignRole(actorRoles, RoleName.SUPER_ADMIN)).not.toThrow();
    });

    it('permits a user with both ADMIN and SUPER_ADMIN to assign SUPER_ADMIN', () => {
      const actorRoles = [RoleName.ADMIN, RoleName.SUPER_ADMIN];

      expect(service.canAssignRole(actorRoles, RoleName.SUPER_ADMIN)).toBe(true);
      expect(() => service.assertCanAssignRole(actorRoles, RoleName.SUPER_ADMIN)).not.toThrow();
    });
  });

  describe('Ordinary Administrator Powers', () => {
    it('permits an ordinary ADMIN to assign CANDIDATE', () => {
      expect(service.canAssignRole([RoleName.ADMIN], RoleName.CANDIDATE)).toBe(true);
      expect(() => service.assertCanAssignRole([RoleName.ADMIN], RoleName.CANDIDATE)).not.toThrow();
    });

    it('permits an ordinary ADMIN to assign RECRUITER', () => {
      expect(service.canAssignRole([RoleName.ADMIN], RoleName.RECRUITER)).toBe(true);
      expect(() => service.assertCanAssignRole([RoleName.ADMIN], RoleName.RECRUITER)).not.toThrow();
    });

    it('permits an ordinary ADMIN to assign COMPANY_HR', () => {
      expect(service.canAssignRole([RoleName.ADMIN], RoleName.COMPANY_HR)).toBe(true);
      expect(() => service.assertCanAssignRole([RoleName.ADMIN], RoleName.COMPANY_HR)).not.toThrow();
    });

    it('permits an ordinary ADMIN to assign MODERATOR', () => {
      expect(service.canAssignRole([RoleName.ADMIN], RoleName.MODERATOR)).toBe(true);
      expect(() => service.assertCanAssignRole([RoleName.ADMIN], RoleName.MODERATOR)).not.toThrow();
    });

    it('permits an ordinary ADMIN to assign ADMIN', () => {
      expect(service.canAssignRole([RoleName.ADMIN], RoleName.ADMIN)).toBe(true);
      expect(() => service.assertCanAssignRole([RoleName.ADMIN], RoleName.ADMIN)).not.toThrow();
    });
  });

  describe('Non-administrative Role Restrictions', () => {
    const nonAdminRoles = [
      RoleName.CANDIDATE,
      RoleName.RECRUITER,
      RoleName.COMPANY_HR,
      RoleName.MODERATOR,
    ];

    it.each(nonAdminRoles)('rejects role assignment attempts by %s', (role) => {
      expect(service.canAssignRole([role], RoleName.CANDIDATE)).toBe(false);
      expect(service.canAssignRole([role], RoleName.RECRUITER)).toBe(false);
      expect(service.canAssignRole([role], RoleName.ADMIN)).toBe(false);
      expect(service.canAssignRole([role], RoleName.SUPER_ADMIN)).toBe(false);

      expect(() => service.assertCanAssignRole([role], RoleName.CANDIDATE)).toThrow(
        ForbiddenException,
      );
      expect(() => service.assertCanAssignRole([role], RoleName.CANDIDATE)).toThrow(
        `Unauthorized privilege escalation: Insufficient permissions to grant ${RoleName.CANDIDATE} role.`,
      );
    });
  });

  describe('Unauthenticated / Empty Actors', () => {
    it('rejects assignment when actor roles array is empty', () => {
      expect(service.canAssignRole([], RoleName.CANDIDATE)).toBe(false);
      expect(() => service.assertCanAssignRole([], RoleName.CANDIDATE)).toThrow(
        ForbiddenException,
      );
    });

    it('rejects assignment when actor is undefined in validateRoleAssignment', () => {
      expect(() =>
        service.validateRoleAssignment(
          undefined as unknown as AuthenticatedPrincipal,
          RoleName.CANDIDATE,
        ),
      ).toThrow(ForbiddenException);
    });

    it('permits valid assignment through validateRoleAssignment with valid principal', () => {
      const adminPrincipal: AuthenticatedPrincipal = {
        id: 'admin-id',
        email: 'admin@company.com',
        roles: [RoleName.ADMIN],
      };

      expect(() =>
        service.validateRoleAssignment(adminPrincipal, RoleName.RECRUITER),
      ).not.toThrow();
    });
  });
});
