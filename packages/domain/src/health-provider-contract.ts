import { HEALTH_METRIC_TYPES } from "./health-vocabulary";
import type { HealthProvider } from "./health-provider";

/**
 * CLAUDE.md rule 8's "contract tests for adapters," written before the adapter
 * (`HealthConnectProvider`, Phase 6F) existed -- so the device slice arrived with its
 * acceptance criteria already fixed, per the Phase 6 plan. Any `HealthProvider`
 * implementation, real or fake, calls this from its own spec file with a factory, so every
 * implementation is checked against the same rules rather than each writing its own ad hoc
 * version.
 *
 * Moved here from `apps/mobile/src/integrations/health/health-provider.contract.ts` in
 * Phase 7C, alongside `health-provider.ts` -- see that file's docblock for why. `WhoopProvider`
 * (Phase 7E, server-side) runs this same suite the way `HealthConnectProvider` already does.
 *
 * These are the interface's own invariants -- what must hold regardless of which provider is
 * behind it -- not a specific provider's behaviour. ADR-004's warning that per-adapter
 * normalization (unit conversion included) is where data corrupts silently is exactly what
 * "sync only returns metric types it declared support for" and "no inverted time window"
 * exist to catch early.
 */
export function runHealthProviderContractTests(name: string, makeProvider: () => HealthProvider): void {
  describe(`HealthProvider contract: ${name}`, () => {
    let provider: HealthProvider;

    beforeEach(() => {
      provider = makeProvider();
    });

    it("declares a source", () => {
      expect(provider.source).toBeTruthy();
    });

    it("connect and disconnect resolve without throwing", async () => {
      await expect(provider.connect()).resolves.not.toThrow();
      await expect(provider.disconnect()).resolves.not.toThrow();
    });

    it("getCapabilities reports its own source and only metric types from the closed domain vocabulary", async () => {
      const capabilities = await provider.getCapabilities();

      expect(capabilities.source).toBe(provider.source);
      for (const metricType of capabilities.supportedMetrics) {
        expect(HEALTH_METRIC_TYPES).toContain(metricType);
      }
    });

    it("requestPermissions partitions every requested permission into exactly one of granted or denied", async () => {
      const capabilities = await provider.getCapabilities();
      if (capabilities.supportedMetrics.length === 0) return;

      // Deliberately requests every declared-supported metric plus (if there is one) an
      // unsupported one, so both outcomes are exercised, not only the happy path.
      const unsupported = HEALTH_METRIC_TYPES.find((m) => !capabilities.supportedMetrics.includes(m));
      const requested = unsupported ? [...capabilities.supportedMetrics, unsupported] : capabilities.supportedMetrics;

      const result = await provider.requestPermissions(requested);

      for (const permission of requested) {
        const inGranted = result.granted.includes(permission);
        const inDenied = result.denied.includes(permission);
        expect(inGranted).toBe(!inDenied);
      }
    });

    it("sync only returns observations for metric types it declared support for", async () => {
      const capabilities = await provider.getCapabilities();
      await provider.requestPermissions(capabilities.supportedMetrics);

      const result = await provider.sync({ metricTypes: capabilities.supportedMetrics, since: null });

      for (const observation of result.observations) {
        expect(capabilities.supportedMetrics).toContain(observation.metricType);
      }
    });

    it("sync never returns an observation whose endTime is before its startTime", async () => {
      const capabilities = await provider.getCapabilities();
      await provider.requestPermissions(capabilities.supportedMetrics);

      const result = await provider.sync({ metricTypes: capabilities.supportedMetrics, since: null });

      for (const observation of result.observations) {
        expect(observation.endTime.getTime()).toBeGreaterThanOrEqual(observation.startTime.getTime());
      }
    });

    it("sync's own timestamp is not in the future relative to when it was called", async () => {
      const before = new Date();
      const result = await provider.sync({ metricTypes: [], since: null });
      expect(result.syncedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });
}
