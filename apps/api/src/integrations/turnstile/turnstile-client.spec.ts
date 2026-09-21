import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import failureFixture from "./__fixtures__/siteverify-failure.json";
import successFixture from "./__fixtures__/siteverify-success.json";
import { createTurnstileClient, turnstileClientProvider } from "./turnstile-client";

/**
 * `createTurnstileClient` is the one place this repo talks to Cloudflare's `siteverify`
 * endpoint (ADR-051). The recorded responses in `__fixtures__` are the contract: the adapter
 * must read `success` from exactly this shape. `fetchImpl` is injected so these tests never
 * touch the network (ADR-011), and every path that cannot positively confirm a human returns
 * `false` -- the endpoint is public, so failing open would switch the spam protection off.
 */
describe("turnstile-client", () => {
  const secretKey = "test-secret-key";
  const token = "0.token-from-the-widget";

  const jsonResponse = (body: unknown, ok = true, status = 200) =>
    ({ ok, status, json: () => Promise.resolve(body) }) as Response;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns true when Cloudflare confirms the token", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(successFixture));
    const client = createTurnstileClient({ secretKey, fetchImpl });

    await expect(client.verify(token, "203.0.113.7")).resolves.toBe(true);
  });

  it("POSTs the secret, the token and the caller address to siteverify as a form", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(successFixture));
    const client = createTurnstileClient({ secretKey, fetchImpl });

    await client.verify(token, "203.0.113.7");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
    const body = new URLSearchParams(init.body as string);
    expect(body.get("secret")).toBe(secretKey);
    expect(body.get("response")).toBe(token);
    expect(body.get("remoteip")).toBe("203.0.113.7");
  });

  it("leaves remoteip out when the caller address is unknown", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(successFixture));
    const client = createTurnstileClient({ secretKey, fetchImpl });

    await client.verify(token);

    const body = new URLSearchParams(fetchImpl.mock.calls[0][1].body as string);
    expect(body.has("remoteip")).toBe(false);
  });

  it("returns false when Cloudflare rejects the token", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(failureFixture));
    const client = createTurnstileClient({ secretKey, fetchImpl });

    await expect(client.verify(token)).resolves.toBe(false);
  });

  it("only accepts an explicit success: true, not any truthy value", async () => {
    // A malformed or hostile response must not be read as a pass.
    for (const body of [{ success: "true" }, { success: 1 }, {}, null, "ok"]) {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(body));
      const client = createTurnstileClient({ secretKey, fetchImpl });
      await expect(client.verify(token)).resolves.toBe(false);
    }
  });

  it("returns false without calling Cloudflare when no secret is configured", async () => {
    const fetchImpl = jest.fn();
    const client = createTurnstileClient({ secretKey: "", fetchImpl });

    await expect(client.verify(token)).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("warns about a missing secret once, not on every request", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const client = createTurnstileClient({ secretKey: "", fetchImpl: jest.fn() });

    await client.verify(token);
    await client.verify(token);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("returns false without calling Cloudflare for an empty token", async () => {
    const fetchImpl = jest.fn();
    const client = createTurnstileClient({ secretKey, fetchImpl });

    await expect(client.verify("")).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends no request for a whitespace-only token", async () => {
    const fetchImpl = jest.fn();
    const client = createTurnstileClient({ secretKey, fetchImpl });

    await expect(client.verify("   ")).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses to follow a redirect, so the secret is never re-sent elsewhere", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(successFixture));
    const client = createTurnstileClient({ secretKey, fetchImpl });

    await client.verify(token);

    expect(fetchImpl.mock.calls[0][1].redirect).toBe("error");
  });

  it("keeps the worst case short: two attempts of five seconds, not thirty", async () => {
    // Anonymous callers can each hold a request open, so the ceiling matters.
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      const client = createTurnstileClient({ secretKey, fetchImpl: fetchImpl as unknown as typeof fetch });

      const result = client.verify(token);
      await jest.advanceTimersByTimeAsync(10_000);

      await expect(result).resolves.toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("retries a 5xx once, then fails closed", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}, false, 503));
    const client = createTurnstileClient({ secretKey, fetchImpl });

    await expect(client.verify(token)).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("recovers when a retry succeeds", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, false, 502))
      .mockResolvedValueOnce(jsonResponse(successFixture));
    const client = createTurnstileClient({ secretKey, fetchImpl });

    await expect(client.verify(token)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a network error once, then fails closed", async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error("socket hang up"));
    const client = createTurnstileClient({ secretKey, fetchImpl });

    await expect(client.verify(token)).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails closed even when fetch rejects with something that is not an Error", async () => {
    const fetchImpl = jest.fn().mockRejectedValue("connection reset");
    const client = createTurnstileClient({ secretKey, fetchImpl });

    await expect(client.verify(token)).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx, which is a real rejection rather than a blip", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}, false, 400));
    const client = createTurnstileClient({ secretKey, fetchImpl });

    await expect(client.verify(token)).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts a request that hangs, so a stalled Cloudflare cannot stall sign-ups", async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      const client = createTurnstileClient({ secretKey, fetchImpl: fetchImpl as unknown as typeof fetch });

      const result = client.verify(token);
      await jest.advanceTimersByTimeAsync(20_000);

      await expect(result).resolves.toBe(false);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("never puts the secret or the token in a log line", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(failureFixture));
    const client = createTurnstileClient({ secretKey, fetchImpl });

    await client.verify(token);

    const logged = warn.mock.calls.map((c) => String(c[0])).join(" ");
    expect(logged).not.toContain(secretKey);
    expect(logged).not.toContain(token);
    expect(logged).toContain("invalid-input-response");
  });

  describe("turnstileClientProvider", () => {
    it("reads TURNSTILE_SECRET_KEY from config, defaulting to empty so the app still boots", () => {
      const config = { get: jest.fn((_key: string, fallback: string) => fallback) } as unknown as ConfigService;

      const client = (turnstileClientProvider as { useFactory: (c: ConfigService) => { verify: unknown } }).useFactory(
        config,
      );

      expect(config.get).toHaveBeenCalledWith("TURNSTILE_SECRET_KEY", "");
      expect(typeof client.verify).toBe("function");
    });
  });
});
