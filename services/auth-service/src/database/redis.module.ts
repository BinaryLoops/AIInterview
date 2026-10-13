import { Module } from '@nestjs/common';
import { RedisService } from './redis.service.js';
import { AuthConfigModule } from '../config/auth-config.module.js';

@Module({
  imports: [AuthConfigModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
