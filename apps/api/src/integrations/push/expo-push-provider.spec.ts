import { Logger } from '@nestjs/common';

import { runNotificationProviderContract, type ProviderHarness } from '../../test-support/notification-provider-contract';
import type { PushErrorCode, PushMessage } from './notification-provider';
import { createExpoPushProvider } from './expo-push-provider';

// The real adapter, with the network stubbed to behave like Expo's push service (https://exp.host/--/api/v2/push/...,
// documented at docs.expo.dev/push-notifications/sending-notifications). The contract suite proves it keeps the same
// promises as the fake; the tests below pin what is specific to Expo: the request shape, chunking, retry and errors.
const EXPO_CODE: Record<PushErrorCode, string> = {
  device_not_registered: 'DeviceNotRegistered',
  message_too_big: 'MessageTooBig',
  rate_limited: 'MessageRateExceeded',
  invalid_credentials: 'InvalidCredentials',
  invalid_request: 'InvalidRequest',
  unavailable: 'Unavailable',
};

interface Recorded {
  url: string;
  init: RequestInit;
  body: unknown;
}

/** A stand-in for Expo's service. Tickets are numbered; receipts exist only for tickets it issued. */
function makeService(initial: { transportBroken?: boolean } = {}) {
  const rejections = new Map<string, PushErrorCode>();
  const receipts = new Map<string, 'ok' | PushErrorCode>();
  const issued = new Set<string>();
  const requests: Recorded[] = [];
  let ticketCounter = 0;
  let broken = initial.transportBroken ?? false;
  let override: ((body: unknown) => Response) | null = null;

  const fetchImpl = jest.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (broken) throw new TypeError('fetch failed');
    const body = JSON.parse(String(init?.body ?? 'null'));
    if (override) return override(body);
    requests.push({ url: String(url), init: init ?? {}, body });
    if (String(url).endsWith('/push/send')) {
      const data = (body as Array<{ to: string }>).map((message) => {
        const rejection = rejections.get(message.to);
        if (rejection) return { status: 'error', message: 'refused', details: { error: EXPO_CODE[rejection] } };
        const id = `ticket-${(ticketCounter += 1)}`;
        issued.add(id);
        return { status: 'ok', id };
      });
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    const ids = (body as { ids: string[] }).ids;
    const data: Record<string, unknown> = {};
    for (const id of ids) {
      if (!issued.has(id)) continue;
      const outcome = receipts.get(id) ?? 'ok';
      data[id] = outcome === 'ok' ? { status: 'ok' } : { status: 'error', message: 'x', details: { error: EXPO_CODE[outcome] } };
    }
    return new Response(JSON.stringify({ data }), { status: 200 });
  });

  return {
    fetchImpl,
    requests,
    rejections,
    receipts,
    break: () => {
      broken = true;
    },
    respondWith: (make: ((body: unknown) => Response) | null) => {
      override = make;
    },
  };
}

runNotificationProviderContract('ExpoPushProvider', () => {
  const service = makeService();
  const provider = createExpoPushProvider({ fetchImpl: service.fetchImpl as unknown as typeof fetch });
  const harness: ProviderHarness = {
    provider,
    rejectAtSend: (token, error) => service.rejections.set(token, error),
    setReceipt: (ticketId, outcome) => service.receipts.set(ticketId, outcome),
    breakTransport: () => service.break(),
    requestCount: () => service.requests.length,
    deliveredTo: () =>
      service.requests
        .filter((request) => request.url.endsWith('/push/send'))
        .flatMap((request) => (request.body as Array<{ to: string }>).map((message) => message.to)),
  };
  return harness;
});

