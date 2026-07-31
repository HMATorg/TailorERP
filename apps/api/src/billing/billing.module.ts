import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FeatureGateModule } from '../platform/feature-gate.module';
import { BillingController, StripeWebhookController } from './billing.controller';
import { StripeService } from './stripe.service';

@Module({
  imports: [AuthModule, FeatureGateModule],
  controllers: [BillingController, StripeWebhookController],
  providers: [StripeService],
  exports: [StripeService],
})
export class BillingModule {}
