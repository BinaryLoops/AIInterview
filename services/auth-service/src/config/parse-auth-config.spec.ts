import { describe, expect, it } from "vitest";
import { AuthConfigService } from "./auth-config.service.js";
import { ConfigValidationError } from "./auth-config.types.js";
import { parseAuthConfig } from "./parse-auth-config.js";

const SECRET = "supersecret-password-do-not-leak";

function expectSafeError(env: NodeJS.ProcessEnv): ConfigValidationError {
  try {
    parseAuthConfig(env);
    throw new Error("expected configuration to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    const message = error instanceof Error ? error.message : "";
    expect(message).not.toContain(SECRET);
    expect(message).not.toMatch(/postgresql:\/\//i);
    return error as ConfigValidationError;
  }
}

describe("parseAuthConfig", () => {
  it("uses local development defaults when integrations are disabled", () => {
    const config = parseAuthConfig({});

    expect(config).toMatchObject({
      nodeEnv: "development",
      host: "127.0.0.1",
      port: 3001,
      appBaseUrl: "http://127.0.0.1:3001",
      database: { enabled: false },
      redis: { enabled: false },
      smtp: { enabled: false, authRequired: false },
    });
  });

  it("parses documented local settings including optional placeholders", () => {
    const config = parseAuthConfig({
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: "3001",
      APP_BASE_URL: "http://127.0.0.1:3001",
      DATABASE_ENABLED: "false",
      DATABASE_URL: "postgresql://arep:arep_dev_only@127.0.0.1:5432/arep_dev",
      REDIS_ENABLED: "false",
      REDIS_HOST: "127.0.0.1",
      REDIS_PORT: "6379",
      REDIS_PASSWORD: SECRET,
      SMTP_ENABLED: "false",
      SMTP_AUTH_REQUIRED: "false",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
    });

    expect(config.database.enabled).toBe(false);
    expect(config.redis.enabled).toBe(false);
    expect(config.redis.password).toBe(SECRET);
    expect(config.smtp.host).toBe("127.0.0.1");
  });

  it("requires database and redis settings only when those integrations are enabled", () => {
    const missing = expectSafeError({
      DATABASE_ENABLED: "true",
      REDIS_ENABLED: "true",
      REDIS_PASSWORD: SECRET,
    });

    expect(missing.issues).toEqual(
      expect.arrayContaining([
        "DATABASE_URL is required when DATABASE_ENABLED=true",
        "REDIS_HOST is required when REDIS_ENABLED=true",
        "REDIS_PORT is required when REDIS_ENABLED=true",
      ]),
    );

    const config = parseAuthConfig({
      DATABASE_ENABLED: "true",
      DATABASE_URL: `postgresql://arep:${SECRET}@127.0.0.1:5432/arep_dev`,
      REDIS_ENABLED: "true",
      REDIS_HOST: "127.0.0.1",
      REDIS_PORT: "6379",
      REDIS_PASSWORD: SECRET,
    });

    expect(config.database.enabled).toBe(true);
    expect(config.redis.enabled).toBe(true);
    expect(config.redis.port).toBe(6379);
  });

  it("rejects invalid ports and malformed values", () => {
    expect(expectSafeError({ PORT: "not-a-port" }).issues).toContain(
      "PORT must be an integer between 1 and 65535",
    );
    expect(expectSafeError({ PORT: "0" }).issues).toContain(
      "PORT must be an integer between 1 and 65535",
    );
    expect(expectSafeError({ PORT: "65536" }).issues).toContain(
      "PORT must be an integer between 1 and 65535",
    );
    expect(expectSafeError({ HOST: "127.0.0.1 extra" }).issues).toContain(
      "HOST must be a hostname or IP address",
    );
  });

  it("rejects malformed URLs without echoing them", () => {
    const database = expectSafeError({
      DATABASE_ENABLED: "true",
      DATABASE_URL: `http://arep:${SECRET}@127.0.0.1:5432/arep_dev`,
    });
    expect(database.issues).toContain(
      "DATABASE_URL must be a postgres connection URL",
    );

    const appBase = expectSafeError({
      APP_BASE_URL: `ftp://user:${SECRET}@example.com`,
    });
    expect(appBase.issues).toContain(
      "APP_BASE_URL must be an http or https URL",
    );
  });

  it("requires SMTP credentials only when SMTP auth is required", () => {
    const missing = expectSafeError({
      SMTP_ENABLED: "true",
      SMTP_AUTH_REQUIRED: "true",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
      SMTP_PASSWORD: SECRET,
    });
    expect(missing.issues).toContain(
      "SMTP_USERNAME is required when SMTP_AUTH_REQUIRED=true",
    );

    const config = parseAuthConfig({
      SMTP_ENABLED: "true",
      SMTP_AUTH_REQUIRED: "false",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
    });
    expect(config.smtp.enabled).toBe(true);
    expect(config.smtp.authRequired).toBe(false);
  });

  it("omits secrets from the public configuration summary", () => {
    const config = parseAuthConfig({
      DATABASE_URL: `postgresql://arep:${SECRET}@127.0.0.1:5432/arep_dev`,
      REDIS_PASSWORD: SECRET,
      SMTP_PASSWORD: SECRET,
    });
    const summary = new AuthConfigService(config).publicSummary();
    const serialized = JSON.stringify(summary);

    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("postgresql://");
    expect(summary).toMatchObject({
      host: "127.0.0.1",
      port: 3001,
      databaseEnabled: false,
      redisEnabled: false,
    });
  });

  it("parses validated session refresh token TTL settings", () => {
    const config = parseAuthConfig({
      SESSION_REFRESH_TOKEN_TTL_DAYS: "14",
    });
    expect(config.session.refreshTokenTtlDays).toBe(14);

    const invalid = expectSafeError({
      SESSION_REFRESH_TOKEN_TTL_DAYS: "not-a-number",
    });
    expect(invalid.issues).toContain(
      "SESSION_REFRESH_TOKEN_TTL_DAYS must be an integer between 1 and 65535",
    );
  });

  describe("JWT access-token configuration", () => {
    it("uses safe development defaults when JWT settings are omitted in dev/test", () => {
      const config = parseAuthConfig({});
      expect(config.jwt).toMatchObject({
        secret: "dev_jwt_secret_placeholder_at_least_32_characters_long",
        expiresInSeconds: 900,
        issuer: "arep-auth-service",
        audience: "arep-api",
      });
    });

    it("parses custom JWT options in development", () => {
      const config = parseAuthConfig({
        JWT_SECRET: "custom_jwt_secret_at_least_32_characters_long_12345",
        JWT_EXPIRES_IN_SECONDS: "1800",
        JWT_ISSUER: "custom-issuer",
        JWT_AUDIENCE: "custom-audience",
      });
      expect(config.jwt.expiresInSeconds).toBe(1800);
      expect(config.jwt.issuer).toBe("custom-issuer");
      expect(config.jwt.audience).toBe("custom-audience");
    });

    it("fails production startup if JWT_SECRET is missing", () => {
      const error = expectSafeError({
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3001",
        APP_BASE_URL: "http://127.0.0.1:3001",
        OTP_HMAC_SECRET: "prod_otp_secret_at_least_32_characters_long_12345",
      });
      expect(error.issues).toContain("JWT_SECRET is required in production");
    });

    it("fails production startup if JWT_SECRET is shorter than 32 characters", () => {
      const error = expectSafeError({
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3001",
        APP_BASE_URL: "http://127.0.0.1:3001",
        OTP_HMAC_SECRET: "prod_otp_secret_at_least_32_characters_long_12345",
        JWT_SECRET: "too-short-secret",
      });
      expect(error.issues).toContain("JWT_SECRET must be at least 32 characters long");
    });

    it("fails production startup if JWT_SECRET uses the default dev placeholder", () => {
      const error = expectSafeError({
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3001",
        APP_BASE_URL: "http://127.0.0.1:3001",
        OTP_HMAC_SECRET: "prod_otp_secret_at_least_32_characters_long_12345",
        JWT_SECRET: "dev_jwt_secret_placeholder_at_least_32_characters_long",
      });
      expect(error.issues).toContain(
        "JWT_SECRET must not use the default development placeholder in production",
      );
    });

    it("parses TRUST_PROXY boolean setting correctly", () => {
      const configTrue = parseAuthConfig({ TRUST_PROXY: "true" });
      expect(configTrue.trustProxy).toBe(true);

      const configFalse = parseAuthConfig({ TRUST_PROXY: "false" });
      expect(configFalse.trustProxy).toBe(false);

      const configDefault = parseAuthConfig({});
      expect(configDefault.trustProxy).toBe(false);

      const error = expectSafeError({ TRUST_PROXY: "not-a-boolean" });
      expect(error.issues).toContain("TRUST_PROXY must be a boolean");
    });
  });

  describe("Production Deployment Readiness and Security Hardening", () => {
    const VALID_PROD_ENV: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      HOST: "0.0.0.0",
      PORT: "3001",
      APP_BASE_URL: "https://auth.arep.ai",
      TRUST_PROXY: "true",
      DATABASE_ENABLED: "true",
      DATABASE_URL: "postgresql://arep_prod_user:a8Fj20vK91msL0294vkm@db.internal:5432/arep_prod",
      REDIS_ENABLED: "true",
      REDIS_HOST: "redis.internal",
      REDIS_PORT: "6379",
      REDIS_PASSWORD: "r83vN19sKmv82910fmvLskf0923",
      OTP_HMAC_SECRET: "9f82kdmv0192jfkms01923kfmv01923kfmv01923",
      JWT_SECRET: "a982kfmv01923kfmv01923kfmv01923kfmv0192348",
      CORS_ALLOWED_ORIGINS: "https://app.arep.ai,https://admin.arep.ai",
    };

    it("accepts a fully compliant, production-hardened configuration", () => {
      const config = parseAuthConfig(VALID_PROD_ENV);
      expect(config.nodeEnv).toBe("production");
      expect(config.appBaseUrl).toBe("https://auth.arep.ai");
      expect(config.trustProxy).toBe(true);
      expect(config.database.enabled).toBe(true);
      expect(config.redis.enabled).toBe(true);
      expect(config.corsAllowedOrigins).toEqual([
        "https://app.arep.ai",
        "https://admin.arep.ai",
      ]);

      const service = new AuthConfigService(config);
      expect(service.isAllowedOrigin("https://app.arep.ai")).toBe(true);
      expect(service.isAllowedOrigin("https://admin.arep.ai")).toBe(true);
      expect(service.isAllowedOrigin("https://auth.arep.ai")).toBe(true);
      // Untrusted origins rejected in production
      expect(service.isAllowedOrigin("http://localhost:3000")).toBe(false);
      expect(service.isAllowedOrigin("https://malicious.evil.com")).toBe(false);
    });

    it("fails production startup if database is disabled or missing in production", () => {
      const missingDb = expectSafeError({
        ...VALID_PROD_ENV,
        DATABASE_ENABLED: "false",
      });
      expect(missingDb.issues).toContain("DATABASE_ENABLED must be true in production");

      const omittedDb = expectSafeError({
        ...VALID_PROD_ENV,
        DATABASE_ENABLED: undefined,
      });
      expect(omittedDb.issues).toContain("DATABASE_ENABLED must be true in production");
    });

    it("fails production startup if database URL contains dev placeholder credentials", () => {
      const devDbUrl = expectSafeError({
        ...VALID_PROD_ENV,
        DATABASE_URL: "postgresql://arep:arep_dev_only@127.0.0.1:5432/arep_dev",
      });
      expect(devDbUrl.issues).toContain(
        "DATABASE_URL must not use development placeholder credentials in production",
      );
    });

    it("fails production startup if Redis is disabled or missing in production", () => {
      const missingRedis = expectSafeError({
        ...VALID_PROD_ENV,
        REDIS_ENABLED: "false",
      });
      expect(missingRedis.issues).toContain(
        "REDIS_ENABLED must be true in production to ensure distributed revocation and rate limiting",
      );

      const omittedRedis = expectSafeError({
        ...VALID_PROD_ENV,
        REDIS_ENABLED: undefined,
      });
      expect(omittedRedis.issues).toContain(
        "REDIS_ENABLED must be true in production to ensure distributed revocation and rate limiting",
      );
    });

    it("fails production startup if Redis password is missing or placeholder", () => {
      const missingPw = expectSafeError({
        ...VALID_PROD_ENV,
        REDIS_PASSWORD: undefined,
      });
      expect(missingPw.issues).toContain("REDIS_PASSWORD is required in production");

      const devPw = expectSafeError({
        ...VALID_PROD_ENV,
        REDIS_PASSWORD: "arep_redis_dev_only",
      });
      expect(devPw.issues).toContain(
        "REDIS_PASSWORD must not use development placeholder credentials in production",
      );
    });

    it("fails production startup if OTP_HMAC_SECRET is missing, weak, or placeholder", () => {
      const missing = expectSafeError({
        ...VALID_PROD_ENV,
        OTP_HMAC_SECRET: undefined,
      });
      expect(missing.issues).toContain("OTP_HMAC_SECRET is required in production");

      const short = expectSafeError({
        ...VALID_PROD_ENV,
        OTP_HMAC_SECRET: "too-short",
      });
      expect(short.issues).toContain("OTP_HMAC_SECRET must be at least 32 characters long");

      const devDefault = expectSafeError({
        ...VALID_PROD_ENV,
        OTP_HMAC_SECRET: "dev_otp_hmac_secret_placeholder_at_least_32_characters_long",
      });
      expect(devDefault.issues).toContain(
        "OTP_HMAC_SECRET must not use development placeholders or weak secrets in production",
      );

      const weakPlaceholder = expectSafeError({
        ...VALID_PROD_ENV,
        OTP_HMAC_SECRET: "my-secret-key-changeme-1234567890abcdef",
      });
      expect(weakPlaceholder.issues).toContain(
        "OTP_HMAC_SECRET must not use development placeholders or weak secrets in production",
      );
    });

    it("fails production startup if JWT_SECRET contains weak placeholders", () => {
      const weakJwt = expectSafeError({
        ...VALID_PROD_ENV,
        JWT_SECRET: "my-super-secret-changeme-1234567890abcdef",
      });
      expect(weakJwt.issues).toContain(
        "JWT_SECRET must not use placeholders or weak secrets in production",
      );
    });

    it("fails production startup if APP_BASE_URL does not use https", () => {
      const httpBase = expectSafeError({
        ...VALID_PROD_ENV,
        APP_BASE_URL: "http://auth.arep.ai",
      });
      expect(httpBase.issues).toContain("APP_BASE_URL must use https:// in production");
    });

    it("fails production startup if CORS_ALLOWED_ORIGINS is missing", () => {
      const missingCors = expectSafeError({
        ...VALID_PROD_ENV,
        CORS_ALLOWED_ORIGINS: undefined,
      });
      expect(missingCors.issues).toContain("CORS_ALLOWED_ORIGINS is required in production");
    });

    it("fails startup if CORS_ALLOWED_ORIGINS contains wildcard '*'", () => {
      const wildcardCors = expectSafeError({
        ...VALID_PROD_ENV,
        CORS_ALLOWED_ORIGINS: "*",
      });
      expect(wildcardCors.issues).toContain(
        "CORS_ALLOWED_ORIGINS cannot contain wildcard '*' when credentials are enabled",
      );
    });

    it("fails production startup if CORS_ALLOWED_ORIGINS contains unencrypted http origins", () => {
      const httpCors = expectSafeError({
        ...VALID_PROD_ENV,
        CORS_ALLOWED_ORIGINS: "http://app.arep.ai",
      });
      expect(httpCors.issues).toContain("CORS_ALLOWED_ORIGINS must use https:// in production");
    });

    it("fails production startup if CORS_ALLOWED_ORIGINS allows localhost or 127.0.0.1", () => {
      const localhostCors = expectSafeError({
        ...VALID_PROD_ENV,
        CORS_ALLOWED_ORIGINS: "https://localhost:3000",
      });
      expect(localhostCors.issues).toContain(
        "CORS_ALLOWED_ORIGINS cannot allow localhost or 127.0.0.1 in production",
      );
    });

    it("fails startup if CORS_ALLOWED_ORIGINS contains path components or credentials", () => {
      const pathCors = expectSafeError({
        ...VALID_PROD_ENV,
        CORS_ALLOWED_ORIGINS: "https://app.arep.ai/subpath",
      });
      expect(pathCors.issues).toContain(
        "CORS origin 'https://app.arep.ai/subpath' must not contain a path component",
      );

      const credsCors = expectSafeError({
        ...VALID_PROD_ENV,
        CORS_ALLOWED_ORIGINS: "https://user:pass@app.arep.ai",
      });
      expect(credsCors.issues).toContain(
        "CORS origin 'https://user:pass@app.arep.ai' must not contain URL credentials",
      );
    });
  });
});

