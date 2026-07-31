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
  CreatePlatformAdminDto,
  UpdateOrganizationDto,
  UpdatePlatformAdminDto,
  UpsertPlanDto,
} from './dto/platform.dto';

const PLATFORM_ADMIN_USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  isActive: true,
  createdAt: true,
} as const;

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

  // ── Platform admin accounts (D-060) — there was previously no way to
  // create/list/deactivate a super_admin/billing/support account other than
  // the one seeded directly into the database. ──

  listPlatformAdmins() {
    return this.prisma.platformAdmin.findMany({
      include: { user: { select: PLATFORM_ADMIN_USER_SELECT } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createPlatformAdmin(actorId: string, dto: CreatePlatformAdminDto, ip?: string) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('A user with this email already exists');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const admin = await this.prisma.$transaction(async (tx) => {
      // organizationId stays null — "null for platform staff" (schema comment).
      const user = await tx.user.create({ data: { email, passwordHash, fullName: dto.fullName } });
      return tx.platformAdmin.create({
        data: { userId: user.id, adminLevel: dto.adminLevel },
        include: { user: { select: PLATFORM_ADMIN_USER_SELECT } },
      });
    });

    await this.audit.log({
      actorUserId: actorId,
      actorType: 'platform_admin',
      action: 'platform.admin_created',
      entityType: 'platform_admin',
      entityId: admin.id,
      newValue: { email, adminLevel: dto.adminLevel },
      ip,
    });
    return admin;
  }

  async updatePlatformAdmin(actorId: string, adminId: string, dto: UpdatePlatformAdminDto, ip?: string) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: adminId } });
    if (!admin) throw new NotFoundException('Platform admin not found');
    // A super_admin locking out the only super_admin (themselves, with no
    // one else able to re-grant access) is exactly the kind of mistake a
    // confirm dialog doesn't protect against — reject it outright.
    if (admin.userId === actorId && dto.isActive === false) {
      throw new BadRequestException('You cannot deactivate your own platform admin access');
    }

    const updated = await this.prisma.platformAdmin.update({
      where: { id: adminId },
      data: {
        ...(dto.adminLevel !== undefined ? { adminLevel: dto.adminLevel } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: { user: { select: PLATFORM_ADMIN_USER_SELECT } },
    });
    await this.audit.log({
      actorUserId: actorId,
      actorType: 'platform_admin',
      action: 'platform.admin_updated',
      entityType: 'platform_admin',
      entityId: adminId,
      oldValue: { adminLevel: admin.adminLevel, isActive: admin.isActive },
      newValue: { adminLevel: updated.adminLevel, isActive: updated.isActive },
      ip,
    });
    return updated;
  }

  // ── Platform-wide metrics (D-060) — PRD §4.5 grants Platform Super Admin
  // "global metrics"; no such view existed before this, only the
  // tenant-scoped dashboard in apps/api/src/dashboard (a different module,
  // orgId-filtered, for tenant staff — not reused here on purpose, since
  // this one deliberately spans every tenant). ──

  async getMetrics() {
    const [orgsByStatus, subsByStatus, storeCount, userCount, recentOrgs, activeSubs] = await Promise.all([
      this.prisma.organization.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.organizationSubscription.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.store.count(),
      this.prisma.user.count({ where: { organizationId: { not: null } } }),
      this.prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          name: true,
          createdAt: true,
          subscription: { select: { plan: { select: { name: true } } } },
        },
      }),
      this.prisma.organizationSubscription.findMany({
        where: { status: { in: ['active', 'trialing'] } },
        select: { plan: { select: { monthlyPrice: true } } },
      }),
    ]);

    // A rough ops estimate from plan list prices, not a real billing figure —
    // Stripe remains the source of truth for actual subscription revenue
    // (D-018). Enterprise deals negotiated outside Stripe, trialing accounts
    // that never convert, and any manual discounting are all invisible here.
    const estimatedMonthlyRecurringRevenueSar = activeSubs.reduce(
      (sum, s) => sum + Number(s.plan.monthlyPrice ?? 0),
      0,
    );

    return {
      organizations: {
        total: orgsByStatus.reduce((sum, r) => sum + r._count._all, 0),
        byStatus: Object.fromEntries(orgsByStatus.map((r) => [r.status, r._count._all])),
      },
      subscriptions: {
        byStatus: Object.fromEntries(subsByStatus.map((r) => [r.status, r._count._all])),
      },
      stores: storeCount,
      users: userCount,
      estimatedMonthlyRecurringRevenueSar,
      recentSignups: recentOrgs.map((o) => ({
        id: o.id,
        name: o.name,
        createdAt: o.createdAt,
        plan: o.subscription?.plan.name ?? null,
      })),
    };
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
