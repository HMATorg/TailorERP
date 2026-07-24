import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  type AppointmentStatus,
  type AppointmentType,
} from '@tailonix/shared';

export class BookAppointmentDto {
  @IsUUID()
  storeId: string;

  @IsIn(APPOINTMENT_TYPES as readonly string[])
  appointmentType: AppointmentType;

  @IsDateString()
  scheduledAt: string;

  @IsInt()
  @Min(15)
  @Max(180)
  @IsOptional()
  durationMinutes?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class RescheduleAppointmentDto {
  @IsDateString()
  @IsOptional()
  scheduledAt?: string;

  @IsIn(['cancelled'])
  @IsOptional()
  status?: 'cancelled';

  @IsString()
  @IsOptional()
  cancelReason?: string;
}

export class UpdateAppointmentStatusDto {
  @IsIn(APPOINTMENT_STATUSES as readonly string[])
  status: AppointmentStatus;

  @IsUUID()
  @IsOptional()
  assignedTailorId?: string;
}
