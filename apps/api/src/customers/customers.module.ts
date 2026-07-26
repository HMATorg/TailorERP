import { Module } from '@nestjs/common';
import { MeasurementsModule } from '../measurements/measurements.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [MeasurementsModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
