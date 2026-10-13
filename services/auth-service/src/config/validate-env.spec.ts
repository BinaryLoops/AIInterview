import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseEnvFileContent,
  runValidationCli,
  validateEnvFile,
  validateEnvironment,
} from "./validate-env.js";

const SECRET_PASSWORD = "supersecret-database-password-do-not-leak-12345";
const REDIS_SECRET = "supersecret-redis-password-do-not-leak-67890";
const JWT_SECRET_VAL = "cryptographically-strong-jwt-secret-at-least-32-chars-long";
const OTP_SECRET_VAL = "cryptographically-strong-otp-secret-at-least-32-chars-long";

const VALID_PROD_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  PORT: "3001",
  APP_BASE_URL: "https://auth.arep.ai",
  TRUST_PROXY: "true",
  DATABASE_ENABLED: "true",
  DATABASE_URL: `postgresql://arep_prod_user:${SECRET_PASSWORD}@db.internal:5432/arep_prod`,
  REDIS_ENABLED: "true",
  REDIS_HOST: "redis.internal",
  REDIS_PORT: "6379",
  REDIS_PASSWORD: REDIS_SECRET,
  OTP_HMAC_SECRET: OTP_SECRET_VAL,
  JWT_SECRET: JWT_SECRET_VAL,
  CORS_ALLOWED_ORIGINS: "https://app.arep.ai,https://admin.arep.ai",
};

