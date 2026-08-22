import axios from 'axios';

/**
 * Why a request failed, to the extent the error actually says so.
 *
 * Deliberately a kind and not a message: login and signup phrase the same failure
 * differently (signup has no "incorrect password" to report), so the copy belongs at the
 * call site while the evidence belongs here.
 */
export type RequestFailure = 'unauthorized' | 'offline' | 'unknown';

/** The `response` field, if this value has one shaped like a response. */
function responseStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const response = (error as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null) {
    return undefined;
  }
  const status = (response as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * The one wording for "the request never reached us", shared by every screen.
 *
 * `05-interactions.md` lists network failure among the states the design does not draw:
 * "`ApiFailure` exists in the codebase; nothing in the design shows it. Decide once — a
 * toast, an inline message, or a retry row — and apply it everywhere." This is that decision
 * for the auth screens: an inline message, in the same slot as their validation errors, from
 * a single constant so the two screens cannot drift apart. It is not transcribed from the
 * prototype, because the prototype has nothing to transcribe here.
 */
export const OFFLINE_MESSAGE = 'Cannot reach FORJD. Check your connection and try again.';

export function classifyRequestFailure(error: unknown): RequestFailure {
  const status = responseStatus(error);

  if (status === 401) {
    return 'unauthorized';
  }

  // "No response" only means offline when the thing that failed was a request. A TypeError
  // thrown inside this app has no `response` either, and telling that user to check their
  // connection sends them to look for a fault that is ours. `isAxiosError` is what
  // distinguishes "the network did not answer" from "this code threw".
  if (status === undefined && axios.isAxiosError(error)) {
    return 'offline';
  }

  return 'unknown';
}
