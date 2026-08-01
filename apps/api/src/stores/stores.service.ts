import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, Store } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { encryptSecret } from '../notifications/crypto.util';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload } from '../auth/auth.types';
import type { CreateStoreDto, UpdateStoreDto } from './dto/store.dto';

/**
 * Never let the encrypted WhatsApp token blob leave the API — the client has
 * no use for ciphertext it can't decrypt, and there's no reason to hand it
 * out. `whatsappConfigured` tells the UI whether one is on file at all.
 */
function sanitizeStore(store: Store) {
  const { whatsappAccessTokenEncrypted, ...rest } = store;
  return { ...rest, whatsappConfigured: whatsappAccessTokenEncrypted != null };
}

@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
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
      const stores = await this.prisma.store.findMany({
        where: { organizationId: principal.orgId },
        orderBy: [{ isHeadquarters: 'desc' }, { name: 'asc' }],
      });
      return stores.map(sanitizeStore);
    }
    const storeIds = user.storeRoles.map((r) => r.storeId);
    const stores = await this.prisma.store.findMany({
      where: { id: { in: storeIds } },
      orderBy: { name: 'asc' },
    });
    return stores.map(sanitizeStore);
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
    return sanitizeStore(store);
  }

  async getById(orgId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, organizationId: orgId },
    });
    if (!store) throw new NotFoundException('Store not found');
    return sanitizeStore(store);
  }

  /** Raw row, including the encrypted token — only for server-side use (notification.worker.ts). */
  private async getByIdRaw(orgId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, organizationId: orgId },
    });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  async update(orgId: string, actorId: string, storeId: string, dto: UpdateStoreDto, ip?: string) {
    const existing = await this.getByIdRaw(orgId, storeId);
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
        ...(dto.whatsappPhoneNumberId !== undefined && {
          whatsappPhoneNumberId: dto.whatsappPhoneNumberId,
        }),
        ...(dto.whatsappAccessToken !== undefined && {
          whatsappAccessTokenEncrypted: encryptSecret(
            dto.whatsappAccessToken,
            this.config.getOrThrow<string>('TOKEN_ENCRYPTION_KEY'),
          ),
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
    return sanitizeStore(store);
  }
}
