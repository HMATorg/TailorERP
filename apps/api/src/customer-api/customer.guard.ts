import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AccessTokenPayload } from '../auth/auth.types';

@Injectable()
export class CustomerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { principal?: AccessTokenPayload }>();
    if (!request.principal) throw new UnauthorizedException();
    if (request.principal.typ !== 'customer') {
      throw new ForbiddenException('Customer credentials required');
    }
    return true;
  }
}
