import { Inject, Injectable } from "@nestjs/common";
import { AUTH_CONFIG } from "./auth-config.constants.js";
import type {
  AuthConfig,
  AuthConfigPublicSummary,
} from "./auth-config.types.js";

@Injectable()
export class AuthConfigService {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  get nodeEnv(): AuthConfig["nodeEnv"] {
    return this.config.nodeEnv;
  }

  get host(): string {
    return this.config.host;
  }

  get port(): number {
    return this.config.port;
  }

  get appBaseUrl(): string {
    return this.config.appBaseUrl;
  }

  get trustProxy(): boolean {
    return this.config.trustProxy;
  }

  get corsAllowedOrigins(): readonly string[] {
    return this.config.corsAllowedOrigins;
  }

  get otp(): AuthConfig["otp"] {
    return this.config.otp;
  }

  get session(): AuthConfig["session"] {
    return this.config.session;
  }

  get jwt(): AuthConfig["jwt"] {
    return this.config.jwt;
  }

  get snapshot(): AuthConfig {
    return this.config;
  }

  isAllowedOrigin(originOrUrl: string): boolean {
    if (!originOrUrl || typeof originOrUrl !== "string") {
      return false;
    }
    try {
      const candidateUrl = new URL(originOrUrl);
      const appUrl = new URL(this.config.appBaseUrl);

      // Same origin as appBaseUrl is always allowed
      if (candidateUrl.origin === appUrl.origin) {
        return true;
      }

      // Check explicitly configured CORS origins
      for (const allowed of this.config.corsAllowedOrigins) {
        try {
          const allowedUrl = new URL(allowed);
          if (candidateUrl.origin === allowedUrl.origin) {
            return true;
          }
        } catch {
          if (originOrUrl === allowed) {
            return true;
          }
        }
      }

      // In non-production environments, allow localhost / 127.0.0.1
      if (this.config.nodeEnv !== "production") {
        if (
          candidateUrl.hostname === "localhost" ||
          candidateUrl.hostname === "127.0.0.1"
        ) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  publicSummary(): AuthConfigPublicSummary {
    return {
      nodeEnv: this.config.nodeEnv,
      host: this.config.host,
      port: this.config.port,
      appBaseUrl: this.config.appBaseUrl,
      trustProxy: this.config.trustProxy,
      corsAllowedOrigins: this.config.corsAllowedOrigins,
      databaseEnabled: this.config.database.enabled,
      redisEnabled: this.config.redis.enabled,
      smtpEnabled: this.config.smtp.enabled,
      smtpAuthRequired: this.config.smtp.authRequired,
    };
  }
}
