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
} from '@nestjs/common';
import { CurrentStoreId, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { AlertsService } from './alerts.service';
import {
  AdjustBatchDto,
  AlertActionDto,
  CreateBatchDto,
  ResolveAlertDto,
  TransferDto,
  UpsertReorderSettingDto,
} from './dto/inventory.dto';
import { InventoryService } from './inventory.service';
import { ReservationService } from './reservation.service';

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly alerts: AlertsService,
    private readonly reservations: ReservationService,
  ) {}

  @Post('batches')
  @RequirePermissions('manage_inventory')
  createBatch(
    @CurrentUser() principal: AccessTokenPayload,
    @CurrentStoreId() storeId: string,
    @Body() dto: CreateBatchDto,
    @Ip() ip: string,
  ) {
    return this.inventory.createBatch(storeId, principal.sub, dto, ip);
  }

  /**
   * Rolls that can supply `requiredMeters` and still stay above their minimum
   * usable point (v4 Phase 2). This is what the POS fabric picker lists —
   * offering a roll that would be stranded is the error we are preventing.
   */
  @Get('sellable')
  @RequirePermissions('view_inventory')
  sellable(
    @CurrentStoreId() storeId: string,
    @Query('requiredMeters') requiredMeters: string,
    @Query('fabricName') fabricName?: string,
  ) {
    return this.reservations.sellableRolls(storeId, Number(requiredMeters ?? 0), fabricName);
  }

  @Get('batches')
  @RequirePermissions('view_inventory')
  listBatches(
    @CurrentStoreId() storeId: string,
    @Query('search') search?: string,
    @Query('fabricName') fabricName?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.inventory.listBatches(storeId, {
      search,
      fabricName,
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('batches/:id')
  @RequirePermissions('view_inventory')
  getBatch(@CurrentStoreId() storeId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.getBatch(storeId, id);
  }

  @Get('batches/:id/movements')
  @RequirePermissions('view_inventory')
  getMovements(
    @CurrentStoreId() storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
  ) {
    return this.inventory.getMovements(storeId, id, page ? Number(page) : 1);
  }

  @Put('batches/:id/adjust')
  @RequirePermissions('manage_inventory')
  adjust(
    @CurrentUser() principal: AccessTokenPayload,
    @CurrentStoreId() storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustBatchDto,
    @Ip() ip: string,
  ) {
    return this.inventory.adjustBatch(storeId, principal.sub, id, dto, ip);
  }

  @Post('transfer')
  @RequirePermissions('transfer_inventory')
  transfer(
    @CurrentUser() principal: AccessTokenPayload,
    @Body() dto: TransferDto,
    @Ip() ip: string,
  ) {
    return this.inventory.transfer(principal.orgId!, principal.sub, dto, ip);
  }

  @Get('alerts')
  @RequirePermissions('view_inventory')
  listAlerts(
    @CurrentUser() principal: AccessTokenPayload,
    @CurrentStoreId() storeId: string,
    @Query('status') status?: string,
  ) {
    return this.alerts.listAlerts(principal.orgId!, storeId, status);
  }

  @Put('alerts/:id')
  @RequirePermissions('manage_inventory')
  actionAlert(
    @CurrentUser() principal: AccessTokenPayload,
    @CurrentStoreId() storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AlertActionDto,
  ) {
    return this.alerts.setAlertStatus(storeId, principal.sub, id, dto.status);
  }

  @Put('alerts/:id/resolve')
  @RequirePermissions('manage_inventory')
  resolveAlert(
    @CurrentUser() principal: AccessTokenPayload,
    @CurrentStoreId() storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveAlertDto,
  ) {
    return this.alerts.setAlertStatus(storeId, principal.sub, id, 'resolved', dto.note);
  }

  @Get('reorder-settings')
  @RequirePermissions('view_inventory')
  listReorderSettings(@CurrentStoreId() storeId: string) {
    return this.alerts.listReorderSettings(storeId);
  }

  @Put('reorder-settings')
  @RequirePermissions('manage_inventory')
  upsertReorderSetting(
    @CurrentStoreId() storeId: string,
    @Body() dto: UpsertReorderSettingDto,
  ) {
    return this.alerts.upsertReorderSetting(storeId, dto);
  }
}
