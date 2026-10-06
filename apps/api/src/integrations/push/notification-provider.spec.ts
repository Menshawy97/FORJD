import { deadTokens, failedTicket, isRetryablePushError, type PushErrorCode, type PushTicket } from './notification-provider';

describe('isRetryablePushError', () => {
  it('treats only a busy or unreachable service as worth asking again', () => {
    expect(isRetryablePushError('rate_limited')).toBe(true);
    expect(isRetryablePushError('unavailable')).toBe(true);
    const never: PushErrorCode[] = ['device_not_registered', 'message_too_big', 'invalid_credentials', 'invalid_request'];
    for (const code of never) expect(isRetryablePushError(code)).toBe(false);
  });
});

describe('failedTicket', () => {
  it('names the token and the reason, and says whether to retry', () => {
    expect(failedTicket('t', 'unavailable')).toEqual({ token: 't', status: 'error', error: 'unavailable', retryable: true });
    expect(failedTicket('t', 'device_not_registered')).toEqual({
      token: 't',
      status: 'error',
      error: 'device_not_registered',
      retryable: false,
    });
  });
});

describe('deadTokens', () => {
  it('picks out only the tokens whose phone is gone, so the sender can delete them', () => {
    const tickets: PushTicket[] = [
      { token: 'alive', status: 'ok', ticketId: '1' },
      failedTicket('gone', 'device_not_registered'),
      failedTicket('busy', 'rate_limited'),
      failedTicket('big', 'message_too_big'),
      failedTicket('gone-too', 'device_not_registered'),
    ];

    expect(deadTokens(tickets)).toEqual(['gone', 'gone-too']);
    expect(deadTokens([])).toEqual([]);
  });
});
