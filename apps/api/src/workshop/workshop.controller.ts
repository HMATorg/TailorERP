import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
import type { ProductionStation } from '@prisma/client';
import { CurrentStoreId, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { STATION_ORDER, WorkshopService } from './workshop.service';

class MoveTicketDto {
  @IsIn(STATION_ORDER)
  toStation: ProductionStation;

  @IsString()
  @IsOptional()
  note?: string;
}

class AssignTicketDto {
  /** null unassigns */
  @ValidateIf((o) => o.assigneeId !== null)
  @IsUUID()
  assigneeId: string | null;
}

@Controller('workshop')
export class WorkshopController {
  constructor(private readonly workshop: WorkshopService) {}

  @Get('board')
  @RequirePermissions('view_orders')
  board(@CurrentStoreId() storeId: string) {
    return this.workshop.board(storeId);
  }

  /** Barcode scan — the workshop tablet's primary action. */
  @Get('tickets/by-code/:code')
  @RequirePermissions('view_orders')
  scan(@CurrentStoreId() storeId: string, @Param('code') code: string) {
    return this.workshop.findByCode(storeId, code);
  }

  @Post('orders/:orderId/tickets')
  @RequirePermissions('manage_orders')
  createTickets(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.workshop.createTicketsForOrder(orderId, principal.sub);
  }

  @Put('tickets/:id/station')
  @RequirePermissions('update_order_status')
  move(
    @CurrentUser() principal: AccessTokenPayload,
    @CurrentStoreId() storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveTicketDto,
  ) {
    return this.workshop.moveTicket(storeId, id, dto.toStation, principal.sub, dto.note);
  }

  @Put('tickets/:id/assign')
  @RequirePermissions('manage_orders')
  assign(
    @CurrentUser() principal: AccessTokenPayload,
    @CurrentStoreId() storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
  ) {
    return this.workshop.assign(storeId, id, dto.assigneeId, principal.sub);
  }

  @Get('workload')
  @RequirePermissions('view_dashboard')
  workload(@CurrentStoreId() storeId: string) {
    return this.workshop.workerLoad(storeId);
  }
}
