import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateButtonDesignDto, UpdateButtonDesignDto } from './dto/buttons.dto';

const SELECT = {
  id: true,
  serialNumber: true,
  imageUrl: true,
  label: true,
  isActive: true,
  createdAt: true,
} as const;

/**
 * The shop's own photographed button stock (D-071) — the digital form of the
 * paper reference board pinned by the counter. Org-wide: the same physical
 * stock serves every branch, so this isn't scoped to a store the way fabric
 * batches are.
 */
@Injectable()
export class ButtonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Active-only by default — the POS picker; pass includeInactive for the admin management view. */
  list(orgId: string, includeInactive = false) {
    return this.prisma.buttonDesign.findMany({
      where: { organizationId: orgId, ...(includeInactive ? {} : { isActive: true }) },
      select: SELECT,
      orderBy: { serialNumber: 'asc' },
    });
  }

  async create(orgId: string, actorId: string, dto: CreateButtonDesignDto, ip?: string) {
    const clash = await this.prisma.buttonDesign.findUnique({
      where: { organizationId_serialNumber: { organizationId: orgId, serialNumber: dto.serialNumber } },
    });
    if (clash) throw new ConflictException('A button with this serial number already exists');

    const button = await this.prisma.buttonDesign.create({
      data: { organizationId: orgId, serialNumber: dto.serialNumber, imageUrl: dto.imageUrl, label: dto.label },
      select: SELECT,
    });
    await this.audit.log({
      organizationId: orgId,
      actorUserId: actorId,
      action: 'button_design.created',
      entityType: 'button_design',
      entityId: button.id,
      // The image payload has no audit value and would bloat the log.
      newValue: { serialNumber: button.serialNumber, label: button.label },
      ip,
    });
    return button;
  }

  async update(orgId: string, actorId: string, id: string, dto: UpdateButtonDesignDto, ip?: string) {
    const existing = await this.prisma.buttonDesign.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) throw new NotFoundException('Button design not found');

    if (dto.serialNumber && dto.serialNumber !== existing.serialNumber) {
      const clash = await this.prisma.buttonDesign.findUnique({
        where: { organizationId_serialNumber: { organizationId: orgId, serialNumber: dto.serialNumber } },
      });
      if (clash) throw new ConflictException('Another button already uses this serial number');
    }

    const button = await this.prisma.buttonDesign.update({
      where: { id },
      data: {
        ...(dto.serialNumber !== undefined && { serialNumber: dto.serialNumber }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      select: SELECT,
    });
    await this.audit.log({
      organizationId: orgId,
      actorUserId: actorId,
      action: 'button_design.updated',
      entityType: 'button_design',
      entityId: id,
      oldValue: { serialNumber: existing.serialNumber, isActive: existing.isActive },
      newValue: { serialNumber: button.serialNumber, isActive: button.isActive },
      ip,
    });
    return button;
  }
}
