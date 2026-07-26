import { Module } from '@nestjs/common';
import { MeasurementsService } from './measurements.service';

/**
 * Read-only measurement views, shared by the customer PWA, the counter, the
 * admin SPA and the workshop tablet. Writes stay in CustomersModule, which owns
 * versioning and supersession.
 */
@Module({
  providers: [MeasurementsService],
  exports: [MeasurementsService],
})
export class MeasurementsModule {}
