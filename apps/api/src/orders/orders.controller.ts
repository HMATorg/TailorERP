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
import {
  AddPaymentDto,
  CreateOrderDto,
  UpdateOrderStatusDto,
} from './dto/orders.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @RequirePermissions('create_orders')
  create(
    @CurrentUser() principal: AccessTokenPayload,
    @CurrentStoreId() storeId: string,
    @Body() dto: CreateOrderDto,
    @Ip() ip: string,
  ) {
    return this.orders.create(principal.orgId!, storeId, principal.sub, dto, ip);
  }

  @Get()
  @RequirePermissions('view_orders')
  list(
    @CurrentStoreId() storeId: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.orders.list(storeId, {
      status,
      customerId,
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('view_orders')
  get(@CurrentStoreId() storeId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.getById(storeId, id);
  }

  @Put(':id/status')
  @RequirePermissions('update_order_status')
  updateStatus(
    @CurrentUser() principal: AccessTokenPayload,
    @CurrentStoreId() storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
    @Ip() ip: string,
  ) {
    return this.orders.updateStatus(principal.orgId!, storeId, principal.sub, id, dto, ip);
  }

  @Post(':id/payments')
  @RequirePermissions('process_payments')
  addPayment(
    @CurrentUser() principal: AccessTokenPayload,
    @CurrentStoreId() storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddPaymentDto,
    @Ip() ip: string,
  ) {
    return this.orders.addPayment(storeId, principal.sub, id, dto, ip);
  }
}
