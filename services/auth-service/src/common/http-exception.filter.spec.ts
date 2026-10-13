import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { GlobalExceptionFilter } from "./http-exception.filter.js";

function createHost(path = "/health") {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));

  return {
    json,
    status,
    host: {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: "GET", path }),
      }),
    },
  };
}

describe("GlobalExceptionFilter", () => {
  it("serializes HTTP exceptions without leaking request bodies", () => {
    const filter = new GlobalExceptionFilter();
    const { host, json, status } = createHost("/health");

    filter.catch(new BadRequestException("Invalid payload"), host as never);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      error: "Invalid payload",
      path: "/health",
    });
  });

  it("hides unknown error details", () => {
    const filter = new GlobalExceptionFilter();
    const { host, json, status } = createHost("/ready");

    filter.catch(new Error("secret database password xyz"), host as never);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      error: "Internal server error",
      path: "/ready",
    });
  });
});
