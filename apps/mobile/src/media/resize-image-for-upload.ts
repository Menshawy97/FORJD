// SDK 54's real API is a named `ImageManipulator` object (backed by the native module) plus a
// `SaveFormat` enum -- there is no `manipulate` free function and no default export. Confirmed
// against this project's own installed `expo-image-manipulator@14.0.8` type declarations
// (`ImageManipulator.d.ts`/`NativeImageManipulatorModule.d.ts`), not assumed from docs alone.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * ADR-024: client-side pre-resize/re-encode before an avatar (or any future upload) leaves the
 * device. This is a UX/bandwidth optimization only -- the server performs its own mandatory
 * `sharp` re-encode and never trusts this step (the server "never trusts client-side
 * compression", the ADR's own words), so this stays simple: resize to fit, re-encode to WebP,
 * done. Every failure is surfaced as a plain `Error` so a caller's existing catch block can
 * show a user-facing message instead of the picker flow crashing.
 */

/** ADR-024's avatar row: 512x512 max, quality 80. */
export const AVATAR_MAX_DIMENSION = 512;

const OUTPUT_QUALITY = 0.8;

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ResizedImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * Fits `original` within a `maxDimension` square, preserving aspect ratio, never upscaling an
 * image that is already smaller -- the same `withoutEnlargement` rule the server's `sharp`
 * step applies.
 */
function computeTargetDimensions(
  original: ImageDimensions,
  maxDimension: number,
): ImageDimensions {
  const largestSide = Math.max(original.width, original.height);
  if (largestSide <= maxDimension) {
    return original;
  }

  const scale = maxDimension / largestSide;
  return {
    width: Math.round(original.width * scale),
    height: Math.round(original.height * scale),
  };
}

/**
 * Resizes and re-encodes a picked image to fit within `maxDimension` on its longest side.
 *
 * `original` is the picked asset's own reported dimensions -- `expo-image-picker`'s
 * `ImagePickerAsset` already returns `width`/`height` on every asset, so no extra native call
 * (e.g. `Image.getSize`) is needed just to learn them.
 */
export async function resizeImageForUpload(
  uri: string,
  original: ImageDimensions,
  maxDimension: number,
): Promise<ResizedImage> {
  try {
    const target = computeTargetDimensions(original, maxDimension);

    const context = ImageManipulator.manipulate(uri);
    context.resize({ width: target.width, height: target.height });
    const rendered = await context.renderAsync();
    const result = await rendered.saveAsync({
      format: SaveFormat.WEBP,
      compress: OUTPUT_QUALITY,
    });

    return { uri: result.uri, width: result.width, height: result.height };
  } catch {
    throw new Error('Could not prepare the image for upload.');
  }
}
