import {
  distanceForDisplay,
  distanceFromDisplay,
  nextDistanceUnit,
  nextWeightUnit,
  weightForDisplay,
  weightFromDisplay,
} from './unit-conversion';

/**
 * The property that actually matters is the round trip. The athlete taps the unit chip, types a
 * number in pounds, taps back to kilograms, and the bar must not have quietly changed weight —
 * which is exactly what happens when the two directions round at incompatible precisions.
 */
describe('unit conversion', () => {
  describe('weight', () => {
    it('leaves kilograms untouched rather than rounding the canonical value', () => {
      expect(weightForDisplay(102.5, 'kg')).toBe(102.5);
      expect(weightForDisplay(0, 'kg')).toBe(0);
      expect(weightForDisplay(82.4, 'kg')).toBe(82.4);
      expect(weightFromDisplay(82.4, 'kg')).toBe(82.4);
    });

    it('rounds pounds to the nearest half, because plates come in halves', () => {
      // 100 kg is 220.462... lb.
      expect(weightForDisplay(100, 'lb')).toBe(220.5);
      expect(weightForDisplay(20, 'lb')).toBe(44);
      expect(weightForDisplay(60, 'lb')).toBe(132.5);
    });

    it('keeps one decimal converting pounds back to kilograms', () => {
      expect(weightFromDisplay(225, 'lb')).toBe(102.1);
      expect(weightFromDisplay(45, 'lb')).toBe(20.4);
    });

    /**
     * The guard the whole feature rests on. Half-pound display steps are coarser than the
     * one-decimal kilogram step, so a value that survives one trip survives every later one --
     * toggling the chip repeatedly must not walk the number anywhere.
     */
    it('is stable across repeated toggles', () => {
      for (const startKg of [20, 42.5, 60, 82.5, 100, 142.5]) {
        const afterOne = weightFromDisplay(weightForDisplay(startKg, 'lb'), 'lb');

        let kg = startKg;
        for (let round = 0; round < 10; round += 1) {
          kg = weightFromDisplay(weightForDisplay(kg, 'lb'), 'lb');
        }

        // Settles after the first trip and never moves again.
        expect(kg).toBe(afterOne);
        expect(Math.abs(kg - startKg)).toBeLessThanOrEqual(0.3);
      }
    });

    it('handles zero without producing a negative or a NaN', () => {
      expect(weightForDisplay(0, 'lb')).toBe(0);
      expect(weightFromDisplay(0, 'lb')).toBe(0);
    });
  });

  describe('distance', () => {
    it('keeps metres whole and miles to two decimals', () => {
      expect(distanceForDisplay(5000, 'm')).toBe(5000);
      expect(distanceForDisplay(5000, 'mi')).toBe(3.11);
      expect(distanceForDisplay(1609.344, 'mi')).toBe(1);
    });

    it('converts a typed distance back to whole metres', () => {
      expect(distanceFromDisplay(3.11, 'mi')).toBe(5005);
      expect(distanceFromDisplay(1, 'mi')).toBe(1609);
      expect(distanceFromDisplay(5000.4, 'm')).toBe(5000);
    });
  });

  describe('toggling', () => {
    it('flips between exactly two units in each direction', () => {
      expect(nextWeightUnit('kg')).toBe('lb');
      expect(nextWeightUnit('lb')).toBe('kg');
      expect(nextDistanceUnit('m')).toBe('mi');
      expect(nextDistanceUnit('mi')).toBe('m');
    });

    it('returns to the original unit after two taps', () => {
      expect(nextWeightUnit(nextWeightUnit('kg'))).toBe('kg');
      expect(nextDistanceUnit(nextDistanceUnit('m'))).toBe('m');
    });
  });
});
