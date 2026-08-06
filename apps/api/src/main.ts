import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { seedPlatformAdminIfConfigured } from './bootstrap/seed-platform-admin';

async function bootstrap() {
  // rawBody is required for WhatsApp/Stripe webhook signature verification
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // Default express json limit (100kb) is too small for a logo data URI
  // (organization.logoUrl, D-069) — everything else the API accepts is small.
  app.useBodyParser('json', { limit: '2mb' });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') ?? [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
    ],
    credentials: true,
  });
  app.enableShutdownHooks();

  await seedPlatformAdminIfConfigured(app);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Tailonix API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
