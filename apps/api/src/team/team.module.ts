import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  imports: [NotificationsModule],
  controllers: [TeamController],
  providers: [TeamService],
})
export class TeamModule {}
