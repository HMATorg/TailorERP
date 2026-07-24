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

  async getById(orgId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: orgId },
      include: {
        measurements: { orderBy: { createdAt: 'desc' }, take: 20 },
        visits: { include: { store: { select: { id: true, name: true } } } },
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

    return this.prisma.measurement.create({
      data: {
        customerId,
        storeId,
        garmentType: dto.garmentType,
        data: dto.data as Prisma.InputJsonValue,
        notes: dto.notes,
        takenById: actorId,
      },
    });
  }
}
