import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CreateStoreDto, UpdateStoreDto } from './dto/store.dto';
import { StoresService } from './stores.service';

@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get()
  list(@CurrentUser() principal: AccessTokenPayload) {
    return this.stores.listAccessible(principal);
  }

  @Post()
  @RequirePermissions('manage_stores')
  create(
    @CurrentUser() principal: AccessTokenPayload,
    @Body() dto: CreateStoreDto,
    @Ip() ip: string,
  ) {
    return this.stores.create(principal.orgId!, principal.sub, dto, ip);
  }

  @Get(':id')
  @RequirePermissions('view_dashboard')
  get(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.stores.getById(principal.orgId!, id);
  }

  @Put(':id')
  @RequirePermissions('manage_stores')
  update(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStoreDto,
    @Ip() ip: string,
  ) {
    return this.stores.update(principal.orgId!, principal.sub, id, dto, ip);
  }
}
