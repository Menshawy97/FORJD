import {
  failedTicket,
  type NotificationProvider,
  type PushErrorCode,
  type PushMessage,
  type PushReceipt,
  type PushTicket,
} from './notification-provider';

/**
 * The provider the rest of the API is tested with (sender, drain, policy): it records what was sent, so a test can assert
 * on the exact payload (the ADR-061 checks do), and it can be told to refuse a token, answer a receipt, or go down. It
 * keeps the same contract as the real adapter (`notification-provider-contract.ts`).
 */
export class FakeNotificationProvider implements NotificationProvider {
  /** Every message the service accepted, in order. */
  readonly sent: PushMessage[] = [];
  /** How many calls reached the service (a call with nothing to do does not). */
  requestCount = 0;

  private readonly rejections = new Map<string, PushErrorCode>();
  private readonly receiptOutcomes = new Map<string, 'ok' | PushErrorCode>();
  private readonly issued = new Set<string>();
  private ticketCounter = 0;
  private broken = false;

  rejectAtSend(token: string, error: PushErrorCode): void {
    this.rejections.set(token, error);
  }

  setReceipt(ticketId: string, outcome: 'ok' | PushErrorCode): void {
    this.receiptOutcomes.set(ticketId, outcome);
  }

  breakTransport(): void {
    this.broken = true;
  }

  async send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    if (messages.length === 0) return [];
    this.requestCount += 1;
    if (this.broken) return messages.map((message) => failedTicket(message.token, 'unavailable'));
    return messages.map((message): PushTicket => {
      const rejection = this.rejections.get(message.token);
      if (rejection) return failedTicket(message.token, rejection);
      this.ticketCounter += 1;
      const ticketId = `fake-ticket-${this.ticketCounter}`;
      this.issued.add(ticketId);
      this.sent.push(message);
      return { token: message.token, status: 'ok', ticketId };
    });
  }

  async receipts(ticketIds: readonly string[]): Promise<PushReceipt[]> {
    if (ticketIds.length === 0) return [];
    this.requestCount += 1;
    if (this.broken) return [];
    return ticketIds.flatMap((ticketId): PushReceipt[] => {
      if (!this.issued.has(ticketId)) return [];
      const outcome = this.receiptOutcomes.get(ticketId) ?? 'ok';
      return [outcome === 'ok' ? { ticketId, status: 'ok' } : { ticketId, status: 'error', error: outcome }];
    });
  }
}
