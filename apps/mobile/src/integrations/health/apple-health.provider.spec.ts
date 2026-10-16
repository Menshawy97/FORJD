import { runHealthProviderContractTests } from "@forjd/domain";

import { AppleHealthProvider } from "./apple-health.provider";
import { SLEEP_ANALYSIS, SleepValue } from "./apple-health-sample-mapping";

/**
 * ADR-068 / ADR-069. `@kingstinct/react-native-healthkit` is a native module (HealthKit through
 * Nitro); there is no HealthKit under Jest and CI never calls a live vendor SDK. Its surface is
 * mocked at the boundary, the way `health-connect.provider.spec.ts` mocks Health Connect, and the
 * same shared contract suite runs at the bottom. Merged switched off; behaviour on a real iPhone is
 * owed (rule 16).
 */
jest.mock("@kingstinct/react-native-healthkit", () => ({
  isHealthDataAvailable: jest.fn(),
  requestAuthorization: jest.fn(),
  queryQuantitySamples: jest.fn(),
  queryCategorySamples: jest.fn(),
}));

import {
  isHealthDataAvailable,
  queryCategorySamples,
  queryQuantitySamples,
  requestAuthorization,
} from "@kingstinct/react-native-healthkit";

const mockAvailable = isHealthDataAvailable as jest.Mock;
const mockRequestAuthorization = requestAuthorization as jest.Mock;
const mockQueryQuantity = queryQuantitySamples as jest.Mock;
const mockQueryCategory = queryCategorySamples as jest.Mock;

const at = new Date("2026-10-16T06:00:00.000Z");
const source = { source: { name: "Apple Watch", bundleIdentifier: "com.apple.health.ABC" }, operatingSystemVersion: "26.0" };

function heartRateSample(bpm: number) {
  return { uuid: `hr-${bpm}`, quantity: bpm, unit: "count/min", startDate: at, endDate: at, sourceRevision: source };
}

async function readyProvider(metrics: Parameters<AppleHealthProvider["requestPermissions"]>[0]) {
  const provider = new AppleHealthProvider();
  await provider.requestPermissions(metrics);
  return provider;
}

