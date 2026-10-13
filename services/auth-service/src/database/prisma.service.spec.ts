import { Test } from '@nestjs/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { AuthConfigService } from '../config/auth-config.service.js';

// Mock PrismaClient inside the factory to avoid hoisting issues
vi.mock('@prisma/client', () => {
  class MockPrismaClient {
    $connect = vi.fn().mockResolvedValue(undefined);
    $disconnect = vi.fn().mockResolvedValue(undefined);
    $queryRaw = vi.fn().mockResolvedValue([1]);
  }
  return { PrismaClient: MockPrismaClient } as any;
});

import { PrismaService } from './prisma.service.js';

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

describe('PrismaService', () => {
  let prismaService: PrismaService;
  let configService: AuthConfigService;

  beforeEach(async () => {
    configService = {
      snapshot: { database: { enabled: true, url: 'postgres://test' } },
    } as any;
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService, { provide: AuthConfigService, useValue: configService }],
    }).compile();
    prismaService = moduleRef.get(PrismaService);
  });

  it('connects on init when enabled', async () => {
    await prismaService.onModuleInit();
    expect(prismaService['$connect']).toHaveBeenCalled();
  });

  it('does not connect when disabled', async () => {
    configService.snapshot.database.enabled = false;
    await prismaService.onModuleInit();
    expect(prismaService['$connect']).not.toHaveBeenCalled();
  });

  it('reports healthy when DB reachable', async () => {
    const healthy = await prismaService.isHealthy();
    expect(healthy).toBe(true);
    expect(prismaService['$queryRaw']).toHaveBeenCalled();
  });

  it('reports unhealthy when query fails', async () => {
    (prismaService['$queryRaw'] as any).mockRejectedValueOnce(new Error('fail'));
    const healthy = await prismaService.isHealthy();
    expect(healthy).toBe(false);
  });
});
