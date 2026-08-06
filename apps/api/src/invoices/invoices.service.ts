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
import { ZatcaService } from '../zatca/zatca.service';
import { KSA_VAT_RATE, splitInclusive } from '../zatca/zatca-vat';
import { InvoicePdfService, type InvoiceData } from './invoice-pdf.service';

/** The invoice fields the PDF needs; narrower than the full Prisma payload. */
type InvoiceRow = {
  invoiceNumber: string;
  issuedAt: Date;
  netAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  vatRate: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  qrCodeBase64: string | null;
  zatcaInvoiceType: string;
};

const ORDER_INCLUDE = {
  organization: {
    select: {
      name: true,
      taxId: true,
      vatNumber: true,
      crNumber: true,
      licenseNumber: true,
      logoUrl: true,
      defaultCurrency: true,
    },
  },
  store: { select: { name: true, address: true, phone: true } },
  customer: { select: { fullName: true, phone: true, vatNumber: true, address: true } },
  items: true,
} satisfies Prisma.OrderInclude;

/** `organization.logoUrl` is a `data:image/...;base64,...` URI — PDFKit needs raw bytes. */
function decodeLogoDataUri(uri: string | null): Buffer | null {
  if (!uri) return null;
  const match = /^data:image\/[a-zA-Z+]+;base64,(.+)$/.exec(uri);
  if (!match) return null;
  try {
    return Buffer.from(match[1], 'base64');
  } catch {
    return null;
  }
}

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: InvoicePdfService,
    private readonly storage: StorageService,
    private readonly counters: CounterService,
    private readonly audit: AuditService,
    private readonly zatca: ZatcaService,
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
   * Maps an invoice and its order onto the PDF's inputs.
   *
   * The tax block comes off the invoice row, which `ZatcaService.issue` fills
   * in. Rows predating issuance carry zeroes, so the split is recomputed here
   * rather than printing "VAT 0.00" on a document whose total plainly includes
   * VAT.
   */
  private buildPdfData(invoice: InvoiceRow, order: OrderWithRelations): InvoiceData {
    const subtotal = order.items.reduce(
      (sum, i) => sum.add(new Prisma.Decimal(i.unitPrice).mul(i.quantity)),
      new Prisma.Decimal(0),
    );

    const issued = !invoice.vatAmount.isZero() || !invoice.netAmount.isZero();
    const fallback = splitInclusive(invoice.totalAmount, KSA_VAT_RATE);
    const tax = issued
      ? { net: invoice.netAmount, vat: invoice.vatAmount, rate: invoice.vatRate }
      : { net: fallback.net, vat: fallback.vat, rate: fallback.rate };

    return {
      invoiceNumber: invoice.invoiceNumber,
      issuedAt: invoice.issuedAt,
      organizationName: order.organization.name,
      organizationVatNumber: order.organization.vatNumber,
      organizationTaxId: order.organization.taxId,
      organizationCrNumber: order.organization.crNumber,
      organizationLicenseNumber: order.organization.licenseNumber,
      organizationLogo: decodeLogoDataUri(order.organization.logoUrl),
      storeName: order.store.name,
      storeAddress: order.store.address,
      storePhone: order.store.phone,
      customerName: order.customer.fullName,
      customerPhone: order.customer.phone,
      customerVatNumber: order.customer.vatNumber,
      customerAddress: order.customer.address,
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
      total: invoice.totalAmount.toString(),
      netAmount: tax.net.toString(),
      vatAmount: tax.vat.toString(),
      vatRate: tax.rate.toString(),
      paid: order.paidAmount.toString(),
      qrCodeBase64: invoice.qrCodeBase64,
      simplified: invoice.zatcaInvoiceType !== 'standard',
    };
  }

  /**
   * Creates the invoice record, issues it through ZATCA, then renders the PDF
   * (PRD W-3). Idempotent: an order already invoiced returns the existing record.
   *
   * Issuance belongs here rather than at each call site, because the printed
   * document is only a valid tax invoice once the VAT split and QR exist. While
   * callers did it themselves, the PDF was rendered *before* issuance and went
   * out with no VAT block and no QR — and the WhatsApp path never issued at all.
   */
  async createForOrder(orderId: string, actorId?: string) {
    const existing = await this.prisma.invoice.findUnique({ where: { orderId } });
    if (existing) return existing;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundException('Order not found');

    const created = await this.prisma.$transaction(async (tx) => {
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

    const invoice = await this.zatca.issue(created.id, actorId);
    const buffer = await this.pdf.generate(this.buildPdfData(invoice, order));

    // Storage is optional in dev; the invoice record stands without a stored PDF.
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
  async renderPdf(
    organizationId: string,
    invoiceId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: { order: { include: ORDER_INCLUDE } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const buffer = await this.pdf.generate(this.buildPdfData(invoice, invoice.order));
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
