import { estimateOneRepMaxKg } from './training-calculations';

/**
 * RED first. These are the project's first training calculations, and CLAUDE.md rule 8 names
 * them explicitly: "unit tests for training/analytics calculations".
 *
 * R29 audit remediation (ADR-038): this file's implementation previously used a `reps - 1`
 * exponent that read about 3 percent low against the published Epley formula and disagreed
 * with `training-calculations.ts`'s own top-of-file docblock. Presented with both curves, the
 * user chose the standard, published formula -- `weight x (1 + reps / 30)`, unmodified, for
 * every rep count in range. The tests below pin that formula's exact output; they failed
 * against the pre-remediation `reps - 1` implementation (see the PR body for the recorded RED
 * failure).
 */
describe('estimateOneRepMaxKg', () => {
  // Standard Epley, unmodified, including at one rep: weight x (1 + reps/30). At exactly one
  // rep this is a touch above the lifted weight (100 x 31/30 = 103.33) rather than the weight
  // itself -- that is the published formula's own behaviour at its boundary, not a special case
  // this function adds.
  it('estimates at a single rep using the unmodified formula', () => {
    expect(estimateOneRepMaxKg(100, 1)).toBe(103.3);
    expect(estimateOneRepMaxKg(62.5, 1)).toBeCloseTo(64.6, 1);
  });

  it('extrapolates upward from a multi-rep set', () => {
    // 100 x 5 -> 100 * (1 + 5/30) = 116.67
    expect(estimateOneRepMaxKg(100, 5)).toBeCloseTo(116.7, 1);
    // 80 x 8 -> 80 * (1 + 8/30) = 101.33
    expect(estimateOneRepMaxKg(80, 8)).toBeCloseTo(101.3, 1);
  });

  it('grows with both load and reps', () => {
    expect(estimateOneRepMaxKg(100, 5)!).toBeGreaterThan(estimateOneRepMaxKg(100, 3)!);
    expect(estimateOneRepMaxKg(110, 5)!).toBeGreaterThan(estimateOneRepMaxKg(100, 5)!);
  });

  /*
   * The literature caps this family of estimators at ten reps, not twelve: accuracy studies
   * (DiStasio's Brzycki/Epley back-squat validation; the seven-equation sedentary-older-adults
   * comparison) both find Epley and Brzycki meaningfully more accurate under ten reps, with
   * error growing fastest just past it -- see ADR-030 (R7, R8). Refusing past ten is the honest
   * answer; a wrong estimate presented as a fact is exactly what this project has declined to
   * do everywhere else.
   */
  it('refuses to estimate from a set too long for the formula to mean anything', () => {
    expect(estimateOneRepMaxKg(60, 11)).toBeNull();
    expect(estimateOneRepMaxKg(60, 13)).toBeNull();
    expect(estimateOneRepMaxKg(60, 20)).toBeNull();
  });

  it('estimates at the edge of the supported range', () => {
    expect(estimateOneRepMaxKg(60, 10)).not.toBeNull();
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
    // 100 x 5 -> 100 * (1 + 5/30) = 116.666... -> 116.7
    expect(estimateOneRepMaxKg(100, 5)).toBe(116.7);
    // 102.5 x 3 -> 102.5 * (1 + 3/30) = 112.75 -> 112.8
    expect(estimateOneRepMaxKg(102.5, 3)).toBe(112.8);
  });
});
