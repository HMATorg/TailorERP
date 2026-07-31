import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  PlatformAdminGuard,
  RequireAdminLevel,
} from '../auth/guards/platform-admin.guard';
import type { AccessTokenPayload } from '../auth/auth.types';
import {
  ChangeSubscriptionDto,
  CreateOrganizationDto,
  CreatePlatformAdminDto,
  UpdateOrganizationDto,
  UpdatePlatformAdminDto,
  UpsertPlanDto,
} from './dto/platform.dto';
import { PlatformService } from './platform.service';

@Controller('admin')
@UseGuards(PlatformAdminGuard)
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('metrics')
  @RequireAdminLevel('super_admin', 'billing', 'support')
  getMetrics() {
    return this.platform.getMetrics();
  }

  @Get('organizations')
  @RequireAdminLevel('super_admin', 'billing', 'support')
  listOrganizations(@Query('status') status?: string, @Query('search') search?: string) {
    return this.platform.listOrganizations({ status, search });
  }

  @Get('organizations/:id')
  @RequireAdminLevel('super_admin', 'billing', 'support')
  getOrganization(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.getOrganization(id);
  }

  @Post('organizations')
  @RequireAdminLevel('super_admin')
  createOrganization(
    @CurrentUser() principal: AccessTokenPayload,
    @Body() dto: CreateOrganizationDto,
    @Ip() ip: string,
  ) {
    return this.platform.createOrganization(principal.sub, dto, ip);
  }

  @Put('organizations/:id')
  @RequireAdminLevel('super_admin')
  updateOrganization(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
    @Ip() ip: string,
  ) {
    return this.platform.updateOrganization(principal.sub, id, dto, ip);
  }

  @Get('organizations/:id/subscription')
  @RequireAdminLevel('super_admin', 'billing')
  getSubscription(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.getOrganization(id).then((o) => o.subscription);
  }

  @Put('organizations/:id/subscription')
  @RequireAdminLevel('super_admin', 'billing')
  changeSubscription(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeSubscriptionDto,
    @Ip() ip: string,
  ) {
    return this.platform.changeSubscription(principal.sub, id, dto, ip);
  }

  @Get('plans')
  @RequireAdminLevel('super_admin', 'billing', 'support')
  listPlans() {
    return this.platform.listPlans();
  }

  @Post('plans')
  @RequireAdminLevel('super_admin')
  upsertPlan(
    @CurrentUser() principal: AccessTokenPayload,
    @Body() dto: UpsertPlanDto,
    @Ip() ip: string,
  ) {
    return this.platform.upsertPlan(principal.sub, dto, ip);
  }

  @Post('organizations/:id/impersonate')
  @RequireAdminLevel('super_admin', 'support')
  impersonate(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ) {
    return this.platform.impersonate(principal.sub, id, ip);
  }

  // ── Platform admin accounts (D-060) — super_admin only ──

  @Get('platform-admins')
  @RequireAdminLevel('super_admin')
  listPlatformAdmins() {
    return this.platform.listPlatformAdmins();
  }

  @Post('platform-admins')
  @RequireAdminLevel('super_admin')
  createPlatformAdmin(
    @CurrentUser() principal: AccessTokenPayload,
    @Body() dto: CreatePlatformAdminDto,
    @Ip() ip: string,
  ) {
    return this.platform.createPlatformAdmin(principal.sub, dto, ip);
  }

  @Put('platform-admins/:id')
  @RequireAdminLevel('super_admin')
  updatePlatformAdmin(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlatformAdminDto,
    @Ip() ip: string,
  ) {
    return this.platform.updatePlatformAdmin(principal.sub, id, dto, ip);
  }

  @Get('audit-logs')
  @RequireAdminLevel('super_admin', 'support')
  auditLogs(
    @Query('organizationId') organizationId?: string,
    @Query('action') action?: string,
    @Query('page') page?: string,
  ) {
    return this.platform.listAuditLogs({
      organizationId,
      action,
      page: page ? Number(page) : undefined,
    });
  }
}
