/**
 * Every closed external-connection-vocabulary tuple must have a matching entry in its
 * *DisplayName map -- same enforcement pattern as `health-vocabulary.spec.ts` and
 * `body-vocabulary.spec.ts`. Written before the implementation (Phase 7B, RED first).
 */
import {
  EXTERNAL_CONNECTION_PROVIDERS,
  EXTERNAL_CONNECTION_PROVIDER_DISPLAY_NAMES,
  EXTERNAL_CONNECTION_STATUSES,
} from "./index";

describe("external connection vocabulary", () => {
  it("every EXTERNAL_CONNECTION_PROVIDERS member has a non-empty display name", () => {
    for (const provider of EXTERNAL_CONNECTION_PROVIDERS) {
      const name = EXTERNAL_CONNECTION_PROVIDER_DISPLAY_NAMES[provider];
      expect(typeof name).toBe("string");
      expect((name ?? "").length).toBeGreaterThan(0);
    }
  });

  it("EXTERNAL_CONNECTION_PROVIDER_DISPLAY_NAMES has no orphan keys", () => {
    const known = new Set<string>(EXTERNAL_CONNECTION_PROVIDERS);
    for (const key of Object.keys(EXTERNAL_CONNECTION_PROVIDER_DISPLAY_NAMES)) {
      expect(known.has(key)).toBe(true);
    }
  });

  it("includes whoop as a provider -- the only one Phase 7 actually implements", () => {
    expect(EXTERNAL_CONNECTION_PROVIDERS).toContain("whoop");
  });

  it("statuses cover the full OAuth connection lifecycle: pending, connected, expired, revoked, disconnected", () => {
    expect(EXTERNAL_CONNECTION_STATUSES).toEqual(["pending", "connected", "expired", "revoked", "disconnected"]);
  });
});
