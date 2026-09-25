import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  BODY_METRIC_UNITS,
  bmiFrom,
  fatFreeMassIndex,
  fatFreeMassKg,
  heightAdjustedFfmi,
  katchMcArdleBmrKcal,
  type BodyMetric,
  type ScanSource,
  type SegmentalSite,
  type User,
} from "@forjd/domain";
import type {
  CreateManualBodyScanRequest,
  BodyScanListResponse,
  BodyScanResponse,
  BodyScanSeriesResponse,
  ConfirmBodyScanRequest,
  ExtractBodyScanResponse,
} from "@forjd/contracts";

import { STORAGE_PROVIDER, StorageProvider } from "../storage/providers/storage-provider.interface";
import { VISION_PROVIDER, VisionProvider } from "../ai/providers/vision-provider.interface";
import { PrivacyService } from "../privacy/privacy.service";
import {
  BodyRepository,
  MeasurementRow,
  NewMeasurementInput,
  ScanProfileInput,
  ScanWithMeasurementsRow,
} from "./body.repository";

/** Mirrors `UploadedAvatarFile` in `avatar-upload.service.ts` -- the minimal shape
 *  `FileInterceptor`'s memory storage actually attaches, not `Express.Multer.File`. */
export interface UploadedScanPhoto {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/** Private bucket (unlike `avatars`): an InBody sheet is health data about an identifiable
 *  person, read back only through `getSignedUrl`, never `getPublicUrl`. */
export const INBODY_BUCKET = "inbody";

/** Larger than the avatar's 5 MiB / 512px -- a photographed document needs to stay legible
 *  at a size a vision model (and, on the scan-detail screen, a human) can actually read. */
/** A typed-in value is exactly what the user meant: nothing was inferred. */
export const MANUAL_ENTRY_CONFIDENCE = 1;

export const MAX_SCAN_PHOTO_BYTES = 10 * 1024 * 1024;
const SCAN_PHOTO_MAX_DIMENSION = 1600;
const SCAN_PHOTO_WEBP_QUALITY = 85;

const ALLOWED_SCAN_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** A request's height and age, stored on the scan row (both required since slice C). */
function scanProfileOf(request: { heightCm: number; ageYears: number }): ScanProfileInput {
  return { heightCm: request.heightCm, ageYears: request.ageYears };
}

/** A value worked out here is arithmetic on values the user confirmed, not a reading. */
const CALCULATED_CONFIDENCE = 1;

/**
 * A scan's measurements plus what can be worked out from them and the scan's height
 * (docs/product/scan-height-age-plan.md §4.1–4.2): a missing BMI from weight and height, and a
 * missing BMR from fat-free mass by the formula InBody prints (370 + 21.6 × FFM). A value the
 * sheet or the user gave is never replaced, and a filled-in one is marked calculated (rule 10).
 */
export function withCalculatedValues(measurements: NewMeasurementInput[], heightCm: number): NewMeasurementInput[] {
  const valueOf = (metric: BodyMetric): number | null => measurements.find((m) => m.metric === metric)?.value ?? null;
  const weightKg = valueOf("weight_kg");
  if (weightKg === null) return measurements;

  const calculated = (metric: BodyMetric, value: number): NewMeasurementInput => ({
    metric,
    value,
    unit: BODY_METRIC_UNITS[metric],
    confidence: CALCULATED_CONFIDENCE,
    calculated: true,
  });
  const added: NewMeasurementInput[] = [];
  if (valueOf("bmi") === null) added.push(calculated("bmi", bmiFrom(weightKg, heightCm)));
  const fatFree = fatFreeMassKg({
    weightKg,
    bodyFatMassKg: valueOf("body_fat_mass_kg"),
    bodyFatPercent: valueOf("body_fat_percent"),
  });
  if (valueOf("basal_metabolic_rate_kcal") === null && fatFree !== null) {
    added.push(calculated("basal_metabolic_rate_kcal", katchMcArdleBmrKcal(fatFree)));
  }
  return [...measurements, ...added];
}

const FFMI: BodyMetric = "fat_free_mass_index";

/**
 * A scan's measurements with its fat-free mass index (docs/product/scan-height-age-plan.md §4.3):
 * the sheet's own when it printed one, otherwise FFM ÷ height² from the scan's weight, body fat and
 * height, marked calculated. Worked out on every read rather than stored (rule 9), so it follows
 * the scan's values and needs no backfill. A scan without a height or a body fat value has none.
 */
export function withFatFreeMassIndex(measurements: MeasurementRow[], heightCm: number | null): MeasurementRow[] {
  if (heightCm === null || measurements.some((m) => m.metric === FFMI)) return measurements;
  const valueOf = (metric: BodyMetric): number | null => measurements.find((m) => m.metric === metric)?.value ?? null;
  const weightKg = valueOf("weight_kg");
  if (weightKg === null) return measurements;
  const fatFree = fatFreeMassKg({
    weightKg,
    bodyFatMassKg: valueOf("body_fat_mass_kg"),
    bodyFatPercent: valueOf("body_fat_percent"),
  });
  if (fatFree === null) return measurements;
  return [
    ...measurements,
    {
      metric: FFMI,
      value: fatFreeMassIndex(fatFree, heightCm),
      unit: BODY_METRIC_UNITS[FFMI],
      confidence: CALCULATED_CONFIDENCE,
      calculated: true,
    },
  ];
}

/** One scan as the API returns it. Confirm, scan detail and the account export share this so they
 *  cannot drift. */
export function toBodyScanResponse(scan: ScanWithMeasurementsRow): BodyScanResponse {
  return {
    id: scan.id,
    measuredAt: scan.measuredAt.toISOString(),
    source: scan.source as ScanSource,
    heightCm: scan.heightCm,
    ageYears: scan.ageYears,
    measurements: withFatFreeMassIndex(scan.measurements, scan.heightCm).map((m) => ({
      metric: m.metric as BodyMetric | SegmentalSite,
      value: m.value,
      unit: m.unit,
      confidence: m.confidence,
      calculated: m.calculated,
    })),
  };
}

@Injectable()
export class BodyService {
  constructor(
    @Inject(VISION_PROVIDER) private readonly visionProvider: VisionProvider,
    @Inject(STORAGE_PROVIDER) private readonly storageProvider: StorageProvider,
    private readonly bodyRepository: BodyRepository,
    private readonly privacyService: PrivacyService,
  ) {}

