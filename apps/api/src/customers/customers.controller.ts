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
import { MeasurementsService } from '../measurements/measurements.service';
import { CustomersService } from './customers.service';
import {
  CreateCustomerDto,
  CreateMeasurementDto,
  UpdateCustomerDto,
} from './dto/customers.dto';

@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly measurements: MeasurementsService,
  ) {}

  @Get()
  @RequirePermissions('view_customers')
  list(
    @CurrentUser() principal: AccessTokenPayload,
    @Query('search') search?: string,
    @Query('page') page?: string,
  ) {
    return this.customers.list(principal.orgId!, {
      search,
      page: page ? Number(page) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('view_customers')
  get(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customers.getById(principal.orgId!, id);
  }

  @Post()
  @RequirePermissions('manage_customers')
  create(
    @CurrentUser() principal: AccessTokenPayload,
    @CurrentStoreId() storeId: string | undefined,
    @Body() dto: CreateCustomerDto,
    @Ip() ip: string,
  ) {
    return this.customers.create(principal.orgId!, storeId, principal.sub, dto, ip);
  }

  @Put(':id')
  @RequirePermissions('manage_customers')
  update(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @Ip() ip: string,
  ) {
    return this.customers.update(principal.orgId!, principal.sub, id, dto, ip);
  }

  /** The snapshots currently being cut against — one per garment type. */
  @Get(':id/measurements')
  @RequirePermissions('view_measurements')
  activeMeasurements(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.measurements.activeForStaff(principal.orgId!, id);
  }

  /**
   * Every version ever taken, grouped by garment. Separately permissioned from
   * the active set: a tailor re-cutting an old order needs the superseded
   * numbers, a cashier quoting a new one does not.
   */
  @Get(':id/measurements/history')
  @RequirePermissions('view_measurement_history')
  measurementHistory(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.measurements.historyForStaff(principal.orgId!, id);
  }

  @Post(':id/measurements')
  @RequirePermissions('manage_measurements')
  addMeasurement(
    @CurrentUser() principal: AccessTokenPayload,
    @CurrentStoreId() storeId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMeasurementDto,
  ) {
    return this.customers.addMeasurement(principal.orgId!, storeId, principal.sub, id, dto);
  }
}