describe("AppleHealthProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAvailable.mockReturnValue(true);
    mockRequestAuthorization.mockResolvedValue(true);
    mockQueryQuantity.mockResolvedValue([]);
    mockQueryCategory.mockResolvedValue([]);
  });

  it("is the apple_health source, recorded explicitly (rule 17)", () => {
    expect(new AppleHealthProvider().source).toBe("apple_health");
  });

  describe("connect", () => {
    it("resolves when this device has Health data", async () => {
      await expect(new AppleHealthProvider().connect()).resolves.toBeUndefined();
    });

    it("refuses on a device without Health data (an iPad, say)", async () => {
      mockAvailable.mockReturnValue(false);

      await expect(new AppleHealthProvider().connect()).rejects.toThrow(/not available/);
    });
  });

  describe("requestPermissions", () => {
    it("asks to read only, never to write, each HealthKit type once", async () => {
      await new AppleHealthProvider().requestPermissions(["heart_rate", "active_energy", "sleep_duration", "sleep_rem_duration"]);

      expect(mockRequestAuthorization).toHaveBeenCalledWith({
        toRead: ["HKQuantityTypeIdentifierHeartRate", "HKQuantityTypeIdentifierActiveEnergyBurned", SLEEP_ANALYSIS],
      });
    });

    it("reports every requested metric as granted once the sheet was shown: HealthKit hides read refusals", async () => {
      const result = await new AppleHealthProvider().requestPermissions(["heart_rate", "active_energy"]);

      expect(result).toEqual({ granted: ["heart_rate", "active_energy"], denied: [] });
    });

    it("reports everything as denied when the request itself fails", async () => {
      mockRequestAuthorization.mockRejectedValue(new Error("Missing NSHealthShareUsageDescription"));

      const result = await new AppleHealthProvider().requestPermissions(["heart_rate"]);

      expect(result).toEqual({ granted: [], denied: ["heart_rate"] });
    });
  });

  describe("sync", () => {
    it("never reads a type it has not asked for, which would crash the app (ADR-068, check 4)", async () => {
      const provider = await readyProvider(["heart_rate"]);

      const result = await provider.sync({ metricTypes: ["heart_rate", "hrv"], since: null });

      expect(mockQueryQuantity).toHaveBeenCalledTimes(1);
      expect(mockQueryQuantity.mock.calls[0]?.[0]).toBe("HKQuantityTypeIdentifierHeartRate");
      expect(result.failedMetricTypes).toEqual(["hrv"]);
    });

    it("reads nothing at all before any permission request", async () => {
      const result = await new AppleHealthProvider().sync({ metricTypes: ["heart_rate"], since: null });

      expect(mockQueryQuantity).not.toHaveBeenCalled();
      expect(result.observations).toEqual([]);
      expect(result.failedMetricTypes).toEqual(["heart_rate"]);
    });

    it("reads in the canonical unit, every sample since the checkpoint, oldest first", async () => {
      const since = new Date("2026-10-15T00:00:00.000Z");
      const provider = await readyProvider(["heart_rate"]);

      await provider.sync({ metricTypes: ["heart_rate"], since });

      const [, options] = mockQueryQuantity.mock.calls[0] as [string, { limit: number; unit: string; ascending: boolean; filter: { date: { startDate?: Date; endDate: Date } } }];
      expect(options.unit).toBe("count/min");
      expect(options.limit).toBe(0);
      expect(options.ascending).toBe(true);
      expect(options.filter.date.startDate).toEqual(since);
      expect(options.filter.date.endDate).toBeInstanceOf(Date);
    });

    it("has no lower bound on a full sync", async () => {
      const provider = await readyProvider(["heart_rate"]);

      await provider.sync({ metricTypes: ["heart_rate"], since: null });

      const [, options] = mockQueryQuantity.mock.calls[0] as [string, { filter: { date: { startDate?: Date } } }];
      expect(options.filter.date.startDate).toBeUndefined();
    });

    it("returns mapped readings for what was asked", async () => {
      mockQueryQuantity.mockResolvedValue([heartRateSample(141), heartRateSample(152)]);
      const provider = await readyProvider(["heart_rate"]);

      const result = await provider.sync({ metricTypes: ["heart_rate"], since: null });

      expect(result.observations.map((o) => o.value)).toEqual([141, 152]);
      expect(result.observations.every((o) => o.metricType === "heart_rate" && o.dataOrigin === "com.apple.health.ABC")).toBe(true);
      expect(result.failedMetricTypes).toBeUndefined();
    });

    it("reads sleep once and returns only the sleep metrics asked for", async () => {
      mockQueryCategory.mockResolvedValue([
        { uuid: "s1", value: SleepValue.asleepDeep, startDate: at, endDate: new Date(at.getTime() + 600_000), sourceRevision: source },
      ]);
      const provider = await readyProvider(["sleep_deep_duration"]);

      const result = await provider.sync({ metricTypes: ["sleep_deep_duration"], since: null });

      expect(mockQueryCategory).toHaveBeenCalledTimes(1);
      expect(result.observations.map((o) => [o.metricType, o.value])).toEqual([["sleep_deep_duration", 10]]);
    });

    it("keeps what succeeded when one type fails, and names the failed metrics", async () => {
      mockQueryQuantity.mockImplementation((identifier: string) =>
        identifier === "HKQuantityTypeIdentifierHeartRate"
          ? Promise.resolve([heartRateSample(120)])
          : Promise.reject(new Error("read failed")),
      );
      const provider = await readyProvider(["heart_rate", "active_energy"]);

      const result = await provider.sync({ metricTypes: ["heart_rate", "active_energy"], since: null });

      expect(result.observations.map((o) => o.metricType)).toEqual(["heart_rate"]);
      expect(result.failedMetricTypes).toEqual(["active_energy"]);
    });

    it("names every sleep metric when the sleep read fails", async () => {
      mockQueryCategory.mockRejectedValue(new Error("read failed"));
      const provider = await readyProvider(["sleep_duration", "sleep_rem_duration"]);

      const result = await provider.sync({ metricTypes: ["sleep_duration", "sleep_rem_duration"], since: null });

      expect(result.failedMetricTypes).toEqual(expect.arrayContaining(["sleep_duration", "sleep_rem_duration"]));
    });
  });

  describe("disconnect", () => {
    it("resolves without touching HealthKit: access is turned off in the Health app, not by FORJD", async () => {
      await expect(new AppleHealthProvider().disconnect()).resolves.toBeUndefined();
      expect(mockRequestAuthorization).not.toHaveBeenCalled();
    });
  });
});

runHealthProviderContractTests("AppleHealthProvider", () => {
  mockAvailable.mockReturnValue(true);
  mockRequestAuthorization.mockResolvedValue(true);
  mockQueryQuantity.mockResolvedValue([heartRateSample(130)]);
  mockQueryCategory.mockResolvedValue([]);
  return new AppleHealthProvider();
});
