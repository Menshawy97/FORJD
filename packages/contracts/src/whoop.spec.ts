import { whoopAuthorizeResponseSchema, whoopStatusResponseSchema } from './index';

describe("whoopStatusResponseSchema", () => {
  it("accepts a connected account with a sync timestamp", () => {
    expect(
      whoopStatusResponseSchema.safeParse({ connected: true, lastSyncAt: '2026-09-08T06:15:00.000Z' }).success,
    ).toBe(true);
  });

  it("accepts a connected account with no sync yet (lastSyncAt: null)", () => {
    expect(whoopStatusResponseSchema.safeParse({ connected: true, lastSyncAt: null }).success).toBe(true);
  });

  it("accepts a disconnected account", () => {
    expect(whoopStatusResponseSchema.safeParse({ connected: false, lastSyncAt: null }).success).toBe(true);
  });

  it("rejects a missing connected field", () => {
    expect(whoopStatusResponseSchema.safeParse({ lastSyncAt: null }).success).toBe(false);
  });
});

describe("whoopAuthorizeResponseSchema", () => {
  it("accepts a well-formed authorize URL", () => {
    expect(
      whoopAuthorizeResponseSchema.safeParse({ authorizeUrl: 'https://api.prod.whoop.com/oauth/oauth2/auth' })
        .success,
    ).toBe(true);
  });

  it("rejects a non-URL string", () => {
    expect(whoopAuthorizeResponseSchema.safeParse({ authorizeUrl: 'not a url' }).success).toBe(false);
  });
});
