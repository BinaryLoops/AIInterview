import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthConfigModule } from '../config/auth-config.module.js';
import { TokenModule } from '../token/token.module.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [DatabaseModule, AuthConfigModule, TokenModule],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}

