import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES } from './queues';

const REORDER_JOB = 'reorder-check';

/**
 * Auto-reorder check (TRD §5.4): a repeatable job runs hourly; stores whose
 * local time is 08:00 (store timezone, falling back to org timezone — D-008)
 * get their thresholds evaluated and restock alerts created.
 */
@Injectable()
export class ReorderCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReorderCronService.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const connection = {
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
    };
    this.queue = new Queue(QUEUE_NAMES.cron, { connection });
    await this.queue.upsertJobScheduler(REORDER_JOB, { pattern: '0 * * * *' });

    this.worker = new Worker(
      QUEUE_NAMES.cron,
      async () => {
        await this.runReorderCheck();
      },
      { connection },
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Exposed for tests and manual triggering. */
  async runReorderCheck(targetHour = 8): Promise<number> {
    const stores = await this.prisma.store.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        timezone: true,
        organization: { select: { timezone: true } },
      },
    });

    const due = stores.filter((s) => {
      const tz = s.timezone ?? s.organization.timezone;
      try {
        const hour = Number(
          new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            hour12: false,
            timeZone: tz,
          }).format(new Date()),
        );
        return hour === targetHour;
      } catch {
        return false;
      }
    });

    let created = 0;
    for (const store of due) {
      created += await this.checkStore(store.id);
    }
    if (due.length > 0) {
      this.logger.log(`Reorder check: ${due.length} store(s) evaluated, ${created} alert(s) created`);
    }
    return created;
  }

  /** Evaluate one store's thresholds (I-4). */
  async checkStore(storeId: string): Promise<number> {
    const settings = await this.prisma.inventoryReorderSetting.findMany({
      where: { storeId },
    });
    let created = 0;
    for (const setting of settings) {
      const stock = await this.prisma.inventoryBatch.aggregate({
        where: { storeId, fabricName: setting.fabricName, status: 'available' },
        _sum: { currentQuantity: true },
      });
      const current = stock._sum.currentQuantity ?? new Prisma.Decimal(0);
      if (current.greaterThan(setting.minThreshold)) continue;

      // Don't duplicate an open alert for the same fabric
      const open = await this.prisma.inventoryRestockAlert.findFirst({
        where: {
          storeId,
          fabricName: setting.fabricName,
          status: { in: ['pending', 'acknowledged', 'ordered'] },
        },
      });
      if (open) continue;

      const suggested = setting.maxThreshold
        ? new Prisma.Decimal(setting.maxThreshold).sub(current)
        : new Prisma.Decimal(setting.minThreshold).mul(2).sub(current);
      await this.prisma.inventoryRestockAlert.create({
        data: {
          storeId,
          fabricName: setting.fabricName,
          currentQty: current,
          thresholdQty: setting.minThreshold,
          suggestedOrderQty: suggested,
        },
      });
      created += 1;
      // TODO(email digest): aggregate per store and push to email-queue (I-5)
    }
    return created;
  }
}
