import {
  BMI_TOLERANCE,
  BMR_TOLERANCE_RATIO,
  bmiFrom,
  bmiDisagrees,
  FFMI_TOLERANCE,
  fatFreeMassIndex,
  ffmiDisagrees,
  heightAdjustedFfmi,
  bmrDisagrees,
  fatFreeMassKg,
  katchMcArdleBmrKcal,
} from "./body-calculations";

/**
 * docs/product/scan-height-age-plan.md §4.1–4.2: the arithmetic behind the BMI and BMR checks on a
 * read sheet and the values filled in when a scan has none.
 */
describe("bmiFrom", () => {
  it("is weight over height in metres squared, to one decimal like the sheet", () => {
    // 86.6 / 1.778^2 = 27.39...
    expect(bmiFrom(86.6, 177.8)).toBe(27.4);
    expect(bmiFrom(70, 175)).toBe(22.9);
  });
});

describe("fatFreeMassKg", () => {
  it("prefers weight minus body fat mass", () => {
    expect(fatFreeMassKg({ weightKg: 86.6, bodyFatMassKg: 13.5, bodyFatPercent: 15.6 })).toBe(73.1);
  });

  it("uses body fat % when the mass is not known", () => {
    // 80 x (1 - 0.20) = 64
    expect(fatFreeMassKg({ weightKg: 80, bodyFatMassKg: null, bodyFatPercent: 20 })).toBe(64);
  });

  it("is unknown without either body fat value", () => {
    expect(fatFreeMassKg({ weightKg: 80, bodyFatMassKg: null, bodyFatPercent: null })).toBeNull();
  });
});

describe("katchMcArdleBmrKcal", () => {
  it("is 370 + 21.6 x fat-free mass, the formula InBody prints, in whole kcal", () => {
    // 370 + 21.6 x 73.1 = 1948.96
    expect(katchMcArdleBmrKcal(73.1)).toBe(1949);
  });
});

describe("bmiDisagrees", () => {
  it(`flags a sheet BMI more than ${BMI_TOLERANCE} away from the computed one`, () => {
    // The known misread: 29.3 read where the sheet says 25.3 (computed 25.3).
    expect(bmiDisagrees(29.3, 25.3)).toBe(true);
    expect(bmiDisagrees(25.9, 25.3)).toBe(true);
  });

  it("accepts the sheet's own rounding", () => {
    expect(bmiDisagrees(25.3, 25.3)).toBe(false);
    expect(bmiDisagrees(25.8, 25.3)).toBe(false);
    expect(bmiDisagrees(24.8, 25.3)).toBe(false);
  });
});

describe("bmrDisagrees", () => {
  it(`flags a sheet BMR more than ${BMR_TOLERANCE_RATIO * 100}% away from the formula`, () => {
    expect(bmrDisagrees(1750, 1949)).toBe(true);
    expect(bmrDisagrees(2100, 1949)).toBe(true);
  });

  it("accepts a BMR within 5%", () => {
    expect(bmrDisagrees(1949, 1949)).toBe(false);
    expect(bmrDisagrees(1860, 1949)).toBe(false);
    expect(bmrDisagrees(2040, 1949)).toBe(false);
  });
});

/**
 * Fat-free mass index (docs/product/scan-height-age-plan.md §4.3): Kouri et al., Clin J Sport Med
 * 1995;5(4):223–228. FFMI = FFM ÷ height², and the height-adjusted form adds 6.1 × (1.8 − height m).
 */
describe("fatFreeMassIndex", () => {
  it("is fat-free mass over height in metres squared, to one decimal", () => {
    // 73.1 / 1.78^2 = 23.07
    expect(fatFreeMassIndex(73.1, 178)).toBe(23.1);
  });
});

describe("heightAdjustedFfmi", () => {
  it("adds 6.1 × (1.8 − height m) to an FFMI, lifting a shorter person's and lowering a taller one's", () => {
    // 23.1 + 6.1 × 0.02 = 23.22
    expect(heightAdjustedFfmi(23.1, 178)).toBe(23.2);
    // 17.7 + 6.1 × (−0.1) = 17.09
    expect(heightAdjustedFfmi(17.7, 190)).toBe(17.1);
  });

  it("leaves the FFMI as it is at 1.8 m", () => {
    expect(heightAdjustedFfmi(21.6, 180)).toBe(21.6);
  });
});

describe("ffmiDisagrees", () => {
  it(`flags a sheet FFMI more than ${FFMI_TOLERANCE} away from the computed one`, () => {
    expect(ffmiDisagrees(26.1, 23.1)).toBe(true);
    expect(ffmiDisagrees(23.1, 23.1)).toBe(false);
    expect(ffmiDisagrees(23.6, 23.1)).toBe(false);
  });
});