  /**
   * Saves nothing (`docs/architecture/health-data.md`'s "nothing saves unconfirmed" rule).
   * The re-encoded bytes are discarded after the vision call, not held anywhere -- if the
   * user confirms, `confirm` re-does this same encode from a second upload of the same
   * photo, rather than this method reaching for a temp store to hand off to it.
   *
   * C2: an InBody photo is health data about an identifiable person, and this is the one
   * place it leaves for a third-party vision model. `aiFeaturesConsent` is read and enforced
   * here, before `reencode` even decodes the bytes -- a non-consenting user's image is never
   * touched, not merely never uploaded.
   */
  async extract(user: User, file: UploadedScanPhoto | undefined): Promise<ExtractBodyScanResponse> {
    await this.requireAiConsent(user);
    const webp = await this.reencode(file);
    const extracted = await this.visionProvider.extractBodyScan(webp, "image/webp");

    return {
      inbodyModel: extracted.inbodyModel,
      testDate: extracted.testDate,
      fields: extracted.fields,
      segmental: extracted.segmental,
      heightCm: extracted.heightCm,
      ageYears: extracted.ageYears,
      imageQualityNotes: extracted.imageQualityNotes,
    };
  }

  /**
   * Gated the same as `extract` -- the client re-uploads and re-encodes the same photo here
   * (this service never persists the unconfirmed bytes), so this is a second, independent
   * opportunity for the image to reach the vision path if consent were checked only once.
   * It is not re-sent to the vision model, but it is still the same identifiable health photo
   * being decoded and written to storage, so the same fail-closed posture applies.
   */
  async confirm(
    user: User,
    file: UploadedScanPhoto | undefined,
    request: ConfirmBodyScanRequest,
  ): Promise<BodyScanResponse> {
    await this.requireAiConsent(user);
    const webp = await this.reencode(file);
    const ref = { bucket: INBODY_BUCKET, key: `${user.id}/${randomUUID()}.webp` };
    await this.storageProvider.upload({ ...ref, body: webp, contentType: "image/webp" });

    const measuredAt = new Date(request.measuredAt);
    const scanId = await this.bodyRepository.createScan(
      user.id,
      measuredAt,
      "inbody",
      ref.key,
      withCalculatedValues(request.measurements, request.heightCm),
      scanProfileOf(request),
    );

    const scan = await this.bodyRepository.getScanById(user.id, scanId);
    if (!scan) throw new NotFoundException("Scan not found immediately after creating it");

    return toBodyScanResponse(scan);
  }

