import { Module } from '@nestjs/common';
import { ZatcaController } from './zatca.controller';
import { ZatcaService } from './zatca.service';

@Module({
  controllers: [ZatcaController],
  providers: [ZatcaService],
  exports: [ZatcaService],
})
export class ZatcaModule {}
