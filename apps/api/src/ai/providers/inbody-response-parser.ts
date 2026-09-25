import { SCAN_AGE_YEARS_BOUNDS, SCAN_HEIGHT_CM_BOUNDS } from "@forjd/contracts";
import {
  BODY_METRICS,
  CM_PER_INCH,
  KG_PER_LB,
  SEGMENTAL_SITES,
  bmiDisagrees,
  bmiFrom,
  bmrDisagrees,
  fatFreeMassIndex,
  fatFreeMassKg,
  ffmiDisagrees,
  katchMcArdleBmrKcal,
  shouldPrefill,
  type BodyMetric,
  type SegmentalSite,
} from "@forjd/domain";

import { AGE_UNITS, HEIGHT_UNITS, PRINTED_FIELDS, SEGMENTAL_UNITS } from "./inbody-extraction-schema";
import type { ExtractedBodyScan, ExtractedMeasurement } from "./vision-provider.interface";

/**
 * Confidence given to a value whose printed unit the parser cannot vouch for -- missing, or not
 * one this field is ever printed in. Machines lay sheets out differently, so such a value is
 * kept for the user to confirm, but held below the pre-fill threshold (`shouldPrefill`, 0.9)
 * so it is never presented as already checked.
 */
export const UNVERIFIED_UNIT_CONFIDENCE = 0.5;

/**
 * Sheets print the test date in whatever form the machine uses ("2025.08.02. 13:10",
 * "2025/8/2", ISO), and the model passes it through. Normalise to YYYY-MM-DD, or null when it
 * is not a real calendar date -- the confirm screen then falls back to today.
 */
export function normalizeTestDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = raw.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Body Fat Mass vs Weight x PBF: absolute slack for the sheet's own 0.1 rounding, or 3%. */
const FAT_MASS_TOLERANCE_KG = 0.5;
const FAT_MASS_TOLERANCE_RATIO = 0.03;

/**
 * InBody's own arithmetic: Body Fat Mass = Weight x Percent Body Fat / 100. A reading that
 * breaks it means one of the two fat values was misread (on a real InBody 120 sheet the model
 * took PBF's 25.0 as Body Fat Mass, printed 21.9, at 99% confidence). Neither value is changed
 * -- the user sees what was read -- but both drop below the pre-fill threshold with a reason,
 * so the confirm screen asks for a check instead of presenting a wrong number as settled.
 */
function flagInconsistentBodyFat(fields: Record<BodyMetric, ExtractedMeasurement>): void {
  const weight = fields.weight_kg.value;
  const fatMass = fields.body_fat_mass_kg.value;
  const percent = fields.body_fat_percent.value;
  if (weight === null || fatMass === null || percent === null) return;

  const expected = (weight * percent) / 100;
  const tolerance = Math.max(FAT_MASS_TOLERANCE_KG, expected * FAT_MASS_TOLERANCE_RATIO);
  if (Math.abs(fatMass - expected) <= tolerance) return;

  const note = `This doesn't match weight × body fat % (${round2(expected)} kg), so please check it.`;
  for (const metric of ["body_fat_mass_kg", "body_fat_percent"] as const) {
    const field = fields[metric];
    fields[metric] = {
      value: field.value,
      confidence: Math.min(field.confidence, UNVERIFIED_UNIT_CONFIDENCE),
      readingNote: field.readingNote ? `${note} ${field.readingNote}` : note,
    };
  }
}

/** A reading another check can lean on: present and confident enough to pre-fill. */
function trusted(reading: ExtractedMeasurement): number | null {
  return reading.value !== null && shouldPrefill(reading.confidence) ? reading.value : null;
}

/**
 * BMI is weight ÷ height² (scan-height-age-plan.md §4.1). A read BMI that breaks it by more than
 * the sheet's rounding was misread (a real sheet's 25.3 came back as 29.3), so it is held for a
 * check. Only confident weight and height readings are used: a doubtful one says nothing.
 */
