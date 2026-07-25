import { Prisma } from '@prisma/client';

/** KSA standard VAT rate. Stored per-invoice so historic documents stay correct. */
export const KSA_VAT_RATE = new Prisma.Decimal(15);

export interface VatBreakdown {
  net: Prisma.Decimal;
  vat: Prisma.Decimal;
  gross: Prisma.Decimal;
  rate: Prisma.Decimal;
}

/** Half-up to 2dp — the rounding ZATCA expects on monetary fields. */
function round2(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Splits a **VAT-inclusive** price into net and VAT.
 *
 * Retail prices in KSA are quoted gross, and our order totals are what the
 * customer was quoted, so this is the direction that matters. Deriving net by
 * subtraction (rather than computing VAT from a rounded net) guarantees
 * net + vat === gross exactly, which is what the tax authority reconciles.
 */
export function splitInclusive(
  grossAmount: Prisma.Decimal | number | string,
  rate: Prisma.Decimal = KSA_VAT_RATE,
): VatBreakdown {
  const gross = round2(new Prisma.Decimal(grossAmount));
  const divisor = new Prisma.Decimal(100).plus(rate).div(100); // 1.15
  const net = round2(gross.div(divisor));
  const vat = gross.minus(net); // never re-rounded — keeps the identity exact
  return { net, vat, gross, rate };
}

/** Adds VAT to a net (tax-exclusive) amount. */
export function addExclusive(
  netAmount: Prisma.Decimal | number | string,
  rate: Prisma.Decimal = KSA_VAT_RATE,
): VatBreakdown {
  const net = round2(new Prisma.Decimal(netAmount));
  const vat = round2(net.mul(rate).div(100));
  return { net, vat, gross: net.plus(vat), rate };
}
