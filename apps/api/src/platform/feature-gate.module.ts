import { Module } from '@nestjs/common';
import { FeatureGateService } from './feature-gate.service';

/**
 * Split out from `PlatformModule` (D-060) — `FeatureGateService` is a
 * cross-cutting concern consumed by tenant-facing modules (auth, inventory,
 * notifications, team) that must never depend on `PlatformModule`, which
 * itself imports `AuthModule`. Bundling it inside `PlatformModule` made
 * `AuthModule → PlatformModule → AuthModule` a real circular-dependency risk
 * the moment any auth-side code needed to check a feature flag — which is
 * exactly what closing the "features are stored but never enforced" gap
 * required. Relies on `PrismaModule`/`RedisModule` being `@Global()`, so no
 * imports are needed here.
 */
@Module({
  providers: [FeatureGateService],
  exports: [FeatureGateService],
})
export class FeatureGateModule {}
