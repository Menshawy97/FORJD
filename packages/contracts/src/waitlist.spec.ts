import { waitlistSignupRequestSchema, waitlistSignupResponseSchema } from "./waitlist";

const token = "0.abcDEF123_token-value";

describe("waitlistSignupRequestSchema (ADR-051)", () => {
  it("accepts an email address and a Turnstile token", () => {
    expect(waitlistSignupRequestSchema.safeParse({ email: "a@example.com", turnstileToken: token }).success).toBe(true);
  });

  it("trims and lower-cases the address, so one person cannot sign up twice by casing", () => {
    const parsed = waitlistSignupRequestSchema.parse({ email: "  Jane.Doe@Example.COM ", turnstileToken: token });
    expect(parsed.email).toBe("jane.doe@example.com");
  });

  it("rejects a missing or malformed address", () => {
    expect(waitlistSignupRequestSchema.safeParse({ turnstileToken: token }).success).toBe(false);
    expect(waitlistSignupRequestSchema.safeParse({ email: "not-an-email", turnstileToken: token }).success).toBe(false);
    expect(waitlistSignupRequestSchema.safeParse({ email: "   ", turnstileToken: token }).success).toBe(false);
  });

  it("rejects an address longer than 254 characters, the SMTP limit", () => {
    const tooLong = `${"a".repeat(250)}@x.co`;
    expect(waitlistSignupRequestSchema.safeParse({ email: tooLong, turnstileToken: token }).success).toBe(false);
  });

  it("rejects a missing, empty or oversized token", () => {
    expect(waitlistSignupRequestSchema.safeParse({ email: "a@example.com" }).success).toBe(false);
    expect(waitlistSignupRequestSchema.safeParse({ email: "a@example.com", turnstileToken: "" }).success).toBe(false);
    // Cloudflare documents a 2048-character ceiling on a Turnstile response.
    expect(waitlistSignupRequestSchema.safeParse({ email: "a@example.com", turnstileToken: "x".repeat(2049) }).success).toBe(false);
    expect(waitlistSignupRequestSchema.safeParse({ email: "a@example.com", turnstileToken: "x".repeat(2048) }).success).toBe(true);
  });

  it("rejects a token that is not a string", () => {
    expect(waitlistSignupRequestSchema.safeParse({ email: "a@example.com", turnstileToken: 123 }).success).toBe(false);
  });
});

describe("waitlistSignupResponseSchema", () => {
  it("accepts the accepted status", () => {
    expect(waitlistSignupResponseSchema.safeParse({ status: "accepted" }).success).toBe(true);
  });

  it("rejects any other status, so a duplicate can never be told apart from a new sign-up", () => {
    expect(waitlistSignupResponseSchema.safeParse({ status: "duplicate" }).success).toBe(false);
    expect(waitlistSignupResponseSchema.safeParse({}).success).toBe(false);
  });
});
