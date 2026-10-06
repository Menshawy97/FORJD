/**
 * The one door through which the API sends a push (Phase 12F, ADR-060, CLAUDE.md rules 3-4 and 8). Business code builds
 * `PushMessage`s and calls this interface; it never knows which service carries them, so moving from the Expo push service
 * to FCM direct later is an adapter, not a rewrite. The conformance script keeps the service's hostname and SDKs inside
 * `apps/api/src/integrations/push/`.
 *
 * **What a push may say is decided before this point** (ADR-061): the message builders in the sender (slice 3) take no
 * health value, and their tests prove it. This layer only carries what it is given, and never logs a token: a push token
 * is a bearer-ish address for one phone.
 */
export const NOTIFICATION_PROVIDER = Symbol('NOTIFICATION_PROVIDER');

export interface PushMessage {
  /** The device token to deliver to. */
  token: string;
  title: string;
  body: string;
  /** Ids and a type only (ADR-061): the app fetches the details after it opens. */
  data: Record<string, string>;
  /** The Android notification channel; the phone creates it (slice 4). */
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  /** How long the service may keep trying to deliver, in seconds. */
  ttlSeconds?: number;
}

export type PushErrorCode =
  /** The phone is gone (uninstalled, token expired): delete the token and never retry it. */
  | 'device_not_registered'
  | 'message_too_big'
  /** Too many sends too fast: try again later. */
  | 'rate_limited'
  | 'invalid_credentials'
  | 'invalid_request'
  /** The service could not be reached or answered something unusable: try again later. */
  | 'unavailable';

/** Only a service that is busy or unreachable is worth asking again; every other refusal will refuse again. */
export const isRetryablePushError = (code: PushErrorCode): boolean => code === 'rate_limited' || code === 'unavailable';

/** The service's answer to one message: accepted for delivery (with a ticket to look up later), or refused. */
export type PushTicket =
  | { token: string; status: 'ok'; ticketId: string }
  | { token: string; status: 'error'; error: PushErrorCode; retryable: boolean };

/** What happened to a delivery after the service accepted it. */
export type PushReceipt =
  | { ticketId: string; status: 'ok' }
  | { ticketId: string; status: 'error'; error: PushErrorCode };

export interface NotificationProvider {
  /**
   * Sends the messages and answers one ticket per message, in order. **Never throws**: a service that cannot be reached
   * (or answers something unusable) turns into a retryable `unavailable` ticket for every message, so one outage cannot
   * lose the rest of a batch or take down the caller.
   */
  send(messages: readonly PushMessage[]): Promise<PushTicket[]>;

  /**
   * Looks up what happened to tickets the service accepted, a quarter of an hour or so after sending. Answers only the
   * receipts the service knows; an id it does not know yet is simply left out (ask again later). **Never throws**: an
   * unreachable service answers nothing.
   */
  receipts(ticketIds: readonly string[]): Promise<PushReceipt[]>;
}

export const failedTicket = (token: string, error: PushErrorCode): PushTicket => ({
  token,
  status: 'error',
  error,
  retryable: isRetryablePushError(error),
});

/** The tokens the service says belong to a phone that is gone, ready for `PushTokensRepository.deleteByTokens`. */
export function deadTokens(tickets: readonly PushTicket[]): string[] {
  return tickets.flatMap((ticket) =>
    ticket.status === 'error' && ticket.error === 'device_not_registered' ? [ticket.token] : [],
  );
}
