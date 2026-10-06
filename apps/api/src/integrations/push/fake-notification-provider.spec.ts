import { runNotificationProviderContract } from '../../test-support/notification-provider-contract';
import { FakeNotificationProvider } from './fake-notification-provider';

// The fake the rest of the API is tested with (sender, drain, policy). It must keep the same contract as the real
// adapter, so a test that passes against the fake says something true about production.
runNotificationProviderContract('FakeNotificationProvider', () => {
  const fake = new FakeNotificationProvider();
  return {
    provider: fake,
    rejectAtSend: (token, error) => fake.rejectAtSend(token, error),
    setReceipt: (ticketId, outcome) => fake.setReceipt(ticketId, outcome),
    breakTransport: () => fake.breakTransport(),
    requestCount: () => fake.requestCount,
    deliveredTo: () => fake.sent.map((message) => message.token),
  };
});

describe('FakeNotificationProvider', () => {
  it('records every message it was asked to send, whole, so a test can inspect the payload', async () => {
    const fake = new FakeNotificationProvider();

    await fake.send([
      { token: 'token-a', title: 'New PR on Back Squat', body: 'Open FORJD to see it.', data: { type: 'pr', sessionId: 's1' } },
    ]);

    expect(fake.sent).toEqual([
      { token: 'token-a', title: 'New PR on Back Squat', body: 'Open FORJD to see it.', data: { type: 'pr', sessionId: 's1' } },
    ]);
  });

  it('does not record messages it could not deliver because the transport is down', async () => {
    const fake = new FakeNotificationProvider();
    fake.breakTransport();

    await fake.send([{ token: 'token-a', title: 't', body: 'b', data: {} }]);

    expect(fake.sent).toEqual([]);
  });
});
