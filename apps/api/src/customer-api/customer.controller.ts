import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { TRACKING_STEPS } from '@tailonix/shared';
import { AppointmentsService } from '../appointments/appointments.service';
import { AvailabilityService } from '../appointments/availability.service';
import {
  BookAppointmentDto,
  RescheduleAppointmentDto,
} from '../appointments/dto/appointments.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerGuard } from './customer.guard';

class RegisterDeviceDto {
  @IsString()
  deviceToken: string;

  @IsIn(['web', 'android', 'ios'])
  @IsOptional()
  platform?: string;
}

@Controller('customer')
@UseGuards(CustomerGuard)
export class CustomerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointments: AppointmentsService,
    private readonly availability: AvailabilityService,
    private readonly config: ConfigService,
  ) {}

  /** VAPID public key the PWA needs to create a push subscription. */
  @Get('push-key')
  pushKey() {
    return { publicKey: this.config.get<string>('VAPID_PUBLIC_KEY') ?? null };
  }

  @Get('orders')
  async myOrders(@CurrentUser() principal: AccessTokenPayload) {
    return this.prisma.order.findMany({
      where: { customerId: principal.sub },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        paidAmount: true,
        dueDate: true,
        createdAt: true,
        store: { select: { id: true, name: true, phone: true } },
        items: { select: { garmentType: true, quantity: true } },
      },
    });
  }

  /** Order detail with the visual-timeline data (PRD C-3, wireframes §3.6b). */
  @Get('orders/:id')
  async orderDetail(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id, customerId: principal.sub },
      include: {
        store: { select: { id: true, name: true, phone: true, address: true } },
        items: {
          select: {
            garmentType: true,
            description: true,
            quantity: true,
            unitPrice: true,
            fabrics: {
              select: {
                quantityUsed: true,
                batch: { select: { fabricName: true, color: true } },
              },
            },
          },
        },
        statusHistory: {
          orderBy: { createdAt: 'asc' },
          select: { toStatus: true, createdAt: true },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    const reachedAt = new Map(order.statusHistory.map((h) => [h.toStatus, h.createdAt]));
    return {
      ...order,
      timeline: TRACKING_STEPS.map((step) => ({
        step,
        reachedAt: reachedAt.get(step) ?? null,
        current: order.status === step,
      })),
    };
  }

  @Get('measurements')
  myMeasurements(@CurrentUser() principal: AccessTokenPayload) {
    return this.prisma.measurement.findMany({
      where: { customerId: principal.sub },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        garmentType: true,
        data: true,
        createdAt: true,
        store: { select: { id: true, name: true } },
      },
    });
  }

  @Get('stores')
  async bookableStores(@CurrentUser() principal: AccessTokenPayload) {
    return this.prisma.store.findMany({
      where: { organizationId: principal.orgId, status: 'active' },
      select: { id: true, name: true, address: true, phone: true, operatingHours: true },
      orderBy: { name: 'asc' },
    });
  }

  @Get('availability')
  slots(@Query('storeId', ParseUUIDPipe) storeId: string, @Query('date') date: string) {
    return this.availability.getSlots(storeId, date);
  }

  @Get('appointments')
  myAppointments(@CurrentUser() principal: AccessTokenPayload) {
    return this.appointments.listForCustomer(principal.sub);
  }

  @Post('appointments')
  book(@CurrentUser() principal: AccessTokenPayload, @Body() dto: BookAppointmentDto) {
    return this.appointments.book(principal.sub, principal.orgId!, dto);
  }

  @Put('appointments/:id')
  updateAppointment(
    @CurrentUser() principal: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleAppointmentDto,
  ) {
    return this.appointments.updateForCustomer(principal.sub, id, dto);
  }

  /** Register a web-push subscription (PRD C-6). */
  @Post('devices')
  async registerDevice(
    @CurrentUser() principal: AccessTokenPayload,
    @Body() dto: RegisterDeviceDto,
  ) {
    const existing = await this.prisma.customerDevice.findFirst({
      where: { customerId: principal.sub, deviceToken: dto.deviceToken },
    });
    if (existing) {
      return this.prisma.customerDevice.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
    }
    return this.prisma.customerDevice.create({
      data: {
        customerId: principal.sub,
        deviceToken: dto.deviceToken,
        platform: dto.platform ?? 'web',
      },
    });
  }
}
