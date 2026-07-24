import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  organizationId?: string;
  storeId?: string;
  actorUserId?: string;
  actorType?: 'staff' | 'platform_admin' | 'impersonation' | 'customer' | 'system';
  action: string;
  entityType?: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string;
}

/**
 * Append-only audit trail for all sensitive mutations (TRD §3.7, §7).
 * Failures are logged but never break the business operation.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: entry.organizationId,
          storeId: entry.storeId,
          actorUserId: entry.actorUserId,
          actorType: entry.actorType ?? 'staff',
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          oldValue: (entry.oldValue as Prisma.InputJsonValue) ?? undefined,
          newValue: (entry.newValue as Prisma.InputJsonValue) ?? undefined,
          ip: entry.ip,
        },
      });
    } catch (err) {
      this.logger.error(`Audit write failed for action=${entry.action}`, err as Error);
    }
  }
}
