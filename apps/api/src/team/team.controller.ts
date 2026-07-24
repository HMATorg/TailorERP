import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import {
  AcceptInviteDto,
  InviteUserDto,
  UpdateUserRolesDto,
  UpdateUserStatusDto,
} from './dto/team.dto';
import { TeamService } from './team.service';

@Controller('users')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  @RequirePermissions('manage_roles')
  list(@CurrentUser() principal: AccessTokenPayload) {
    return this.team.listUsers(principal.orgId!);
  }

  @Post('invite')
  @RequirePermissions('manage_roles')
  invite(
    @CurrentUser() principal: AccessTokenPayload,
    @Body() dto: InviteUserDto,
    @Ip() ip: string,
  ) {
    return this.team.invite(principal.orgId!, principal.sub, dto, ip);
  }

  @Public()
  @Post('accept-invite')
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.team.acceptInvite(dto);
  }

  @Put(':id/roles')
  @RequirePermissions('manage_roles')
  updateRoles(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRolesDto,
    @Ip() ip: string,
  ) {
    return this.team.updateRoles(principal.orgId!, principal.sub, id, dto, ip);
  }

  @Put(':id/status')
  @RequirePermissions('manage_roles')
  updateStatus(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @Ip() ip: string,
  ) {
    return this.team.updateStatus(principal.orgId!, principal.sub, id, dto.isActive, ip);
  }
}
