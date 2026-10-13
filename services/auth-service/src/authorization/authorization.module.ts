import { Module } from '@nestjs/common';
import { RolesGuard } from './roles.guard.js';
import { RolePrivilegeService } from './role-privilege.service.js';

@Module({
  providers: [RolesGuard, RolePrivilegeService],
  exports: [RolesGuard, RolePrivilegeService],
})
export class AuthorizationModule {}
