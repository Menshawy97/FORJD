import { estimateOneRepMaxKg } from './training-calculations';

/**
 * RED first. These are the project's first training calculations, and CLAUDE.md rule 8 names
 * them explicitly: "unit tests for training/analytics calculations".
 */
describe('estimateOneRepMaxKg', () => {
  // Epley: weight x (1 + reps/30). A single rep is already a one-rep max, so the formula must
  // return the lift itself rather than inflating it -- which the naive `1 + reps/30` does not
  // do on its own (it would give 103.33 for 100x1).
  it('returns the lift itself for a single rep', () => {
    expect(estimateOneRepMaxKg(100, 1)).toBe(100);
    expect(estimateOneRepMaxKg(62.5, 1)).toBe(62.5);
  });

  it('extrapolates upward from a multi-rep set', () => {
    // 100 x 5 -> 100 * (1 + 4/30) = 113.33
    expect(estimateOneRepMaxKg(100, 5)).toBeCloseTo(113.3, 1);
    // 80 x 8 -> 80 * (1 + 7/30) = 98.67
    expect(estimateOneRepMaxKg(80, 8)).toBeCloseTo(98.7, 1);
  });

  it('grows with both load and reps', () => {
    expect(estimateOneRepMaxKg(100, 5)!).toBeGreaterThan(estimateOneRepMaxKg(100, 3)!);
    expect(estimateOneRepMaxKg(110, 5)!).toBeGreaterThan(estimateOneRepMaxKg(100, 5)!);
  });

  /*
   * Epley diverges badly past about ten reps -- a 20-rep set extrapolates to roughly 1.63x the
   * load, which is not a number to show an athlete as their own one-rep max. Refusing is the
   * honest answer; a wrong estimate presented as a fact is exactly what this project has
   * declined to do everywhere else.
   */
  it('refuses to estimate from a set too long for the formula to mean anything', () => {
    expect(estimateOneRepMaxKg(60, 13)).toBeNull();
    expect(estimateOneRepMaxKg(60, 20)).toBeNull();
  });

  it('estimates at the edge of the supported range', () => {
    expect(estimateOneRepMaxKg(60, 12)).not.toBeNull();
  });

  it('refuses a set that describes no lift at all', () => {
    expect(estimateOneRepMaxKg(0, 5)).toBeNull();
    expect(estimateOneRepMaxKg(-10, 5)).toBeNull();
    expect(estimateOneRepMaxKg(100, 0)).toBeNull();
    expect(estimateOneRepMaxKg(100, -1)).toBeNull();
  });

  // A whole number of reps or nothing: 3.5 reps is not a set anyone performed, and silently
  // rounding it would invent the number the estimate is built on.
  it('refuses a fractional rep count', () => {
    expect(estimateOneRepMaxKg(100, 3.5)).toBeNull();
  });

  it('refuses values that are not finite numbers', () => {
    expect(estimateOneRepMaxKg(Number.NaN, 5)).toBeNull();
    expect(estimateOneRepMaxKg(100, Number.NaN)).toBeNull();
    expect(estimateOneRepMaxKg(Number.POSITIVE_INFINITY, 5)).toBeNull();
  });

  // Displayed to one decimal, so it is rounded once here rather than at each call site --
  // otherwise two screens showing "the same" estimate could disagree in the last digit.
  it('rounds to a single decimal place', () => {
    expect(estimateOneRepMaxKg(100, 5)).toBe(113.3);
    expect(estimateOneRepMaxKg(102.5, 3)).toBe(109.3);
  });
});
