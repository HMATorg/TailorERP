import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentStoreId, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { AppointmentsService } from './appointments.service';
import { AvailabilityService } from './availability.service';
import { UpdateAppointmentStatusDto } from './dto/appointments.dto';

@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly availability: AvailabilityService,
  ) {}

  @Get()
  @RequirePermissions('manage_appointments')
  list(@CurrentStoreId() storeId: string, @Query('date') date?: string) {
    return this.appointments.listForStore(storeId, date);
  }

  @Get('availability')
  @RequirePermissions('manage_appointments')
  slots(@CurrentStoreId() storeId: string, @Query('date') date: string) {
    return this.availability.getSlots(storeId, date);
  }

  @Put(':id')
  @RequirePermissions('manage_appointments')
  update(
    @CurrentUser() principal: AccessTokenPayload,
    @CurrentStoreId() storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentStatusDto,
  ) {
    return this.appointments.updateForStaff(storeId, principal.sub, id, dto);
  }
}
