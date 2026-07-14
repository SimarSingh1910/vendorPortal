import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import type { Express } from 'express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  // Accept both our own 'prod' convention and Node/Railway's default
  // NODE_ENV=production so a platform-injected value still counts as production.
  const nodeEnv = config.get<string>('NODE_ENV');
  const isProd = nodeEnv === 'prod' || nodeEnv === 'production';

  // Security headers, incl. HSTS (effective once served over TLS — see
  // docs/DEPLOYMENT.md for the HTTPS termination + TLS-to-MySQL requirements).
  app.use(helmet());

  // Behind a TLS-terminating load balancer in prod: trust the proxy so Secure
  // cookies and client-IP (rate-limit / audit) resolve from X-Forwarded-* headers.
  if (isProd) {
    (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);
  }

  // Global /api prefix; health stays reachable at /api/health.
  app.setGlobalPrefix('api');

  // DTO validation everywhere, stripping unknown properties.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Credentialed CORS so the browser sends/stores the httpOnly refresh cookie.
  // CORS_ORIGIN is the canonical name; WEB_ORIGIN is accepted as an alias so a
  // deployment configured with either the web app's origin works.
  const corsOrigin =
    config.get<string>('CORS_ORIGIN') ??
    config.get<string>('WEB_ORIGIN') ??
    'http://localhost:5173';
  app.enableCors({
    origin: corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  });

  // Bind to 0.0.0.0 (all interfaces) and the platform-injected PORT. Railway (and
  // most PaaS) route to the container on $PORT and require binding to 0.0.0.0,
  // not localhost, or the health check never connects.
  const port = Number(config.get<string>('PORT', '3000'));
  await app.listen(port, '0.0.0.0');
  Logger.log(`API listening on port ${port} (path /api)`, 'Bootstrap');
}

void bootstrap();
