import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { AppModule } from "./app.module.js";
import { HealthController } from "./health/health.controller.js";

describe("AppModule", () => {
  it("boots the HTTP application module", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    await app.init();

    const controller = app.get(HealthController);
    expect(controller.health().status).toBe("ok");

    await app.close();
  });
});
