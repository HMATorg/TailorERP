import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FeatureGateModule } from './feature-gate.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [AuthModule, FeatureGateModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
