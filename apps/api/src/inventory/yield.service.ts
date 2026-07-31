import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Hem/seam allowance for a Thobe (v4 Phase 2) — the blueprint's exact figure. */
export const HEM_ALLOWANCE_METERS = new Prisma.Decimal('0.20');

/**
 * Bisht/Shirt/Trousers allowances below are *not* from the blueprint — there is
 * no documented fabric-consumption formula for them yet. These are reasonable
 * approximations so checkout works for every garment type today; replace with
 * real shop figures once available (D-054).
 */
export const BISHT_HEM_ALLOWANCE_METERS = new Prisma.Decimal('0.35');
export const SHIRT_HEM_ALLOWANCE_METERS = new Prisma.Decimal('0.15');
export const TROUSERS_HEM_ALLOWANCE_METERS = new Prisma.Decimal('0.25');

/** Fallback when a roll does not carry its own minimum usable point. */
export const DEFAULT_MIN_USABLE_METERS = new Prisma.Decimal('3.50');

export interface RobeYieldInput {
  /** M1 — الطول, centimetres */
  totalLengthCm: Prisma.Decimal | number | string;
  /** M3 — الكم, centimetres */
  sleeveLengthCm: Prisma.Decimal | number | string;
  /** Number of identical garments cut from the same measurements */
  quantity?: number;
  /** How many times total length is doubled over the fabric. Thobe = 2. */
  lengthMultiplier?: Prisma.Decimal | number | string;
  hemAllowanceM?: Prisma.Decimal | number | string;
}

/** Backward-compatible alias — `calculate()`'s original Thobe-only shape. */
export type YieldInput = Omit<RobeYieldInput, 'lengthMultiplier' | 'hemAllowanceM'>;

export interface TrouserYieldInput {
  /** T4 — الطول الكلي, centimetres */
  outseamCm: Prisma.Decimal | number | string;
  quantity?: number;
  hemAllowanceM?: Prisma.Decimal | number | string;
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
  /** The exact blueprint formula — Thobe only. Kept as the stable, tested entry point. */
  calculate(input: YieldInput): Prisma.Decimal {
    return this.calculateRobe(input);
  }

  /**
   * Generalised robe-family formula (Thobe/Bisht/Shirt — D-054): same shape as
   * the blueprint's Thobe formula, parameterised by how many times the length
   * is doubled over the fabric and by the hem/seam allowance, since a fuller
   * cloak (Bisht) or a shorter top (Shirt) plausibly needs a different
   * allowance even off the same measurement points. Defaults to Thobe's exact
   * figures, so `calculate()` above is unchanged by this generalisation.
   */
  calculateRobe(input: RobeYieldInput): Prisma.Decimal {
    const lengthM = new Prisma.Decimal(input.totalLengthCm).div(100);
    const sleeveM = new Prisma.Decimal(input.sleeveLengthCm).div(100);

    if (lengthM.lessThanOrEqualTo(0) || sleeveM.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'Total length (M1) and sleeve length (M3) are required to calculate fabric yield',
      );
    }

    const multiplier = new Prisma.Decimal(input.lengthMultiplier ?? 2);
    const hemAllowance = new Prisma.Decimal(input.hemAllowanceM ?? HEM_ALLOWANCE_METERS);
    const perGarment = lengthM.mul(multiplier).plus(sleeveM).plus(hemAllowance);
    const quantity = Math.max(1, input.quantity ?? 1);

    return perGarment.mul(quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_UP);
  }

  /**
   * Trousers has no sleeve to add and is cut as two leg panels rather than one
   * doubled body panel, so the robe formula's shape does not apply at all.
   * Approximation (D-054, pending real figures): two leg lengths plus a flat
   * allowance standing in for thigh/hip fullness, since this system does not
   * model fabric width and so cannot compute that fullness precisely.
   */
  calculateTrousers(input: TrouserYieldInput): Prisma.Decimal {
    const outseamM = new Prisma.Decimal(input.outseamCm).div(100);

    if (outseamM.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Outseam (T4) is required to calculate fabric yield');
    }

    const hemAllowance = new Prisma.Decimal(input.hemAllowanceM ?? TROUSERS_HEM_ALLOWANCE_METERS);
    const perGarment = outseamM.mul(2).plus(hemAllowance);
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