function flagInconsistentBmi(fields: Record<BodyMetric, ExtractedMeasurement>, height: ExtractedMeasurement): void {
  const weightKg = trusted(fields.weight_kg);
  const heightCm = trusted(height);
  const bmi = fields.bmi;
  if (bmi.value === null || weightKg === null || heightCm === null) return;

  const computed = bmiFrom(weightKg, heightCm);
  if (!bmiDisagrees(bmi.value, computed)) return;
  fields.bmi = needsCheck(bmi, `This doesn't match weight ÷ height² (${computed}), so please check it.`);
}

/**
 * InBody prints BMR as 370 + 21.6 × fat-free mass (scan-height-age-plan.md §4.2). A read BMR more
 * than 5% off it is held for a check. Runs after the body fat check, so a fat value that check
 * doubted is not trusted here either.
 */
function flagInconsistentBmr(fields: Record<BodyMetric, ExtractedMeasurement>): void {
  const bmr = fields.basal_metabolic_rate_kcal;
  const fatFree = trustedFatFreeMass(fields);
  if (bmr.value === null || fatFree === null) return;

  const computed = katchMcArdleBmrKcal(fatFree);
  if (!bmrDisagrees(bmr.value, computed)) return;
  fields.basal_metabolic_rate_kcal = needsCheck(
    bmr,
    `This doesn't match 370 + 21.6 × fat-free mass (${computed.toLocaleString("en-US")} kcal), so please check it.`,
  );
}

/** Fat-free mass from confidently read weight and body fat, or null when it cannot be vouched for. */
function trustedFatFreeMass(fields: Record<BodyMetric, ExtractedMeasurement>): number | null {
  const weightKg = trusted(fields.weight_kg);
  if (weightKg === null) return null;
  return fatFreeMassKg({
    weightKg,
    bodyFatMassKg: trusted(fields.body_fat_mass_kg),
    bodyFatPercent: trusted(fields.body_fat_percent),
  });
}

/**
 * Some models print FFMI (scan-height-age-plan.md §4.3). Like BMI, a printed value is kept, but
 * one that breaks fat-free mass ÷ height² by more than the sheet's rounding is held for a check.
 */
function flagInconsistentFfmi(fields: Record<BodyMetric, ExtractedMeasurement>, height: ExtractedMeasurement): void {
  const ffmi = fields.fat_free_mass_index;
  const heightCm = trusted(height);
  const fatFree = trustedFatFreeMass(fields);
  if (ffmi.value === null || heightCm === null || fatFree === null) return;

  const computed = fatFreeMassIndex(fatFree, heightCm);
  if (!ffmiDisagrees(ffmi.value, computed)) return;
  fields.fat_free_mass_index = needsCheck(ffmi, `This doesn't match fat-free mass ÷ height² (${computed}), so please check it.`);
}

type RawMeasurement = { value?: unknown; unit?: unknown; confidence?: unknown; reading_note?: unknown };

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * ADR-053's printed-value entry: the number and unit exactly as the sheet prints them. lb is
 * converted here, in code, rather than by the model -- which was measured reading lb digits
 * correctly and then skipping the conversion.
 */
