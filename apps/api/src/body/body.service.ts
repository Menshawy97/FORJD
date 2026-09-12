import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { BodyMetric, SegmentalSite, User } from "@forjd/domain";
import type {
  BodyScanListResponse,
  BodyScanResponse,
  BodyScanSeriesResponse,
  ConfirmBodyScanRequest,
  ExtractBodyScanResponse,
} from "@forjd/contracts";

import { STORAGE_PROVIDER, StorageProvider } from "../storage/providers/storage-provider.interface";
import { VISION_PROVIDER, VisionProvider } from "../ai/providers/vision-provider.interface";
import { PrivacyService } from "../privacy/privacy.service";
import { BodyRepository } from "./body.repository";

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
export const MAX_SCAN_PHOTO_BYTES = 10 * 1024 * 1024;
const SCAN_PHOTO_MAX_DIMENSION = 1600;
const SCAN_PHOTO_WEBP_QUALITY = 85;

const ALLOWED_SCAN_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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
    const scanId = await this.bodyRepository.createScan(user.id, measuredAt, "inbody", ref.key, request.measurements);

    const scan = await this.bodyRepository.getScanById(user.id, scanId);
    if (!scan) throw new NotFoundException("Scan not found immediately after creating it");

    return {
      id: scan.id,
      measuredAt: scan.measuredAt.toISOString(),
      source: "inbody",
      measurements: scan.measurements.map((m) => ({
        metric: m.metric as BodyMetric | SegmentalSite,
        value: m.value,
        unit: m.unit,
        confidence: m.confidence,
      })),
    };
  }

  async listScans(user: User): Promise<BodyScanListResponse> {
    const scans = await this.bodyRepository.listScansForUser(user.id);

    return {
      scans: scans.map((scan) => {
        const byMetric = new Map(scan.measurements.map((m) => [m.metric, m.value]));
        return {
          id: scan.id,
          measuredAt: scan.measuredAt.toISOString(),
          weightKg: byMetric.get("weight_kg") ?? null,
          bodyFatPercent: byMetric.get("body_fat_percent") ?? null,
        };
      }),
    };
  }

  async getScan(user: User, scanId: string): Promise<BodyScanResponse> {
    const scan = await this.bodyRepository.getScanById(user.id, scanId);
    if (!scan) throw new NotFoundException("Scan not found");

    return {
      id: scan.id,
      measuredAt: scan.measuredAt.toISOString(),
      source: "inbody",
      measurements: scan.measurements.map((m) => ({
        metric: m.metric as BodyMetric | SegmentalSite,
        value: m.value,
        unit: m.unit,
        confidence: m.confidence,
      })),
    };
  }

  async getSeries(user: User): Promise<BodyScanSeriesResponse> {
    const series = await this.bodyRepository.getSeriesForUser(user.id);

    return {
      series: series.map((s) => ({
        metric: s.metric as BodyMetric | SegmentalSite,
        unit: s.unit,
        points: s.points.map((p) => ({ measuredAt: p.measuredAt.toISOString(), value: p.value })),
      })),
    };
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
