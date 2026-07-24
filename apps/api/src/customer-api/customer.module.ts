import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { CustomerController } from './customer.controller';

@Module({
  imports: [AppointmentsModule],
  controllers: [CustomerController],
})
export class CustomerModule {}
