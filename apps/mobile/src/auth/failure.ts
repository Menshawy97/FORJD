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

/**
 * Statuses whose response body carries copy the API wrote *for the user*, and which is
 * therefore safe to render verbatim.
 *
 * 401 is excluded deliberately, and that exclusion is the point of the allowlist rather than
 * an oversight: the API collapses every enumerable auth failure — "user already registered",
 * "invalid login credentials", "email not confirmed" — into one constant 401 string
 * precisely so a caller cannot probe which addresses hold accounts. Forwarding 401 bodies
 * would leave this app one server-side wording change away from undoing that.
 */
const ACTIONABLE_STATUSES: readonly number[] = [400, 429];

/**
 * The server's own message, when the server meant it to be read by a person.
 *
 * Signup previously replaced every non-offline failure with one generic sentence, which made
 * "Please try again" the advice for a mail-quota rejection that could not succeed for an
 * hour (found on the slice 14 device walk). Preferring the server's message where one exists
 * also stops the weak-password rule from being written carefully in the API and then thrown
 * away by the client.
 */
export function actionableServerMessage(error: unknown): string | undefined {
  const status = responseStatus(error);
  if (status === undefined || !ACTIONABLE_STATUSES.includes(status)) {
    return undefined;
  }

  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const response = (error as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null) {
    return undefined;
  }
  const data = (response as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  const message = (data as { message?: unknown }).message;

  return typeof message === 'string' && message.trim().length > 0 ? message : undefined;
}

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
