import {
  type AuthConfig,
  ConfigValidationError,
  type NodeEnv,
} from "./auth-config.types.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3001;
const NODE_ENVS = new Set<NodeEnv>(["development", "test", "production"]);

const DEV_PLACEHOLDER_SUBSTRINGS = [
  "placeholder",
  "changeme",
  "change_me",
  "replace_me",
  "replace-me",
  "your-secret",
  "your_secret",
  "dev_otp",
  "dev_jwt",
  "secret123",
  "example",
  "required",
  "<",
  ">",
];

function isWeakOrPlaceholderSecret(val: string): boolean {
  if (val.length < 32) {
    return true;
  }
  const lower = val.toLowerCase();
  for (const sub of DEV_PLACEHOLDER_SUBSTRINGS) {
    if (lower.includes(sub)) {
      return true;
    }
  }
  const unique = new Set(val);
  if (unique.size < 6) {
    return true;
  }
  return false;
}

function readOptional(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readBoolean(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: boolean,
): boolean | string {
  const raw = readOptional(env, key);
  if (raw === undefined) {
    return fallback;
  }
  const normalized = raw.toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return `${key} must be a boolean`;
}

function readPort(
  raw: string | undefined,
  field: string,
  fallback?: number,
): number | string {
  if (raw === undefined) {
    if (fallback === undefined) {
      return `${field} is required`;
    }
    return fallback;
  }
  if (!/^[0-9]+$/.test(raw)) {
    return `${field} must be an integer between 1 and 65535`;
  }
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return `${field} must be an integer between 1 and 65535`;
  }
  return port;
}

function hasUrlCredentials(url: URL): boolean {
  return url.username.length > 0 || url.password.length > 0;
}

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "postgres:" || url.protocol === "postgresql:";
  } catch {
    return false;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !hasUrlCredentials(url)
    );
  } catch {
    return false;
  }
}

