import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { AuthConfigModule } from '../config/auth-config.module.js';

@Module({
  imports: [AuthConfigModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
