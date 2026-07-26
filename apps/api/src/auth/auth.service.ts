import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  computeEffectivePermissions,
  PERMISSIONS,
  type PermissionOverrides,
} from '@tailonix/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from './token.service';
import type { AuthTokens } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /** Tenant staff login (email/password → 1h access + 7d rotating refresh). */
  async staffLogin(email: string, password: string, ip?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        organization: { select: { id: true, name: true, status: true } },
        storeRoles: {
          where: { isActive: true },
          include: { store: { select: { id: true, name: true, status: true } } },
        },
      },
    });
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.organizationId || !user.organization) {
      throw new UnauthorizedException('Not a tenant staff account');
    }
    if (user.organization.status === 'suspended') {
      throw new ForbiddenException('Organization is suspended — contact Tailonix support');
    }

    const tokens = await this.tokens.issueTokenPair(
      { sub: user.id, typ: 'staff', orgId: user.organizationId },
      ip,
    );

    // Effective permissions per store travel with the login so a client can hide
    // what the user cannot do, instead of rendering buttons that 403. Computed
    // server-side because per-user JSONB grants/revokes are invisible to a client
    // that only knows the role name. The API still enforces independently — this
    // is for the UI, never a substitute for the guard.
    const stores =
      user.orgRole === 'hq_admin'
        ? (
            await this.prisma.store.findMany({
              where: { organizationId: user.organizationId },
              select: { id: true, name: true, status: true, isHeadquarters: true },
              orderBy: [{ isHeadquarters: 'desc' }, { name: 'asc' }],
            })
          ).map((s) => ({ ...s, role: 'hq_admin' as const, permissions: [...PERMISSIONS] }))
        : user.storeRoles.map((r) => ({
            ...r.store,
            role: r.role,
            permissions: [
              ...computeEffectivePermissions(
                r.role,
                r.permissions as PermissionOverrides | null,
              ),
            ],
          }));

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        orgRole: user.orgRole,
        organization: { id: user.organization.id, name: user.organization.name },
        storeRoles: user.storeRoles.map((r) => ({ storeId: r.storeId, role: r.role })),
      },
      stores,
      ...tokens,
    };
  }

  async staffRefresh(refreshToken: string, ip?: string): Promise<AuthTokens> {
    const { subjectId, refreshToken: newRefresh } = await this.tokens.rotateRefreshToken(
      refreshToken,
      'staff',
      ip,
    );
    const user = await this.prisma.user.findUnique({ where: { id: subjectId } });
    if (!user || !user.isActive || !user.organizationId) {
      throw new UnauthorizedException('Account is no longer active');
    }
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      typ: 'staff',
      orgId: user.organizationId,
    });
    return {
      accessToken,
      refreshToken: newRefresh,
      expiresIn: this.tokens.accessTtlSeconds('staff'),
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revokeRefreshToken(refreshToken);
  }

  /** Platform admin login — separate credential path (TRD §7.1). */
  async platformLogin(email: string, password: string, ip?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { platformAdmin: true },
    });
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.platformAdmin || !user.platformAdmin.isActive) {
      throw new ForbiddenException('Not a platform admin account');
    }
    const tokens = await this.tokens.issueTokenPair(
      { sub: user.id, typ: 'platform', adminLevel: user.platformAdmin.adminLevel },
      ip,
    );
    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        adminLevel: user.platformAdmin.adminLevel,
      },
      ...tokens,
    };
  }
}