describe("validateEnvironment", () => {
  it("passes compliant production configuration without external network connections", () => {
    const result = validateEnvironment(VALID_PROD_ENV);

    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.summary).toBeDefined();
    expect(result.summary).toMatchObject({
      nodeEnv: "production",
      host: "0.0.0.0",
      port: 3001,
      appBaseUrl: "https://auth.arep.ai",
      trustProxy: true,
      databaseEnabled: true,
      redisEnabled: true,
    });
    // Ensure secrets are never in the returned summary
    const serialized = JSON.stringify(result.summary);
    expect(serialized).not.toContain(SECRET_PASSWORD);
    expect(serialized).not.toContain(REDIS_SECRET);
    expect(serialized).not.toContain(JWT_SECRET_VAL);
    expect(serialized).not.toContain(OTP_SECRET_VAL);
  });

  it("passes development defaults when external integrations are disabled", () => {
    const result = validateEnvironment({});

    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.summary?.nodeEnv).toBe("development");
    expect(result.summary?.databaseEnabled).toBe(false);
    expect(result.summary?.redisEnabled).toBe(false);
  });

  describe("Production security failures", () => {
    it("fails when JWT_SECRET is missing", () => {
      const result = validateEnvironment({
        ...VALID_PROD_ENV,
        JWT_SECRET: undefined,
      });
      expect(result.success).toBe(false);
      expect(result.issues).toContain("JWT_SECRET is required in production");
    });

    it("fails when JWT_SECRET is too short or weak placeholder", () => {
      const shortRes = validateEnvironment({
        ...VALID_PROD_ENV,
        JWT_SECRET: "short-secret",
      });
      expect(shortRes.success).toBe(false);
      expect(shortRes.issues).toContain("JWT_SECRET must be at least 32 characters long");

      const placeholderRes = validateEnvironment({
        ...VALID_PROD_ENV,
        JWT_SECRET: "super-secret-changeme-key-1234567890abcdef",
      });
      expect(placeholderRes.success).toBe(false);
      expect(placeholderRes.issues).toContain(
        "JWT_SECRET must not use placeholders or weak secrets in production",
      );

      const templateTokenRes = validateEnvironment({
        ...VALID_PROD_ENV,
        JWT_SECRET: "<REQUIRED_CRYPTOGRAPHIC_RANDOM_SECRET_MIN_32_CHARS>",
      });
      expect(templateTokenRes.success).toBe(false);
      expect(templateTokenRes.issues).toContain(
        "JWT_SECRET must not use placeholders or weak secrets in production",
      );
    });

    it("fails when OTP_HMAC_SECRET is missing, weak, or placeholder", () => {
      const missingRes = validateEnvironment({
        ...VALID_PROD_ENV,
        OTP_HMAC_SECRET: undefined,
      });
      expect(missingRes.success).toBe(false);
      expect(missingRes.issues).toContain("OTP_HMAC_SECRET is required in production");

      const devPlaceholderRes = validateEnvironment({
        ...VALID_PROD_ENV,
        OTP_HMAC_SECRET: "dev_otp_hmac_secret_placeholder_at_least_32_characters_long",
      });
      expect(devPlaceholderRes.success).toBe(false);
      expect(devPlaceholderRes.issues).toContain(
        "OTP_HMAC_SECRET must not use development placeholders or weak secrets in production",
      );

      const templateTokenRes = validateEnvironment({
        ...VALID_PROD_ENV,
        OTP_HMAC_SECRET: "<REQUIRED_CRYPTOGRAPHIC_RANDOM_SECRET_MIN_32_CHARS>",
      });
      expect(templateTokenRes.success).toBe(false);
      expect(templateTokenRes.issues).toContain(
        "OTP_HMAC_SECRET must not use development placeholders or weak secrets in production",
      );
    });

    it("fails when PostgreSQL is disabled in production", () => {
      const result = validateEnvironment({
        ...VALID_PROD_ENV,
        DATABASE_ENABLED: "false",
      });
      expect(result.success).toBe(false);
      expect(result.issues).toContain("DATABASE_ENABLED must be true in production");
    });

    it("fails when DATABASE_URL is missing or uses development placeholder credentials", () => {
      const missingRes = validateEnvironment({
        ...VALID_PROD_ENV,
        DATABASE_URL: undefined,
      });
      expect(missingRes.success).toBe(false);
      expect(missingRes.issues).toContain(
        "DATABASE_URL is required when DATABASE_ENABLED=true",
      );

      const devCredsRes = validateEnvironment({
        ...VALID_PROD_ENV,
        DATABASE_URL: "postgresql://arep:arep_dev_only@127.0.0.1:5432/arep_dev",
      });
      expect(devCredsRes.success).toBe(false);
      expect(devCredsRes.issues).toContain(
        "DATABASE_URL must not use development placeholder credentials in production",
      );
    });

    it("fails when DATABASE_URL is malformed", () => {
      const result = validateEnvironment({
        ...VALID_PROD_ENV,
        DATABASE_URL: "not-a-valid-url",
      });
      expect(result.success).toBe(false);
      expect(result.issues).toContain(
        "DATABASE_URL must be a postgres connection URL",
      );
    });

    it("fails when Redis is disabled in production", () => {
      const result = validateEnvironment({
        ...VALID_PROD_ENV,
        REDIS_ENABLED: "false",
      });
      expect(result.success).toBe(false);
      expect(result.issues).toContain(
        "REDIS_ENABLED must be true in production to ensure distributed revocation and rate limiting",
      );
    });

    it("fails when REDIS_PASSWORD is missing or placeholder", () => {
      const missingRes = validateEnvironment({
        ...VALID_PROD_ENV,
        REDIS_PASSWORD: undefined,
      });
      expect(missingRes.success).toBe(false);
      expect(missingRes.issues).toContain("REDIS_PASSWORD is required in production");

      const devCredsRes = validateEnvironment({
        ...VALID_PROD_ENV,
        REDIS_PASSWORD: "arep_redis_dev_only",
      });
      expect(devCredsRes.success).toBe(false);
      expect(devCredsRes.issues).toContain(
        "REDIS_PASSWORD must not use development placeholder credentials in production",
      );

      const templateTokenRes = validateEnvironment({
        ...VALID_PROD_ENV,
        REDIS_PASSWORD: "<REQUIRED_REDIS_PASSWORD>",
      });
      expect(templateTokenRes.success).toBe(false);
      expect(templateTokenRes.issues).toContain(
        "REDIS_PASSWORD must not use development placeholder credentials in production",
      );
    });

    it("fails when CORS_ALLOWED_ORIGINS is missing, wildcard, or allows localhost in production", () => {
      const missingRes = validateEnvironment({
        ...VALID_PROD_ENV,
        CORS_ALLOWED_ORIGINS: undefined,
      });
      expect(missingRes.success).toBe(false);
      expect(missingRes.issues).toContain("CORS_ALLOWED_ORIGINS is required in production");

      const wildcardRes = validateEnvironment({
        ...VALID_PROD_ENV,
        CORS_ALLOWED_ORIGINS: "*",
      });
      expect(wildcardRes.success).toBe(false);
      expect(wildcardRes.issues).toContain(
        "CORS_ALLOWED_ORIGINS cannot contain wildcard '*' when credentials are enabled",
      );

      const localhostRes = validateEnvironment({
        ...VALID_PROD_ENV,
        CORS_ALLOWED_ORIGINS: "https://localhost:3000",
      });
      expect(localhostRes.success).toBe(false);
      expect(localhostRes.issues).toContain(
        "CORS_ALLOWED_ORIGINS cannot allow localhost or 127.0.0.1 in production",
      );

      const httpRes = validateEnvironment({
        ...VALID_PROD_ENV,
        CORS_ALLOWED_ORIGINS: "http://app.arep.ai",
      });
      expect(httpRes.success).toBe(false);
      expect(httpRes.issues).toContain("CORS_ALLOWED_ORIGINS must use https:// in production");
    });

    it("fails when PORT or REDIS_PORT is out of range or non-integer", () => {
      expect(
        validateEnvironment({ ...VALID_PROD_ENV, PORT: "99999" }).issues,
      ).toContain("PORT must be an integer between 1 and 65535");

      expect(
        validateEnvironment({ ...VALID_PROD_ENV, PORT: "abc" }).issues,
      ).toContain("PORT must be an integer between 1 and 65535");

      expect(
        validateEnvironment({ ...VALID_PROD_ENV, REDIS_PORT: "0" }).issues,
      ).toContain("REDIS_PORT must be an integer between 1 and 65535");
    });

    it("fails when TRUST_PROXY is an invalid non-boolean value", () => {
      const result = validateEnvironment({
        ...VALID_PROD_ENV,
        TRUST_PROXY: "not-a-boolean",
      });
      expect(result.success).toBe(false);
      expect(result.issues).toContain("TRUST_PROXY must be a boolean");
    });

    it("fails when APP_BASE_URL is unencrypted HTTP in production", () => {
      const result = validateEnvironment({
        ...VALID_PROD_ENV,
        APP_BASE_URL: "http://auth.arep.ai",
      });
      expect(result.success).toBe(false);
      expect(result.issues).toContain("APP_BASE_URL must use https:// in production");
    });
  });
});

