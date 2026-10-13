import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { AuthConfigService } from '../config/auth-config.service.js';

/**
 * RedisService manages a Redis client connection based on the runtime config.
 * It respects the `REDIS_ENABLED` flag, uses a bounded connection timeout,
 * cleans up on application shutdown, and provides an `isHealthy` ping.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType | null = null;
  getClient(): RedisClientType | null { return this.client; }

  constructor(private readonly configService: AuthConfigService) {}

  async onModuleInit(): Promise<void> {
    if (!this.configService.snapshot.redis.enabled) {
      this.logger.log('Redis integration disabled; skipping connection.');
      return;
    }
    const { host, port, password } = this.configService.snapshot.redis;
    const url = `redis://${host ?? '127.0.0.1'}:${port ?? 6379}`;
    this.client = createClient({
      url,
      password: password ?? undefined,
    });
    const timeoutMs = 5000;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Redis connection timeout')), timeoutMs),
    );
    try {
      await Promise.race([this.client.connect(), timeout]);
      this.logger.log('Redis connected');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Redis connection failed: ${msg}`);
      this.client = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.quit();
      this.logger.log('Redis disconnected');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Redis disconnection error: ${msg}`);
    }
  }

  /**
   * Performs a lightweight ping. Returns true if the ping succeeds.
   */
  async isHealthy(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const resp = await this.client.ping();
      return resp === 'PONG';
    } catch {
      return false;
    }
  }
}
