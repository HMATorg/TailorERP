import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DEFAULT_MIN_USABLE_METERS,
  SHIRT_HEM_ALLOWANCE_METERS,
  TROUSERS_HEM_ALLOWANCE_METERS,
  YieldService,
} from './yield.service';

describe('YieldService (v4 Phase 2 material maths)', () => {
  const service = new YieldService();

  describe('calculate', () => {
    it('applies (length × 2) + sleeve + 0.20 hem, converting cm to metres', () => {
      // 145cm length, 60cm sleeve → (1.45×2) + 0.60 + 0.20 = 3.70 m
      const result = service.calculate({ totalLengthCm: 145, sleeveLengthCm: 60 });
      expect(result.toFixed(2)).toBe('3.70');
    });

    it('multiplies across identical garments', () => {
      const result = service.calculate({ totalLengthCm: 145, sleeveLengthCm: 60, quantity: 3 });
      expect(result.toFixed(2)).toBe('11.10'); // 3.70 × 3
    });

    it('rounds up, never down — a short cut ruins the garment', () => {
      // 100.5cm, 55.5cm → (1.005×2) + 0.555 + 0.20 = 2.765 → 2.77
      const result = service.calculate({ totalLengthCm: 100.5, sleeveLengthCm: 55.5 });
      expect(result.toFixed(2)).toBe('2.77');
    });

    it('treats quantity 0 or negative as a single garment', () => {
      const one = service.calculate({ totalLengthCm: 145, sleeveLengthCm: 60, quantity: 1 });
      expect(service.calculate({ totalLengthCm: 145, sleeveLengthCm: 60, quantity: 0 })).toEqual(one);
      expect(service.calculate({ totalLengthCm: 145, sleeveLengthCm: 60, quantity: -5 })).toEqual(one);
    });

    it('refuses to guess when M1 or M3 is missing', () => {
      expect(() => service.calculate({ totalLengthCm: 0, sleeveLengthCm: 60 })).toThrow(
        BadRequestException,
      );
      expect(() => service.calculate({ totalLengthCm: 145, sleeveLengthCm: 0 })).toThrow(
        /M3/,
      );
    });

    it('accepts Decimal and string inputs identically', () => {
      const fromNumber = service.calculate({ totalLengthCm: 145, sleeveLengthCm: 60 });
      const fromString = service.calculate({ totalLengthCm: '145', sleeveLengthCm: '60' });
      const fromDecimal = service.calculate({
        totalLengthCm: new Prisma.Decimal(145),
        sleeveLengthCm: new Prisma.Decimal(60),
      });
      expect(fromString.toFixed(2)).toBe(fromNumber.toFixed(2));
      expect(fromDecimal.toFixed(2)).toBe(fromNumber.toFixed(2));
    });
  });

  describe('calculateRobe (D-054: Bisht/Shirt approximations)', () => {
    it('defaults to the exact Thobe formula when no multiplier/allowance is given', () => {
      const robe = service.calculateRobe({ totalLengthCm: 150, sleeveLengthCm: 62 });
      const thobe = service.calculate({ totalLengthCm: 150, sleeveLengthCm: 62 });
      expect(robe.toFixed(2)).toBe(thobe.toFixed(2));
    });

    it('applies a length×1 multiplier and Shirt allowance for a shorter garment', () => {
      // 75cm length, 58cm sleeve → (0.75×1) + 0.58 + 0.15 = 1.48 m
      const result = service.calculateRobe({
        totalLengthCm: 75,
        sleeveLengthCm: 58,
        lengthMultiplier: 1,
        hemAllowanceM: SHIRT_HEM_ALLOWANCE_METERS,
      });
      expect(result.toFixed(2)).toBe('1.48');
    });

    it('still requires both length and sleeve regardless of multiplier', () => {
      expect(() =>
        service.calculateRobe({ totalLengthCm: 75, sleeveLengthCm: 0, lengthMultiplier: 1 }),
      ).toThrow(BadRequestException);
    });
  });

  describe('calculateTrousers (D-054: approximation, no width model)', () => {
    it('applies 2×outseam + the trousers allowance, no sleeve term', () => {
      // 105cm outseam → (1.05×2) + 0.25 = 2.35 m
      const result = service.calculateTrousers({ outseamCm: 105 });
      expect(result.toFixed(2)).toBe('2.35');
      expect(TROUSERS_HEM_ALLOWANCE_METERS.toFixed(2)).toBe('0.25');
    });

    it('multiplies across identical garments and rounds up', () => {
      const result = service.calculateTrousers({ outseamCm: 105, quantity: 2 });
      expect(result.toFixed(2)).toBe('4.70');
    });

    it('refuses to guess when the outseam is missing', () => {
      expect(() => service.calculateTrousers({ outseamCm: 0 })).toThrow(/Outseam/);
    });
  });

  describe('canCutFrom', () => {
    it('allows a cut that leaves the roll above its minimum', () => {
      // 20m roll, cut 3.70 → 16.30 remaining, well above 3.50
      const result = service.canCutFrom({ currentQuantity: 20, requiredMeters: 3.7 });
      expect(result.ok).toBe(true);
      expect(result.remainderAfter.toFixed(2)).toBe('16.30');
    });

    it('blocks a cut that would strand the roll below the safety point', () => {
      // 6m roll, cut 3.70 → 2.30 remaining, below 3.50
      const result = service.canCutFrom({ currentQuantity: 6, requiredMeters: 3.7 });
      expect(result.ok).toBe(false);
      expect(result.remainderAfter.toFixed(2)).toBe('2.30');
    });

    it('allows a cut landing exactly on the safety point', () => {
      // 7.20 − 3.70 = 3.50 exactly
      const result = service.canCutFrom({ currentQuantity: 7.2, requiredMeters: 3.7 });
      expect(result.ok).toBe(true);
      expect(result.remainderAfter.toFixed(2)).toBe('3.50');
    });

    it('excludes metres already reserved for other orders', () => {
      // 20m on the roll but 15m promised elsewhere → only 5m usable
      const result = service.canCutFrom({
        currentQuantity: 20,
        reservedQuantity: 15,
        requiredMeters: 3.7,
      });
      expect(result.available.toFixed(2)).toBe('5.00');
      expect(result.ok).toBe(false); // 5.00 − 3.70 = 1.30 < 3.50
    });

    it('honours a roll-specific minimum over the default', () => {
      const strict = service.canCutFrom({
        currentQuantity: 10,
        requiredMeters: 3.7,
        minUsableMeters: 8,
      });
      expect(strict.ok).toBe(false); // 6.30 remaining < 8

      const lenient = service.canCutFrom({
        currentQuantity: 10,
        requiredMeters: 3.7,
        minUsableMeters: 1,
      });
      expect(lenient.ok).toBe(true);
    });

    it('falls back to the 3.50m blueprint default', () => {
      const result = service.canCutFrom({
        currentQuantity: 10,
        requiredMeters: 1,
        minUsableMeters: null,
      });
      expect(result.minUsable.toFixed(2)).toBe(DEFAULT_MIN_USABLE_METERS.toFixed(2));
    });

    it('reports a negative remainder rather than clamping it', () => {
      const result = service.canCutFrom({ currentQuantity: 2, requiredMeters: 10 });
      expect(result.ok).toBe(false);
      expect(result.remainderAfter.toFixed(2)).toBe('-8.00');
    });
  });

  describe('worked example from the blueprint', () => {
    it('validates three thobes against a single roll', () => {
      // Clerk adds 3 thobes for a customer measuring 150cm length, 62cm sleeve
      const perGarment = service.calculate({ totalLengthCm: 150, sleeveLengthCm: 62 });
      expect(perGarment.toFixed(2)).toBe('3.82'); // (3.00) + 0.62 + 0.20

      const total = service.calculate({ totalLengthCm: 150, sleeveLengthCm: 62, quantity: 3 });
      expect(total.toFixed(2)).toBe('11.46');

      // A 20m roll can take all three (20 − 11.46 = 8.54 ≥ 3.50)
      expect(service.canCutFrom({ currentQuantity: 20, requiredMeters: total }).ok).toBe(true);
      // A 14m roll cannot (14 − 11.46 = 2.54 < 3.50)
      expect(service.canCutFrom({ currentQuantity: 14, requiredMeters: total }).ok).toBe(false);
    });
  });
});
