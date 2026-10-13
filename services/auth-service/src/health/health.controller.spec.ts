import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";
import { HealthController } from "./health.controller.js";
import { HealthModule } from "./health.module.js";

describe("HealthController", () => {
  it("reports service health", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();
    const controller = moduleRef.get(HealthController);

    expect(controller.health()).toEqual({
      status: "ok",
      service: "auth-service",
    });
  });

  it("reports process readiness without claiming database or Redis", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();
    const controller = moduleRef.get(HealthController);
    const body = await controller.ready();

    expect(body).toEqual({
      status: "ready",
      service: "auth-service",
      checks: {
        process: "up",
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/postgres|redis|database/i);
  });

  it("reports readiness and up status when database is enabled and healthy", async () => {
    const mockPrisma = { isHealthy: () => Promise.resolve(true) };
    const mockRedis = { isHealthy: () => Promise.resolve(false) };
    const mockConfig = {
      snapshot: {
        database: { enabled: true },
        redis: { enabled: false },
      },
    };

    const controller = new HealthController(mockPrisma as any, mockConfig as any, mockRedis as any);
    const res = { status: vi.fn() };
    const body = await controller.ready(res);

    expect(body.status).toBe("ready");
    expect(body.checks.database).toBe("up");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("reports not_ready and sets HTTP 503 when database is enabled but unhealthy", async () => {
    const mockPrisma = { isHealthy: () => Promise.resolve(false) };
    const mockRedis = { isHealthy: () => Promise.resolve(false) };
    const mockConfig = {
      snapshot: {
        database: { enabled: true },
        redis: { enabled: false },
      },
    };

    const controller = new HealthController(mockPrisma as any, mockConfig as any, mockRedis as any);
    const res = { status: vi.fn() };
    const body = await controller.ready(res);

    expect(body.status).toBe("not_ready");
    expect(body.checks.database).toBe("down");
    expect(res.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("postgresql://");
  });

  it("reports not_ready and sets HTTP 503 when redis is enabled but unhealthy", async () => {
    const mockPrisma = { isHealthy: () => Promise.resolve(true) };
    const mockRedis = { isHealthy: () => Promise.resolve(false) };
    const mockConfig = {
      snapshot: {
        database: { enabled: true },
        redis: { enabled: true },
      },
    };

    const controller = new HealthController(mockPrisma as any, mockConfig as any, mockRedis as any);
    const res = { status: vi.fn() };
    const body = await controller.ready(res);

    expect(body.status).toBe("not_ready");
    expect(body.checks.database).toBe("up");
    expect(body.checks.redis).toBe("down");
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