describe('ExpoPushProvider', () => {
  const message: PushMessage = {
    token: 'ExponentPushToken[abc]',
    title: 'New PR on Back Squat',
    body: 'Open FORJD to see it.',
    data: { type: 'pr', sessionId: 's1' },
    channelId: 'updates',
    priority: 'high',
    ttlSeconds: 3600,
  };

  afterEach(() => jest.restoreAllMocks());

  it('posts to the send endpoint with the fields Expo expects, and nothing the caller did not give', async () => {
    const service = makeService();
    const provider = createExpoPushProvider({ fetchImpl: service.fetchImpl as unknown as typeof fetch });

    await provider.send([message, { token: 'ExponentPushToken[def]', title: 't', body: 'b', data: {} }]);

    const [request] = service.requests;
    expect(request!.url).toBe('https://exp.host/--/api/v2/push/send');
    expect(request!.init.method).toBe('POST');
    expect(request!.init.redirect).toBe('error');
    expect(request!.body).toEqual([
      {
        to: 'ExponentPushToken[abc]',
        title: 'New PR on Back Squat',
        body: 'Open FORJD to see it.',
        data: { type: 'pr', sessionId: 's1' },
        channelId: 'updates',
        priority: 'high',
        ttl: 3600,
      },
      { to: 'ExponentPushToken[def]', title: 't', body: 'b', data: {} },
    ]);
  });

  it('sends the optional access token as a bearer header only when one is configured', async () => {
    const withToken = makeService();
    const without = makeService();

    await createExpoPushProvider({ accessToken: 'secret-access', fetchImpl: withToken.fetchImpl as unknown as typeof fetch }).send([message]);
    await createExpoPushProvider({ fetchImpl: without.fetchImpl as unknown as typeof fetch }).send([message]);

    expect((withToken.requests[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer secret-access');
    expect((without.requests[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect((without.requests[0]!.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('splits a large send into requests of at most 100 messages, as Expo requires', async () => {
    const service = makeService();
    const provider = createExpoPushProvider({ fetchImpl: service.fetchImpl as unknown as typeof fetch });

    await provider.send(Array.from({ length: 230 }, (_, index) => ({ ...message, token: `ExponentPushToken[t-${index}]` })));

    const sizes = service.requests.map((request) => (request.body as unknown[]).length);
    expect(sizes).toEqual([100, 100, 30]);
  });

  it('asks for receipts in requests of at most 1000 ids', async () => {
    const service = makeService();
    const provider = createExpoPushProvider({ fetchImpl: service.fetchImpl as unknown as typeof fetch });

    await provider.receipts(Array.from({ length: 1500 }, (_, index) => `id-${index}`));

    expect(service.requests.map((request) => request.url)).toEqual([
      'https://exp.host/--/api/v2/push/getReceipts',
      'https://exp.host/--/api/v2/push/getReceipts',
    ]);
    expect(service.requests.map((request) => (request.body as { ids: string[] }).ids.length)).toEqual([1000, 500]);
  });

  it('tries again once when the service answers 5xx, and uses the second answer', async () => {
    const service = makeService();
    let calls = 0;
    service.respondWith(() => {
      calls += 1;
      return calls === 1
        ? new Response('bad gateway', { status: 502 })
        : new Response(JSON.stringify({ data: [{ status: 'ok', id: 'ticket-9' }] }), { status: 200 });
    });
    const provider = createExpoPushProvider({ fetchImpl: service.fetchImpl as unknown as typeof fetch });

    const [ticket] = await provider.send([message]);

    expect(calls).toBe(2);
    expect(ticket).toMatchObject({ status: 'ok', ticketId: 'ticket-9' });
  });

  it('answers a retryable unavailable error after two failed attempts, not three', async () => {
    const service = makeService();
    let calls = 0;
    service.respondWith(() => {
      calls += 1;
      return new Response('down', { status: 503 });
    });
    const provider = createExpoPushProvider({ fetchImpl: service.fetchImpl as unknown as typeof fetch });

    const [ticket] = await provider.send([message]);

    expect(calls).toBe(2);
    expect(ticket).toMatchObject({ status: 'error', error: 'unavailable', retryable: true });
  });

  it('does not retry a 4xx, and says why: bad credentials, or a bad request', async () => {
    for (const [status, error] of [
      [401, 'invalid_credentials'],
      [403, 'invalid_credentials'],
      [400, 'invalid_request'],
    ] as const) {
      const service = makeService();
      let calls = 0;
      service.respondWith(() => {
        calls += 1;
        return new Response('no', { status });
      });
      const provider = createExpoPushProvider({ fetchImpl: service.fetchImpl as unknown as typeof fetch });

      const [ticket] = await provider.send([message]);

      expect(calls).toBe(1);
      expect(ticket).toMatchObject({ status: 'error', error, retryable: false });
    }
  });

  it('answers a retryable rate_limited error for HTTP 429 without hammering the service', async () => {
    const service = makeService();
    let calls = 0;
    service.respondWith(() => {
      calls += 1;
      return new Response('slow down', { status: 429 });
    });
    const provider = createExpoPushProvider({ fetchImpl: service.fetchImpl as unknown as typeof fetch });

    const [ticket] = await provider.send([message]);

    expect(calls).toBe(1);
    expect(ticket).toMatchObject({ status: 'error', error: 'rate_limited', retryable: true });
  });

  it('treats a reply that is not the documented shape as unavailable, never as success', async () => {
    for (const body of ['not json', JSON.stringify({ data: 'nope' }), JSON.stringify({ data: [] }), JSON.stringify({})]) {
      const service = makeService();
      service.respondWith(() => new Response(body, { status: 200 }));
      const provider = createExpoPushProvider({ fetchImpl: service.fetchImpl as unknown as typeof fetch });

      const tickets = await provider.send([message, { ...message, token: 'ExponentPushToken[other]' }]);

      expect(tickets).toHaveLength(2);
      expect(tickets.every((ticket) => ticket.status === 'error' && ticket.error === 'unavailable' && ticket.retryable)).toBe(true);
    }
  });

  it('maps an error code it does not know to a non-retryable invalid_request rather than guessing', async () => {
    const service = makeService();
    service.respondWith(
      () => new Response(JSON.stringify({ data: [{ status: 'error', message: 'odd', details: { error: 'SomethingNew' } }] }), { status: 200 }),
    );
    const provider = createExpoPushProvider({ fetchImpl: service.fetchImpl as unknown as typeof fetch });

    const [ticket] = await provider.send([message]);

    expect(ticket).toMatchObject({ status: 'error', error: 'invalid_request', retryable: false });
  });

  it('answers a ticket for a token that is not shaped like an Expo token without sending it, and still sends the rest in order', async () => {
    const service = makeService();
    const provider = createExpoPushProvider({ fetchImpl: service.fetchImpl as unknown as typeof fetch });
    const good = (name: string) => ({ ...message, token: `ExponentPushToken[${name}]` });

    const tickets = await provider.send([good('a'), { ...message, token: 'not-a-token' }, { ...message, token: 'has space' }, good('b')]);

    expect(tickets.map((ticket) => ticket.token)).toEqual(['ExponentPushToken[a]', 'not-a-token', 'has space', 'ExponentPushToken[b]']);
    expect(tickets.map((ticket) => ticket.status)).toEqual(['ok', 'error', 'error', 'ok']);
    expect(tickets[1]).toMatchObject({ error: 'invalid_request', retryable: false });
    expect(service.requests).toHaveLength(1);
    expect((service.requests[0]!.body as Array<{ to: string }>).map((sent) => sent.to)).toEqual([
      'ExponentPushToken[a]',
      'ExponentPushToken[b]',
    ]);
  });

  it('keeps order and count when one chunk in the middle cannot be sent', async () => {
    const service = makeService();
    let calls = 0;
    service.respondWith((body) => {
      calls += 1;
      // Calls 2 and 3 are the two attempts at the second chunk.
      if (calls === 2 || calls === 3) return new Response('down', { status: 503 });
      const data = (body as unknown[]).map((_, index) => ({ status: 'ok', id: `c${calls}-${index}` }));
      return new Response(JSON.stringify({ data }), { status: 200 });
    });
    const provider = createExpoPushProvider({ fetchImpl: service.fetchImpl as unknown as typeof fetch });
    const names = Array.from({ length: 230 }, (_, index) => `ExponentPushToken[t${index}]`);

    const tickets = await provider.send(names.map((token) => ({ ...message, token })));

    expect(tickets.map((ticket) => ticket.token)).toEqual(names);
    expect(tickets.slice(0, 100).every((ticket) => ticket.status === 'ok')).toBe(true);
    expect(tickets.slice(100, 200).every((ticket) => ticket.status === 'error' && ticket.error === 'unavailable')).toBe(true);
    expect(tickets.slice(200).every((ticket) => ticket.status === 'ok')).toBe(true);
  });

  it('does not send again after a timeout, because the first attempt may have been accepted', async () => {
    let calls = 0;
    const fetchImpl = jest.fn(async () => {
      calls += 1;
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    });
    const provider = createExpoPushProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const [ticket] = await provider.send([message]);

    expect(calls).toBe(1);
    expect(ticket).toMatchObject({ status: 'error', error: 'unavailable', retryable: true });
  });

  it('stops trying the rest of a big batch after three chunks in a row that could not be sent', async () => {
    const service = makeService();
    let calls = 0;
    service.respondWith(() => {
      calls += 1;
      return new Response('down', { status: 503 });
    });
    const provider = createExpoPushProvider({ fetchImpl: service.fetchImpl as unknown as typeof fetch });
    const names = Array.from({ length: 500 }, (_, index) => `ExponentPushToken[t${index}]`);

    const tickets = await provider.send(names.map((token) => ({ ...message, token })));

    // Three chunks, two attempts each; the other two chunks are not tried.
    expect(calls).toBe(6);
    expect(tickets).toHaveLength(500);
    expect(tickets.every((ticket) => ticket.status === 'error' && ticket.error === 'unavailable')).toBe(true);
  });

  it('reads receipts entry by entry: a malformed entry is skipped and the others still count', async () => {
    const service = makeService();
    service.respondWith(
      () =>
        new Response(
          JSON.stringify({
            data: {
              a: { status: 'ok' },
              b: 'junk',
              c: { status: 'error', details: { error: 'DeviceNotRegistered' } },
              d: { status: 'error', details: { error: 'constructor' } },
            },
          }),
          { status: 200 },
        ),
    );
    const provider = createExpoPushProvider({ fetchImpl: service.fetchImpl as unknown as typeof fetch });

    const receipts = await provider.receipts(['a', 'b', 'c', 'd', 'toString']);

    expect(receipts).toEqual([
      { ticketId: 'a', status: 'ok' },
      { ticketId: 'c', status: 'error', error: 'device_not_registered' },
      { ticketId: 'd', status: 'error', error: 'invalid_request' },
    ]);
  });

  it('asks for each receipt id once, and answers nothing for a reply it cannot use or a failed request', async () => {
    const service = makeService();
    const provider = createExpoPushProvider({ fetchImpl: service.fetchImpl as unknown as typeof fetch });
    const [ticket] = await provider.send([message]);
    const id = ticket!.status === 'ok' ? ticket!.ticketId : '';

    expect(await provider.receipts([id, id, id])).toEqual([{ ticketId: id, status: 'ok' }]);
    expect((service.requests[1]!.body as { ids: string[] }).ids).toEqual([id]);

    for (const respond of [
      () => new Response('not json', { status: 200 }),
      () => new Response(JSON.stringify({ data: 'nope' }), { status: 200 }),
      () => new Response('x', { status: 500 }),
      () => new Response('x', { status: 400 }),
    ]) {
      service.respondWith(respond);
      await expect(provider.receipts([id])).resolves.toEqual([]);
    }
  });

  it('loses only the chunk that failed when receipts are asked for in several requests', async () => {
    const service = makeService();
    let calls = 0;
    service.respondWith((body) => {
      calls += 1;
      if (calls <= 2) return new Response('down', { status: 503 });
      const ids = (body as { ids: string[] }).ids;
      return new Response(JSON.stringify({ data: Object.fromEntries(ids.map((id) => [id, { status: 'ok' }])) }), { status: 200 });
    });
    const provider = createExpoPushProvider({ fetchImpl: service.fetchImpl as unknown as typeof fetch });

    const receipts = await provider.receipts(Array.from({ length: 1500 }, (_, index) => `id-${index}`));

    expect(receipts).toHaveLength(500);
    expect(receipts[0]).toEqual({ ticketId: 'id-1000', status: 'ok' });
  });

  it('maps a send error named like an inherited property to an unknown error, not a function', async () => {
    const service = makeService();
    service.respondWith(
      () => new Response(JSON.stringify({ data: [{ status: 'error', details: { error: 'toString' } }] }), { status: 200 }),
    );
    const provider = createExpoPushProvider({ fetchImpl: service.fetchImpl as unknown as typeof fetch });

    const [ticket] = await provider.send([message]);

    expect(ticket).toMatchObject({ status: 'error', error: 'invalid_request' });
  });

  it('never writes a push token or the access token to the log', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = makeService();
    service.respondWith(() => new Response('down', { status: 503 }));
    const provider = createExpoPushProvider({
      accessToken: 'secret-access',
      fetchImpl: service.fetchImpl as unknown as typeof fetch,
    });

    await provider.send([message]);
    await provider.receipts(['ticket-1']);

    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(warn).toHaveBeenCalled();
    expect(logged).not.toContain('ExponentPushToken');
    expect(logged).not.toContain('secret-access');
  });
});
