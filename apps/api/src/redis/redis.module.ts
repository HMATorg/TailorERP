import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { redisConnectionOptions } from './redis-connection';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis({
          ...redisConnectionOptions(config),
          maxRetriesPerRequest: 3,
          lazyConnect: false,
        }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
