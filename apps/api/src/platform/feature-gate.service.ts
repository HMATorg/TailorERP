import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const CACHE_TTL_SECONDS = 300; // 5 min (TRD §9)

/**
 * Feature gating per subscription plan (PRD §4.5): enabled features are cached
 * in Redis; a missing feature returns 402 to the tenant API caller.
 */
@Injectable()
export class FeatureGateService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private key(orgId: string) {
    return `features:${orgId}`;
  }

  async getFeatures(orgId: string): Promise<string[]> {
    const cached = await this.redis.get(this.key(orgId));
    if (cached) return JSON.parse(cached) as string[];

    const subscription = await this.prisma.organizationSubscription.findUnique({
      where: { organizationId: orgId },
      include: { plan: { select: { features: true } } },
    });
    const features =
      subscription && ['active', 'trialing'].includes(subscription.status)
        ? ((subscription.plan.features as string[]) ?? [])
        : [];
    await this.redis.set(this.key(orgId), JSON.stringify(features), 'EX', CACHE_TTL_SECONDS);
    return features;
  }

  async assertFeature(orgId: string, feature: string): Promise<void> {
    const features = await this.getFeatures(orgId);
    if (!features.includes(feature)) {
      throw new HttpException(
        `Your plan does not include '${feature}' — upgrade to enable it`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  /** Called whenever a tenant's plan or subscription status changes. */
  async invalidate(orgId: string): Promise<void> {
    await this.redis.del(this.key(orgId));
  }
}
