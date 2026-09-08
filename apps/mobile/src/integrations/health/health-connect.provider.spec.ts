import { runHealthProviderContractTests } from "@forjd/domain";
import { SdkAvailabilityStatus } from "react-native-health-connect";

import { buildTimeRangeFilter, HealthConnectProvider } from "./health-connect.provider";

/**
 * `react-native-health-connect` is a native module -- there is no real Health Connect to call
 * into under Jest, and this codebase never runs a live vendor call in CI (the same reasoning
 * `nvidia-vision.provider.spec.ts`/`openai-vision.provider.spec.ts` give on the API side).
 * The whole functional surface this file touches is mocked; `health-connect-record-mapping.spec.ts`
 * already covers the pure field-mapping logic with real record shapes and no mock at all.
 */
jest.mock("react-native-health-connect", () => {
  const actual = jest.requireActual("react-native-health-connect");
  return {
    ...actual,
    getSdkStatus: jest.fn(),
    initialize: jest.fn(),
    requestPermission: jest.fn(),
    readRecords: jest.fn(),
  };
});

import { getSdkStatus, initialize, readRecords, requestPermission } from "react-native-health-connect";

const mockGetSdkStatus = getSdkStatus as jest.Mock;
const mockInitialize = initialize as jest.Mock;
const mockRequestPermission = requestPermission as jest.Mock;
const mockReadRecords = readRecords as jest.Mock;

describe("buildTimeRangeFilter", () => {
  it("uses an unbounded 'before' filter for a full sync (since: null)", () => {
    const now = new Date("2026-09-08T00:00:00.000Z");
    expect(buildTimeRangeFilter(null, now)).toEqual({ operator: "before", endTime: now.toISOString() });
  });

  it("uses a 'between' filter bounded by the checkpoint and now for an incremental sync", () => {
    const since = new Date("2026-09-01T00:00:00.000Z");
    const now = new Date("2026-09-08T00:00:00.000Z");
    expect(buildTimeRangeFilter(since, now)).toEqual({
      operator: "between",
      startTime: since.toISOString(),
      endTime: now.toISOString(),
    });
  });
});

describe("HealthConnectProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("connect", () => {
    it("initializes once the SDK reports available", async () => {
      mockGetSdkStatus.mockResolvedValue(SdkAvailabilityStatus.SDK_AVAILABLE);
      mockInitialize.mockResolvedValue(true);

      await expect(new HealthConnectProvider().connect()).resolves.toBeUndefined();
      expect(mockInitialize).toHaveBeenCalled();
    });

    it("throws without initializing when the SDK is unavailable", async () => {
      mockGetSdkStatus.mockResolvedValue(SdkAvailabilityStatus.SDK_UNAVAILABLE);

      await expect(new HealthConnectProvider().connect()).rejects.toThrow(/not available/i);
      expect(mockInitialize).not.toHaveBeenCalled();
    });

    it("throws when the SDK reports available but initialize() itself fails", async () => {
      mockGetSdkStatus.mockResolvedValue(SdkAvailabilityStatus.SDK_AVAILABLE);
      mockInitialize.mockResolvedValue(false);

      await expect(new HealthConnectProvider().connect()).rejects.toThrow(/failed to initialize/i);
    });
  });

  describe("requestPermissions", () => {
    it("requests one Health Connect permission per distinct record type, not per metric type", async () => {
      mockRequestPermission.mockResolvedValue([]);

      await new HealthConnectProvider().requestPermissions([
        "sleep_duration",
        "sleep_light_duration",
        "sleep_deep_duration",
      ]);

      expect(mockRequestPermission).toHaveBeenCalledWith([{ accessType: "read", recordType: "SleepSession" }]);
    });

    it("grants every sleep metric type together once SleepSession is granted", async () => {
      mockRequestPermission.mockResolvedValue([{ accessType: "read", recordType: "SleepSession" }]);

      const result = await new HealthConnectProvider().requestPermissions([
        "sleep_duration",
        "sleep_rem_duration",
      ]);

      expect(result.granted).toEqual(["sleep_duration", "sleep_rem_duration"]);
      expect(result.denied).toEqual([]);
    });

    it("denies a metric type whose record type was not returned as granted", async () => {
      mockRequestPermission.mockResolvedValue([]);

      const result = await new HealthConnectProvider().requestPermissions(["hrv"]);

      expect(result.granted).toEqual([]);
      expect(result.denied).toEqual(["hrv"]);
    });
  });

  describe("sync", () => {
    it("only fetches the record types for the requested metric types", async () => {
      mockReadRecords.mockResolvedValue({ records: [] });

      await new HealthConnectProvider().sync({ metricTypes: ["hrv"], since: null });

      expect(mockReadRecords).toHaveBeenCalledTimes(1);
      expect(mockReadRecords).toHaveBeenCalledWith("HeartRateVariabilityRmssd", expect.any(Object));
    });

    it("maps a real record through to a canonical observation", async () => {
      mockReadRecords.mockResolvedValue({
        records: [{ time: "2026-09-07T00:00:00.000Z", heartRateVariabilityMillis: 60, metadata: { id: "rec-1" } }],
      });

      const result = await new HealthConnectProvider().sync({ metricTypes: ["hrv"], since: null });

      expect(result.observations).toEqual([
        expect.objectContaining({ metricType: "hrv", value: 60, unit: "ms", providerRecordId: "rec-1" }),
      ]);
    });

    it("filters the final result down to only the requested metric types", async () => {
      // A SleepSession record always yields a sleep_duration row alongside any stage rows --
      // requesting only the stage type should not leak sleep_duration into the result.
      mockReadRecords.mockResolvedValue({
        records: [{ startTime: "2026-09-07T22:00:00.000Z", endTime: "2026-09-08T06:00:00.000Z" }],
      });

      const result = await new HealthConnectProvider().sync({ metricTypes: ["sleep_light_duration"], since: null });

      expect(result.observations.every((o) => o.metricType === "sleep_light_duration")).toBe(true);
    });

    it("requesting zero metric types fetches nothing and returns an empty result", async () => {
      const result = await new HealthConnectProvider().sync({ metricTypes: [], since: null });

      expect(mockReadRecords).not.toHaveBeenCalled();
      expect(result.observations).toEqual([]);
    });
  });

  describe("disconnect", () => {
    it("resolves without calling revokeAllPermissions", async () => {
      await expect(new HealthConnectProvider().disconnect()).resolves.toBeUndefined();
    });
  });
});

runHealthProviderContractTests("HealthConnectProvider", () => {
  mockGetSdkStatus.mockResolvedValue(SdkAvailabilityStatus.SDK_AVAILABLE);
  mockInitialize.mockResolvedValue(true);
  mockRequestPermission.mockImplementation((permissions: Array<{ recordType: string }>) => Promise.resolve(permissions));
  mockReadRecords.mockResolvedValue({ records: [] });
  return new HealthConnectProvider();
});
