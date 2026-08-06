import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { ButtonsService } from './buttons.service';
import { CreateButtonDesignDto, UpdateButtonDesignDto } from './dto/buttons.dto';

@Controller('buttons')
export class ButtonsController {
  constructor(private readonly buttons: ButtonsService) {}

  /** The POS picker reads this (active only); the admin management page passes includeInactive. */
  @Get()
  @RequirePermissions('use_pos')
  list(@CurrentUser() principal: AccessTokenPayload, @Query('includeInactive') includeInactive?: string) {
    return this.buttons.list(principal.orgId!, includeInactive === 'true');
  }

  @Post()
  @RequirePermissions('manage_organization')
  create(
    @CurrentUser() principal: AccessTokenPayload,
    @Body() dto: CreateButtonDesignDto,
    @Ip() ip: string,
  ) {
    return this.buttons.create(principal.orgId!, principal.sub, dto, ip);
  }

  @Put(':id')
  @RequirePermissions('manage_organization')
  update(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateButtonDesignDto,
    @Ip() ip: string,
  ) {
    return this.buttons.update(principal.orgId!, principal.sub, id, dto, ip);
  }
}
