import { Module } from '@nestjs/common';
import { ZatcaApiClient } from './zatca-api-client';
import { ZatcaOnboardingService } from './zatca-onboarding.service';
import { ZatcaController } from './zatca.controller';
import { ZatcaService } from './zatca.service';

@Module({
  controllers: [ZatcaController],
  providers: [ZatcaService, ZatcaApiClient, ZatcaOnboardingService],
  exports: [ZatcaService, ZatcaOnboardingService],
})
export class ZatcaModule {}
