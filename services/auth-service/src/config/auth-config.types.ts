export type NodeEnv = "development" | "test" | "production";

export type AuthConfig = {
  nodeEnv: NodeEnv;
  host: string;
  port: number;
  appBaseUrl: string;
  trustProxy: boolean;
  corsAllowedOrigins: readonly string[];
  database: {
    enabled: boolean;
    url: string | undefined;
  };
  redis: {
    enabled: boolean;
    host: string | undefined;
    port: number | undefined;
    password: string | undefined;
  };
  smtp: {
    enabled: boolean;
    authRequired: boolean;
    host: string | undefined;
    port: number | undefined;
    secure: boolean;
    username: string | undefined;
    password: string | undefined;
    from: string;
    timeoutMs: number;
  };
  otp: {
    hmacSecret: string;
    ttlSeconds: number;
    maxAttempts: number;
  };
  session: {
    refreshTokenTtlDays: number;
  };
  jwt: {
    secret: string;
    expiresInSeconds: number;
    issuer: string;
    audience: string;
  };
};

export type AuthConfigPublicSummary = {
  nodeEnv: NodeEnv;
  host: string;
  port: number;
  appBaseUrl: string;
  trustProxy: boolean;
  corsAllowedOrigins: readonly string[];
  databaseEnabled: boolean;
  redisEnabled: boolean;
  smtpEnabled: boolean;
  smtpAuthRequired: boolean;
};

export class ConfigValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration: ${issues.join("; ")}`);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}
