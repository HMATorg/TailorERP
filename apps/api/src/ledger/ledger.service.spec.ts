import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ACCOUNTS, LedgerService } from './ledger.service';

/** Mirrors the seeded chart so posting rules resolve codes to ids. */
const ACCOUNT_ROWS = [
  { id: 'a-cash', code: ACCOUNTS.cashOnHand },
  { id: 'a-card', code: ACCOUNTS.cardClearing },
  { id: 'a-bank', code: ACCOUNTS.bank },
  { id: 'a-unearned', code: ACCOUNTS.unearnedRevenue },
  { id: 'a-vat', code: ACCOUNTS.vatPayable },
  { id: 'a-sales', code: ACCOUNTS.salesRevenue },
];

function makeTx() {
  const created: Record<string, any>[] = [];
  return {
    created,
    tx: {
      ledgerAccount: { findMany: jest.fn().mockResolvedValue(ACCOUNT_ROWS) },
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue({ entryNumber: 7 }),
        create: jest.fn().mockImplementation((args: Record<string, any>) => {
          created.push(args.data);
          return Promise.resolve({ id: 'j1', ...args.data });
        }),
      },
    },
  };
}

/** Maps posted lines back to account codes for readable assertions. */
function linesByCode(data: Record<string, any>) {
  const codeById = new Map(ACCOUNT_ROWS.map((a) => [a.id, a.code]));
  return Object.fromEntries(
    data.lines.create.map((l: Record<string, any>) => [
      codeById.get(l.accountId),
      { debit: l.debit.toFixed(2), credit: l.credit.toFixed(2) },
    ]),
  );
}

