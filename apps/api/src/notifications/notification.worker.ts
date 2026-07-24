import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, type OrderStatusChangedJob } from './queues';
import { WhatsappService } from './whatsapp.service';

const STATUS_TEMPLATES: Record<string, { template: string; type: string }> = {
  cutting: { template: 'order_status_update', type: 'order_update' },
  sewing: { template: 'order_status_update', type: 'order_update' },
  fitting: { template: 'order_status_update', type: 'order_update' },
  ready: { template: 'order_ready_pickup', type: 'pickup_ready' },
  delivered: { template: 'order_delivered', type: 'order_update' },
};

/**
 * Consumes the whatsapp queue (TRD §5.5): resolves consent, credentials, and
 * template, then delegates to WhatsappService. Runs in-process with the API
 * (Architecture §4.2 allows same-container workers initially).
 */
@Injectable()
export class NotificationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsappService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(
      QUEUE_NAMES.whatsapp,
      (job) => this.process(job as Job<OrderStatusChangedJob>),
      {
        connection: {
          host: this.config.get<string>('REDIS_HOST', 'localhost'),
          port: this.config.get<number>('REDIS_PORT', 6379),
        },
        concurrency: 5,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async process(job: Job<OrderStatusChangedJob>): Promise<void> {
    const data = job.data;
    if (data.kind !== 'order.status.changed') return;

    const mapping = STATUS_TEMPLATES[data.toStatus];
    if (!mapping) return; // e.g. pending/cancelled — no proactive message

    const customer = await this.prisma.customer.findUnique({
      where: { id: data.customerId },
      select: { whatsappConsent: true, whatsappPhone: true, phone: true, language: true, fullName: true },
    });
    if (!customer?.whatsappConsent) {
      this.logger.log(`Customer ${data.customerId} has no WhatsApp consent — skipping`);
      return;
    }
    const store = await this.prisma.store.findUnique({
      where: { id: data.storeId },
      select: { name: true },
    });

    await this.whatsapp.sendTemplate({
      organizationId: data.organizationId,
      storeId: data.storeId,
      customerId: data.customerId,
      orderId: data.orderId,
      toPhone: customer.whatsappPhone ?? customer.phone,
      templateName: mapping.template,
      language: customer.language === 'ar' ? 'ar' : 'en',
      bodyVariables: [
        customer.fullName,
        data.orderNumber,
        data.toStatus.replace('_', ' '),
        store?.name ?? 'our store',
      ],
      messageType: mapping.type,
    });
  }
}
