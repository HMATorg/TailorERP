import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ProductionStation } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ReservationService } from '../inventory/reservation.service';
import { PrismaService } from '../prisma/prisma.service';

/** Kanban columns in order; movement is normally forward one step. */
export const STATION_ORDER: ProductionStation[] = [
  'queued',
  'cutting',
  'stitching',
  'quality',
  'ready',
];

/** Arabic station names from the blueprint, for the workshop tablet UI. */
export const STATION_LABELS: Record<ProductionStation, { en: string; ar: string }> = {
  queued: { en: 'Queued', ar: 'في الانتظار' },
  cutting: { en: 'Cutting', ar: 'التفصيل' },
  stitching: { en: 'Stitching', ar: 'الخياطة' },
  quality: { en: 'Quality & Press', ar: 'الكوي والجودة' },
  ready: { en: 'Ready', ar: 'جاهز' },
};

@Injectable()
export class WorkshopService {
  private readonly logger = new Logger(WorkshopService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: ReservationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Splits an order into one ticket per garment (v4 Phase 4 §1). A three-thobe
   * order becomes three cards that move through stations independently — the
   * whole point of split-ticket tracking.
   */
  async createTicketsForOrder(orderId: string, actorId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { orderBy: { sequenceNo: 'asc' } }, tickets: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.tickets.length > 0) return order.tickets; // idempotent

    const tickets = await this.prisma.$transaction(
      order.items.map((item, index) =>
        this.prisma.productionTicket.create({
          data: {
            orderId: order.id,
            orderItemId: item.id,
            storeId: order.storeId,
            // Scannable and human-readable: ORD-000123-01
            ticketCode: `${order.orderNumber}-${String(index + 1).padStart(2, '0')}`,
          },
        }),
      ),
    );

    await this.audit.log({
      organizationId: order.organizationId,
      storeId: order.storeId,
      actorUserId: actorId,
      action: 'workshop.tickets_created',
      entityType: 'order',
      entityId: order.id,
      newValue: { ticketCount: tickets.length },
    });
    return tickets;
  }

  /** Kanban board: tickets grouped by station for one store. */
  async board(storeId: string) {
    const tickets = await this.prisma.productionTicket.findMany({
      where: { storeId, station: { not: 'ready' } },
      orderBy: [{ createdAt: 'asc' }],
      include: {
        assignedTo: { select: { id: true, fullName: true } },
        order: {
          select: {
            orderNumber: true,
            dueDate: true,
            customer: { select: { fullName: true, phone: true } },
          },
        },
        orderItem: {
          select: {
            garmentType: true,
            sequenceNo: true,
            collarStyle: true,
            cuffStyle: true,
            pocketStyle: true,
            stitchingStyle: true,
            yieldMeters: true,
          },
        },
      },
    });

    const columns = STATION_ORDER.filter((s) => s !== 'ready').map((station) => ({
      station,
      label: STATION_LABELS[station],
      tickets: tickets.filter((t) => t.station === station),
    }));
    return { columns, total: tickets.length };
  }

  /** Barcode scan at a station — the tablet's primary interaction. */
  async findByCode(storeId: string, ticketCode: string) {
    const ticket = await this.prisma.productionTicket.findFirst({
      where: { ticketCode, storeId },
      include: {
        assignedTo: { select: { id: true, fullName: true } },
        order: {
          select: {
            orderNumber: true,
            dueDate: true,
            customer: { select: { fullName: true, phone: true } },
          },
        },
        orderItem: {
          include: {
            measurement: true,
            fabrics: { include: { batch: { select: { batchCode: true, fabricName: true } } } },
          },
        },
        history: {
          orderBy: { createdAt: 'desc' },
          include: { changedBy: { select: { fullName: true } } },
        },
      },
    });
    if (!ticket) throw new NotFoundException(`No ticket with code ${ticketCode} in this store`);
    return { ...ticket, stationLabel: STATION_LABELS[ticket.station] };
  }

