import type { BodyMetric } from "@forjd/domain";

/**
 * Bucket/key addressing on StorageProvider is deliberately vendor-agnostic (S3-shaped); this
 * interface follows the same principle for AI vision extraction. Swapping vendors (ADR-032
 * defers OpenAI as the eventual production choice, NVIDIA is development-only) is a new
 * implementation of this interface and nothing else -- no caller changes.
 */
export const VISION_PROVIDER = Symbol("VISION_PROVIDER");

export interface ExtractedMeasurement {
  /** The value as read (and, for weight-related fields, converted to canonical units). Null
   *  if the field is not printed on the sheet or could not be read at all. */
  value: number | null;
  /** 0-1. Whether this pre-fills the confirm screen is decided by
   *  `shouldPrefill` in @forjd/domain, not by this provider. */
  confidence: number;
  /** Non-empty only when confidence is notably reduced or a unit conversion was applied --
   *  shown to the user on the confirm screen so a low-confidence field is explainable, not
   *  just a lower number on a bar. */
  readingNote: string;
}

export interface ExtractedBodyScan {
  /** e.g. "570", or null if not printed / unreadable. */
  inbodyModel: string | null;
  /** ISO date string as printed on the sheet, or null. */
  testDate: string | null;
  fields: Record<BodyMetric, ExtractedMeasurement>;
  imageQualityNotes: string;
}

export interface VisionProvider {
  extractBodyScan(image: Buffer, mimeType: string): Promise<ExtractedBodyScan>;
}
