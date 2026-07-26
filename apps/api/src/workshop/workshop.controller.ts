import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
import type { ProductionStation } from '@prisma/client';
import { CurrentStoreId, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { MeasurementsService } from '../measurements/measurements.service';
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
  constructor(
    private readonly workshop: WorkshopService,
    private readonly measurements: MeasurementsService,
  ) {}

  /**
   * The measurements behind a ticket, for the workshop tablet.
   *
   * Returns the snapshot the garment was actually cut against plus the full
   * history for that garment, so a worker mid-seam can check a figure without
   * leaving the floor or asking the counter. Flags when a newer version exists
   * rather than swapping to it — re-measuring a customer must not silently
   * change what is on the cutting table.
   */
  @Get('tickets/:id/measurements')
  @RequirePermissions('view_workshop', 'view_measurements')
  ticketMeasurements(
    @CurrentStoreId() storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.measurements.forTicket(storeId, id);
  }

  @Get('board')
  @RequirePermissions('view_workshop')
  board(@CurrentStoreId() storeId: string) {
    return this.workshop.board(storeId);
  }

  /** Barcode scan — the workshop tablet's primary action. */
  @Get('tickets/by-code/:code')
  @RequirePermissions('view_workshop')
  scan(@CurrentStoreId() storeId: string, @Param('code') code: string) {
    return this.workshop.findByCode(storeId, code);
  }

  @Post('orders/:orderId/tickets')
  @RequirePermissions('manage_workshop')
  createTickets(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.workshop.createTicketsForOrder(orderId, principal.sub);
  }

  @Put('tickets/:id/station')
  @RequirePermissions('manage_workshop')
  move(
    @CurrentUser() principal: AccessTokenPayload,
    @CurrentStoreId() storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveTicketDto,
  ) {
    return this.workshop.moveTicket(storeId, id, dto.toStation, principal.sub, dto.note);
  }

  @Put('tickets/:id/assign')
  @RequirePermissions('manage_workshop')
  assign(
    @CurrentUser() principal: AccessTokenPayload,
    @CurrentStoreId() storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
  ) {
    return this.workshop.assign(storeId, id, dto.assigneeId, principal.sub);
  }

  @Get('workload')
  @RequirePermissions('view_workshop')
  workload(@CurrentStoreId() storeId: string) {
    return this.workshop.workerLoad(storeId);
  }
}