  /**
   * Advances a ticket. Completing **cutting** is the moment reserved fabric
   * physically leaves the roll, so the deduction happens here rather than at
   * checkout (v4 Phase 4 §2).
   */
  async moveTicket(
    storeId: string,
    ticketId: string,
    toStation: ProductionStation,
    userId: string,
    note?: string,
  ) {
    const ticket = await this.prisma.productionTicket.findFirst({
      where: { id: ticketId, storeId },
      include: { order: { select: { id: true, organizationId: true, orderNumber: true } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found in this store');
    if (ticket.station === toStation) return ticket;

    const fromIndex = STATION_ORDER.indexOf(ticket.station);
    const toIndex = STATION_ORDER.indexOf(toStation);
    if (toIndex === -1) throw new BadRequestException(`Unknown station '${toStation}'`);
    // Forward one step, or back for rework. Skipping ahead would bypass cutting
    // and leave fabric reserved but never deducted.
    if (toIndex > fromIndex + 1) {
      throw new BadRequestException(
        `Cannot skip from ${ticket.station} to ${toStation} — advance one station at a time`,
      );
    }

    // Leaving cutting forward = the cut happened.
    const leavingCutting = ticket.station === 'cutting' && toIndex > fromIndex;
    if (leavingCutting) {
      await this.reservations.consumeForOrderItem(ticket.orderItemId, userId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.productionTicket.update({
        where: { id: ticketId },
        data: {
          station: toStation,
          ...(toStation === 'cutting' && !ticket.startedAt ? { startedAt: new Date() } : {}),
          ...(toStation === 'ready' ? { completedAt: new Date() } : {}),
        },
      });
      await tx.productionTicketHistory.create({
        data: {
          ticketId,
          fromStation: ticket.station,
          toStation,
          changedById: userId,
          note,
        },
      });
      return result;
    });

    await this.audit.log({
      organizationId: ticket.order.organizationId,
      storeId,
      actorUserId: userId,
      action: 'workshop.ticket_moved',
      entityType: 'production_ticket',
      entityId: ticketId,
      oldValue: { station: ticket.station },
      newValue: { station: toStation, fabricConsumed: leavingCutting },
    });

    if (toStation === 'ready') {
      await this.checkOrderReady(ticket.orderId, userId);
    }
    return updated;
  }

  async assign(storeId: string, ticketId: string, assigneeId: string | null, userId: string) {
    const ticket = await this.prisma.productionTicket.findFirst({
      where: { id: ticketId, storeId },
    });
    if (!ticket) throw new NotFoundException('Ticket not found in this store');

    if (assigneeId) {
      const worker = await this.prisma.userStoreRole.findFirst({
        where: { userId: assigneeId, storeId, isActive: true },
      });
      if (!worker) {
        throw new BadRequestException('That worker is not assigned to this store');
      }
    }
    return this.prisma.productionTicket.update({
      where: { id: ticketId },
      data: { assignedToId: assigneeId },
    });
  }

  /**
   * The order is only ready when *every* garment is — that is what triggers the
   * customer's "ready for collection" WhatsApp (v4 Phase 5 §1).
   */
  private async checkOrderReady(orderId: string, userId: string) {
    const tickets = await this.prisma.productionTicket.findMany({
      where: { orderId },
      select: { station: true },
    });
    const allReady = tickets.length > 0 && tickets.every((t) => t.station === 'ready');
    if (!allReady) return;

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status === 'ready' || order.status === 'delivered') return;

    await this.prisma.$transaction([
      this.prisma.order.update({ where: { id: orderId }, data: { status: 'ready' } }),
      this.prisma.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: 'ready',
          note: 'All production tickets completed',
          changedById: userId,
        },
      }),
    ]);
    this.logger.log(`Order ${order.orderNumber} marked ready — all tickets complete`);
  }

  /** Per-worker throughput, for the workshop manager's allocation decisions. */
  async workerLoad(storeId: string) {
    const grouped = await this.prisma.productionTicket.groupBy({
      by: ['assignedToId', 'station'],
      where: { storeId, station: { notIn: ['ready'] } },
      _count: true,
      orderBy: { assignedToId: 'asc' },
    });
    const userIds = [...new Set(grouped.map((g) => g.assignedToId).filter(Boolean))] as string[];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.fullName]));

    return grouped.map((row) => ({
      workerId: row.assignedToId,
      workerName: row.assignedToId ? (nameById.get(row.assignedToId) ?? null) : 'Unassigned',
      station: row.station,
      count: row._count,
    }));
  }
}
