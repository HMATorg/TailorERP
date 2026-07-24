import { Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { FifoService } from './fifo.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, FifoService, AlertsService],
  exports: [FifoService],
})
export class InventoryModule {}
