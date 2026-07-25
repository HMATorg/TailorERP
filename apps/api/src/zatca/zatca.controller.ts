import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { ZatcaService } from './zatca.service';

@Controller('zatca')
export class ZatcaController {
  constructor(private readonly zatca: ZatcaService) {}

  /** Issue (or return the already-issued) compliant document for an invoice. */
  @Post('invoices/:id/issue')
  @RequirePermissions('process_payments')
  issue(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.zatca.issue(id, principal.sub);
  }

  @Post('invoices/:id/submit')
  @RequirePermissions('process_payments')
  submit(@Param('id', ParseUUIDPipe) id: string) {
    return this.zatca.submit(id);
  }

  /** Compliance self-check — hash chain integrity and ICV continuity. */
  @Get('compliance')
  @RequirePermissions('view_dashboard')
  compliance(@CurrentUser() principal: AccessTokenPayload) {
    return this.zatca.verifyChain(principal.orgId!);
  }
}
