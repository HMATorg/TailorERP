import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CounterService } from '../common/counter.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { InvoicePdfService } from './invoice-pdf.service';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: InvoicePdfService,
    private readonly storage: StorageService,
    private readonly counters: CounterService,
    private readonly audit: AuditService,
  ) {}

  /** Sequential per-org invoice number, e.g. INV-2026-000042. */
  private async nextInvoiceNumber(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const seq = await this.counters.next(tx, {
      organizationId,
      kind: 'invoice',
      scope: String(year), // numbering restarts each year
    });
    return `INV-${year}-${String(seq).padStart(6, '0')}`;
  }

  /**
   * Creates the invoice record and renders its PDF (PRD W-3).
   * Idempotent: an order already invoiced returns the existing record.
   */
  async createForOrder(orderId: string, actorId?: string) {
    const existing = await this.prisma.invoice.findUnique({ where: { orderId } });
    if (existing) return existing;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        organization: { select: { name: true, taxId: true, defaultCurrency: true } },
        store: { select: { name: true, address: true, phone: true } },
        customer: { select: { fullName: true, phone: true } },
        items: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    const invoice = await this.prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.nextInvoiceNumber(tx, order.organizationId);
      return tx.invoice.create({
        data: {
          organizationId: order.organizationId,
          orderId: order.id,
          invoiceNumber,
          totalAmount: order.totalAmount,
        },
      });
    });

    const subtotal = order.items.reduce(
      (sum, i) => sum.add(new Prisma.Decimal(i.unitPrice).mul(i.quantity)),
      new Prisma.Decimal(0),
    );

    const buffer = await this.pdf.generate({
      invoiceNumber: invoice.invoiceNumber,
      issuedAt: invoice.issuedAt,
      organizationName: order.organization.name,
      organizationTaxId: order.organization.taxId,
      storeName: order.store.name,
      storeAddress: order.store.address,
      storePhone: order.store.phone,
      customerName: order.customer.fullName,
      customerPhone: order.customer.phone,
      orderNumber: order.orderNumber,
      currency: order.organization.defaultCurrency,
      lines: order.items.map((i) => ({
        garmentType: i.garmentType,
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice.toString(),
      })),
      subtotal: subtotal.toString(),
      discount: order.discountAmount.toString(),
      total: order.totalAmount.toString(),
      paid: order.paidAmount.toString(),
    });

    // Storage is optional in dev; the invoice record stands without a PDF.
    if (this.storage.isEnabled()) {
      try {
        const key = `invoices/${order.organizationId}/${invoice.invoiceNumber}.pdf`;
        await this.storage.putObject(key, buffer, 'application/pdf');
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: { pdfUrl: key },
        });
      } catch (err) {
        this.logger.error(`Invoice PDF upload failed: ${(err as Error).message}`);
      }
    }

    await this.audit.log({
      organizationId: order.organizationId,
      storeId: order.storeId,
      actorUserId: actorId,
      actorType: actorId ? 'staff' : 'system',
      action: 'invoice.created',
      entityType: 'invoice',
      entityId: invoice.id,
      newValue: { invoiceNumber: invoice.invoiceNumber, total: order.totalAmount.toString() },
    });

    return this.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  }

  /** Renders the PDF on demand — used for direct download without S3. */
  async renderPdf(organizationId: string, invoiceId: string): Promise<{ buffer: Buffer; filename: string }> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: {
        order: {
          include: {
            organization: { select: { name: true, taxId: true, defaultCurrency: true } },
            store: { select: { name: true, address: true, phone: true } },
            customer: { select: { fullName: true, phone: true } },
            items: true,
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const order = invoice.order;
    const subtotal = order.items.reduce(
      (sum, i) => sum.add(new Prisma.Decimal(i.unitPrice).mul(i.quantity)),
      new Prisma.Decimal(0),
    );

    const buffer = await this.pdf.generate({
      invoiceNumber: invoice.invoiceNumber,
      issuedAt: invoice.issuedAt,
      organizationName: order.organization.name,
      organizationTaxId: order.organization.taxId,
      storeName: order.store.name,
      storeAddress: order.store.address,
      storePhone: order.store.phone,
      customerName: order.customer.fullName,
      customerPhone: order.customer.phone,
      orderNumber: order.orderNumber,
      currency: order.organization.defaultCurrency,
      lines: order.items.map((i) => ({
        garmentType: i.garmentType,
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice.toString(),
      })),
      subtotal: subtotal.toString(),
      discount: order.discountAmount.toString(),
      total: order.totalAmount.toString(),
      paid: order.paidAmount.toString(),
    });
    return { buffer, filename: `${invoice.invoiceNumber}.pdf` };
  }

  /** Presigned S3 link, for sharing (e.g. attaching to a WhatsApp message). */
  async getDownloadUrl(organizationId: string, invoiceId: string): Promise<string> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: { pdfUrl: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!invoice.pdfUrl || !this.storage.isEnabled()) {
      throw new ServiceUnavailableException('No stored PDF for this invoice');
    }
    return this.storage.getSignedDownloadUrl(invoice.pdfUrl);
  }

  listForStore(storeId: string) {
    return this.prisma.invoice.findMany({
      where: { order: { storeId } },
      orderBy: { issuedAt: 'desc' },
      include: {
        order: {
          select: {
            orderNumber: true,
            customer: { select: { fullName: true, phone: true } },
          },
        },
      },
    });
  }
}
