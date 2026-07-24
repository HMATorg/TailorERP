import { Controller, Get, Query } from '@nestjs/common';
import { CurrentStoreId, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('hq')
  @RequirePermissions('view_dashboard')
  hq(
    @CurrentUser() principal: AccessTokenPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.dashboard.hqDashboard(principal.sub, principal.orgId!, from, to);
  }

  @Get('store')
  @RequirePermissions('view_dashboard')
  store(@CurrentStoreId() storeId: string) {
    return this.dashboard.storeDashboard(storeId);
  }
}
