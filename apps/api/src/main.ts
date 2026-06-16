import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import type { Express } from 'express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const isProd = config.get<string>('NODE_ENV') === 'prod';

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
  const corsOrigin = config.get<string>('CORS_ORIGIN', 'http://localhost:5173');
  app.enableCors({
    origin: corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  });

  const port = Number(config.get<string>('PORT', '3000'));
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
