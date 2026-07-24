import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { PlatformAdminLevel } from '@tailonix/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AccessTokenPayload } from '../auth.types';

export const ADMIN_LEVELS_KEY = 'requiredAdminLevels';
/** Restrict a platform endpoint to specific admin levels (default: any active platform admin). */
export const RequireAdminLevel = (...levels: PlatformAdminLevel[]) =>
  SetMetadata(ADMIN_LEVELS_KEY, levels);

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { principal?: AccessTokenPayload }>();
    const principal = request.principal;
    if (!principal) throw new UnauthorizedException();
    if (principal.typ !== 'platform') {
      throw new ForbiddenException('Platform admin credentials required');
    }

    // Always re-validate against the platform_admins table (TRD §6.3)
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { userId: principal.sub },
      include: { user: { select: { isActive: true } } },
    });
    if (!admin || !admin.isActive || !admin.user.isActive) {
      throw new ForbiddenException('Platform admin access revoked');
    }

    const levels = this.reflector.getAllAndOverride<PlatformAdminLevel[]>(ADMIN_LEVELS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (levels && levels.length > 0 && !levels.includes(admin.adminLevel)) {
      throw new ForbiddenException(`Requires admin level: ${levels.join(' or ')}`);
    }
    return true;
  }
}