function readPrinted(raw: RawMeasurement | undefined, allowedUnits: readonly string[]): ExtractedMeasurement {
  const value = typeof raw?.value === "number" ? raw.value : null;
  if (value === null) return { value: null, confidence: 0, readingNote: "" };

  const confidence = typeof raw?.confidence === "number" ? raw.confidence : 0;
  const modelNote = typeof raw?.reading_note === "string" ? raw.reading_note : "";
  const unit = typeof raw?.unit === "string" ? raw.unit : null;
  const withNote = (note: string) => (modelNote ? `${note} ${modelNote}` : note);

  if (unit === null || !allowedUnits.includes(unit)) {
    return {
      value,
      confidence: Math.min(confidence, UNVERIFIED_UNIT_CONFIDENCE),
      readingNote: withNote(`The unit printed for this value wasn't recognised (${unit ?? "none"}), so please check it.`),
    };
  }
  if (unit === "lb") {
    return { value: round2(value * KG_PER_LB), confidence, readingNote: withNote(`Converted from ${value} lb.`) };
  }
  return { value, confidence, readingNote: modelNote };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const NO_READING: ExtractedMeasurement = { value: null, confidence: 0, readingNote: "" };

/** Held below the pre-fill threshold, with the reason first and the model's own note after it. */
function needsCheck(reading: ExtractedMeasurement, note: string): ExtractedMeasurement {
  return {
    value: reading.value,
    confidence: Math.min(reading.confidence, UNVERIFIED_UNIT_CONFIDENCE),
    readingNote: reading.readingNote ? `${note} ${reading.readingNote}` : note,
  };
}

/** A reading the app could not save as it stands is kept for the user to correct, never dropped. */
function checkBounds(reading: ExtractedMeasurement, [min, max]: readonly [number, number], unit: string): ExtractedMeasurement {
  if (reading.value === null || (reading.value >= min && reading.value <= max)) return reading;
  return needsCheck(reading, `This is outside the range the app accepts (${min}–${max} ${unit}), so please check it.`);
}

type RawHeight = RawMeasurement & { inches?: unknown };

/**
 * The header's height (scan-height-age-plan.md §2.3), printed in cm, inches, or feet and inches.
 * Like lb to kg (ADR-053), the conversion happens here rather than in the model.
 */
function readHeight(raw: RawHeight | undefined): ExtractedMeasurement {
  const value = typeof raw?.value === "number" ? raw.value : null;
  if (value === null) return NO_READING;

  const confidence = typeof raw?.confidence === "number" ? raw.confidence : 0;
  const modelNote = typeof raw?.reading_note === "string" ? raw.reading_note : "";
  const unit = typeof raw?.unit === "string" ? raw.unit : null;
  const read = (cm: number, note: string): ExtractedMeasurement => ({
    value: cm,
    confidence,
    readingNote: note && modelNote ? `${note} ${modelNote}` : note || modelNote,
  });

  if (unit === null || !(HEIGHT_UNITS as readonly string[]).includes(unit)) {
    return needsCheck(read(value, ""), `The unit printed for this value wasn't recognised (${unit ?? "none"}), so please check it.`);
  }
  let reading: ExtractedMeasurement;
  if (unit === "ft_in") {
    const inches = typeof raw?.inches === "number" ? raw.inches : 0;
    const printed = inches ? `${value} ft ${inches} in` : `${value} ft`;
    reading = read(round1((value * 12 + inches) * CM_PER_INCH), `Converted from ${printed}.`);
  } else if (unit === "in") {
    reading = read(round1(value * CM_PER_INCH), `Converted from ${value} in.`);
  } else {
    reading = read(value, "");
  }
  return checkBounds(reading, SCAN_HEIGHT_CM_BOUNDS, "cm");
}

/** The header's age, in whole years (scan-height-age-plan.md §2.3). */
function readAge(raw: RawMeasurement | undefined): ExtractedMeasurement {
  const reading = readPrinted(raw, AGE_UNITS);
  // A missing value, or an unrecognised unit (already held for a check by readPrinted), is final.
  if (reading.value === null || !(AGE_UNITS as readonly unknown[]).includes(raw?.unit)) return reading;
  if (!Number.isInteger(reading.value)) {
    return needsCheck(reading, "Age is printed in whole years, so please check it.");
  }
  return checkBounds(reading, SCAN_AGE_YEARS_BOUNDS, "years");
}

/** Printed keys that differ from their canonical metric name (`weight` vs `weight_kg`). Some
 *  keys, like `bmi`, are identical in both shapes, so they cannot tell the shapes apart. */
const PRINTED_ONLY_KEYS = Object.entries(PRINTED_FIELDS)
  .filter(([metric, { key }]) => key !== metric)
  .map(([, { key }]) => key);

/** True when the response uses ADR-053's printed-value shape rather than the original one. */
function isPrintedShape(fields: Record<string, RawMeasurement> | undefined): boolean {
  if (!fields) return false;
  return (
    PRINTED_ONLY_KEYS.some((key) => key in fields) ||
    Object.values(fields).some((field) => typeof field === "object" && field !== null && "unit" in field)
  );
}

/**
 * Vendor-agnostic InBody response parser (extracted from `NvidiaVisionProvider`, ADR-032).
 *
 * Tolerates a markdown code fence or prose wrapping around the JSON object -- verified against
 * the live API to be necessary even with an otherwise-correct prompt (both `response_format`
 * and `nvext.guided_json` structured-output modes were tried and rejected; see ADR-032 decision
 * 3 and `buildInBodyExtractionPrompt`'s docblock).
 */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object found in response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Parses a raw InBody vision-model response into `ExtractedBodyScan`. Defensive by design: a
 * missing or malformed field coerces to a safe default (null value, 0 confidence, empty note)
 * rather than throwing, and a response with no `segmental` key at all (the shape every
 * pre-PR-#119 response has) still parses -- see `tests/fixtures/inbody/` for the fixtures that
 * pin this against real recorded responses, including real extraction errors the model made
 * (a value copied into the wrong field, a null confidence). The parser passes those errors
 * through faithfully; the confirm screen's confidence gate is the safety net, not this parser.
 */
export function parseInBodyExtractionResponse(text: string): ExtractedBodyScan {
  const raw = extractJson(text) as {
    inbody_model?: unknown;
    test_date?: unknown;
    height?: unknown;
    age?: unknown;
    fields?: Record<string, { value?: unknown; confidence?: unknown; reading_note?: unknown }>;
    segmental?: Record<string, { value?: unknown; confidence?: unknown; reading_note?: unknown }>;
    image_quality_notes?: unknown;
  };

  if (isPrintedShape(raw.fields as Record<string, RawMeasurement> | undefined)) {
    const fields = {} as Record<BodyMetric, ExtractedMeasurement>;
    for (const metric of BODY_METRICS) {
      const printed = PRINTED_FIELDS[metric];
      fields[metric] = readPrinted((raw.fields as Record<string, RawMeasurement>)[printed.key], printed.units);
    }
    flagInconsistentBodyFat(fields);
    const heightCm = readHeight(raw.height as RawHeight | undefined);
    flagInconsistentBmi(fields, heightCm);
    flagInconsistentBmr(fields);
    flagInconsistentFfmi(fields, heightCm);
    const segmental = {} as Record<SegmentalSite, ExtractedMeasurement>;
    for (const site of SEGMENTAL_SITES) {
      segmental[site] = readPrinted((raw.segmental as Record<string, RawMeasurement> | undefined)?.[site], SEGMENTAL_UNITS);
    }
    return {
      inbodyModel: typeof raw.inbody_model === "string" ? raw.inbody_model : null,
      testDate: normalizeTestDate(raw.test_date),
      fields,
      segmental,
      heightCm,
      ageYears: readAge(raw.age as RawMeasurement | undefined),
      imageQualityNotes: typeof raw.image_quality_notes === "string" ? raw.image_quality_notes : "",
    };
  }

  // The original (pre-ADR-053) shape: already-converted values keyed by canonical metric. Kept
  // so the recorded real responses in tests/fixtures/inbody/ stay covered.
  const readMeasurement = (
    raw_field: { value?: unknown; confidence?: unknown; reading_note?: unknown } | undefined,
  ): ExtractedMeasurement => ({
    value: typeof raw_field?.value === "number" ? raw_field.value : null,
    confidence: typeof raw_field?.confidence === "number" ? raw_field.confidence : 0,
    readingNote: typeof raw_field?.reading_note === "string" ? raw_field.reading_note : "",
  });

  const fields = {} as Record<BodyMetric, ExtractedMeasurement>;
  for (const metric of BODY_METRICS) {
    fields[metric] = readMeasurement(raw.fields?.[metric]);
  }

  const segmental = {} as Record<SegmentalSite, ExtractedMeasurement>;
  for (const site of SEGMENTAL_SITES) {
    segmental[site] = readMeasurement(raw.segmental?.[site]);
  }

  return {
    inbodyModel: typeof raw.inbody_model === "string" ? raw.inbody_model : null,
    testDate: normalizeTestDate(raw.test_date),
    fields,
    segmental,
    // The original shape predates height and age on scans, so it never carries them.
    heightCm: NO_READING,
    ageYears: NO_READING,
    imageQualityNotes: typeof raw.image_quality_notes === "string" ? raw.image_quality_notes : "",
  };
}