  /**
   * InBody results typed in by the user, with no photo (docs/product/manual-inbody-entry-plan.md).
   * Nothing reaches the vision model or storage, so -- unlike `extract`/`confirm` -- there is
   * no AI-consent gate. Each value is stored at confidence 1: the user entered it, nothing was
   * inferred. The `manual` source keeps it distinguishable from a photographed scan (rule 10).
   */
  async createManual(user: User, request: CreateManualBodyScanRequest): Promise<BodyScanResponse> {
    const measurements = request.measurements.map((m) => ({ ...m, confidence: MANUAL_ENTRY_CONFIDENCE }));
    const scanId = await this.bodyRepository.createScan(
      user.id,
      new Date(request.measuredAt),
      "manual",
      null,
      withCalculatedValues(measurements, request.heightCm),
      scanProfileOf(request),
    );
    return this.getScan(user, scanId);
  }

  async listScans(user: User): Promise<BodyScanListResponse> {
    const scans = await this.bodyRepository.listScansForUser(user.id);

    return {
      scans: scans.map((scan) => {
        const byMetric = new Map(scan.measurements.map((m) => [m.metric, m.value]));
        return {
          id: scan.id,
          measuredAt: scan.measuredAt.toISOString(),
          source: scan.source as ScanSource,
          weightKg: byMetric.get("weight_kg") ?? null,
          bodyFatPercent: byMetric.get("body_fat_percent") ?? null,
        };
      }),
    };
  }

  async getScan(user: User, scanId: string): Promise<BodyScanResponse> {
    const scan = await this.bodyRepository.getScanById(user.id, scanId);
    if (!scan) throw new NotFoundException("Scan not found");

    return toBodyScanResponse(scan);
  }

  async getSeries(user: User): Promise<BodyScanSeriesResponse> {
    const [series, scans] = await Promise.all([
      this.bodyRepository.getSeriesForUser(user.id),
      this.bodyRepository.listScansForUser(user.id),
    ]);

    const stored = series
      // A sheet-printed FFMI is stored like any value; the series below already includes it.
      .filter((s) => s.metric !== FFMI)
      .map((s) => ({
        metric: s.metric as BodyMetric | SegmentalSite,
        unit: s.unit,
        points: s.points.map((p) => ({ measuredAt: p.measuredAt.toISOString(), value: p.value, calculated: p.calculated })),
      }));
    const ffmi = this.ffmiSeries(scans);
    return { series: ffmi.points.length > 0 ? [...stored, ffmi] : stored };
  }

  /** One FFMI point per scan that has one, oldest first, with Kouri et al.'s height-adjusted value. */
  private ffmiSeries(scans: ScanWithMeasurementsRow[]): BodyScanSeriesResponse["series"][number] {
    const points = [...scans]
      .sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime())
      .flatMap((scan) => {
        const ffmi = withFatFreeMassIndex(scan.measurements, scan.heightCm).find((m) => m.metric === FFMI);
        if (!ffmi) return [];
        return [
          {
            measuredAt: scan.measuredAt.toISOString(),
            value: ffmi.value,
            calculated: ffmi.calculated,
            ...(scan.heightCm === null ? {} : { heightAdjusted: heightAdjustedFfmi(ffmi.value, scan.heightCm) }),
          },
        ];
      });
    return { metric: FFMI, unit: BODY_METRIC_UNITS[FFMI], points };
  }

  private async requireAiConsent(user: User): Promise<void> {
    const privacy = await this.privacyService.get(user.id);
    if (!privacy.aiFeaturesConsent) {
      throw new ForbiddenException("AI features consent is required to process a body scan photo");
    }
  }

  /** ADR-024's two-stage pipeline applied to InBody photos: the server never trusts the
   *  client's own resize, so every accepted upload is unconditionally re-encoded here,
   *  regardless of what the client sent. */
  private async reencode(file: UploadedScanPhoto | undefined): Promise<Buffer> {
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }
    if (file.size > MAX_SCAN_PHOTO_BYTES) {
      throw new BadRequestException("Image must be 10 MB or smaller");
    }
    if (!ALLOWED_SCAN_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException("Unsupported image type. Use JPEG or PNG.");
    }

    try {
      return await sharp(file.buffer)
        .resize(SCAN_PHOTO_MAX_DIMENSION, SCAN_PHOTO_MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: SCAN_PHOTO_WEBP_QUALITY })
        .toBuffer();
    } catch {
      throw new BadRequestException("Could not process image. The file may be corrupt.");
    }
  }
}
