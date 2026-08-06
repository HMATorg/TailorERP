import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateOrganizationDto } from './dto/organization.dto';

const PROFILE_SELECT = {
  id: true,
  name: true,
  vatNumber: true,
  crNumber: true,
  licenseNumber: true,
  receiptNote: true,
  logoUrl: true,
} as const;

/**
 * The business-profile fields a receipt or tax invoice prints about the
 * seller: name, VAT/CR/license numbers, and logo. Deliberately separate from
 * `ZatcaOnboardingService` — that module owns the CSID/cryptographic side of
 * compliance; this is plain display data an owner edits from Settings with no
 * ZATCA round trip involved (D-069).
 */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getProfile(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: PROFILE_SELECT,
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async updateProfile(orgId: string, actorId: string, dto: UpdateOrganizationDto, ip?: string) {
    const existing = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: PROFILE_SELECT,
    });
    if (!existing) throw new NotFoundException('Organization not found');

    const org = await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.vatNumber !== undefined && { vatNumber: dto.vatNumber }),
        ...(dto.crNumber !== undefined && { crNumber: dto.crNumber }),
        ...(dto.licenseNumber !== undefined && { licenseNumber: dto.licenseNumber }),
        ...(dto.receiptNote !== undefined && { receiptNote: dto.receiptNote }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
      },
      select: PROFILE_SELECT,
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: actorId,
      action: 'organization.profile_updated',
      entityType: 'organization',
      entityId: orgId,
      // The logo data URI is large and not meaningful in an audit trail —
      // record whether it changed, never the payload itself.
      oldValue: { ...existing, logoUrl: existing.logoUrl ? '(set)' : null },
      newValue: { ...org, logoUrl: org.logoUrl ? '(set)' : null },
      ip,
    });
    return org;
  }
}
