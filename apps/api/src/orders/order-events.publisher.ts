import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  WHATSAPP_QUEUE,
  type InvoiceRequestedJob,
  type OrderStatusChangedJob,
} from '../notifications/queues';

export interface OrderStatusChangedEvent {
  orderId: string;
  organizationId: string;
  storeId: string;
  customerId: string;
  orderNumber: string;
  fromStatus: string | null;
  toStatus: string;
}

/**
 * Publishes order lifecycle events to the whatsapp queue (TRD §5.5).
 * Queue failures never break the API response — the status change itself
 * is already committed; delivery is at-least-once via BullMQ retries.
 */
@Injectable()
export class OrderEventsPublisher {
  private readonly logger = new Logger(OrderEventsPublisher.name);

  constructor(
    @Optional() @Inject(WHATSAPP_QUEUE) private readonly whatsappQueue?: Queue,
  ) {}

  async publishStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    const job: OrderStatusChangedJob = { kind: 'order.status.changed', ...event };
    try {
      await this.whatsappQueue?.add('order.status.changed', job);
      this.logger.log(
        `queued order.status.changed ${event.orderNumber}: ${event.fromStatus ?? '∅'} → ${event.toStatus}`,
      );

      // Delivery closes the order: invoice it and send the PDF (PRD W-3)
      if (event.toStatus === 'delivered') {
        const invoiceJob: InvoiceRequestedJob = {
          kind: 'invoice.requested',
          orderId: event.orderId,
          organizationId: event.organizationId,
          storeId: event.storeId,
          customerId: event.customerId,
          orderNumber: event.orderNumber,
        };
        await this.whatsappQueue?.add('invoice.requested', invoiceJob);
        this.logger.log(`queued invoice.requested for ${event.orderNumber}`);
      }
    } catch (err) {
      this.logger.error(
        `Failed to queue notification for ${event.orderNumber}: ${(err as Error).message}`,
      );
    }
  }
}
