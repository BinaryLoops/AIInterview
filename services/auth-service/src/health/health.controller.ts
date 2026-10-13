import { Controller, Get, Res } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuthConfigService } from '../config/auth-config.service.js';
import { RedisService } from '../database/redis.service.js';
import { Public } from '../authorization/public.decorator.js';

@Public()
@Controller()
export class HealthController {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: AuthConfigService,
    private readonly redisService: RedisService,
  ) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'auth-service',
    };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res?: any) {
    const checks: Record<string, 'up' | 'down'> = { process: 'up' };
    let allHealthy = true;

    if (this.configService.snapshot.database.enabled) {
      const dbReady = await this.prismaService.isHealthy();
      checks.database = dbReady ? 'up' : 'down';
      if (!dbReady) {
        allHealthy = false;
      }
    }

    if (this.configService.snapshot.redis.enabled) {
      const redisReady = await this.redisService.isHealthy();
      checks.redis = redisReady ? 'up' : 'down';
      if (!redisReady) {
        allHealthy = false;
      }
    }

    if (!allHealthy && res && typeof res.status === 'function') {
      res.status(503);
    }

    return {
      status: allHealthy ? 'ready' : 'not_ready',
      service: 'auth-service',
      checks,
    };
  }
}
