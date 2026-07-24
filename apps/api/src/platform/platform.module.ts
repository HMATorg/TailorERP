import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FeatureGateService } from './feature-gate.service';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [AuthModule],
  controllers: [PlatformController],
  providers: [PlatformService, FeatureGateService],
  exports: [FeatureGateService],
})
export class PlatformModule {}
