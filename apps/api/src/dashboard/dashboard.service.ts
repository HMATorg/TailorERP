import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Store IDs the user may aggregate over (HQ admin: all org stores). */
  private async accessibleStoreIds(userId: string, orgId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { storeRoles: { where: { isActive: true } } },
    });
    if (!user || !user.isActive) throw new ForbiddenException('Account is inactive');
    if (user.orgRole === 'hq_admin') {
      const stores = await this.prisma.store.findMany({
        where: { organizationId: orgId },
        select: { id: true },
      });
      return stores.map((s) => s.id);
    }
    return user.storeRoles.map((r) => r.storeId);
  }

  /** Aggregated HQ/regional dashboard (HQ-1, RM-1). */
  async hqDashboard(userId: string, orgId: string, fromISO?: string, toISO?: string) {
    const storeIds = await this.accessibleStoreIds(userId, orgId);
    if (storeIds.length === 0) {
      return { totals: null, stores: [], period: { from: fromISO, to: toISO } };
    }

    const to = toISO ? new Date(toISO) : new Date();
    const from = fromISO
      ? new Date(fromISO)
      : new Date(to.getTime() - 7 * 24 * 3600 * 1000);

    const perStore = await this.prisma.$queryRaw<
      {
        store_id: string;
        store_name: string;
        revenue: Prisma.Decimal | null;
        order_count: bigint;
        avg_order_value: Prisma.Decimal | null;
      }[]
    >`
      SELECT s.id AS store_id, s.name AS store_name,
             COALESCE(SUM(o.total_amount), 0) AS revenue,
             COUNT(o.id) AS order_count,
             COALESCE(AVG(o.total_amount), 0) AS avg_order_value
      FROM stores s
      LEFT JOIN orders o
        ON o.store_id = s.id
        AND o.status <> 'cancelled'
        AND o.created_at BETWEEN ${from} AND ${to}
      WHERE s.id IN (${Prisma.join(storeIds.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY s.id, s.name
      ORDER BY revenue DESC
    `;

    const alertCount = await this.prisma.inventoryRestockAlert.count({
      where: { storeId: { in: storeIds }, status: 'pending' },
    });

    const stores = perStore.map((row) => ({
      storeId: row.store_id,
      storeName: row.store_name,
      revenue: row.revenue?.toString() ?? '0',
      orderCount: Number(row.order_count),
      avgOrderValue: row.avg_order_value?.toString() ?? '0',
    }));
    const totals = {
      revenue: stores.reduce((sum, s) => sum + Number(s.revenue), 0).toFixed(2),
      orderCount: stores.reduce((sum, s) => sum + s.orderCount, 0),
      pendingAlerts: alertCount,
      storeCount: stores.length,
    };
    return { totals, stores, period: { from: from.toISOString(), to: to.toISOString() } };
  }

  /** Single-store dashboard (SM-1). */
  async storeDashboard(storeId: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 3600 * 1000);

    const [todayOrders, yesterdayOrders, byStatus, pendingAlerts, todayAppointments] =
      await this.prisma.$transaction([
        this.prisma.order.aggregate({
          where: { storeId, createdAt: { gte: todayStart }, status: { not: 'cancelled' } },
          _sum: { totalAmount: true },
          _count: true,
        }),
        this.prisma.order.aggregate({
          where: {
            storeId,
            createdAt: { gte: yesterdayStart, lt: todayStart },
            status: { not: 'cancelled' },
          },
          _sum: { totalAmount: true },
          _count: true,
        }),
        this.prisma.order.groupBy({
          by: ['status'],
          where: { storeId, status: { notIn: ['delivered', 'cancelled'] } },
          _count: true,
          orderBy: { status: 'asc' },
        }),
        this.prisma.inventoryRestockAlert.count({
          where: { storeId, status: 'pending' },
        }),
        this.prisma.appointment.findMany({
          where: {
            storeId,
            scheduledAt: { gte: todayStart, lt: new Date(todayStart.getTime() + 24 * 3600 * 1000) },
            status: { in: ['scheduled', 'confirmed', 'in_progress'] },
          },
          orderBy: { scheduledAt: 'asc' },
          include: { customer: { select: { fullName: true, phone: true } } },
        }),
      ]);

    return {
      today: {
        revenue: todayOrders._sum.totalAmount?.toString() ?? '0',
        orderCount: todayOrders._count,
      },
      yesterday: {
        revenue: yesterdayOrders._sum.totalAmount?.toString() ?? '0',
        orderCount: yesterdayOrders._count,
      },
      activeOrdersByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
      pendingAlerts,
      todayAppointments,
    };
  }
}
