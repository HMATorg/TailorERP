import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  computeEffectivePermissions,
  Permission,
  PermissionOverrides,
  STORE_ID_HEADER,
} from '@tailonix/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../auth.types';

/**
 * Enforces the RBAC model from TRD §4.1:
 * - hq_admin (org-scoped, D-004) holds all permissions for every store in their org.
 * - Store roles resolve via user_store_roles for the X-Store-Id header; effective
 *   permissions = role defaults + JSONB overrides.
 * Attaches the validated storeId/orgId to the request for downstream handlers.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { principal?: AccessTokenPayload; storeId?: string; orgId?: string }>();
    const principal = request.principal;
    if (!principal) throw new UnauthorizedException();
    if (principal.typ !== 'staff') {
      throw new ForbiddenException('Staff credentials required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: principal.sub },
      include: { storeRoles: { where: { isActive: true } } },
    });
    if (!user || !user.isActive || !user.organizationId) {
      throw new ForbiddenException('Account is inactive');
    }

    const requestedStoreId =
      (request.headers[STORE_ID_HEADER] as string | undefined) ?? undefined;

    // HQ admin: org-wide access to every store in their organization
    if (user.orgRole === 'hq_admin') {
      if (requestedStoreId) {
        const store = await this.prisma.store.findFirst({
          where: { id: requestedStoreId, organizationId: user.organizationId },
          select: { id: true },
        });
        if (!store) throw new ForbiddenException('Store not in your organization');
        request.storeId = requestedStoreId;
      }
      request.orgId = user.organizationId;
      return true;
    }

    // Store-scoped roles require an explicit store context
    if (!requestedStoreId) {
      throw new ForbiddenException(`Missing ${STORE_ID_HEADER} header`);
    }
    const assignment = user.storeRoles.find((r) => r.storeId === requestedStoreId);
    if (!assignment) {
      throw new ForbiddenException('You are not assigned to this store');
    }

    const effective = computeEffectivePermissions(
      assignment.role,
      assignment.permissions as PermissionOverrides | null,
    );
    const missing = required.filter((p) => !effective.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    }

    request.storeId = requestedStoreId;
    request.orgId = user.organizationId;
    return true;
  }
}
