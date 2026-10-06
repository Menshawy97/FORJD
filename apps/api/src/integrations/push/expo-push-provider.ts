import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import {
  failedTicket,
  NOTIFICATION_PROVIDER,
  type NotificationProvider,
  type PushErrorCode,
  type PushMessage,
  type PushReceipt,
  type PushTicket,
} from './notification-provider';

/**
 * The Expo push service behind `NotificationProvider` (ADR-060, accepted by the owner 2026-10-03: generic text may pass
 * through Expo's servers). A thin client over its two HTTP endpoints with an injected `fetch`, the same shape as the
 * Turnstile and WHOOP clients, so there is no SDK to keep current and the tests stub the network. Documented at
 * docs.expo.dev/push-notifications/sending-notifications.
 *
 * Never logs a push token or the access token: a token is a bearer-ish address for one phone. Failures log a reason code
 * and a count only.
 */
const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
/** Expo's limits: 100 messages per send request, 1000 ids per receipts request. */
const MAX_SEND_BATCH = 100;
const MAX_RECEIPT_BATCH = 1000;
/**
 * Two attempts of ten seconds, no backoff (the repo convention). Only an answer of 5xx or a connection that failed is
 * retried: a 4xx will be refused again, and a **timeout or an unreadable reply is not retried at all**, because Expo's send
 * is not idempotent and the first attempt may have been accepted (a second would push twice). Delivery is therefore
 * at-least-once end to end, never retried blindly here (ADR-060).
 */
const MAX_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = 10_000;

export interface CreateExpoPushProviderOptions {
  /** Expo's optional "enhanced push security" access token; sent as a bearer header when set. */
  accessToken?: string;
  /** Injected for tests; defaults to the global `fetch` Node 22 provides. */
  fetchImpl?: typeof fetch;
}

/** Expo's documented error names for a refused message, mapped to ours. Anything else is not guessed at. */
const EXPO_ERROR: Record<string, PushErrorCode> = {
  DeviceNotRegistered: 'device_not_registered',
  MessageTooBig: 'message_too_big',
  MessageRateExceeded: 'rate_limited',
  InvalidCredentials: 'invalid_credentials',
  MismatchSenderId: 'invalid_credentials',
};

/** `Object.hasOwn`, so a reply naming `constructor` or `toString` is an unknown error, not an inherited function. */
const mapExpoError = (name: string | undefined): PushErrorCode =>
  name !== undefined && Object.hasOwn(EXPO_ERROR, name) ? EXPO_ERROR[name]! : 'invalid_request';

/**
 * Expo tokens look like `ExponentPushToken[...]` (or `ExpoPushToken[...]`). A token of any other shape is refused here
 * as one bad message, never sent: Expo answers a request with a malformed token by refusing the whole batch, which would
 * drop up to 99 valid messages with it.
 */
const EXPO_TOKEN_PATTERN = /^(?:Exponent|Expo)PushToken\[[^\]\s]+\]$/;

/** After this many chunks in a row that could not be sent at all, the rest of a big batch is not even tried. */
const MAX_CONSECUTIVE_UNREACHABLE_CHUNKS = 3;

const errorOutcomeSchema = z.object({
  status: z.literal('error'),
  message: z.string().optional(),
  details: z.object({ error: z.string().optional() }).optional(),
});
/** A receipt: delivered, or an error. */
const outcomeSchema = z.union([z.object({ status: z.literal('ok') }), errorOutcomeSchema]);
/** A ticket: accepted with an id to look up later, or an error. An 'ok' without an id is not a usable answer. */
const ticketSchema = z.union([z.object({ status: z.literal('ok'), id: z.string().min(1) }), errorOutcomeSchema]);
const sendResponseSchema = z.object({ data: z.array(ticketSchema) });
/** The receipts map is read entry by entry, so one malformed receipt cannot cost the rest of the chunk theirs. */
const receiptsResponseSchema = z.object({ data: z.record(z.string(), z.unknown()) });

/** A non-2xx answer, so the retry loop can tell a real refusal (4xx) from a transient failure (5xx). */
class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`Expo push service answered ${status}`);
  }
}

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
};

/** What a whole-request failure means for the messages in it. */
function failureCode(error: unknown): PushErrorCode {
  if (!(error instanceof HttpStatusError)) return 'unavailable';
  if (error.status === 429) return 'rate_limited';
  if (error.status === 401 || error.status === 403) return 'invalid_credentials';
  if (error.status >= 400 && error.status < 500) return 'invalid_request';
  return 'unavailable';
}

const reasonOf = (error: unknown): string =>
  error instanceof HttpStatusError ? `status ${error.status}` : error instanceof Error ? error.name : 'unknown error';

