import { accountExportPushTokenSchema } from "./account-export";
import { registerPushTokenRequestSchema, removePushTokenRequestSchema } from "./push-tokens";

// Phase 12F slice 1 (docs/product/phase-12f-plan.md). The phone registers its push token once it has permission and
// removes it before sign-out. The contract is provider-agnostic (ADR-060 keeps FCM direct as a fallback), so it
// checks the shape of a token, not the Expo format.
const EXPO_TOKEN = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";

describe("registerPushTokenRequestSchema", () => {
  it("accepts a token with its platform", () => {
    expect(registerPushTokenRequestSchema.parse({ token: EXPO_TOKEN, platform: "android" })).toEqual({
      token: EXPO_TOKEN,
      platform: "android",
    });
    expect(registerPushTokenRequestSchema.safeParse({ token: EXPO_TOKEN, platform: "ios" }).success).toBe(true);
  });

  it("refuses an empty token, one with whitespace or control characters, and one that is too long", () => {
    for (const token of ["", " ", "a b", "tab\there", "line\nbreak", "x".repeat(513)]) {
      expect(registerPushTokenRequestSchema.safeParse({ token, platform: "android" }).success).toBe(false);
    }
    expect(registerPushTokenRequestSchema.safeParse({ token: "x".repeat(512), platform: "android" }).success).toBe(true);
  });

  it("refuses a platform it does not know, and a missing one", () => {
    expect(registerPushTokenRequestSchema.safeParse({ token: EXPO_TOKEN, platform: "web" }).success).toBe(false);
    expect(registerPushTokenRequestSchema.safeParse({ token: EXPO_TOKEN }).success).toBe(false);
  });

  it("refuses an unknown key rather than silently dropping it", () => {
    expect(registerPushTokenRequestSchema.safeParse({ token: EXPO_TOKEN, platform: "ios", userId: "x" }).success).toBe(false);
  });
});

describe("removePushTokenRequestSchema", () => {
  it("takes only the token", () => {
    expect(removePushTokenRequestSchema.parse({ token: EXPO_TOKEN })).toEqual({ token: EXPO_TOKEN });
    expect(removePushTokenRequestSchema.safeParse({ token: EXPO_TOKEN, platform: "ios" }).success).toBe(false);
    expect(removePushTokenRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("accountExportPushTokenSchema", () => {
  it("describes one registered phone: the platform and when it was added and last seen, never the token value", () => {
    const row = {
      platform: "android",
      createdAt: "2026-10-06T12:00:00.000Z",
      lastSeenAt: "2026-10-07T08:00:00.000Z",
    };

    expect(accountExportPushTokenSchema.parse(row)).toEqual(row);
    expect(accountExportPushTokenSchema.safeParse({ ...row, lastSeenAt: "yesterday" }).success).toBe(false);
    // The schema is not strict, so a token value in the input is simply dropped from what it returns.
    expect(accountExportPushTokenSchema.parse({ ...row, token: EXPO_TOKEN })).toEqual(row);
  });
});
