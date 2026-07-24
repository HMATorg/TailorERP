import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload } from '../auth/auth.types';
import type { CreateStoreDto, UpdateStoreDto } from './dto/store.dto';

@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Stores visible to the current staff member (HQ admin: all; others: assigned). */
  async listAccessible(principal: AccessTokenPayload) {
    if (principal.typ !== 'staff' || !principal.orgId) {
      throw new ForbiddenException('Staff credentials required');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: principal.sub },
      include: { storeRoles: { where: { isActive: true } } },
    });
    if (!user || !user.isActive) throw new ForbiddenException('Account is inactive');

    if (user.orgRole === 'hq_admin') {
      return this.prisma.store.findMany({
        where: { organizationId: principal.orgId },
        orderBy: [{ isHeadquarters: 'desc' }, { name: 'asc' }],
      });
    }
    const storeIds = user.storeRoles.map((r) => r.storeId);
    return this.prisma.store.findMany({
      where: { id: { in: storeIds } },
      orderBy: { name: 'asc' },
    });
  }

  async create(orgId: string, actorId: string, dto: CreateStoreDto, ip?: string) {
    // Enforce the subscription plan's store limit (PRD §4.5 licensing)
    const subscription = await this.prisma.organizationSubscription.findUnique({
      where: { organizationId: orgId },
      include: { plan: true },
    });
    if (subscription) {
      const storeCount = await this.prisma.store.count({
        where: { organizationId: orgId, status: { not: 'closed' } },
      });
      if (storeCount >= subscription.plan.maxStores) {
        throw new HttpException(
          `Your ${subscription.plan.name} plan allows ${subscription.plan.maxStores} store(s) — upgrade to add more`,
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
    }

    const store = await this.prisma.store.create({
      data: {
        organizationId: orgId,
        name: dto.name,
        address: dto.address,
        phone: dto.phone,
        email: dto.email,
        isHeadquarters: dto.isHeadquarters ?? false,
        timezone: dto.timezone,
        operatingHours: (dto.operatingHours ?? {}) as Prisma.InputJsonValue,
      },
    });
    await this.audit.log({
      organizationId: orgId,
      storeId: store.id,
      actorUserId: actorId,
      action: 'store.created',
      entityType: 'store',
      entityId: store.id,
      newValue: { name: store.name },
      ip,
    });
    return store;
  }

  async getById(orgId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, organizationId: orgId },
    });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  async update(orgId: string, actorId: string, storeId: string, dto: UpdateStoreDto, ip?: string) {
    const existing = await this.getById(orgId, storeId);
    const store = await this.prisma.store.update({
      where: { id: storeId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
        ...(dto.isHeadquarters !== undefined && { isHeadquarters: dto.isHeadquarters }),
        ...(dto.operatingHours !== undefined && {
          operatingHours: dto.operatingHours as Prisma.InputJsonValue,
        }),
      },
    });
    await this.audit.log({
      organizationId: orgId,
      storeId,
      actorUserId: actorId,
      action: 'store.updated',
      entityType: 'store',
      entityId: storeId,
      oldValue: { name: existing.name, status: existing.status },
      newValue: { name: store.name, status: store.status },
      ip,
    });
    return store;
  }
}
