import { Body, Controller, HttpCode, Ip, Post } from '@nestjs/common';
import { OtpService } from './otp.service';
import { Public } from './decorators/public.decorator';
import { OtpRequestDto, OtpVerifyDto, RefreshDto } from './dto/auth.dto';

@Controller('customer/auth')
export class CustomerAuthController {
  constructor(private readonly otp: OtpService) {}

  @Public()
  @Post('otp')
  @HttpCode(200)
  requestOtp(@Body() dto: OtpRequestDto) {
    return this.otp.requestOtp(dto.phone, dto.organizationId);
  }

  @Public()
  @Post('verify')
  @HttpCode(200)
  verify(@Body() dto: OtpVerifyDto, @Ip() ip: string) {
    return this.otp.verifyOtp(dto.phone, dto.code, dto.organizationId, ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Ip() ip: string) {
    return this.otp.customerRefresh(dto.refreshToken, ip);
  }
}
