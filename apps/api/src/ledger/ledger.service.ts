import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type JournalSource, type PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { splitInclusive } from '../zatca/zatca-vat';

/** Machine keys the posting rules reference. */
export const ACCOUNTS = {
  cashOnHand: 'cash_on_hand',
  cardClearing: 'card_clearing',
  bank: 'bank',
  unearnedRevenue: 'unearned_revenue',
  vatPayable: 'vat_payable',
  salesRevenue: 'sales_revenue',
} as const;

const CHART: {
  code: string;
  name: string;
  nameAr: string;
  type: 'asset' | 'liability' | 'revenue';
  normalBalance: 'debit' | 'credit';
}[] = [
  { code: ACCOUNTS.cashOnHand, name: 'Cash on Hand', nameAr: 'النقد في الصندوق', type: 'asset', normalBalance: 'debit' },
  { code: ACCOUNTS.cardClearing, name: 'Card Clearing (Mada)', nameAr: 'مقاصة البطاقات', type: 'asset', normalBalance: 'debit' },
  { code: ACCOUNTS.bank, name: 'Bank', nameAr: 'البنك', type: 'asset', normalBalance: 'debit' },
  { code: ACCOUNTS.unearnedRevenue, name: 'Unearned Revenue (Customer Deposits)', nameAr: 'إيرادات غير مكتسبة', type: 'liability', normalBalance: 'credit' },
  { code: ACCOUNTS.vatPayable, name: 'VAT Payable', nameAr: 'ضريبة القيمة المضافة المستحقة', type: 'liability', normalBalance: 'credit' },
  { code: ACCOUNTS.salesRevenue, name: 'Sales Revenue', nameAr: 'إيرادات المبيعات', type: 'revenue', normalBalance: 'credit' },
];

interface PostLine {
  code: string;
  debit?: Prisma.Decimal | number;
  credit?: Prisma.Decimal | number;
  memo?: string;
}

