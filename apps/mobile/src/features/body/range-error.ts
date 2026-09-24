import { measurementBounds } from '@forjd/contracts';
import type { BodyMetric, SegmentalSite } from '@forjd/domain';

/**
 * The message for a value outside the server's own limits (`measurementBounds`), or null.
 * Checked before saving so the user sees which field is wrong, instead of the whole scan being
 * rejected with a message that blamed their connection.
 */
export function rangeError(metric: BodyMetric | SegmentalSite, value: number, unit: string): string | null {
  const bounds = measurementBounds(metric, value);
  if (!bounds) return null;
  return `Must be between ${bounds[0]} and ${bounds[1]}${unit ? ` ${unit}` : ''}`;
}
