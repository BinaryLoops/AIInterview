import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE, APP_GUARD } from "@nestjs/core";
import { createValidationPipe } from "./common/create-validation-pipe.js";
import { GlobalExceptionFilter } from "./common/http-exception.filter.js";
import { RequestLoggingInterceptor } from "./common/request-logging.interceptor.js";
import { AuthConfigModule } from "./config/auth-config.module.js";
import { HealthModule } from "./health/health.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { RedisModule } from "./database/redis.module.js";
import { RateLimitModule } from "./rate-limit/rate-limit.module.js";
import { RateLimitGuard } from "./rate-limit/rate-limit.guard.js";
import { PasswordModule } from "./password/password.module.js";
import { OtpModule } from "./otp/otp.module.js";
import { EmailModule } from "./email/email.module.js";
import { SessionModule } from "./session/session.module.js";
import { AuthorizationModule } from "./authorization/authorization.module.js";
import { RolesGuard } from "./authorization/roles.guard.js";
import { TokenModule } from "./token/token.module.js";
import { AccessTokenGuard } from "./token/access-token.guard.js";
import { AuthModule } from "./auth/auth.module.js";

@Module({
  imports: [
    AuthConfigModule,
    HealthModule,
    DatabaseModule,
    RedisModule,
    RateLimitModule,
    PasswordModule,
    OtpModule,
    EmailModule,
    SessionModule,
    TokenModule,
    AuthorizationModule,
    AuthModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: createValidationPipe(),
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggingInterceptor,
    },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
