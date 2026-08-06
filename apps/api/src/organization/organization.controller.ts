import { Body, Controller, Get, Ip, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { UpdateOrganizationDto } from './dto/organization.dto';
import { OrganizationService } from './organization.service';

@Controller('organization')
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get()
  @RequirePermissions('manage_organization')
  get(@CurrentUser() principal: AccessTokenPayload) {
    return this.organization.getProfile(principal.orgId!);
  }

  @Put()
  @RequirePermissions('manage_organization')
  update(
    @CurrentUser() principal: AccessTokenPayload,
    @Body() dto: UpdateOrganizationDto,
    @Ip() ip: string,
  ) {
    return this.organization.updateProfile(principal.orgId!, principal.sub, dto, ip);
  }
}
