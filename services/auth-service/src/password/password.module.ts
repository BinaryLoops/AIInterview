import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PasswordPolicyService } from './password-policy.service.js';
import { PasswordHashingService } from './password-hashing.service.js';
import { PasswordHistoryService } from './password-history.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [PasswordPolicyService, PasswordHashingService, PasswordHistoryService],
  exports: [PasswordPolicyService, PasswordHashingService, PasswordHistoryService],
})
export class PasswordModule {}

