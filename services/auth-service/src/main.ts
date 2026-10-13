import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { AuthConfigService } from "./config/auth-config.service.js";
import { loadLocalEnv } from "./config/load-local-env.js";

async function bootstrap(): Promise<void> {
  loadLocalEnv();
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const config = app.get(AuthConfigService);
  if (config.trustProxy) {
    const httpAdapter = app.getHttpAdapter();
    if (httpAdapter && typeof (httpAdapter as any).getInstance === 'function') {
      const expressInstance = (httpAdapter as any).getInstance();
      if (typeof expressInstance.set === 'function') {
        expressInstance.set('trust proxy', 1);
      }
    }
  }

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      if (config.isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  });

  await app.listen(config.port, config.host);

  const logger = new Logger("Bootstrap");
  logger.log(
    `auth-service listening on http://${config.host}:${config.port} (${config.nodeEnv})`,
  );
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger("Bootstrap");
  logger.error(error instanceof Error ? error.message : "Failed to start");
  process.exitCode = 1;
});
