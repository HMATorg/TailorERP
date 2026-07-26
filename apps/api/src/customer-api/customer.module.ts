import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { MeasurementsModule } from '../measurements/measurements.module';
import { CustomerController } from './customer.controller';

@Module({
  imports: [AppointmentsModule, MeasurementsModule],
  controllers: [CustomerController],
})
export class CustomerModule {}
