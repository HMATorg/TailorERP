import { Body, Controller, ForbiddenException, Get, HttpCode, Ip, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { RefreshDto, StaffLoginDto } from './dto/auth.dto';
import type { AccessTokenPayload } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: StaffLoginDto, @Ip() ip: string) {
    return this.auth.staffLogin(dto.email, dto.password, ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Ip() ip: string) {
    return this.auth.staffRefresh(dto.refreshToken, ip);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @Public()
  @Post('platform/login')
  @HttpCode(200)
  platformLogin(@Body() dto: StaffLoginDto, @Ip() ip: string) {
    return this.auth.platformLogin(dto.email, dto.password, ip);
  }

  @Public()
  @Post('platform/refresh')
  @HttpCode(200)
  platformRefresh(@Body() dto: RefreshDto, @Ip() ip: string) {
    return this.auth.platformRefresh(dto.refreshToken, ip);
  }

  /**
   * Resolves the current staff/impersonation token into the same
   * `{user, stores}` shape `login()` returns — the impersonation handoff
   * (D-060) uses this instead of asking the operator to hand-construct a
   * session.
   */
  @Get('session')
  session(@CurrentUser() principal: AccessTokenPayload) {
    if (principal.typ !== 'staff') {
      throw new ForbiddenException('Staff credentials required');
    }
    return this.auth.staffSession(principal.sub);
  }
}