export function createExpoPushProvider(options: CreateExpoPushProviderOptions = {}): NotificationProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const logger = new Logger('ExpoPushProvider');

  const headers = (): Record<string, string> => ({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
  });

  async function post(url: string, body: unknown): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(body),
          redirect: 'error',
          signal: controller.signal,
        });
        if (response.ok) return await response.json();
        const failure = new HttpStatusError(response.status);
        // A 4xx will be refused again, and a 429 should not be hammered: only a 5xx is worth a second try.
        if (response.status < 500) throw failure;
        lastError = failure;
      } catch (error) {
        if (error instanceof HttpStatusError && error.status < 500) throw error;
        // The request may have been accepted before it timed out or the reply broke: do not send it twice.
        if (error instanceof SyntaxError || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))) {
          throw error;
        }
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  const toExpoMessage = (message: PushMessage) => ({
    to: message.token,
    title: message.title,
    body: message.body,
    data: message.data,
    ...(message.channelId ? { channelId: message.channelId } : {}),
    ...(message.priority ? { priority: message.priority } : {}),
    ...(message.ttlSeconds !== undefined ? { ttl: message.ttlSeconds } : {}),
  });

  async function sendChunk(messages: PushMessage[]): Promise<PushTicket[]> {
    try {
      const parsed = sendResponseSchema.safeParse(await post(SEND_URL, messages.map(toExpoMessage)));
      if (!parsed.success || parsed.data.data.length !== messages.length) {
        logger.warn(`Expo push service answered something unusable; ${messages.length} message(s) not confirmed.`);
        return messages.map((message) => failedTicket(message.token, 'unavailable'));
      }
      return messages.map((message, index): PushTicket => {
        const ticket = parsed.data.data[index]!;
        if (ticket.status === 'ok') return { token: message.token, status: 'ok', ticketId: ticket.id };
        return failedTicket(message.token, mapExpoError(ticket.details?.error));
      });
    } catch (error) {
      const code = failureCode(error);
      logger.warn(`Expo push send failed (${reasonOf(error)}); ${messages.length} message(s) not sent.`);
      return messages.map((message) => failedTicket(message.token, code));
    }
  }

  return {
    async send(messages) {
      // One ticket per message, in the order given: a token that is not shaped like an Expo token is answered on the
      // spot, and the rest are sent in chunks.
      const tickets = new Array<PushTicket>(messages.length);
      const sendable: Array<{ message: PushMessage; index: number }> = [];
      messages.forEach((message, index) => {
        if (EXPO_TOKEN_PATTERN.test(message.token)) sendable.push({ message, index });
        else tickets[index] = failedTicket(message.token, 'invalid_request');
      });

      let unreachableInARow = 0;
      for (const group of chunk(sendable, MAX_SEND_BATCH)) {
        // During an outage every chunk would cost two ten-second attempts; stop trying after a few in a row.
        const result =
          unreachableInARow >= MAX_CONSECUTIVE_UNREACHABLE_CHUNKS
            ? group.map(({ message }) => failedTicket(message.token, 'unavailable'))
            : await sendChunk(group.map(({ message }) => message));
        unreachableInARow = result.every((ticket) => ticket.status === 'error' && ticket.error === 'unavailable')
          ? unreachableInARow + 1
          : 0;
        group.forEach(({ index }, position) => {
          tickets[index] = result[position]!;
        });
      }
      return tickets;
    },

    async receipts(ticketIds) {
      const receipts: PushReceipt[] = [];
      for (const group of chunk([...new Set(ticketIds)], MAX_RECEIPT_BATCH)) {
        try {
          const parsed = receiptsResponseSchema.safeParse(await post(RECEIPTS_URL, { ids: group }));
          if (!parsed.success) {
            logger.warn('Expo push service answered something unusable for a receipts request.');
            continue;
          }
          for (const ticketId of group) {
            if (!Object.hasOwn(parsed.data.data, ticketId)) continue;
            const outcome = outcomeSchema.safeParse(parsed.data.data[ticketId]);
            if (!outcome.success) continue;
            if (outcome.data.status === 'ok') {
              receipts.push({ ticketId, status: 'ok' });
            } else {
              receipts.push({ ticketId, status: 'error', error: mapExpoError(outcome.data.details?.error) });
            }
          }
        } catch (error) {
          logger.warn(`Expo push receipts request failed (${reasonOf(error)}); ${group.length} receipt(s) not read.`);
        }
      }
      return receipts;
    },
  };
}

export const expoPushProvider: Provider = {
  provide: NOTIFICATION_PROVIDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService): NotificationProvider =>
    createExpoPushProvider({
      // Optional, and not in the required-env schema on purpose: Expo accepts unauthenticated sends unless enhanced
      // push security is switched on for the project, and dev and staging boot without it.
      accessToken: config.get<string>('EXPO_ACCESS_TOKEN') || undefined,
    }),
};
