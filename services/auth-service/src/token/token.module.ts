import { Module } from '@nestjs/common';
import { AuthConfigModule } from '../config/auth-config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RedisModule } from '../database/redis.module.js';
import { TokenService } from './token.service.js';
import { AccessTokenGuard } from './access-token.guard.js';

@Module({
  imports: [AuthConfigModule, DatabaseModule, RedisModule],
  providers: [TokenService, AccessTokenGuard],
  exports: [TokenService, AccessTokenGuard],
})
export class TokenModule {}

