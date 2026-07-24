import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AcceptInviteDto,
  InviteUserDto,
  StoreAssignmentDto,
  UpdateUserRolesDto,
} from './dto/team.dto';

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private async assertActorCanGrantHq(actorId: string, wantsHq: boolean) {
    if (!wantsHq) return;
    const actor = await this.prisma.user.findUnique({ where: { id: actorId } });
    if (actor?.orgRole !== 'hq_admin') {
      throw new ForbiddenException('Only an HQ Admin can grant HQ Admin access');
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

    // TODO(task #10): send invitation email via email-queue.
    const isDev = this.config.get('NODE_ENV') !== 'production';
    return {
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      ...(isDev ? { devAcceptToken: token } : {}),
    };
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