/**
 * Double-entry ledger for custom-order deposits (v4 Phase 3 §2).
 *
 * Deposits are a **liability**, not revenue: the shop owes the customer a thobe,
 * and nothing is earned until handover. Only then does the balance move into
 * Sales Revenue. See D-036 for the sign convention, which the source blueprint
 * states backwards.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Creates the standard chart of accounts for a tenant. Idempotent. */
  async ensureChartOfAccounts(organizationId: string) {
    const existing = await this.prisma.ledgerAccount.findMany({
      where: { organizationId },
      select: { code: true },
    });
    const have = new Set(existing.map((a) => a.code));
    const missing = CHART.filter((a) => !have.has(a.code));
    if (missing.length === 0) return existing.length;

    await this.prisma.ledgerAccount.createMany({
      data: missing.map((a) => ({ organizationId, ...a })),
      skipDuplicates: true,
    });
    return missing.length;
  }

  private cashAccountFor(method: PaymentMethod | string): string {
    switch (method) {
      case 'card':
        return ACCOUNTS.cardClearing; // Mada settles to the bank later
      case 'transfer':
        return ACCOUNTS.bank;
      default:
        return ACCOUNTS.cashOnHand;
    }
  }

  /**
   * Posts a balanced entry. Rejects anything that does not balance *before*
   * touching the database — the CHECK constraint is the backstop, not the check.
   */
  async post(
    tx: Prisma.TransactionClient,
    params: {
      organizationId: string;
      storeId?: string;
      source: JournalSource;
      referenceType?: string;
      referenceId?: string;
      memo?: string;
      postedById?: string;
      lines: PostLine[];
    },
  ) {
    const accounts = await tx.ledgerAccount.findMany({
      where: { organizationId: params.organizationId },
    });
    const byCode = new Map(accounts.map((a) => [a.code, a]));

    let totalDebit = new Prisma.Decimal(0);
    let totalCredit = new Prisma.Decimal(0);
    const resolved = params.lines.map((line) => {
      const account = byCode.get(line.code);
      if (!account) {
        throw new BadRequestException(`Ledger account '${line.code}' is not set up for this tenant`);
      }
      const debit = new Prisma.Decimal(line.debit ?? 0);
      const credit = new Prisma.Decimal(line.credit ?? 0);
      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);
      return { accountId: account.id, debit, credit, memo: line.memo };
    });

    if (!totalDebit.equals(totalCredit)) {
      throw new BadRequestException(
        `Journal entry does not balance: debits ${totalDebit.toFixed(2)} vs credits ${totalCredit.toFixed(2)}`,
      );
    }
    if (totalDebit.isZero()) {
      throw new BadRequestException('Refusing to post a zero-value journal entry');
    }

    const last = await tx.journalEntry.findFirst({
      where: { organizationId: params.organizationId },
      orderBy: { entryNumber: 'desc' },
      select: { entryNumber: true },
    });

    return tx.journalEntry.create({
      data: {
        organizationId: params.organizationId,
        storeId: params.storeId,
        entryNumber: (last?.entryNumber ?? 0) + 1,
        source: params.source,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        memo: params.memo,
        totalDebit,
        totalCredit,
        postedById: params.postedById,
        lines: { create: resolved.filter((l) => !l.debit.isZero() || !l.credit.isZero()) },
      },
      include: { lines: true },
    });
  }

  /**
   * Deposit taken at the counter.
   *
   *   Dr  Cash / Card Clearing     (asset up — money received)
   *     Cr  Unearned Revenue       (liability up — goods still owed)
   *     Cr  VAT Payable            (VAT falls due on the advance under KSA rules)
   */
  async postDeposit(
    tx: Prisma.TransactionClient,
    params: {
      organizationId: string;
      storeId: string;
      orderId: string;
      orderNumber: string;
      amount: Prisma.Decimal | number;
      method: PaymentMethod | string;
      postedById?: string;
    },
  ) {
    const { net, vat, gross } = splitInclusive(params.amount);
    return this.post(tx, {
      organizationId: params.organizationId,
      storeId: params.storeId,
      source: 'deposit',
      referenceType: 'order',
      referenceId: params.orderId,
      memo: `Deposit for ${params.orderNumber}`,
      postedById: params.postedById,
      lines: [
        { code: this.cashAccountFor(params.method), debit: gross },
        { code: ACCOUNTS.unearnedRevenue, credit: net },
        { code: ACCOUNTS.vatPayable, credit: vat },
      ],
    });
  }

  /**
   * Handover: the balance is collected and the deposit becomes earned.
   *
   *   Dr  Cash / Card Clearing     (the balance received)
   *   Dr  Unearned Revenue         (liability discharged — we delivered)
   *     Cr  Sales Revenue          (net of the whole order, now earned)
   *     Cr  VAT Payable            (VAT on the balance only; deposit VAT already posted)
   */
  async postSettlement(
    tx: Prisma.TransactionClient,
    params: {
      organizationId: string;
      storeId: string;
      orderId: string;
      orderNumber: string;
      amount: Prisma.Decimal | number;
      depositApplied: Prisma.Decimal | number;
      /// Gross total of the order, used to derive VAT as a remainder (D-037)
      orderTotal?: Prisma.Decimal | number;
      method: PaymentMethod | string;
      postedById?: string;
    },
  ) {
    const balance = splitInclusive(params.amount);
    const deposit = splitInclusive(params.depositApplied);

    // VAT must be derived as a REMAINDER against the order, not computed
    // independently per payment: splitting 400 into 2x200 yields 26.09 + 26.09 =
    // 52.18, while the invoice says 52.17. A per-payment split would overstate
    // VAT Payable by a halala on every split order and never reconcile against
    // the ZATCA filing (D-037).
    const orderGross = params.orderTotal
      ? new Prisma.Decimal(params.orderTotal)
      : deposit.gross.plus(balance.gross);
    const orderSplit = splitInclusive(orderGross);
    const closesOrder = !deposit.gross.isZero();

    const vatThisEntry = closesOrder
      ? orderSplit.vat.minus(deposit.vat) // exactly the remainder
      : balance.vat;
    const revenueNet = closesOrder
      ? orderSplit.net.minus(deposit.net).plus(deposit.net) // = orderSplit.net
      : balance.net;

    const lines: PostLine[] = [
      { code: this.cashAccountFor(params.method), debit: balance.gross, memo: 'Balance collected' },
    ];
    if (!deposit.net.isZero()) {
      lines.push({
        code: ACCOUNTS.unearnedRevenue,
        debit: deposit.net,
        memo: 'Deposit realised',
      });
    }
    lines.push({ code: ACCOUNTS.salesRevenue, credit: revenueNet });
    if (!vatThisEntry.isZero()) {
      lines.push({ code: ACCOUNTS.vatPayable, credit: vatThisEntry });
    }

    // The entry must still balance after the remainder adjustment.
    const debits = balance.gross.plus(deposit.net);
    const credits = revenueNet.plus(vatThisEntry);
    if (!debits.equals(credits)) {
      // Rounding pushed a halala adrift — absorb it in revenue so the entry
      // balances and VAT stays exactly reconcilable to the invoice.
      const drift = debits.minus(credits);
      lines[lines.findIndex((l) => l.code === ACCOUNTS.salesRevenue)] = {
        code: ACCOUNTS.salesRevenue,
        credit: revenueNet.plus(drift),
      };
    }

    return this.post(tx, {
      organizationId: params.organizationId,
      storeId: params.storeId,
      source: 'settlement',
      referenceType: 'order',
      referenceId: params.orderId,
      memo: `Settlement for ${params.orderNumber}`,
      postedById: params.postedById,
      lines,
    });
  }

  /** Balances per account, plus the proof that the whole ledger balances. */
  async trialBalance(organizationId: string, asOf?: Date) {
    const rows = await this.prisma.$queryRaw<
      {
        code: string;
        name: string;
        type: string;
        normal_balance: string;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
      }[]
    >`
      SELECT a.code, a.name, a.type::text, a.normal_balance::text,
             COALESCE(SUM(l.debit), 0) AS debit,
             COALESCE(SUM(l.credit), 0) AS credit
      FROM ledger_accounts a
      LEFT JOIN ledger_lines l ON l.account_id = a.id
      LEFT JOIN journal_entries j ON j.id = l.entry_id
        ${asOf ? Prisma.sql`AND j.posted_at <= ${asOf}` : Prisma.empty}
      WHERE a.organization_id = ${organizationId}::uuid
      GROUP BY a.id, a.code, a.name, a.type, a.normal_balance
      ORDER BY a.type, a.code
    `;

    let totalDebit = new Prisma.Decimal(0);
    let totalCredit = new Prisma.Decimal(0);
    const accounts = rows.map((r) => {
      const debit = new Prisma.Decimal(r.debit);
      const credit = new Prisma.Decimal(r.credit);
      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);
      // Present each account on its natural side
      const balance = r.normal_balance === 'debit' ? debit.minus(credit) : credit.minus(debit);
      return {
        code: r.code,
        name: r.name,
        type: r.type,
        normalBalance: r.normal_balance,
        debit: debit.toFixed(2),
        credit: credit.toFixed(2),
        balance: balance.toFixed(2),
      };
    });

    return {
      asOf: asOf?.toISOString() ?? null,
      accounts,
      totalDebit: totalDebit.toFixed(2),
      totalCredit: totalCredit.toFixed(2),
      balanced: totalDebit.equals(totalCredit),
    };
  }

  /** Entry-level statement for one account — what an auditor asks for first. */
  async accountStatement(organizationId: string, code: string, limit = 100) {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: { organizationId_code: { organizationId, code } },
    });
    if (!account) throw new BadRequestException(`Unknown account '${code}'`);

    const lines = await this.prisma.ledgerLine.findMany({
      where: { accountId: account.id },
      orderBy: { entry: { entryNumber: 'desc' } },
      take: limit,
      include: {
        entry: {
          select: {
            entryNumber: true,
            postedAt: true,
            source: true,
            memo: true,
            referenceType: true,
            referenceId: true,
          },
        },
      },
    });

    return {
      account: { code: account.code, name: account.name, type: account.type },
      lines: lines.map((l) => ({
        entryNumber: l.entry.entryNumber,
        postedAt: l.entry.postedAt,
        source: l.entry.source,
        memo: l.memo ?? l.entry.memo,
        debit: l.debit.toFixed(2),
        credit: l.credit.toFixed(2),
      })),
    };
  }
}
