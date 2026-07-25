import { Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { FifoService } from './fifo.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ReservationService } from './reservation.service';
import { YieldService } from './yield.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, FifoService, AlertsService, YieldService, ReservationService],
  exports: [FifoService, YieldService, ReservationService],
})
export class InventoryModule {}
