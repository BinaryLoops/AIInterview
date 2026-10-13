import { Module } from '@nestjs/common';
import { RedisModule } from '../database/redis.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { HealthController } from "./health.controller.js";

@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [HealthController],
})
export class HealthModule {}
