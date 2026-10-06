import type { NotificationProvider, PushErrorCode, PushMessage } from '../integrations/push/notification-provider';

/**
 * The contract every `NotificationProvider` must keep (Phase 12F, ADR-060, CLAUDE.md rule 8). It is run against the fake
 * the rest of the API tests with and against the real Expo adapter (with a stubbed network), so the fake can never
 * promise something the real thing does not do. Each adapter spec supplies a harness that can make its service accept,
 * reject or drop requests; the assertions are the same for both.
 */
export interface ProviderHarness {
  provider: NotificationProvider;
  /** Makes the service refuse this token at send time with this reason. */
  rejectAtSend(token: string, error: PushErrorCode): void;
  /** Makes the service answer this ticket's receipt as ok, or as an error. */
  setReceipt(ticketId: string, outcome: 'ok' | PushErrorCode): void;
  /** Makes the next requests fail at the transport (the network is down or the service answers 5xx). */
  breakTransport(): void;
  /** How many requests reached the service. */
  requestCount(): number;
  /** Every token the service was asked to deliver to, across requests, in order. */
  deliveredTo(): string[];
}

const message = (token: string, over: Partial<PushMessage> = {}): PushMessage => ({
  token,
  title: 'New PR on Back Squat',
  body: 'Open FORJD to see it.',
  data: { type: 'pr', sessionId: 'abc' },
  ...over,
});

export function runNotificationProviderContract(name: string, makeHarness: () => ProviderHarness): void {
  describe(`${name} keeps the NotificationProvider contract`, () => {
    let harness: ProviderHarness;
    beforeEach(() => {
      harness = makeHarness();
    });

    it('answers one ticket per message, in order, each naming its token and carrying a ticket id', async () => {
      const tickets = await harness.provider.send([message('ExponentPushToken[a]'), message('ExponentPushToken[b]'), message('ExponentPushToken[c]')]);

      expect(tickets.map((ticket) => ticket.token)).toEqual(['ExponentPushToken[a]', 'ExponentPushToken[b]', 'ExponentPushToken[c]']);
      for (const ticket of tickets) {
        expect(ticket.status).toBe('ok');
        expect(ticket.status === 'ok' && ticket.ticketId.length > 0).toBe(true);
      }
      expect(harness.deliveredTo()).toEqual(['ExponentPushToken[a]', 'ExponentPushToken[b]', 'ExponentPushToken[c]']);
    });

    it('sends nothing, and asks the service nothing, for no messages', async () => {
      await expect(harness.provider.send([])).resolves.toEqual([]);
      await expect(harness.provider.receipts([])).resolves.toEqual([]);

      expect(harness.requestCount()).toBe(0);
    });

    it('reports a token the service refuses as an error on that ticket only, and keeps the others ok', async () => {
      harness.rejectAtSend('ExponentPushToken[dead]', 'device_not_registered');

      const tickets = await harness.provider.send([message('ExponentPushToken[a]'), message('ExponentPushToken[dead]'), message('ExponentPushToken[b]')]);

      expect(tickets.map((ticket) => ticket.status)).toEqual(['ok', 'error', 'ok']);
      expect(tickets[1]).toMatchObject({ token: 'ExponentPushToken[dead]', status: 'error', error: 'device_not_registered', retryable: false });
    });

    it('marks a rate-limit refusal retryable and a too-big message not', async () => {
      harness.rejectAtSend('ExponentPushToken[busy]', 'rate_limited');
      harness.rejectAtSend('ExponentPushToken[big]', 'message_too_big');

      const tickets = await harness.provider.send([message('ExponentPushToken[busy]'), message('ExponentPushToken[big]')]);

      expect(tickets[0]).toMatchObject({ status: 'error', error: 'rate_limited', retryable: true });
      expect(tickets[1]).toMatchObject({ status: 'error', error: 'message_too_big', retryable: false });
    });

    it('answers a ticket for each message even when the same token appears twice', async () => {
      const tickets = await harness.provider.send([message('ExponentPushToken[a]'), message('ExponentPushToken[a]')]);

      expect(tickets).toHaveLength(2);
      expect(tickets.every((ticket) => ticket.status === 'ok')).toBe(true);
    });

    it('delivers a large batch in full, in order', async () => {
      const tokens = Array.from({ length: 250 }, (_, index) => `ExponentPushToken[t${index}]`);

      const tickets = await harness.provider.send(tokens.map((token) => message(token)));

      expect(tickets.map((ticket) => ticket.token)).toEqual(tokens);
      expect(tickets.every((ticket) => ticket.status === 'ok')).toBe(true);
      expect(harness.deliveredTo()).toEqual(tokens);
    });

    it('never throws when the service cannot be reached: every ticket is a retryable error', async () => {
      harness.breakTransport();

      const tickets = await harness.provider.send([message('ExponentPushToken[a]'), message('ExponentPushToken[b]')]);

      expect(tickets).toHaveLength(2);
      for (const ticket of tickets) {
        expect(ticket).toMatchObject({ status: 'error', error: 'unavailable', retryable: true });
      }
    });

    it('answers the receipt of each ticket the service knows, and leaves out the ones it does not know yet', async () => {
      const [first, second] = await harness.provider.send([message('ExponentPushToken[a]'), message('ExponentPushToken[b]')]);
      const firstId = first!.status === 'ok' ? first!.ticketId : '';
      const secondId = second!.status === 'ok' ? second!.ticketId : '';
      harness.setReceipt(secondId, 'device_not_registered');

      const receipts = await harness.provider.receipts([firstId, secondId, 'ticket-not-known-yet']);

      expect(receipts).toEqual([
        { ticketId: firstId, status: 'ok' },
        { ticketId: secondId, status: 'error', error: 'device_not_registered' },
      ]);
    });

    it('answers no receipts, without throwing, when the service cannot be reached', async () => {
      const [ticket] = await harness.provider.send([message('ExponentPushToken[a]')]);
      harness.breakTransport();

      await expect(harness.provider.receipts([ticket!.status === 'ok' ? ticket!.ticketId : ''])).resolves.toEqual([]);
    });
  });
}
