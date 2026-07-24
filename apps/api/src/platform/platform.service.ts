import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../auth/token.service';
import { FeatureGateService } from './feature-gate.service';
import type {
  ChangeSubscriptionDto,
  CreateOrganizationDto,
  UpdateOrganizationDto,
  UpsertPlanDto,
} from './dto/platform.dto';

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly featureGate: FeatureGateService,
    private readonly audit: AuditService,
  ) {}

  // ── Organizations (PA-1, PA-2, PA-4) ──

  async listOrganizations(query: { status?: string; search?: string }) {
    return this.prisma.organization.findMany({
      where: {
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.search
          ? { name: { contains: query.search, mode: 'insensitive' } }
          : {}),
      },
      include: {
        subscription: { include: { plan: { select: { name: true, code: true } } } },
        _count: { select: { stores: true, users: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrganization(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        subscription: { include: { plan: true } },
        stores: { select: { id: true, name: true, status: true, isHeadquarters: true } },
        _count: { select: { users: true, customers: true, orders: true } },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  /** Manual enterprise provisioning: org + subscription + HQ store + HQ admin (PA-2). */
  async createOrganization(actorId: string, dto: CreateOrganizationDto, ip?: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { code: dto.planCode },
    });
    if (!plan) throw new BadRequestException(`Unknown plan code '${dto.planCode}'`);

    const email = dto.hqAdminEmail.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('HQ admin email already in use');

    const passwordHash = await bcrypt.hash(dto.hqAdminPassword, 10);
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);

    const org = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: {
          name: dto.name,
          defaultCurrency: dto.defaultCurrency ?? 'SAR',
          timezone: dto.timezone ?? 'Asia/Riyadh',
        },
      });
      await tx.organizationSubscription.create({
        data: {
          organizationId: created.id,
          planId: plan.id,
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });
      await tx.store.create({
        data: {
          organizationId: created.id,
          name: dto.hqStoreName ?? `${dto.name} — HQ`,
          isHeadquarters: true,
        },
      });
      await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName: dto.hqAdminFullName ?? 'HQ Admin',
          organizationId: created.id,
          orgRole: 'hq_admin',
        },
      });
      return created;
    });

    await this.audit.log({
      organizationId: org.id,
      actorUserId: actorId,
      actorType: 'platform_admin',
      action: 'platform.organization_created',
      entityType: 'organization',
      entityId: org.id,
      newValue: { name: dto.name, plan: dto.planCode },
      ip,
    });
    return this.getOrganization(org.id);
  }

  async updateOrganization(
    actorId: string,
    orgId: string,
    dto: UpdateOrganizationDto,
    ip?: string,
  ) {
    const org = await this.getOrganization(orgId);
    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
    await this.featureGate.invalidate(orgId);
    await this.audit.log({
      organizationId: orgId,
      actorUserId: actorId,
      actorType: 'platform_admin',
      action: dto.status === 'suspended' ? 'platform.organization_suspended' : 'platform.organization_updated',
      entityType: 'organization',
      entityId: orgId,
      oldValue: { name: org.name, status: org.status },
      newValue: { name: updated.name, status: updated.status },
      ip,
    });
    return updated;
  }

  // ── Subscriptions (PA-4, PA-6) ──

  async changeSubscription(
    actorId: string,
    orgId: string,
    dto: ChangeSubscriptionDto,
    ip?: string,
  ) {
    const subscription = await this.prisma.organizationSubscription.findUnique({
      where: { organizationId: orgId },
      include: { plan: true },
    });
    if (!subscription) throw new NotFoundException('Organization has no subscription');

    let planId = dto.planId;
    if (!planId && dto.planCode) {
      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { code: dto.planCode },
      });
      if (!plan) throw new BadRequestException(`Unknown plan code '${dto.planCode}'`);
      planId = plan.id;
    }

    const updated = await this.prisma.organizationSubscription.update({
      where: { organizationId: orgId },
      data: {
        ...(planId ? { planId } : {}),
        ...(dto.status ? { status: dto.status as never } : {}),
        ...(dto.currentPeriodEnd ? { currentPeriodEnd: new Date(dto.currentPeriodEnd) } : {}),
        ...(dto.trialEndsAt ? { trialEndsAt: new Date(dto.trialEndsAt) } : {}),
      },
      include: { plan: true },
    });
    await this.featureGate.invalidate(orgId);
    await this.audit.log({
      organizationId: orgId,
      actorUserId: actorId,
      actorType: 'platform_admin',
      action: 'platform.subscription_changed',
      entityType: 'organization_subscription',
      entityId: updated.id,
      oldValue: { plan: subscription.plan.code, status: subscription.status },
      newValue: { plan: updated.plan.code, status: updated.status },
      ip,
    });
    return updated;
  }

  // ── Plans (PA-3) ──

  listPlans() {
    return this.prisma.subscriptionPlan.findMany({ orderBy: { maxStores: 'asc' } });
  }

  async upsertPlan(actorId: string, dto: UpsertPlanDto, ip?: string) {
    const plan = await this.prisma.subscriptionPlan.upsert({
      where: { code: dto.code },
      update: {
        name: dto.name,
        maxStores: dto.maxStores,
        maxUsers: dto.maxUsers,
        features: dto.features,
        monthlyPrice: dto.monthlyPrice,
        yearlyPrice: dto.yearlyPrice,
        isPublic: dto.isPublic ?? true,
        stripeMonthlyPriceId: dto.stripeMonthlyPriceId,
        stripeYearlyPriceId: dto.stripeYearlyPriceId,
      },
      create: {
        name: dto.name,
        code: dto.code,
        maxStores: dto.maxStores,
        maxUsers: dto.maxUsers,
        features: dto.features,
        monthlyPrice: dto.monthlyPrice,
        yearlyPrice: dto.yearlyPrice,
        isPublic: dto.isPublic ?? true,
        stripeMonthlyPriceId: dto.stripeMonthlyPriceId,
        stripeYearlyPriceId: dto.stripeYearlyPriceId,
      },
    });
    await this.audit.log({
      actorUserId: actorId,
      actorType: 'platform_admin',
      action: 'platform.plan_upserted',
      entityType: 'subscription_plan',
      entityId: plan.id,
      newValue: { code: plan.code, features: dto.features },
      ip,
    });
    return plan;
  }

  // ── Impersonation (PA-5, TRD §7.4) ──

  async impersonate(actorId: string, orgId: string, ip?: string) {
    const hqAdmin = await this.prisma.user.findFirst({
      where: { organizationId: orgId, orgRole: 'hq_admin', isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!hqAdmin) throw new NotFoundException('Organization has no active HQ admin');

    const ttl = Number(process.env.JWT_IMPERSONATION_TTL ?? 1800); // max 30 min
    const accessToken = await this.tokens.signAccessToken(
      { sub: hqAdmin.id, typ: 'staff', orgId, impersonatorId: actorId },
      ttl,
    );
    await this.audit.log({
      organizationId: orgId,
      actorUserId: actorId,
      actorType: 'impersonation',
      action: 'platform.impersonation_started',
      entityType: 'user',
      entityId: hqAdmin.id,
      newValue: { ttlSeconds: ttl },
      ip,
    });
    return { accessToken, expiresIn: ttl, impersonatedUserId: hqAdmin.id };
  }

  // ── Platform-wide audit view ──

  listAuditLogs(query: { organizationId?: string; action?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 50));
    const where = {
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.action ? { action: { contains: query.action } } : {}),
    };
    return this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          actorUser: { select: { id: true, email: true, fullName: true } },
          organization: { select: { id: true, name: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]).then(([items, total]) => ({ items, meta: { page, pageSize, total } }));
  }
}
