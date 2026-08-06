import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import {
  computeEffectivePermissions,
  PERMISSIONS,
  type PermissionOverrides,
} from '@tailonix/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from './token.service';
import type { AuthTokens } from './auth.types';

const STAFF_SESSION_USER_INCLUDE = {
  organization: {
    select: {
      id: true,
      name: true,
      status: true,
      vatNumber: true,
      taxId: true,
      crNumber: true,
      licenseNumber: true,
      logoUrl: true,
    },
  },
  storeRoles: {
    where: { isActive: true },
    include: { store: { select: { id: true, name: true, status: true } } },
  },
} satisfies Prisma.UserInclude;

type StaffSessionUser = Prisma.UserGetPayload<{ include: typeof STAFF_SESSION_USER_INCLUDE }>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * The `{user, stores}` shape both a fresh login and a resumed session
   * (impersonation handoff, D-060) need — factored out so the two paths
   * cannot drift into returning different shapes for the same account.
   */
  private async buildStaffSession(user: StaffSessionUser) {
    // Effective permissions per store travel with the login so a client can hide
    // what the user cannot do, instead of rendering buttons that 403. Computed
    // server-side because per-user JSONB grants/revokes are invisible to a client
    // that only knows the role name. The API still enforces independently — this
    // is for the UI, never a substitute for the guard.
    const stores =
      user.orgRole === 'hq_admin'
        ? (
            await this.prisma.store.findMany({
              where: { organizationId: user.organizationId! },
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
        organization: {
          id: user.organization!.id,
          name: user.organization!.name,
          // Carried so any print surface (thermal receipt, garment tags) can
          // show the seller's VAT registration without a second request —
          // the same number InvoicePdfService already prints on the A4 invoice.
          vatNumber: user.organization!.vatNumber,
          taxId: user.organization!.taxId,
          // Same reasoning, for the CR/license numbers and logo a thermal
          // receipt now prints (D-069).
          crNumber: user.organization!.crNumber,
          licenseNumber: user.organization!.licenseNumber,
          logoUrl: user.organization!.logoUrl,
        },
        storeRoles: user.storeRoles.map((r) => ({ storeId: r.storeId, role: r.role })),
      },
      stores,
    };
  }

  /** Tenant staff login (email/password → 1h access + 7d rotating refresh). */
  async staffLogin(email: string, password: string, ip?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: STAFF_SESSION_USER_INCLUDE,
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
    const session = await this.buildStaffSession(user);
    return { ...session, ...tokens };
  }

  /**
   * Resolves `{user, stores}` for an *already-issued* staff access token —
   * used by the impersonation handoff (D-060): the platform-admin app mints
   * a token via `PlatformService.impersonate`, hands the operator a link
   * into `apps/admin`, and `apps/admin` calls this to populate its own
   * session store correctly instead of expecting the operator to hand-craft
   * the zustand-persisted localStorage blob themselves (which is what the
   * previous "paste this into session storage" instruction actually
   * required, and which no operator could realistically do).
   */
  async staffSession(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: STAFF_SESSION_USER_INCLUDE,
    });
    if (!user || !user.isActive || !user.organizationId || !user.organization) {
      throw new UnauthorizedException('Account is no longer active');
    }
    if (user.organization.status === 'suspended') {
      throw new ForbiddenException('Organization is suspended — contact Tailonix support');
    }
    return this.buildStaffSession(user);
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

  /**
   * Platform admin refresh — its own method, same as `customerRefresh` in
   * `otp.service.ts` (D-060). `staffRefresh` hardcodes `'staff'` as the
   * expected `subjectType`, so a platform-typed refresh token was rejected
   * outright: every platform-admin session died at the access-token TTL
   * (1h) with no way to renew, forcing a full re-login. Re-validates against
   * `platformAdmin.isActive` on every refresh, same as `PlatformAdminGuard`
   * does on every request — revoking access takes effect immediately rather
   * than surviving until the next natural expiry.
   */
  async platformRefresh(refreshToken: string, ip?: string): Promise<AuthTokens> {
    const { subjectId, refreshToken: newRefresh } = await this.tokens.rotateRefreshToken(
      refreshToken,
      'platform',
      ip,
    );
    const user = await this.prisma.user.findUnique({
      where: { id: subjectId },
      include: { platformAdmin: true },
    });
    if (!user || !user.isActive || !user.platformAdmin || !user.platformAdmin.isActive) {
      throw new UnauthorizedException('Account is no longer active');
    }
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      typ: 'platform',
      adminLevel: user.platformAdmin.adminLevel,
    });
    return {
      accessToken,
      refreshToken: newRefresh,
      expiresIn: this.tokens.accessTtlSeconds('platform'),
    };
  }
}
