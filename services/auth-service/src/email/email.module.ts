import { Module } from '@nestjs/common';
import { AuthConfigModule } from '../config/auth-config.module.js';
import { EmailService } from './email.service.js';

@Module({
  imports: [AuthConfigModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
