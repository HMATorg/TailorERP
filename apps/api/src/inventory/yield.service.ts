import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Hem/seam allowance added to every garment (v4 Phase 2). */
export const HEM_ALLOWANCE_METERS = new Prisma.Decimal('0.20');

/** Fallback when a roll does not carry its own minimum usable point. */
export const DEFAULT_MIN_USABLE_METERS = new Prisma.Decimal('3.50');

export interface YieldInput {
  /** M1 — الطول, centimetres */
  totalLengthCm: Prisma.Decimal | number | string;
  /** M3 — الكم, centimetres */
  sleeveLengthCm: Prisma.Decimal | number | string;
  /** Number of identical garments cut from the same measurements */
  quantity?: number;
}

/**
 * Fabric yield (v4 Phase 2):
 *
 *   Target Meter Yield = (Total Length × 2) + Sleeve Length + 0.20 m
 *
 * The blueprint states the formula in metres while measurements are captured in
 * centimetres, so the conversion happens here — in one place — rather than being
 * repeated (and eventually mis-remembered) at each call site.
 */
@Injectable()
export class YieldService {
  calculate(input: YieldInput): Prisma.Decimal {
    const lengthM = new Prisma.Decimal(input.totalLengthCm).div(100);
    const sleeveM = new Prisma.Decimal(input.sleeveLengthCm).div(100);

    if (lengthM.lessThanOrEqualTo(0) || sleeveM.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'Total length (M1) and sleeve length (M3) are required to calculate fabric yield',
      );
    }

    const perGarment = lengthM.mul(2).plus(sleeveM).plus(HEM_ALLOWANCE_METERS);
    const quantity = Math.max(1, input.quantity ?? 1);

    return perGarment.mul(quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_UP);
  }

  /**
   * Roll usability check: cutting must not take the remainder below the roll's
   * minimum usable point, or the offcut is too short to be sold as a thobe.
   */
  canCutFrom(params: {
    currentQuantity: Prisma.Decimal | number | string;
    reservedQuantity?: Prisma.Decimal | number | string;
    minUsableMeters?: Prisma.Decimal | number | string | null;
    requiredMeters: Prisma.Decimal | number | string;
  }): { ok: boolean; available: Prisma.Decimal; remainderAfter: Prisma.Decimal; minUsable: Prisma.Decimal } {
    const current = new Prisma.Decimal(params.currentQuantity);
    const reserved = new Prisma.Decimal(params.reservedQuantity ?? 0);
    const minUsable = new Prisma.Decimal(params.minUsableMeters ?? DEFAULT_MIN_USABLE_METERS);
    const required = new Prisma.Decimal(params.requiredMeters);

    // Metres already promised to other orders are not available to this one.
    const available = current.minus(reserved);
    const remainderAfter = available.minus(required);

    return {
      ok: remainderAfter.greaterThanOrEqualTo(minUsable),
      available,
      remainderAfter,
      minUsable,
    };
  }
}
