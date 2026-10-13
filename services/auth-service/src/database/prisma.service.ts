import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuthConfigService } from '../config/auth-config.service.js';

/**
 * PrismaService wraps the generated Prisma client and respects the
 * AuthConfigService `database.enabled` flag. It connects on module init,
 * disconnects on module destroy, and provides a lightweight health check.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly configService: AuthConfigService) {
    const dbUrl = configService.snapshot?.database?.url;
    super(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);
  }

  async onModuleInit(): Promise<void> {
    if (!this.configService.snapshot.database.enabled) {
      this.logger.log('Database integration disabled; skipping Prisma connection.');
      return;
    }
    const timeoutMs = 5000;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Prisma connection timeout')), timeoutMs),
    );
    try {
      await Promise.race([this.$connect(), timeout]);
      this.logger.log('Prisma connected');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Prisma connection failed: ${msg}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.configService.snapshot.database.enabled) {
      return;
    }
    try {
      await this.$disconnect();
      this.logger.log('Prisma disconnected');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Prisma disconnection error: ${msg}`);
    }
  }

  /**
   * Simple health‑check query – returns true if a lightweight query succeeds.
   * Returns false when the integration is disabled or the query fails.
   */
  async isHealthy(): Promise<boolean> {
    if (!this.configService.snapshot.database.enabled) {
      return false;
    }
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
