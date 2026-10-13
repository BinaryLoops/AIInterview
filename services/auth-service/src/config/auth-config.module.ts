import { Global, Module } from "@nestjs/common";
import { AUTH_CONFIG } from "./auth-config.constants.js";
import { AuthConfigService } from "./auth-config.service.js";
import { parseAuthConfig } from "./parse-auth-config.js";

@Global()
@Module({
  providers: [
    {
      provide: AUTH_CONFIG,
      useFactory: () => parseAuthConfig(process.env),
    },
    AuthConfigService,
  ],
  exports: [AuthConfigService],
})
export class AuthConfigModule {}
