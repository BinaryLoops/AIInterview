import { Module } from '@nestjs/common';
import { AuthConfigModule } from '../config/auth-config.module.js';
import { RedisModule } from '../database/redis.module.js';
import { RateLimitService } from './rate-limit.service.js';
import { RateLimitGuard } from './rate-limit.guard.js';

@Module({
  imports: [AuthConfigModule, RedisModule],
  providers: [RateLimitService, RateLimitGuard],
  exports: [RateLimitService, RateLimitGuard],
})
export class RateLimitModule {}