export function parseAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const issues: string[] = [];

  const nodeEnvRaw = readOptional(env, "NODE_ENV") ?? "development";
  if (!NODE_ENVS.has(nodeEnvRaw as NodeEnv)) {
    issues.push("NODE_ENV must be development, test, or production");
  }
  const nodeEnv = (
    NODE_ENVS.has(nodeEnvRaw as NodeEnv) ? nodeEnvRaw : "development"
  ) as NodeEnv;

  const host = readOptional(env, "HOST") ?? DEFAULT_HOST;
  if (host.includes(" ") || host.includes("\t")) {
    issues.push("HOST must be a hostname or IP address");
  }

  const port = readPort(readOptional(env, "PORT"), "PORT", DEFAULT_PORT);
  if (typeof port === "string") {
    issues.push(port);
  }

  const resolvedPort = typeof port === "number" ? port : DEFAULT_PORT;
  const appBaseUrl =
    readOptional(env, "APP_BASE_URL") ?? `http://127.0.0.1:${resolvedPort}`;
  if (!isHttpUrl(appBaseUrl)) {
    issues.push("APP_BASE_URL must be an http or https URL");
  } else if (nodeEnv === "production" && !appBaseUrl.startsWith("https://")) {
    issues.push("APP_BASE_URL must use https:// in production");
  }

  const trustProxyParsed = readBoolean(env, "TRUST_PROXY", false);
  if (typeof trustProxyParsed === "string") {
    issues.push(trustProxyParsed);
  }
  const trustProxy = trustProxyParsed === true;

  const corsAllowedOriginsRaw = readOptional(env, "CORS_ALLOWED_ORIGINS");
  const parsedCorsOrigins: string[] = [];

  if (corsAllowedOriginsRaw !== undefined) {
    const rawList = corsAllowedOriginsRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const origin of rawList) {
      if (origin === "*") {
        issues.push(
          "CORS_ALLOWED_ORIGINS cannot contain wildcard '*' when credentials are enabled",
        );
        continue;
      }
      try {
        const u = new URL(origin);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          issues.push(`CORS origin '${origin}' must use http: or https: scheme`);
        } else if (hasUrlCredentials(u)) {
          issues.push(`CORS origin '${origin}' must not contain URL credentials`);
        } else if (u.pathname !== "/" && u.pathname !== "") {
          issues.push(`CORS origin '${origin}' must not contain a path component`);
        } else {
          parsedCorsOrigins.push(u.origin);
        }
      } catch {
        issues.push(`CORS origin '${origin}' is not a valid URL`);
      }
    }
  }

  if (nodeEnv === "production") {
    if (corsAllowedOriginsRaw === undefined || parsedCorsOrigins.length === 0) {
      issues.push("CORS_ALLOWED_ORIGINS is required in production");
    } else {
      for (const origin of parsedCorsOrigins) {
        if (!origin.startsWith("https://")) {
          issues.push("CORS_ALLOWED_ORIGINS must use https:// in production");
        }
        try {
          const u = new URL(origin);
          if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
            issues.push(
              "CORS_ALLOWED_ORIGINS cannot allow localhost or 127.0.0.1 in production",
            );
          }
        } catch {}
      }
    }
  } else {
    if (parsedCorsOrigins.length === 0) {
      parsedCorsOrigins.push(
        appBaseUrl,
        "http://localhost:3000",
        "http://127.0.0.1:3000",
      );
    }
  }

  const databaseEnabled = readBoolean(env, "DATABASE_ENABLED", false);
  if (typeof databaseEnabled === "string") {
    issues.push(databaseEnabled);
  }
  const databaseUrl = readOptional(env, "DATABASE_URL");
  if (nodeEnv === "production") {
    if (databaseEnabled !== true) {
      issues.push("DATABASE_ENABLED must be true in production");
    }
    if (databaseUrl === undefined) {
      issues.push("DATABASE_URL is required when DATABASE_ENABLED=true");
    } else if (!isPostgresUrl(databaseUrl)) {
      issues.push("DATABASE_URL must be a postgres connection URL");
    } else if (databaseUrl.includes("arep_dev_only")) {
      issues.push(
        "DATABASE_URL must not use development placeholder credentials in production",
      );
    }
  } else {
    if (databaseEnabled === true) {
      if (databaseUrl === undefined) {
        issues.push("DATABASE_URL is required when DATABASE_ENABLED=true");
      } else if (!isPostgresUrl(databaseUrl)) {
        issues.push("DATABASE_URL must be a postgres connection URL");
      }
    } else if (databaseUrl !== undefined && !isPostgresUrl(databaseUrl)) {
      issues.push("DATABASE_URL must be a postgres connection URL");
    }
  }

  const redisEnabled = readBoolean(env, "REDIS_ENABLED", false);
  if (typeof redisEnabled === "string") {
    issues.push(redisEnabled);
  }
  const redisHost = readOptional(env, "REDIS_HOST");
  const redisPort = readOptional(env, "REDIS_PORT");
  const redisPassword = readOptional(env, "REDIS_PASSWORD");
  let parsedRedisPort: number | undefined;

  if (nodeEnv === "production") {
    if (redisEnabled !== true) {
      issues.push(
        "REDIS_ENABLED must be true in production to ensure distributed revocation and rate limiting",
      );
    }
    if (redisHost === undefined) {
      issues.push("REDIS_HOST is required when REDIS_ENABLED=true");
    }
    const parsed = readPort(redisPort, "REDIS_PORT");
    if (typeof parsed === "string") {
      issues.push(
        redisPort === undefined
          ? "REDIS_PORT is required when REDIS_ENABLED=true"
          : parsed,
      );
    } else {
      parsedRedisPort = parsed;
    }
    if (redisPassword === undefined) {
      issues.push("REDIS_PASSWORD is required in production");
    } else if (
      redisPassword === "arep_redis_dev_only" ||
      redisPassword.toLowerCase().includes("placeholder") ||
      redisPassword.toLowerCase().includes("required") ||
      redisPassword.includes("<")
    ) {
      issues.push(
        "REDIS_PASSWORD must not use development placeholder credentials in production",
      );
    }
  } else {
    if (redisEnabled === true) {
      if (redisHost === undefined) {
        issues.push("REDIS_HOST is required when REDIS_ENABLED=true");
      }
      const parsed = readPort(redisPort, "REDIS_PORT");
      if (typeof parsed === "string") {
        issues.push(
          redisPort === undefined
            ? "REDIS_PORT is required when REDIS_ENABLED=true"
            : parsed,
        );
      } else {
        parsedRedisPort = parsed;
      }
    } else if (redisPort !== undefined) {
      const parsed = readPort(redisPort, "REDIS_PORT");
      if (typeof parsed === "string") {
        issues.push(parsed);
      } else {
        parsedRedisPort = parsed;
      }
    }
  }

  const smtpEnabled = readBoolean(env, "SMTP_ENABLED", false);
  const smtpAuthRequired = readBoolean(env, "SMTP_AUTH_REQUIRED", false);
  if (typeof smtpEnabled === "string") {
    issues.push(smtpEnabled);
  }
  if (typeof smtpAuthRequired === "string") {
    issues.push(smtpAuthRequired);
  }
  const smtpHost = readOptional(env, "SMTP_HOST");
  const smtpPortRaw = readOptional(env, "SMTP_PORT");
  const smtpUsername = readOptional(env, "SMTP_USERNAME");
  const smtpPassword = readOptional(env, "SMTP_PASSWORD");
  let parsedSmtpPort: number | undefined;
  if (smtpEnabled === true) {
    if (smtpHost === undefined) {
      issues.push("SMTP_HOST is required when SMTP_ENABLED=true");
    }
    const parsed = readPort(smtpPortRaw, "SMTP_PORT");
    if (typeof parsed === "string") {
      issues.push(
        smtpPortRaw === undefined
          ? "SMTP_PORT is required when SMTP_ENABLED=true"
          : parsed,
      );
    } else {
      parsedSmtpPort = parsed;
    }
  } else if (smtpPortRaw !== undefined) {
    const parsed = readPort(smtpPortRaw, "SMTP_PORT");
    if (typeof parsed === "string") {
      issues.push(parsed);
    } else {
      parsedSmtpPort = parsed;
    }
  }
  const smtpSecure = readBoolean(env, "SMTP_SECURE", false);
  if (typeof smtpSecure === "string") {
    issues.push(smtpSecure);
  }
  const smtpFrom = readOptional(env, "SMTP_FROM") ?? "AREP <noreply@arep.local>";
  const smtpTimeoutMsParsed = readPort(
    readOptional(env, "SMTP_TIMEOUT_MS"),
    "SMTP_TIMEOUT_MS",
    5000,
  );
  if (typeof smtpTimeoutMsParsed === "string") {
    issues.push(smtpTimeoutMsParsed);
  }
  const smtpTimeoutMs =
    typeof smtpTimeoutMsParsed === "number" ? smtpTimeoutMsParsed : 5000;

  if (smtpAuthRequired === true) {
    if (smtpEnabled !== true) {
      issues.push("SMTP_ENABLED must be true when SMTP_AUTH_REQUIRED=true");
    }
    if (smtpUsername === undefined) {
      issues.push("SMTP_USERNAME is required when SMTP_AUTH_REQUIRED=true");
    }
    if (smtpPassword === undefined) {
      issues.push("SMTP_PASSWORD is required when SMTP_AUTH_REQUIRED=true");
    }
  }

  const DEFAULT_OTP_TTL_SECONDS = 600;
  const DEFAULT_OTP_MAX_ATTEMPTS = 5;
  const DEFAULT_DEV_OTP_HMAC_SECRET =
    "dev_otp_hmac_secret_placeholder_at_least_32_characters_long";

  const otpHmacSecretRaw = readOptional(env, "OTP_HMAC_SECRET");
  if (nodeEnv === "production") {
    if (otpHmacSecretRaw === undefined) {
      issues.push("OTP_HMAC_SECRET is required in production");
    } else if (otpHmacSecretRaw.length < 32) {
      issues.push("OTP_HMAC_SECRET must be at least 32 characters long");
    } else if (
      otpHmacSecretRaw === DEFAULT_DEV_OTP_HMAC_SECRET ||
      isWeakOrPlaceholderSecret(otpHmacSecretRaw)
    ) {
      issues.push(
        "OTP_HMAC_SECRET must not use development placeholders or weak secrets in production",
      );
    }
  }

  const otpHmacSecret = otpHmacSecretRaw ?? DEFAULT_DEV_OTP_HMAC_SECRET;

  const otpTtlSecondsParsed = readPort(
    readOptional(env, "OTP_TTL_SECONDS"),
    "OTP_TTL_SECONDS",
    DEFAULT_OTP_TTL_SECONDS,
  );
  if (typeof otpTtlSecondsParsed === "string") {
    issues.push(otpTtlSecondsParsed);
  }
  const otpTtlSeconds =
    typeof otpTtlSecondsParsed === "number"
      ? otpTtlSecondsParsed
      : DEFAULT_OTP_TTL_SECONDS;

  const otpMaxAttemptsParsed = readPort(
    readOptional(env, "OTP_MAX_ATTEMPTS"),
    "OTP_MAX_ATTEMPTS",
    DEFAULT_OTP_MAX_ATTEMPTS,
  );
  if (typeof otpMaxAttemptsParsed === "string") {
    issues.push(otpMaxAttemptsParsed);
  }
  const otpMaxAttempts =
    typeof otpMaxAttemptsParsed === "number"
      ? otpMaxAttemptsParsed
      : DEFAULT_OTP_MAX_ATTEMPTS;

  const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 7;
  const sessionRefreshTokenTtlDaysParsed = readPort(
    readOptional(env, "SESSION_REFRESH_TOKEN_TTL_DAYS"),
    "SESSION_REFRESH_TOKEN_TTL_DAYS",
    DEFAULT_REFRESH_TOKEN_TTL_DAYS,
  );
  if (typeof sessionRefreshTokenTtlDaysParsed === "string") {
    issues.push(sessionRefreshTokenTtlDaysParsed);
  }
  const sessionRefreshTokenTtlDays =
    typeof sessionRefreshTokenTtlDaysParsed === "number"
      ? sessionRefreshTokenTtlDaysParsed
      : DEFAULT_REFRESH_TOKEN_TTL_DAYS;

  const DEFAULT_JWT_EXPIRES_IN_SECONDS = 900; // 15 minutes
  const DEFAULT_JWT_ISSUER = "arep-auth-service";
  const DEFAULT_JWT_AUDIENCE = "arep-api";
  const DEFAULT_DEV_JWT_SECRET =
    "dev_jwt_secret_placeholder_at_least_32_characters_long";

  const jwtSecretRaw = readOptional(env, "JWT_SECRET");
  if (nodeEnv === "production") {
    if (jwtSecretRaw === undefined) {
      issues.push("JWT_SECRET is required in production");
    } else if (jwtSecretRaw.length < 32) {
      issues.push("JWT_SECRET must be at least 32 characters long");
    } else if (jwtSecretRaw === DEFAULT_DEV_JWT_SECRET) {
      issues.push("JWT_SECRET must not use the default development placeholder in production");
    } else if (isWeakOrPlaceholderSecret(jwtSecretRaw)) {
      issues.push("JWT_SECRET must not use placeholders or weak secrets in production");
    }
  }

  const jwtSecret = jwtSecretRaw ?? DEFAULT_DEV_JWT_SECRET;

  const jwtExpiresInSecondsParsed = readPort(
    readOptional(env, "JWT_EXPIRES_IN_SECONDS"),
    "JWT_EXPIRES_IN_SECONDS",
    DEFAULT_JWT_EXPIRES_IN_SECONDS,
  );
  if (typeof jwtExpiresInSecondsParsed === "string") {
    issues.push(jwtExpiresInSecondsParsed);
  }
  const jwtExpiresInSeconds =
    typeof jwtExpiresInSecondsParsed === "number"
      ? jwtExpiresInSecondsParsed
      : DEFAULT_JWT_EXPIRES_IN_SECONDS;

  const jwtIssuer = readOptional(env, "JWT_ISSUER") ?? DEFAULT_JWT_ISSUER;
  const jwtAudience = readOptional(env, "JWT_AUDIENCE") ?? DEFAULT_JWT_AUDIENCE;

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }

  return {
    nodeEnv,
    host,
    port: resolvedPort,
    appBaseUrl,
    trustProxy,
    corsAllowedOrigins: parsedCorsOrigins,
    database: {
      enabled: databaseEnabled === true,
      url: databaseUrl,
    },
    redis: {
      enabled: redisEnabled === true,
      host: redisHost,
      port: parsedRedisPort,
      password: redisPassword,
    },
    smtp: {
      enabled: smtpEnabled === true,
      authRequired: smtpAuthRequired === true,
      host: smtpHost,
      port: parsedSmtpPort,
      secure: smtpSecure === true,
      username: smtpUsername,
      password: smtpPassword,
      from: smtpFrom,
      timeoutMs: smtpTimeoutMs,
    },
    otp: {
      hmacSecret: otpHmacSecret,
      ttlSeconds: otpTtlSeconds,
      maxAttempts: otpMaxAttempts,
    },
    session: {
      refreshTokenTtlDays: sessionRefreshTokenTtlDays,
    },
    jwt: {
      secret: jwtSecret,
      expiresInSeconds: jwtExpiresInSeconds,
      issuer: jwtIssuer,
      audience: jwtAudience,
    },
  };
}

