import { Logger, ValidationPipe, type INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { assertSafeEnv } from './config/validate-env.js';
import { AppLogger } from './core/logs/app-logger.js';
import { LogsService } from './core/logs/logs.service.js';
import { requestLogger } from './core/logs/request-logger.js';

/** Small socket messages only, and the same origins as the REST API. */
class LimitedIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: Parameters<IoAdapter['createIOServer']>[1]) {
    return super.createIOServer(port, { ...options, maxHttpBufferSize: 64 * 1024, cors: { origin: this.origins, credentials: true } } as typeof options);
  }
}

async function bootstrap() {
  assertSafeEnv();
  // rawBody: kept for signed webhooks (checked against the exact bytes received).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bufferLogs: true });
  const config = app.get(ConfigService);
  const logs = app.get(LogsService);
  AppLogger.sink = logs;
  app.useLogger(new AppLogger());

  // Only trust X-Forwarded-For from known proxies, or rate limits and logs could be spoofed.
  app.set('trust proxy', config.get<number>('security.trustProxy') ?? 0);
  app.disable('x-powered-by');
  app.use(
    helmet({
      // An API: nothing here should ever be framed or run scripts.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // public images are loaded by the apps
      hsts: { maxAge: 31_536_000, includeSubDomains: true },
    }),
  );
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '100kb', extended: false });
  app.use(requestLogger(logs));
  app.setGlobalPrefix('api');
  const origins = config.get<string[]>('corsOrigins') ?? [];
  app.enableCors({ origin: origins, credentials: true, maxAge: 600 });
  app.useWebSocketAdapter(new LimitedIoAdapter(app, origins));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter(logs));
  app.enableShutdownHooks();

  const port = config.get<number>('port') ?? 3000;
  const server = await app.listen(port);
  // Slow-loris protection: drop clients that trickle headers or bodies.
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 10_000;
  new Logger('Bootstrap').log(`API on :${port} (${config.get('solana.cluster')})`);
}

process.on('unhandledRejection', (reason) => {
  void AppLogger.sink?.error('Process', reason instanceof Error ? reason : new Error(String(reason)));
});

await bootstrap();
