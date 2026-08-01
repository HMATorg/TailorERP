import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import { staffInvitation } from '../notifications/email-templates';
import { MailerService } from '../notifications/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureGateService } from '../platform/feature-gate.service';
import type {
  AcceptInviteDto,
  InviteUserDto,
  StoreAssignmentDto,
  UpdateUserRolesDto,
} from './dto/team.dto';

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
    private readonly featureGate: FeatureGateService,
  ) {}

  private async assertActorCanGrantHq(actorId: string, wantsHq: boolean) {
    if (!wantsHq) return;
    const actor = await this.prisma.user.findUnique({ where: { id: actorId } });
    if (actor?.orgRole !== 'hq_admin') {
      throw new ForbiddenException('Only an HQ Admin can grant HQ Admin access');
    }
  }

  /** Assigning the regional_manager role is an Enterprise-plan feature (D-060). */
  private async assertRegionalManagerAllowed(orgId: string, assignments: StoreAssignmentDto[]) {
    if (assignments.some((a) => a.role === 'regional_manager')) {
      await this.featureGate.assertFeature(orgId, 'regional_managers');
    }
  }

  private async assertStoresInOrg(orgId: string, assignments: StoreAssignmentDto[]) {
    if (assignments.length === 0) return;
    const count = await this.prisma.store.count({
      where: { id: { in: assignments.map((a) => a.storeId) }, organizationId: orgId },
    });
    if (count !== new Set(assignments.map((a) => a.storeId)).size) {
      throw new BadRequestException('One or more stores do not belong to your organization');
    }
  }

  async listUsers(orgId: string) {
    const users = await this.prisma.user.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        orgRole: true,
        isActive: true,
        createdAt: true,
        storeRoles: {
          where: { isActive: true },
          select: {
            storeId: true,
            role: true,
            permissions: true,
            store: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const pendingInvites = await this.prisma.invitation.findMany({
      where: { organizationId: orgId, status: 'pending', expiresAt: { gt: new Date() } },
      select: { id: true, email: true, fullName: true, assignments: true, createdAt: true },
    });
    return { users, pendingInvites };
  }

  async invite(orgId: string, actorId: string, dto: InviteUserDto, ip?: string) {
    const assignments = dto.assignments ?? [];
    if (!dto.asHqAdmin && assignments.length === 0) {
      throw new BadRequestException('Provide store assignments or asHqAdmin');
    }
    await this.assertActorCanGrantHq(actorId, dto.asHqAdmin === true);
    await this.assertStoresInOrg(orgId, assignments);
    await this.assertRegionalManagerAllowed(orgId, assignments);

    const email = dto.email.toLowerCase();
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    // Plan seat limit (PRD §4.5)
    const subscription = await this.prisma.organizationSubscription.findUnique({
      where: { organizationId: orgId },
      include: { plan: true },
    });
    if (subscription) {
      const userCount = await this.prisma.user.count({
        where: { organizationId: orgId, isActive: true },
      });
      if (userCount >= subscription.plan.maxUsers) {
        throw new HttpException(
          `Your ${subscription.plan.name} plan allows ${subscription.plan.maxUsers} users — upgrade to add more`,
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
    }

    if (dto.password) {
      return this.createDirectly(orgId, actorId, dto, assignments, ip);
    }

    const token = randomBytes(32).toString('hex');
    const invitation = await this.prisma.invitation.create({
      data: {
        organizationId: orgId,
        email,
        fullName: dto.fullName,
        phone: dto.phone,
        orgRole: dto.asHqAdmin ? 'hq_admin' : null,
        assignments: assignments as unknown as Prisma.InputJsonValue,
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        invitedById: actorId,
      },
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: actorId,
      action: 'team.user_invited',
      entityType: 'invitation',
      entityId: invitation.id,
      newValue: { email, asHqAdmin: dto.asHqAdmin ?? false, assignments },
      ip,
    });

    await this.sendInvitationEmail(invitation.id, actorId, orgId, email, token, assignments);

    const isDev = this.config.get('NODE_ENV') !== 'production';
    return {
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      ...(isDev ? { devAcceptToken: token } : {}),
    };
  }

  /**
   * Admin sets the password directly instead of emailing an invite (useful
   * when mail isn't configured, or the admin is handing credentials to the
   * new hire in person). Creates the same shape acceptInvite() would have
   * produced, just without the intermediate Invitation row.
   */
  private async createDirectly(
    orgId: string,
    actorId: string,
    dto: InviteUserDto,
    assignments: StoreAssignmentDto[],
    ip?: string,
  ) {
    const email = dto.email.toLowerCase();
    const passwordHash = await bcrypt.hash(dto.password as string, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName: dto.fullName,
          phone: dto.phone,
          organizationId: orgId,
          orgRole: dto.asHqAdmin ? 'hq_admin' : null,
        },
      });
      if (assignments.length > 0) {
        await tx.userStoreRole.createMany({
          data: assignments.map((a) => ({
            userId: created.id,
            storeId: a.storeId,
            role: a.role,
            permissions: (a.permissions ?? {}) as Prisma.InputJsonValue,
          })),
        });
      }
      return created;
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: actorId,
      action: 'team.user_created_directly',
      entityType: 'user',
      entityId: user.id,
      newValue: { email, asHqAdmin: dto.asHqAdmin ?? false, assignments },
      ip,
    });

    return { id: user.id, email: user.email, fullName: user.fullName, createdDirectly: true };
  }

  /** Sends the invite email; delivery problems must not fail the invitation. */
  private async sendInvitationEmail(
    invitationId: string,
    actorId: string,
    orgId: string,
    email: string,
    token: string,
    assignments: StoreAssignmentDto[],
  ): Promise<void> {
    try {
      const [org, inviter, stores] = await Promise.all([
        this.prisma.organization.findUnique({
          where: { id: orgId },
          select: { name: true },
        }),
        this.prisma.user.findUnique({
          where: { id: actorId },
          select: { fullName: true, email: true },
        }),
        assignments.length > 0
          ? this.prisma.store.findMany({
              where: { id: { in: assignments.map((a) => a.storeId) } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
      ]);

      const storeNames = new Map(stores.map((s) => [s.id, s.name]));
      const roleSummary =
        assignments.length > 0
          ? assignments
              .map(
                (a) =>
                  `${a.role.replace('_', ' ')} at ${storeNames.get(a.storeId) ?? 'a store'}`,
              )
              .join(', ')
          : 'HQ Admin (all stores)';

      const baseUrl = this.config.get<string>('ADMIN_APP_URL', 'http://localhost:5173');
      await this.mailer.send({
        to: email,
        ...staffInvitation({
          organizationName: org?.name ?? 'your organisation',
          inviterName: inviter?.fullName ?? inviter?.email ?? 'A colleague',
          acceptUrl: `${baseUrl}/accept-invite?token=${token}`,
          roleSummary,
        }),
      });
    } catch {
      // The invitation row exists regardless; it can be resent from Team.
      this.logger.warn(`Invitation email to ${email} could not be sent (id ${invitationId})`);
    }
  }

  async acceptInvite(dto: AcceptInviteDto) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token: dto.token },
    });
    if (!invitation || invitation.status !== 'pending') {
      throw new BadRequestException('Invitation is invalid or already used');
    }
    if (invitation.expiresAt < new Date()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'expired' },
      });
      throw new BadRequestException('Invitation has expired');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const assignments = (invitation.assignments as unknown as StoreAssignmentDto[]) ?? [];

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: invitation.email,
          passwordHash,
          fullName: dto.fullName ?? invitation.fullName,
          phone: invitation.phone,
          organizationId: invitation.organizationId,
          orgRole: invitation.orgRole,
        },
      });
      if (assignments.length > 0) {
        await tx.userStoreRole.createMany({
          data: assignments.map((a) => ({
            userId: created.id,
            storeId: a.storeId,
            role: a.role,
            permissions: (a.permissions ?? {}) as Prisma.InputJsonValue,
          })),
        });
      }
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'accepted' },
      });
      return created;
    });

    await this.audit.log({
      organizationId: invitation.organizationId,
      actorUserId: user.id,
      action: 'team.invite_accepted',
      entityType: 'user',
      entityId: user.id,
    });
    return { id: user.id, email: user.email, fullName: user.fullName };
  }

  async updateRoles(
    orgId: string,
    actorId: string,
    userId: string,
    dto: UpdateUserRolesDto,
    ip?: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: orgId },
      include: { storeRoles: true },
    });
    if (!user) throw new NotFoundException('User not found in your organization');

    await this.assertActorCanGrantHq(actorId, dto.asHqAdmin === true);
    const assignments = dto.assignments ?? [];
    await this.assertStoresInOrg(orgId, assignments);
    await this.assertRegionalManagerAllowed(orgId, assignments);

    const oldValue = {
      orgRole: user.orgRole,
      assignments: user.storeRoles.map((r) => ({ storeId: r.storeId, role: r.role })),
    };

    await this.prisma.$transaction(async (tx) => {
      if (dto.asHqAdmin !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { orgRole: dto.asHqAdmin ? 'hq_admin' : null },
        });
      }
      if (dto.assignments !== undefined) {
        await tx.userStoreRole.deleteMany({ where: { userId } });
        if (assignments.length > 0) {
          await tx.userStoreRole.createMany({
            data: assignments.map((a) => ({
              userId,
              storeId: a.storeId,
              role: a.role,
              permissions: (a.permissions ?? {}) as Prisma.InputJsonValue,
            })),
          });
        }
      }
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: actorId,
      action: 'team.roles_updated',
      entityType: 'user',
      entityId: userId,
      oldValue,
      newValue: { asHqAdmin: dto.asHqAdmin, assignments },
      ip,
    });
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        orgRole: true,
        storeRoles: { select: { storeId: true, role: true, permissions: true } },
      },
    });
  }

  async updateStatus(
    orgId: string,
    actorId: string,
    userId: string,
    isActive: boolean,
    ip?: string,
  ) {
    if (actorId === userId) {
      throw new BadRequestException('You cannot change your own active status');
    }
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: orgId },
    });
    if (!user) throw new NotFoundException('User not found in your organization');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
    });
    await this.audit.log({
      organizationId: orgId,
      actorUserId: actorId,
      action: isActive ? 'team.user_activated' : 'team.user_deactivated',
      entityType: 'user',
      entityId: userId,
      oldValue: { isActive: user.isActive },
      newValue: { isActive },
      ip,
    });
    return { id: updated.id, isActive: updated.isActive };
  }
}
