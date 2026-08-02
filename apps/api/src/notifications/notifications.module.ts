import { Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { InvoicesModule } from '../invoices/invoices.module';
import { FeatureGateModule } from '../platform/feature-gate.module';
import { redisConnectionOptions } from '../redis/redis-connection';
import { MailerService } from './mailer.service';
import { NotificationWorker } from './notification.worker';
import { PushService } from './push.service';
import { QUEUE_NAMES, WHATSAPP_QUEUE } from './queues';
import { ReorderCronService } from './reorder-cron.service';
import { WhatsappService } from './whatsapp.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

const queueFactory = (name: string) => ({
  provide: name === QUEUE_NAMES.whatsapp ? WHATSAPP_QUEUE : name,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    new Queue(name, {
      connection: redisConnectionOptions(config),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    }),
});

@Module({
  imports: [InvoicesModule, FeatureGateModule],
  controllers: [WhatsappWebhookController],
  providers: [
    queueFactory(QUEUE_NAMES.whatsapp),
    WhatsappService,
    PushService,
    MailerService,
    NotificationWorker,
    ReorderCronService,
  ],
  exports: [WHATSAPP_QUEUE, WhatsappService, PushService, MailerService],
})
export class NotificationsModule implements OnModuleDestroy {
  async onModuleDestroy() {
    // queues/workers close via their own lifecycle hooks
  }
}
