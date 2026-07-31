import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';

/**
 * PlatformAdminGuard (D-060) — the only thing standing between `/admin/*`
 * and a tenant-staff token, plus the guard that makes revoking a platform
 * admin's access take effect immediately rather than surviving until token
 * expiry (TRD §6.3, exercised end-to-end by
 * `platform-admin.e2e-spec.ts`'s revoke test, but never in isolation).
 */
function build() {
  const prisma = { platformAdmin: { findUnique: jest.fn() } };
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
  const guard = new PlatformAdminGuard(reflector as never, prisma as never);
  return { guard, prisma, reflector };
}

function contextWith(principal: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ principal }) }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

describe('PlatformAdminGuard', () => {
  it('rejects a request with no principal at all (401)', async () => {
    const { guard } = build();
    await expect(guard.canActivate(contextWith(undefined))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a non-platform-typed token, e.g. tenant staff (403)', async () => {
    const { guard } = build();
    await expect(
      guard.canActivate(contextWith({ typ: 'staff', sub: 'user-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when no PlatformAdmin row exists for the token subject', async () => {
    const { guard, prisma } = build();
    prisma.platformAdmin.findUnique.mockResolvedValue(null);
    await expect(
      guard.canActivate(contextWith({ typ: 'platform', sub: 'user-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when the platform admin has been deactivated', async () => {
    const { guard, prisma } = build();
    prisma.platformAdmin.findUnique.mockResolvedValue({
      isActive: false,
      adminLevel: 'support',
      user: { isActive: true },
    });
    await expect(
      guard.canActivate(contextWith({ typ: 'platform', sub: 'user-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when the underlying user account has been deactivated', async () => {
    const { guard, prisma } = build();
    prisma.platformAdmin.findUnique.mockResolvedValue({
      isActive: true,
      adminLevel: 'support',
      user: { isActive: false },
    });
    await expect(
      guard.canActivate(contextWith({ typ: 'platform', sub: 'user-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('re-validates against the database on every call, not just the JWT', async () => {
    const { guard, prisma } = build();
    prisma.platformAdmin.findUnique.mockResolvedValue({
      isActive: true,
      adminLevel: 'support',
      user: { isActive: true },
    });
    await guard.canActivate(contextWith({ typ: 'platform', sub: 'user-1' }));
    await guard.canActivate(contextWith({ typ: 'platform', sub: 'user-1' }));
    expect(prisma.platformAdmin.findUnique).toHaveBeenCalledTimes(2);
  });

  it('allows any active platform admin through when no admin level is required', async () => {
    const { guard, prisma, reflector } = build();
    reflector.getAllAndOverride.mockReturnValue(undefined);
    prisma.platformAdmin.findUnique.mockResolvedValue({
      isActive: true,
      adminLevel: 'support',
      user: { isActive: true },
    });
    await expect(
      guard.canActivate(contextWith({ typ: 'platform', sub: 'user-1' })),
    ).resolves.toBe(true);
  });

  it('rejects an admin level not in the route\'s RequireAdminLevel allow-list', async () => {
    const { guard, prisma, reflector } = build();
    reflector.getAllAndOverride.mockReturnValue(['super_admin']);
    prisma.platformAdmin.findUnique.mockResolvedValue({
      isActive: true,
      adminLevel: 'support',
      user: { isActive: true },
    });
    await expect(
      guard.canActivate(contextWith({ typ: 'platform', sub: 'user-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an admin level that is in the allow-list', async () => {
    const { guard, prisma, reflector } = build();
    reflector.getAllAndOverride.mockReturnValue(['super_admin', 'billing']);
    prisma.platformAdmin.findUnique.mockResolvedValue({
      isActive: true,
      adminLevel: 'billing',
      user: { isActive: true },
    });
    await expect(
      guard.canActivate(contextWith({ typ: 'platform', sub: 'user-1' })),
    ).resolves.toBe(true);
  });
});
