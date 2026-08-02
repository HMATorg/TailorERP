import type { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';

/**
 * Shared by RedisModule, both BullMQ queues/workers, and the reorder cron —
 * one place to build connection options so TLS (required by managed
 * providers like Upstash, absent for a local/docker-compose Redis) can't be
 * added to three call sites and missed on the fourth.
 */
export function redisConnectionOptions(config: ConfigService): RedisOptions {
  return {
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: config.get<number>('REDIS_PORT', 6379),
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    ...(config.get<string>('REDIS_TLS') === 'true' ? { tls: {} } : {}),
  };
}
