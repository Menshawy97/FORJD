import { socialSignInRequestSchema, socialSignInResponseSchema } from "./auth";

const idToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature-signature";

describe("socialSignInRequestSchema (ADR-041)", () => {
  it("accepts a Google ID token with no nonce", () => {
    expect(socialSignInRequestSchema.safeParse({ provider: "google", idToken }).success).toBe(true);
  });

  it("accepts a Google ID token that carries a nonce", () => {
    expect(socialSignInRequestSchema.safeParse({ provider: "google", idToken, nonce: "raw-nonce-123" }).success).toBe(true);
  });

  it("requires a nonce for Apple, whose token is bound to one", () => {
    expect(socialSignInRequestSchema.safeParse({ provider: "apple", idToken }).success).toBe(false);
    expect(socialSignInRequestSchema.safeParse({ provider: "apple", idToken, nonce: "raw-nonce-123" }).success).toBe(true);
  });

  it("rejects a provider outside the closed set", () => {
    expect(socialSignInRequestSchema.safeParse({ provider: "facebook", idToken }).success).toBe(false);
  });

  it("rejects an empty, tiny or oversized token", () => {
    expect(socialSignInRequestSchema.safeParse({ provider: "google", idToken: "" }).success).toBe(false);
    expect(socialSignInRequestSchema.safeParse({ provider: "google", idToken: "short" }).success).toBe(false);
    expect(socialSignInRequestSchema.safeParse({ provider: "google", idToken: "x".repeat(9000) }).success).toBe(false);
  });

  it("rejects a missing token or provider", () => {
    expect(socialSignInRequestSchema.safeParse({ provider: "google" }).success).toBe(false);
    expect(socialSignInRequestSchema.safeParse({ idToken }).success).toBe(false);
  });
});

describe("socialSignInResponseSchema", () => {
  it("is the password-login session plus whether this is the account's first sign-in", () => {
    const parsed = socialSignInResponseSchema.safeParse({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: "2026-01-01T00:00:00.000Z",
      isNewUser: true,
    });

    expect(parsed.success).toBe(true);
  });

  it("requires isNewUser", () => {
    expect(
      socialSignInResponseSchema.safeParse({ accessToken: "a", refreshToken: "r", expiresAt: "2026-01-01T00:00:00.000Z" }).success,
    ).toBe(false);
  });
});
