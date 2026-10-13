import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PasswordModule } from '../password/password.module.js';
import { OtpModule } from '../otp/otp.module.js';
import { EmailModule } from '../email/email.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { SessionModule } from '../session/session.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { TokenModule } from '../token/token.module.js';
import { AuthConfigModule } from '../config/auth-config.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [
    DatabaseModule,
    PasswordModule,
    OtpModule,
    EmailModule,
    RateLimitModule,
    SessionModule,
    AuthorizationModule,
    TokenModule,
    AuthConfigModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, AuthorizationModule, TokenModule],
})
export class AuthModule {}
