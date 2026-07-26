import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentStoreId, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { PosCheckoutDto, PosSettleDto } from './dto/pos.dto';
import { PosService } from './pos.service';

@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}

  /** Phase 1 (legacy): the clerk types an exact phone number. */
  @Get('lookup')
  @RequirePermissions('use_pos', 'view_customers')
  lookup(@CurrentUser() principal: AccessTokenPayload, @Query('phone') phone: string) {
    return this.pos.lookupByPhone(principal.orgId!, phone);
  }

  /**
   * Phase 1 (rush-hour picker): recent customers with no query, filtered by
   * name/phone substring with one. Backs the search-as-you-type box so the
   * counter never needs a customer's exact, correctly-formatted phone number
   * before it can show anything.
   */
  @Get('customers')
  @RequirePermissions('use_pos', 'view_customers')
  directory(@CurrentUser() principal: AccessTokenPayload, @Query('search') search?: string) {
    return this.pos.directory(principal.orgId!, search);
  }

  /** Opens the full profile for a customer picked from the directory. */
  @Get('customers/:id')
  @RequirePermissions('use_pos', 'view_customers')
  lookupById(@CurrentUser() principal: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.pos.lookupById(principal.orgId!, id);
  }

  /** Phase 2: fabric metres this garment will need, before committing stock. */
  @Get('customers/:customerId/yield')
  @RequirePermissions('use_pos')
  previewYield(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query('garmentType') garmentType: string,
    @Query('quantity') quantity?: string,
  ) {
    return this.pos.previewYield(customerId, garmentType, quantity ? Number(quantity) : 1);
  }

  /** Phases 1–4 in one counter transaction. */
  @Post('orders')
  @RequirePermissions('pos_checkout')
  checkout(
    @CurrentUser() principal: AccessTokenPayload,
    @CurrentStoreId() storeId: string,
    @Body() dto: PosCheckoutDto,
    @Ip() ip: string,
  ) {
    return this.pos.checkout(principal.orgId!, storeId, principal.sub, dto, ip);
  }

  /** Phase 5 §3: balance paid at handover. */
  @Post('orders/:id/settle')
  @RequirePermissions('pos_settle')
  settle(
    @CurrentUser() principal: AccessTokenPayload,
    @CurrentStoreId() storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PosSettleDto,
  ) {
    return this.pos.settle(storeId, id, principal.sub, dto.amount, dto.method);
  }
}
