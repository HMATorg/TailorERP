import { Prisma } from '@prisma/client';
import { InvoicesService } from './invoices.service';

/**
 * Locks in the single invoicing path (D-041).
 *
 * Three call sites produce invoices — the counter at checkout, the
 * `invoice.requested` job at delivery, and the admin endpoint. They all go
 * through `createForOrder`, and the ordering inside it is what makes the
 * document a tax invoice rather than a receipt: issue to ZATCA first, render
 * second. When callers did those two steps themselves, the counter got them
 * right and the WhatsApp path never issued at all.
 */
const dec = (v: string) => new Prisma.Decimal(v);

const order = {
  id: 'order-1',
  organizationId: 'org-1',
  storeId: 'store-1',
  orderNumber: 'ORD-000001',
  totalAmount: dec('500.00'),
  discountAmount: dec('0'),
  paidAmount: dec('200.00'),
  organization: { name: 'خياطة الأنوار', taxId: null, vatNumber: '300012345600003', defaultCurrency: 'SAR' },
  store: { name: 'جدة', address: null, phone: null },
  customer: { fullName: 'محمد عبدالله', phone: '+966512345678' },
  items: [
    { garmentType: 'ثوب', description: null, quantity: 2, unitPrice: dec('250.00') },
  ],
};

/** Invoice as created (tax block still at defaults) vs as issued. */
const created = {
  id: 'inv-1',
  invoiceNumber: 'INV-2026-000001',
  issuedAt: new Date('2026-07-25T10:00:00Z'),
  netAmount: dec('0'),
  vatAmount: dec('0'),
  vatRate: dec('15.00'),
  totalAmount: dec('500.00'),
  qrCodeBase64: null,
  zatcaInvoiceType: 'simplified',
};
const issued = {
  ...created,
  netAmount: dec('434.78'),
  vatAmount: dec('65.22'),
  qrCodeBase64: 'BASE64TLV',
};

function build(opts: { existingInvoice?: unknown } = {}) {
  const calls: string[] = [];

  const prisma = {
    invoice: {
      findUnique: jest.fn(async () => opts.existingInvoice ?? null),
      create: jest.fn(async () => created),
      update: jest.fn(async () => issued),
      findUniqueOrThrow: jest.fn(async () => issued),
    },
    order: { findUnique: jest.fn(async () => order) },
    $transaction: jest.fn(async (fn: any) =>
      fn({ invoice: { create: jest.fn(async () => created) } }),
    ),
  };
  const pdf = {
    generate: jest.fn(async (_data: any): Promise<Buffer> => {
      calls.push('render');
      return Buffer.from('%PDF-1.7');
    }),
  };
  const zatca = {
    issue: jest.fn(async (..._args: any[]): Promise<any> => {
      calls.push('issue');
      return issued;
    }),
  };
  const storage = { isEnabled: () => false };
  const counters = { next: jest.fn(async () => 1) };
  const audit = { log: jest.fn(async () => undefined) };

  const service = new InvoicesService(
    prisma as any,
    pdf as any,
    storage as any,
    counters as any,
    audit as any,
    zatca as any,
  );
  return { service, prisma, pdf, zatca, audit, calls };
}

describe('InvoicesService.createForOrder', () => {
  it('issues to ZATCA before rendering the PDF', async () => {
    const { service, calls } = build();
    await service.createForOrder('order-1', 'user-1');
    // Order matters: rendering first is how invoices shipped with a zeroed VAT
    // block and no QR.
    expect(calls).toEqual(['issue', 'render']);
  });

  it('renders the issued tax figures, not the pre-issue defaults', async () => {
    const { service, pdf } = build();
    await service.createForOrder('order-1', 'user-1');

    const data = pdf.generate.mock.calls[0][0] as any;
    expect(data.qrCodeBase64).toBe('BASE64TLV');
    // Compared numerically: these cross the boundary as Decimal.toString(), which
    // drops trailing zeros ("500"), and the renderer applies toFixed(2). What
    // matters is the value, and that net + VAT reconstructs the gross exactly.
    expect(Number(data.netAmount)).toBeCloseTo(434.78, 2);
    expect(Number(data.vatAmount)).toBeCloseTo(65.22, 2);
    expect(Number(data.total)).toBeCloseTo(500.0, 2);
    expect(Number(data.netAmount) + Number(data.vatAmount)).toBeCloseTo(Number(data.total), 2);
  });

  it('is idempotent — a second call re-issues nothing', async () => {
    const { service, zatca, pdf } = build({ existingInvoice: issued });
    const result = await service.createForOrder('order-1', 'user-1');

    // The delivery job and the counter can both reach the same order; the second
    // must not mint a new ICV or overwrite the stored document.
    expect(zatca.issue).not.toHaveBeenCalled();
    expect(pdf.generate).not.toHaveBeenCalled();
    expect(result).toBe(issued);
  });

  it('falls back to computing VAT when a legacy row was never issued', async () => {
    // Rows predating D-041 carry a zeroed tax block; printing "VAT 0.00" on a
    // total that plainly includes VAT would be worse than recomputing it.
    const { service, pdf, zatca } = build();
    zatca.issue = jest.fn(async (..._a: any[]): Promise<any> => created); // issuance produced nothing
    await service.createForOrder('order-1', 'user-1');

    const data = pdf.generate.mock.calls[0][0] as any;
    expect(Number(data.netAmount)).toBeCloseTo(434.78, 2);
    expect(Number(data.vatAmount)).toBeCloseTo(65.22, 2);
    expect(Number(data.netAmount) + Number(data.vatAmount)).toBeCloseTo(500.0, 2);
  });

  it('records the creation in the audit log', async () => {
    const { service, audit } = build();
    await service.createForOrder('order-1', 'user-1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'invoice.created', entityType: 'invoice' }),
    );
  });
});
