import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { FeatureGateService } from './feature-gate.service';

/**
 * FeatureGateService (D-060) — was itself untested despite becoming the
 * actual enforcement point for `transfers`/`reorder_alerts`/`whatsapp`/`pwa`/
 * `regional_managers` (see D-060's "features are stored but never enforced"
 * fix). Redis is mocked with a plain object store, not ioredis — the real
 * client's wire protocol isn't what's under test here.
 */
function build() {
  const store = new Map<string, string>();
  const redis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  };
  const prisma = { organizationSubscription: { findUnique: jest.fn() } };
  const service = new FeatureGateService(prisma as never, redis as never);
  return { service, prisma, redis, store };
}

describe('FeatureGateService', () => {
  it('reads features from the active subscription plan and caches them', async () => {
    const { service, prisma, redis } = build();
    prisma.organizationSubscription.findUnique.mockResolvedValue({
      status: 'active',
      plan: { features: ['whatsapp', 'pwa'] },
    });

    const features = await service.getFeatures('org-1');

    expect(features).toEqual(['whatsapp', 'pwa']);
    expect(redis.set).toHaveBeenCalledWith('features:org-1', JSON.stringify(['whatsapp', 'pwa']), 'EX', 300);
  });

  it('treats trialing the same as active', async () => {
    const { service, prisma } = build();
    prisma.organizationSubscription.findUnique.mockResolvedValue({
      status: 'trialing',
      plan: { features: ['pwa'] },
    });
    expect(await service.getFeatures('org-1')).toEqual(['pwa']);
  });

  it('returns no features for a suspended/past_due/cancelled subscription', async () => {
    const { service, prisma } = build();
    for (const status of ['suspended', 'past_due', 'cancelled']) {
      prisma.organizationSubscription.findUnique.mockResolvedValue({
        status,
        plan: { features: ['whatsapp'] },
      });
      expect(await service.getFeatures(`org-${status}`)).toEqual([]);
    }
  });

  it('returns no features when the org has no subscription at all', async () => {
    const { service, prisma } = build();
    prisma.organizationSubscription.findUnique.mockResolvedValue(null);
    expect(await service.getFeatures('org-none')).toEqual([]);
  });

  it('serves the second call from the Redis cache without hitting Postgres again', async () => {
    const { service, prisma } = build();
    prisma.organizationSubscription.findUnique.mockResolvedValue({
      status: 'active',
      plan: { features: ['transfers'] },
    });

    await service.getFeatures('org-1');
    await service.getFeatures('org-1');

    expect(prisma.organizationSubscription.findUnique).toHaveBeenCalledTimes(1);
  });

  it('assertFeature passes silently when the feature is included', async () => {
    const { service, prisma } = build();
    prisma.organizationSubscription.findUnique.mockResolvedValue({
      status: 'active',
      plan: { features: ['transfers'] },
    });
    await expect(service.assertFeature('org-1', 'transfers')).resolves.toBeUndefined();
  });

  it('assertFeature throws a 402 HttpException when the feature is missing', async () => {
    const { service, prisma } = build();
    prisma.organizationSubscription.findUnique.mockResolvedValue({
      status: 'active',
      plan: { features: [] },
    });

    await expect(service.assertFeature('org-1', 'whatsapp')).rejects.toThrow(HttpException);
    try {
      await service.assertFeature('org-1', 'whatsapp');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(402);
      expect((e as HttpException).message).toContain('whatsapp');
    }
  });

  it('invalidate clears the cache so the next read hits Postgres again', async () => {
    const { service, prisma } = build();
    prisma.organizationSubscription.findUnique.mockResolvedValue({
      status: 'active',
      plan: { features: ['pwa'] },
    });
    await service.getFeatures('org-1');
    await service.invalidate('org-1');
    await service.getFeatures('org-1');

    expect(prisma.organizationSubscription.findUnique).toHaveBeenCalledTimes(2);
  });
});
