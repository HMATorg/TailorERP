import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { MeasurementsModule } from '../measurements/measurements.module';
import { WorkshopController } from './workshop.controller';
import { WorkshopService } from './workshop.service';

@Module({
  imports: [InventoryModule, MeasurementsModule],
  controllers: [WorkshopController],
  providers: [WorkshopService],
  exports: [WorkshopService],
})
export class WorkshopModule {}
