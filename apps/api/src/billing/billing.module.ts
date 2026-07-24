import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformModule } from '../platform/platform.module';
import { BillingController, StripeWebhookController } from './billing.controller';
import { StripeService } from './stripe.service';

@Module({
  imports: [AuthModule, PlatformModule],
  controllers: [BillingController, StripeWebhookController],
  providers: [StripeService],
  exports: [StripeService],
})
export class BillingModule {}
