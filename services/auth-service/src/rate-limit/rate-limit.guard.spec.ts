import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard } from './rate-limit.guard.js';
import { RateLimitService } from './rate-limit.service.js';
import { AuthConfigService } from '../config/auth-config.service.js';

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let mockReflector: any;
  let mockRateLimitService: any;
  let mockConfigService: any;

  beforeEach(() => {
    mockReflector = {
      get: vi.fn(),
    };
    mockRateLimitService = {
      isAllowed: vi.fn().mockResolvedValue(true),
    };
    mockConfigService = {
      trustProxy: false,
    };

    guard = new RateLimitGuard(
      mockReflector as Reflector,
      mockRateLimitService as RateLimitService,
      mockConfigService as AuthConfigService,
    );
  });

  const createMockContext = (req: any, res: any = {}) => ({
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
    getHandler: () => ({}),
  } as any);

  it('bypasses routes without @RateLimit metadata', async () => {
    mockReflector.get.mockReturnValue(undefined);
    const context = createMockContext({});

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(mockRateLimitService.isAllowed).not.toHaveBeenCalled();
  });

  it('strictly ignores X-Forwarded-For when trustProxy is false (anti-spoofing)', async () => {
    mockReflector.get.mockReturnValue({ limit: 10, ttl: 60 });
    mockConfigService.trustProxy = false;

    const req = {
      headers: { 'x-forwarded-for': '203.0.113.195' },
      socket: { remoteAddress: '198.51.100.1' },
    };
    const context = createMockContext(req);

    await guard.canActivate(context);
    expect(mockRateLimitService.isAllowed).toHaveBeenCalledWith('rl:198.51.100.1', {
      limit: 10,
      ttl: 60,
    });
  });

  it('respects verified X-Forwarded-For when trustProxy is explicitly true', async () => {
    mockReflector.get.mockReturnValue({ limit: 10, ttl: 60 });
    mockConfigService.trustProxy = true;

    const req = {
      headers: { 'x-forwarded-for': '203.0.113.195, 10.0.0.1' },
      socket: { remoteAddress: '10.0.0.1' },
    };
    const context = createMockContext(req);

    await guard.canActivate(context);
    expect(mockRateLimitService.isAllowed).toHaveBeenCalledWith('rl:203.0.113.195', {
      limit: 10,
      ttl: 60,
    });
  });

  it('throws 429 TooManyRequests with Retry-After header when limit is exceeded', async () => {
    mockReflector.get.mockReturnValue({ limit: 5, ttl: 30 });
    mockRateLimitService.isAllowed.mockResolvedValue(false);

    const headers: Record<string, string> = {};
    const req = { socket: { remoteAddress: '192.0.2.1' } };
    const res = {
      setHeader: vi.fn((name: string, val: string) => {
        headers[name] = val;
      }),
    };
    const context = createMockContext(req, { res });
    (req as any).res = res;

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '30');
  });
});
