export const QUEUE_NAMES = {
  whatsapp: 'whatsapp-queue',
  notification: 'notification-queue',
  email: 'email-queue',
  cron: 'cron-queue',
} as const;

export const WHATSAPP_QUEUE = 'WHATSAPP_QUEUE';
export const NOTIFICATION_QUEUE = 'NOTIFICATION_QUEUE';
export const EMAIL_QUEUE = 'EMAIL_QUEUE';
export const CRON_QUEUE = 'CRON_QUEUE';

export interface OrderStatusChangedJob {
  kind: 'order.status.changed';
  orderId: string;
  organizationId: string;
  storeId: string;
  customerId: string;
  orderNumber: string;
  fromStatus: string | null;
  toStatus: string;
}

/** Emitted once an order is delivered: generate the invoice and send it (W-3). */
export interface InvoiceRequestedJob {
  kind: 'invoice.requested';
  orderId: string;
  organizationId: string;
  storeId: string;
  customerId: string;
  orderNumber: string;
}

export type NotificationJob = OrderStatusChangedJob | InvoiceRequestedJob;
