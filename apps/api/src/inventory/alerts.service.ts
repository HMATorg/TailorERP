import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureGateService } from '../platform/feature-gate.service';
import type { UpsertReorderSettingDto } from './dto/inventory.dto';

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly featureGate: FeatureGateService,
  ) {}

  async listAlerts(orgId: string, storeId: string, status?: string) {
    await this.featureGate.assertFeature(orgId, 'reorder_alerts');
    return this.prisma.inventoryRestockAlert.findMany({
      where: { storeId, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setAlertStatus(
    storeId: string,
    userId: string,
    alertId: string,
    status: 'acknowledged' | 'ordered' | 'resolved',
    note?: string,
  ) {
    const alert = await this.prisma.inventoryRestockAlert.findFirst({
      where: { id: alertId, storeId },
    });
    if (!alert) throw new NotFoundException('Alert not found in this store');

    const updated = await this.prisma.inventoryRestockAlert.update({
      where: { id: alertId },
      data: {
        status,
        ...(status === 'resolved'
          ? { resolvedAt: new Date(), resolvedById: userId, resolutionNote: note }
          : {}),
      },
    });
    await this.audit.log({
      storeId,
      actorUserId: userId,
      action: `inventory.alert_${status}`,
      entityType: 'inventory_restock_alert',
      entityId: alertId,
    });
    return updated;
  }

  listReorderSettings(storeId: string) {
    return this.prisma.inventoryReorderSetting.findMany({
      where: { storeId },
      orderBy: { fabricName: 'asc' },
    });
  }

  upsertReorderSetting(storeId: string, dto: UpsertReorderSettingDto) {
    return this.prisma.inventoryReorderSetting.upsert({
      where: { storeId_fabricName: { storeId, fabricName: dto.fabricName } },
      update: {
        minThreshold: dto.minThreshold,
        maxThreshold: dto.maxThreshold,
        leadTimeDays: dto.leadTimeDays ?? 7,
      },
      create: {
        storeId,
        fabricName: dto.fabricName,
        minThreshold: dto.minThreshold,
        maxThreshold: dto.maxThreshold,
        leadTimeDays: dto.leadTimeDays ?? 7,
      },
    });
  }
}