describe('LedgerService', () => {
  const service = new LedgerService({} as never);

  describe('post', () => {
    it('assigns the next sequential entry number', async () => {
      const { tx, created } = makeTx();
      await service.post(tx as never, {
        organizationId: 'org-1',
        source: 'adjustment',
        lines: [
          { code: ACCOUNTS.cashOnHand, debit: 100 },
          { code: ACCOUNTS.salesRevenue, credit: 100 },
        ],
      });
      expect(created[0].entryNumber).toBe(8);
    });

    it('refuses an entry whose debits and credits differ', async () => {
      const { tx } = makeTx();
      await expect(
        service.post(tx as never, {
          organizationId: 'org-1',
          source: 'adjustment',
          lines: [
            { code: ACCOUNTS.cashOnHand, debit: 100 },
            { code: ACCOUNTS.salesRevenue, credit: 99 },
          ],
        }),
      ).rejects.toThrow(/does not balance/);
    });

    it('refuses a zero-value entry', async () => {
      const { tx } = makeTx();
      await expect(
        service.post(tx as never, {
          organizationId: 'org-1',
          source: 'adjustment',
          lines: [
            { code: ACCOUNTS.cashOnHand, debit: 0 },
            { code: ACCOUNTS.salesRevenue, credit: 0 },
          ],
        }),
      ).rejects.toThrow(/zero-value/);
    });

    it('refuses an account the tenant does not have', async () => {
      const { tx } = makeTx();
      await expect(
        service.post(tx as never, {
          organizationId: 'org-1',
          source: 'adjustment',
          lines: [{ code: 'nonexistent', debit: 10 }, { code: ACCOUNTS.salesRevenue, credit: 10 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('postDeposit', () => {
    const deposit = (amount: number, method = 'card') => {
      const { tx, created } = makeTx();
      return service
        .postDeposit(tx as never, {
          organizationId: 'org-1',
          storeId: 's-1',
          orderId: 'o-1',
          orderNumber: 'ORD-000001',
          amount,
          method,
        })
        .then(() => linesByCode(created[0]));
    };

    it('debits cash and credits the liability — not revenue', async () => {
      // SAR 200 inclusive → 173.91 net + 26.09 VAT
      const lines = await deposit(200);
      expect(lines[ACCOUNTS.cardClearing]).toEqual({ debit: '200.00', credit: '0.00' });
      expect(lines[ACCOUNTS.unearnedRevenue]).toEqual({ debit: '0.00', credit: '173.91' });
      expect(lines[ACCOUNTS.vatPayable]).toEqual({ debit: '0.00', credit: '26.09' });
      // Nothing is earned at deposit time
      expect(lines[ACCOUNTS.salesRevenue]).toBeUndefined();
    });

    it('balances exactly', async () => {
      const { tx, created } = makeTx();
      await service.postDeposit(tx as never, {
        organizationId: 'org-1',
        storeId: 's-1',
        orderId: 'o-1',
        orderNumber: 'ORD-1',
        amount: 200,
        method: 'card',
      });
      expect(created[0].totalDebit.toFixed(2)).toBe(created[0].totalCredit.toFixed(2));
    });

    it('routes cash, card, and transfer to different asset accounts', async () => {
      expect(Object.keys(await deposit(100, 'cash'))).toContain(ACCOUNTS.cashOnHand);
      expect(Object.keys(await deposit(100, 'card'))).toContain(ACCOUNTS.cardClearing);
      expect(Object.keys(await deposit(100, 'transfer'))).toContain(ACCOUNTS.bank);
    });

    it('keeps net + VAT equal to cash received on awkward amounts', async () => {
      for (const amount of [0.07, 33.33, 999.99, 1234.56]) {
        const lines = await deposit(amount);
        const net = new Prisma.Decimal(lines[ACCOUNTS.unearnedRevenue].credit);
        const vat = new Prisma.Decimal(lines[ACCOUNTS.vatPayable].credit);
        expect(net.plus(vat).toFixed(2)).toBe(new Prisma.Decimal(amount).toFixed(2));
      }
    });
  });

  describe('postSettlement', () => {
    it('discharges the deposit liability and recognises the whole order as revenue', async () => {
      const { tx, created } = makeTx();
      // 400 order: 200 deposit already held, 200 balance now collected
      await service.postSettlement(tx as never, {
        organizationId: 'org-1',
        storeId: 's-1',
        orderId: 'o-1',
        orderNumber: 'ORD-1',
        amount: 200,
        depositApplied: 200,
        orderTotal: 400,
        method: 'cash',
      });
      const lines = linesByCode(created[0]);

      expect(lines[ACCOUNTS.cashOnHand]).toEqual({ debit: '200.00', credit: '0.00' });
      // liability released
      expect(lines[ACCOUNTS.unearnedRevenue]).toEqual({ debit: '173.91', credit: '0.00' });
      // revenue = net of deposit + net of balance
      expect(lines[ACCOUNTS.salesRevenue]).toEqual({ debit: '0.00', credit: '347.83' });
      // VAT is the REMAINDER against the order (52.17 − 26.09), not an
      // independent split of the balance, so the two entries sum to the invoice.
      expect(lines[ACCOUNTS.vatPayable]).toEqual({ debit: '0.00', credit: '26.08' });
      expect(created[0].totalDebit.toFixed(2)).toBe(created[0].totalCredit.toFixed(2));
    });

    it('handles a full-price settlement with no deposit', async () => {
      const { tx, created } = makeTx();
      await service.postSettlement(tx as never, {
        organizationId: 'org-1',
        storeId: 's-1',
        orderId: 'o-1',
        orderNumber: 'ORD-1',
        amount: 400,
        depositApplied: 0,
        method: 'cash',
      });
      const lines = linesByCode(created[0]);
      expect(lines[ACCOUNTS.cashOnHand].debit).toBe('400.00');
      expect(lines[ACCOUNTS.unearnedRevenue]).toBeUndefined(); // nothing to release
      expect(lines[ACCOUNTS.salesRevenue].credit).toBe('347.83');
      expect(lines[ACCOUNTS.vatPayable].credit).toBe('52.17');
    });

    it('never double-counts VAT across deposit and settlement', async () => {
      // Deposit 200 then settle 200 on a 400 order
      const d = makeTx();
      await service.postDeposit(d.tx as never, {
        organizationId: 'org-1', storeId: 's-1', orderId: 'o-1',
        orderNumber: 'ORD-1', amount: 200, method: 'card',
      });
      const s = makeTx();
      await service.postSettlement(s.tx as never, {
        organizationId: 'org-1', storeId: 's-1', orderId: 'o-1',
        orderNumber: 'ORD-1', amount: 200, depositApplied: 200, orderTotal: 400, method: 'cash',
      });

      const vatAtDeposit = new Prisma.Decimal(linesByCode(d.created[0])[ACCOUNTS.vatPayable].credit);
      const vatAtSettle = new Prisma.Decimal(linesByCode(s.created[0])[ACCOUNTS.vatPayable].credit);
      // Total VAT collected must equal VAT on the 400 order exactly — this is
      // what reconciles against the ZATCA filing.
      expect(vatAtDeposit.plus(vatAtSettle).toFixed(2)).toBe('52.17');
    });
  });
});
