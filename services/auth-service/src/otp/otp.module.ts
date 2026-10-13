import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthConfigModule } from '../config/auth-config.module.js';
import { OtpService } from './otp.service.js';

@Module({
  imports: [DatabaseModule, AuthConfigModule],
  providers: [OtpService],
  exports: [OtpService],
})
export class OtpModule {}
