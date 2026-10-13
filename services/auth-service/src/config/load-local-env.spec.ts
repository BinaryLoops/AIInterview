import { describe, expect, it } from "vitest";
import { resolveLocalEnvPath } from "./load-local-env.js";

describe("resolveLocalEnvPath", () => {
  it("does not load env files during tests", () => {
    expect(
      resolveLocalEnvPath(process.cwd(), { NODE_ENV: "test" }),
    ).toBeUndefined();
  });

  it("does not load local env files in production", () => {
    expect(
      resolveLocalEnvPath(process.cwd(), { NODE_ENV: "production" }),
    ).toBeUndefined();
  });
});
