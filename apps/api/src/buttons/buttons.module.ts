import { Module } from '@nestjs/common';
import { ButtonsController } from './buttons.controller';
import { ButtonsService } from './buttons.service';

@Module({
  controllers: [ButtonsController],
  providers: [ButtonsService],
  exports: [ButtonsService],
})
export class ButtonsModule {}
