import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { FeatureGateModule } from '../platform/feature-gate.module';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  imports: [NotificationsModule, FeatureGateModule],
  controllers: [TeamController],
  providers: [TeamService],
})
export class TeamModule {}
