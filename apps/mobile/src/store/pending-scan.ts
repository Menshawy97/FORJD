import type { ExtractBodyScanResponse } from '@forjd/contracts';

/**
 * A one-shot, in-memory handoff from `inbody.tsx` (captures the photo, calls extract) to
 * `inbody-confirm.tsx` (shows the result, calls confirm). Deliberately not a persisted store
 * like `workout-session.ts` -- there is nothing here worth surviving a force-kill; if the app
 * dies mid-flow the user re-photographs the sheet, exactly as if they had backgrounded before
 * tapping the upload button at all.
 *
 * A plain module-level variable, not a param passed through `expo-router`'s URL-based
 * navigation: the extracted payload (nine fields, each with a value/confidence/note) and the
 * local photo URI are both too large and too irregular to serialize into a route param
 * without a lossy round trip through `encodeURIComponent`.
 */
export interface PendingScan {
  photoUri: string;
  extracted: ExtractBodyScanResponse;
}

let pending: PendingScan | null = null;

export function setPendingScan(value: PendingScan): void {
  pending = value;
}

export function takePendingScan(): PendingScan | null {
  const value = pending;
  pending = null;
  return value;
}
