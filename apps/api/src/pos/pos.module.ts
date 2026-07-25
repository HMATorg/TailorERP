import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { WorkshopModule } from '../workshop/workshop.module';
import { ZatcaModule } from '../zatca/zatca.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

@Module({
  imports: [InventoryModule, InvoicesModule, WorkshopModule, ZatcaModule],
  controllers: [PosController],
  providers: [PosService],
})
export class PosModule {}
