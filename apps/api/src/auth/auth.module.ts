import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { FeatureGateModule } from '../platform/feature-gate.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CustomerAuthController } from './customer-auth.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

@Module({
  imports: [JwtModule.register({ global: true }), FeatureGateModule],
  controllers: [AuthController, CustomerAuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    PlatformAdminGuard,
    // Order matters: authentication first, then permission enforcement.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [TokenService, PlatformAdminGuard],
})
export class AuthModule {}
