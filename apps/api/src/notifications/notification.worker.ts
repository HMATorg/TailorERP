import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from './push.service';
import { QUEUE_NAMES, type OrderStatusChangedJob } from './queues';
import { WhatsappService } from './whatsapp.service';

const STATUS_TEMPLATES: Record<string, { template: string; type: string }> = {
  cutting: { template: 'order_status_update', type: 'order_update' },
  sewing: { template: 'order_status_update', type: 'order_update' },
  fitting: { template: 'order_status_update', type: 'order_update' },
  ready: { template: 'order_ready_pickup', type: 'pickup_ready' },
  delivered: { template: 'order_delivered', type: 'order_update' },
};

/** Short status blurbs for push, which has no pre-approved templates. */
const PUSH_COPY: Record<string, Record<string, { title: string; body: string }>> = {
  en: {
    cutting: { title: 'Order in progress', body: 'Cutting has started on order {{n}}.' },
    sewing: { title: 'Order in progress', body: 'Your order {{n}} is now being stitched.' },
    fitting: { title: 'Ready for fitting', body: 'Order {{n}} is ready for a fitting.' },
    ready: { title: 'Ready for pickup', body: 'Order {{n}} is ready to collect at {{s}}.' },
    delivered: { title: 'Order delivered', body: 'Order {{n}} has been collected. Thank you!' },
  },
  ar: {
    cutting: { title: 'طلبك قيد التنفيذ', body: 'بدأ قص القماش للطلب {{n}}.' },
    sewing: { title: 'طلبك قيد التنفيذ', body: 'جارٍ خياطة طلبك {{n}}.' },
    fitting: { title: 'جاهز للقياس', body: 'الطلب {{n}} جاهز للقياس.' },
    ready: { title: 'جاهز للاستلام', body: 'الطلب {{n}} جاهز للاستلام من {{s}}.' },
    delivered: { title: 'تم التسليم', body: 'تم استلام الطلب {{n}}. شكرًا لك!' },
  },
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
    private readonly push: PushService,
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
    if (!customer) return;

    const store = await this.prisma.store.findUnique({
      where: { id: data.storeId },
      select: { name: true },
    });
    const storeName = store?.name ?? 'our store';

    // Primary channel: WhatsApp, when the customer has opted in (PRD §4.4)
    if (customer.whatsappConsent) {
      try {
        await this.whatsapp.sendTemplate({
          organizationId: data.organizationId,
          storeId: data.storeId,
          customerId: data.customerId,
          orderId: data.orderId,
          toPhone: customer.whatsappPhone ?? customer.phone,
          templateName: mapping.template,
          language: customer.language === 'ar' ? 'ar' : 'en',
          bodyVariables: [customer.fullName, data.orderNumber, data.toStatus, storeName],
          messageType: mapping.type,
        });
        return;
      } catch {
        this.logger.warn(
          `WhatsApp failed for order ${data.orderNumber} — falling back to web push`,
        );
      }
    }

    // Fallback (or sole channel without consent): web push to registered devices
    const copy =
      PUSH_COPY[customer.language === 'ar' ? 'ar' : 'en']?.[data.toStatus] ??
      PUSH_COPY.en[data.toStatus];
    if (!copy) return;

    const delivered = await this.push.sendToCustomer(data.customerId, {
      title: copy.title,
      body: copy.body.replace('{{n}}', data.orderNumber).replace('{{s}}', storeName),
      url: `/orders/${data.orderId}`,
      tag: `order-${data.orderId}`,
    });
    this.logger.log(
      `Push for ${data.orderNumber}: delivered to ${delivered} device(s)`,
    );
    // TODO: SMS as the final fallback once a Gulf gateway is selected (PRD §4.4)
  }
}
