import { Body, Controller, HttpCode, Ip, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { RefreshDto, StaffLoginDto } from './dto/auth.dto';

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
}
