import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { LedgerService } from './ledger.service';

@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  /** Sets up the standard chart of accounts. Safe to call repeatedly. */
  @Post('accounts/bootstrap')
  @RequirePermissions('manage_stores')
  bootstrap(@CurrentUser() principal: AccessTokenPayload) {
    return this.ledger
      .ensureChartOfAccounts(principal.orgId!)
      .then((created) => ({ created }));
  }

  @Get('trial-balance')
  @RequirePermissions('view_dashboard')
  trialBalance(@CurrentUser() principal: AccessTokenPayload, @Query('asOf') asOf?: string) {
    return this.ledger.trialBalance(principal.orgId!, asOf ? new Date(asOf) : undefined);
  }

  @Get('accounts/:code')
  @RequirePermissions('view_dashboard')
  statement(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('code') code: string,
    @Query('limit') limit?: string,
  ) {
    return this.ledger.accountStatement(principal.orgId!, code, limit ? Number(limit) : 100);
  }
}
