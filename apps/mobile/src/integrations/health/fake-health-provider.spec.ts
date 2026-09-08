import { FakeHealthProvider } from "./fake-health-provider";
import { runHealthProviderContractTests } from "./health-provider.contract";

runHealthProviderContractTests("FakeHealthProvider", () => new FakeHealthProvider());

describe("FakeHealthProvider", () => {
  it("does not return an observation for a metric type whose permission was never requested", async () => {
    const provider = new FakeHealthProvider({
      observations: [
        {
          metricType: "hrv",
          value: 60,
          unit: "ms",
          startTime: new Date("2026-09-07T00:00:00.000Z"),
          endTime: new Date("2026-09-07T00:00:00.000Z"),
          providerRecordId: null,
          deviceId: null,
          quality: null,
        },
      ],
    });

    const result = await provider.sync({ metricTypes: ["hrv"], since: null });

    expect(result.observations).toEqual([]);
  });

  it("returns an observation once its permission is granted", async () => {
    const provider = new FakeHealthProvider({
      observations: [
        {
          metricType: "hrv",
          value: 60,
          unit: "ms",
          startTime: new Date("2026-09-07T00:00:00.000Z"),
          endTime: new Date("2026-09-07T00:00:00.000Z"),
          providerRecordId: null,
          deviceId: null,
          quality: null,
        },
      ],
    });

    await provider.requestPermissions(["hrv"]);
    const result = await provider.sync({ metricTypes: ["hrv"], since: null });

    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]?.value).toBe(60);
  });

  it("filters out an observation older than the sync checkpoint", async () => {
    const provider = new FakeHealthProvider({
      observations: [
        {
          metricType: "steps",
          value: 5000,
          unit: "steps",
          startTime: new Date("2026-09-01T00:00:00.000Z"),
          endTime: new Date("2026-09-01T00:00:00.000Z"),
          providerRecordId: null,
          deviceId: null,
          quality: null,
        },
      ],
    });

    await provider.requestPermissions(["steps"]);
    const result = await provider.sync({ metricTypes: ["steps"], since: new Date("2026-09-05T00:00:00.000Z") });

    expect(result.observations).toEqual([]);
  });

  it("denies a permission for a metric type outside its declared capabilities", async () => {
    const provider = new FakeHealthProvider({ supportedMetrics: ["hrv"] });

    const result = await provider.requestPermissions(["hrv", "steps"]);

    expect(result.granted).toEqual(["hrv"]);
    expect(result.denied).toEqual(["steps"]);
  });

  it("clears granted permissions on disconnect, so a later sync returns nothing until re-granted", async () => {
    const provider = new FakeHealthProvider({
      observations: [
        {
          metricType: "hrv",
          value: 60,
          unit: "ms",
          startTime: new Date("2026-09-07T00:00:00.000Z"),
          endTime: new Date("2026-09-07T00:00:00.000Z"),
          providerRecordId: null,
          deviceId: null,
          quality: null,
        },
      ],
    });

    await provider.requestPermissions(["hrv"]);
    await provider.disconnect();
    const result = await provider.sync({ metricTypes: ["hrv"], since: null });

    expect(result.observations).toEqual([]);
  });
});
