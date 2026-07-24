import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AccessTokenPayload } from '../auth.types';

/** Injects the verified JWT payload attached by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenPayload => {
    return ctx.switchToHttp().getRequest().principal;
  },
);

/** Injects the validated store context (set by PermissionsGuard from X-Store-Id). */
export const CurrentStoreId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    return ctx.switchToHttp().getRequest().storeId;
  },
);