describe("validateEnvFile & production template validation", () => {
  it("confirms .env.production.example template is non-runnable until placeholders are replaced", () => {
    const examplePath = path.resolve(process.cwd(), "../../.env.production.example");
    const targetPath = fs.existsSync(examplePath)
      ? examplePath
      : path.resolve(process.cwd(), ".env.production.example");

    expect(fs.existsSync(targetPath)).toBe(true);

    const result = validateEnvFile(targetPath);
    expect(result.success).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    // Explicitly check that template angle bracket placeholders fail validation
    expect(
      result.issues.some((i) => i.includes("DATABASE_URL") || i.includes("placeholder") || i.includes("CORS")),
    ).toBe(true);
  });

  it("returns error issue if target environment file does not exist", () => {
    const result = validateEnvFile("non-existent-file-path.env");
    expect(result.success).toBe(false);
    expect(result.issues[0]).toContain("Environment file not found");
  });

  it("parses raw env file content accurately without mutating process.env", () => {
    const sample = `
# Comment line
NODE_ENV=production
PORT=3001
QUOTED="quoted-value"
SINGLE_QUOTED='single-value'
`;
    const parsed = parseEnvFileContent(sample);
    expect(parsed).toEqual({
      NODE_ENV: "production",
      PORT: "3001",
      QUOTED: "quoted-value",
      SINGLE_QUOTED: "single-value",
    });
  });
});

describe("runValidationCli secrecy invariant", () => {
  it("never prints secrets or database connection strings to stdout/stderr on success", () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const mockLogger = {
      log: (msg: string) => logs.push(msg),
      error: (msg: string) => errors.push(msg),
    };

    const code = runValidationCli(VALID_PROD_ENV, mockLogger);

    expect(code).toBe(0);
    const combinedOutput = [...logs, ...errors].join("\n");
    expect(combinedOutput).not.toContain(SECRET_PASSWORD);
    expect(combinedOutput).not.toContain(REDIS_SECRET);
    expect(combinedOutput).not.toContain(JWT_SECRET_VAL);
    expect(combinedOutput).not.toContain(OTP_SECRET_VAL);
    expect(combinedOutput).not.toContain("postgresql://");
  });

  it("never prints secrets or database connection strings to stdout/stderr on failure", () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const mockLogger = {
      log: (msg: string) => logs.push(msg),
      error: (msg: string) => errors.push(msg),
    };

    const code = runValidationCli(
      {
        ...VALID_PROD_ENV,
        DATABASE_ENABLED: "false",
      },
      mockLogger,
    );

    expect(code).toBe(1);
    const combinedOutput = [...logs, ...errors].join("\n");
    expect(combinedOutput).not.toContain(SECRET_PASSWORD);
    expect(combinedOutput).not.toContain(REDIS_SECRET);
    expect(combinedOutput).not.toContain("postgresql://");
  });
});
