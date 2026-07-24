import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush, { type PushSubscription, type WebPushError } from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Web Push delivery via VAPID (PRD C-6, TRD §6.3).
 * Subscriptions live in customer_devices; a 404/410 from the push service
 * means the browser dropped the subscription, so we deactivate that row.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private configured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    if (!publicKey || !privateKey) {
      this.logger.warn('VAPID keys not configured — web push is disabled');
      return;
    }
    webpush.setVapidDetails(
      this.config.get<string>('VAPID_SUBJECT', 'mailto:support@tailonix.com'),
      publicKey,
      privateKey,
    );
    this.configured = true;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  /** Sends to every active device of a customer. Returns how many succeeded. */
  async sendToCustomer(customerId: string, payload: PushPayload): Promise<number> {
    if (!this.configured) return 0;

    const devices = await this.prisma.customerDevice.findMany({
      where: { customerId, isActive: true },
    });
    if (devices.length === 0) return 0;

    let delivered = 0;
    await Promise.all(
      devices.map(async (device) => {
        try {
          const subscription = JSON.parse(device.deviceToken) as PushSubscription;
          await webpush.sendNotification(subscription, JSON.stringify(payload));
          delivered += 1;
        } catch (err) {
          const statusCode = (err as WebPushError).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // Subscription is permanently gone — stop trying it.
            await this.prisma.customerDevice.update({
              where: { id: device.id },
              data: { isActive: false },
            });
            this.logger.log(`Deactivated expired push subscription ${device.id}`);
          } else {
            this.logger.error(
              `Push to device ${device.id} failed: ${(err as Error).message}`,
            );
          }
        }
      }),
    );
    return delivered;
  }
}
