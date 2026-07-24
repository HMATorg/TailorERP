import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from './availability.service';
import type {
  BookAppointmentDto,
  RescheduleAppointmentDto,
  UpdateAppointmentStatusDto,
} from './dto/appointments.dto';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly audit: AuditService,
  ) {}

  /** Customer books an appointment (PRD C-5). */
  async book(customerId: string, orgId: string, dto: BookAppointmentDto) {
    const store = await this.prisma.store.findFirst({
      where: { id: dto.storeId, organizationId: orgId, status: 'active' },
      select: { id: true },
    });
    if (!store) throw new BadRequestException('Store not available for booking');

    const scheduledAt = new Date(dto.scheduledAt);
    if (scheduledAt < new Date()) {
      throw new BadRequestException('Cannot book a past time slot');
    }
    const duration = dto.durationMinutes ?? 30;
    await this.availability.assertSlotFree(dto.storeId, scheduledAt, duration);

    const appointment = await this.prisma.appointment.create({
      data: {
        customerId,
        storeId: dto.storeId,
        appointmentType: dto.appointmentType,
        scheduledAt,
        durationMinutes: duration,
        notes: dto.notes,
      },
    });
    await this.audit.log({
      organizationId: orgId,
      storeId: dto.storeId,
      actorType: 'customer',
      action: 'appointment.booked',
      entityType: 'appointment',
      entityId: appointment.id,
      newValue: { scheduledAt: dto.scheduledAt, type: dto.appointmentType },
    });
    return appointment;
  }

  listForCustomer(customerId: string) {
    return this.prisma.appointment.findMany({
      where: { customerId },
      orderBy: { scheduledAt: 'desc' },
      include: { store: { select: { id: true, name: true, address: true, phone: true } } },
    });
  }

  /** Customer reschedules or cancels their own appointment (PWA §3.6c). */
  async updateForCustomer(customerId: string, appointmentId: string, dto: RescheduleAppointmentDto) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });
    if (!appointment || appointment.customerId !== customerId) {
      throw new NotFoundException('Appointment not found');
    }
    if (!['scheduled', 'confirmed'].includes(appointment.status)) {
      throw new ForbiddenException('This appointment can no longer be changed');
    }

    if (dto.status === 'cancelled') {
      return this.prisma.appointment.update({
        where: { id: appointmentId },
        data: { status: 'cancelled', cancelReason: dto.cancelReason },
      });
    }
    if (dto.scheduledAt) {
      const newTime = new Date(dto.scheduledAt);
      if (newTime < new Date()) throw new BadRequestException('Cannot move to a past time');
      await this.availability.assertSlotFree(
        appointment.storeId,
        newTime,
        appointment.durationMinutes,
        appointmentId,
      );
      return this.prisma.appointment.update({
        where: { id: appointmentId },
        data: { scheduledAt: newTime, status: 'scheduled' },
      });
    }
    throw new BadRequestException('Provide scheduledAt to reschedule or status=cancelled');
  }

  listForStore(storeId: string, dateISO?: string) {
    const dayFilter = dateISO
      ? {
          scheduledAt: {
            gte: new Date(`${dateISO}T00:00:00`),
            lt: new Date(new Date(`${dateISO}T00:00:00`).getTime() + 24 * 3600 * 1000),
          },
        }
      : {};
    return this.prisma.appointment.findMany({
      where: { storeId, ...dayFilter },
      orderBy: { scheduledAt: 'asc' },
      include: {
        customer: { select: { id: true, fullName: true, phone: true } },
        assignedTailor: { select: { id: true, fullName: true } },
      },
    });
  }

  async updateForStaff(
    storeId: string,
    userId: string,
    appointmentId: string,
    dto: UpdateAppointmentStatusDto,
  ) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, storeId },
    });
    if (!appointment) throw new NotFoundException('Appointment not found in this store');

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: dto.status,
        ...(dto.assignedTailorId !== undefined ? { assignedTailorId: dto.assignedTailorId } : {}),
      },
    });
    await this.audit.log({
      storeId,
      actorUserId: userId,
      action: 'appointment.updated',
      entityType: 'appointment',
      entityId: appointmentId,
      oldValue: { status: appointment.status },
      newValue: { status: dto.status },
    });
    return updated;
  }
}
