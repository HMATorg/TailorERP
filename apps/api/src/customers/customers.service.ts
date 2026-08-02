import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateCustomerDto,
  CreateMeasurementDto,
  UpdateCustomerDto,
} from './dto/customers.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Customers are org-shared (hybrid tenancy) — search across the whole org. */
  async list(orgId: string, query: { search?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const where: Prisma.CustomerWhereInput = {
      organizationId: orgId,
      isActive: true,
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          fullName: true,
          phone: true,
          email: true,
          whatsappConsent: true,
          language: true,
          createdAt: true,
          _count: { select: { orders: true } },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total } };
  }

  /**
   * The complete record HQ oversight needs for one customer: profile, which
   * stores they've visited and when, recent order history, and activity
   * counts. Deliberately does not carry measurements — that shape belongs to
   * `MeasurementsService`, the one place it is grouped by garment and
   * versioned consistently across every surface that shows it (D-044); a
   * second ad hoc measurement select here would be exactly the kind of
   * divergence that fixed.
   */
  async getById(orgId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: orgId },
      include: {
        visits: {
          include: { store: { select: { id: true, name: true } } },
          orderBy: { lastVisitDate: 'desc' },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            totalAmount: true,
            paidAmount: true,
            createdAt: true,
            store: { select: { name: true } },
          },
        },
        _count: { select: { orders: true, appointments: true } },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async create(orgId: string, storeId: string | undefined, actorId: string, dto: CreateCustomerDto, ip?: string) {
    const existing = await this.prisma.customer.findUnique({
      where: { organizationId_phone: { organizationId: orgId, phone: dto.phone } },
    });
    if (existing) {
      throw new ConflictException('A customer with this phone already exists in your organization');
    }
    const customer = await this.prisma.customer.create({
      data: {
        organizationId: orgId,
        fullName: dto.fullName,
        phone: dto.phone,
        email: dto.email,
        whatsappConsent: dto.whatsappConsent ?? false,
        whatsappPhone: dto.whatsappPhone ?? (dto.whatsappConsent ? dto.phone : undefined),
        language: dto.language ?? 'en',
        notes: dto.notes,
        preferredStoreId: storeId,
      },
    });
    if (storeId) {
      await this.prisma.customerStoreVisit.create({
        data: { customerId: customer.id, storeId },
      });
    }
    await this.audit.log({
      organizationId: orgId,
      storeId,
      actorUserId: actorId,
      action: 'customer.created',
      entityType: 'customer',
      entityId: customer.id,
      newValue: { fullName: dto.fullName, phone: dto.phone },
      ip,
    });
    return customer;
  }

  async update(orgId: string, actorId: string, customerId: string, dto: UpdateCustomerDto, ip?: string) {
    const existing = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: orgId },
    });
    if (!existing) throw new NotFoundException('Customer not found');

    if (dto.phone && dto.phone !== existing.phone) {
      const clash = await this.prisma.customer.findUnique({
        where: { organizationId_phone: { organizationId: orgId, phone: dto.phone } },
      });
      if (clash) throw new ConflictException('Another customer already uses this phone');
    }

    const customer = await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        ...(dto.fullName !== undefined && { fullName: dto.fullName }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.whatsappConsent !== undefined && { whatsappConsent: dto.whatsappConsent }),
        ...(dto.whatsappPhone !== undefined && { whatsappPhone: dto.whatsappPhone }),
        ...(dto.language !== undefined && { language: dto.language }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
    await this.audit.log({
      organizationId: orgId,
      actorUserId: actorId,
      action: 'customer.updated',
      entityType: 'customer',
      entityId: customerId,
      oldValue: { fullName: existing.fullName, phone: existing.phone },
      newValue: { fullName: customer.fullName, phone: customer.phone },
      ip,
    });
    return customer;
  }

  async addMeasurement(
    orgId: string,
    storeId: string | undefined,
    actorId: string,
    customerId: string,
    dto: CreateMeasurementDto,
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: orgId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    // A new snapshot supersedes the previous one: deactivate then insert, in one
    // transaction, or the partial unique index would reject the second active row.
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.measurement.findFirst({
        where: { customerId, garmentType: dto.garmentType },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      await tx.measurement.updateMany({
        where: { customerId, garmentType: dto.garmentType, isActive: true },
        data: { isActive: false },
      });
      return tx.measurement.create({
        data: {
          customerId,
          storeId,
          garmentType: dto.garmentType,
          version: (previous?.version ?? 0) + 1,
          isActive: true,
          m1FrontLength: dto.m1FrontLength,
          m1BackLength: dto.m1BackLength,
          m2ShoulderWidth: dto.m2ShoulderWidth,
          m3SleeveLeft: dto.m3SleeveLeft,
          m3SleeveRight: dto.m3SleeveRight,
          m4ChestCirc: dto.m4ChestCirc,
          m5HipWidth: dto.m5HipWidth,
          m6NeckDiameter: dto.m6NeckDiameter,
          m7WristOpening: dto.m7WristOpening,
          m8SkirtPerimeter: dto.m8SkirtPerimeter,
          m9Waist: dto.m9Waist,
          m10RoundShoulder: dto.m10RoundShoulder,
          m11MidHand: dto.m11MidHand,
          m12PlateLength: dto.m12PlateLength,
          m13HalfChest: dto.m13HalfChest,
          t1Waist: dto.t1Waist,
          t2Hip: dto.t2Hip,
          t3Inseam: dto.t3Inseam,
          t4Outseam: dto.t4Outseam,
          t5Thigh: dto.t5Thigh,
          t6Knee: dto.t6Knee,
          t7AnkleOpening: dto.t7AnkleOpening,
          trouserPallas: (dto.trouserPallas ?? undefined) as Prisma.InputJsonValue | undefined,
          extra: (dto.extra ?? undefined) as Prisma.InputJsonValue | undefined,
          notes: dto.notes,
          takenById: actorId,
        },
      });
    });
  }
}
