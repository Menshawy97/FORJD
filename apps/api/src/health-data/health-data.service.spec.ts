import { User } from "@forjd/domain";

import { HealthDataRepository, ObservationRow } from "./health-data.repository";
import { HealthDataService } from "./health-data.service";

/**
 * The service's own jobs against a fake repository: mapping a wire batch into
 * `NewObservationInput`s (nullable-field defaulting included), grouping observation rows by
 * `(metricType, startTime, endTime)` window and resolving each window's winner via
 * `resolveByPriority`, and turning `Date`s into ISO strings on the way out.
 * `HealthDataRepository`'s own SQL (the upsert, the schema constraints) is proven against
 * real Postgres in `health-data.schema.spec.ts`.
 */
describe("HealthDataService", () => {
  const viewer = { id: "11111111-1111-4111-8111-111111111111", email: "ada@example.com" } as User;

  const makeRow = (overrides: Partial<ObservationRow> = {}): ObservationRow => ({
    id: "22222222-2222-4222-8222-222222222222",
    userId: viewer.id,
    metricType: "hrv",
    value: 60,
    unit: "ms",
    startTime: new Date("2026-09-07T00:00:00.000Z"),
    endTime: new Date("2026-09-07T00:00:00.000Z"),
    source: "health_connect",
    providerRecordId: null,
    deviceId: null,
    quality: null,
    createdAt: new Date("2026-09-07T01:00:00.000Z"),
    ...overrides,
  });

  const makeService = (
    rows: ObservationRow[] = [],
    connections: Array<{ source: string; lastSuccessfulSyncAt: Date | null }> = [],
  ) => {
    const repository = {
      ingestObservations: jest.fn().mockResolvedValue(undefined),
      getObservationsForUser: jest.fn().mockResolvedValue(rows),
      getConnectionsForUser: jest.fn().mockResolvedValue(connections),
    } as unknown as HealthDataRepository;
    return { service: new HealthDataService(repository), repository };
  };

  describe("ingestBatch", () => {
    it("scopes the write to the caller's own id", async () => {
      const { service, repository } = makeService();

      await service.ingestBatch(viewer, {
        observations: [
          {
            metricType: "hrv",
            value: 60,
            unit: "ms",
            startTime: "2026-09-07T00:00:00.000Z",
            endTime: "2026-09-07T00:00:00.000Z",
            source: "health_connect",
          },
        ],
      });

      expect(repository.ingestObservations).toHaveBeenCalledWith(viewer.id, expect.any(Array));
    });

    it("parses ISO date strings into Dates and defaults omitted optional fields to null", async () => {
      const { service, repository } = makeService();

      await service.ingestBatch(viewer, {
        observations: [
          {
            metricType: "steps",
            value: 8000,
            unit: "steps",
            startTime: "2026-09-07T00:00:00.000Z",
            endTime: "2026-09-07T23:59:59.000Z",
            source: "manual",
          },
        ],
      });

      const [, mapped] = (repository.ingestObservations as jest.Mock).mock.calls[0];
      expect(mapped[0].startTime).toEqual(new Date("2026-09-07T00:00:00.000Z"));
      expect(mapped[0].endTime).toEqual(new Date("2026-09-07T23:59:59.000Z"));
      expect(mapped[0].providerRecordId).toBeNull();
      expect(mapped[0].deviceId).toBeNull();
      expect(mapped[0].quality).toBeNull();
    });

    it("carries provided optional fields through rather than discarding them", async () => {
      const { service, repository } = makeService();

      await service.ingestBatch(viewer, {
        observations: [
          {
            metricType: "hrv",
            value: 60,
            unit: "ms",
            startTime: "2026-09-07T00:00:00.000Z",
            endTime: "2026-09-07T00:00:00.000Z",
            source: "whoop",
            providerRecordId: "whoop-rec-1",
            deviceId: "whoop-band-1",
            quality: 0.9,
          },
        ],
      });

      const [, mapped] = (repository.ingestObservations as jest.Mock).mock.calls[0];
      expect(mapped[0].providerRecordId).toBe("whoop-rec-1");
      expect(mapped[0].deviceId).toBe("whoop-band-1");
      expect(mapped[0].quality).toBe(0.9);
    });
  });

  describe("getSeries", () => {
    it("returns one series entry per metric type, with startTime turned into an ISO string", async () => {
      const { service } = makeService([
        makeRow({ metricType: "hrv", value: 60 }),
        makeRow({
          metricType: "steps",
          value: 8000,
          startTime: new Date("2026-09-06T00:00:00.000Z"),
          endTime: new Date("2026-09-06T23:59:59.000Z"),
        }),
      ]);

      const result = await service.getSeries(viewer);

      expect(result.series).toHaveLength(2);
      const hrv = result.series.find((s) => s.metricType === "hrv");
      expect(hrv?.points).toEqual([{ startTime: "2026-09-07T00:00:00.000Z", value: 60 }]);
    });

    it("resolves duplicate same-window candidates via source priority instead of listing both", async () => {
      const { service } = makeService([
        makeRow({ source: "apple_health", value: 55, createdAt: new Date("2026-09-07T01:00:00.000Z") }),
        makeRow({ source: "whoop", value: 60, createdAt: new Date("2026-09-07T02:00:00.000Z") }),
      ]);

      const result = await service.getSeries(viewer);

      const hrv = result.series.find((s) => s.metricType === "hrv");
      // hrv's priority list puts whoop ahead of health_connect/apple_health.
      expect(hrv?.points).toEqual([{ startTime: "2026-09-07T00:00:00.000Z", value: 60 }]);
    });

    it("treats two different windows for the same metric as two separate series points", async () => {
      const { service } = makeService([
        makeRow({ value: 55, startTime: new Date("2026-09-06T00:00:00.000Z"), endTime: new Date("2026-09-06T00:00:00.000Z") }),
        makeRow({ value: 60, startTime: new Date("2026-09-07T00:00:00.000Z"), endTime: new Date("2026-09-07T00:00:00.000Z") }),
      ]);

      const result = await service.getSeries(viewer);

      const hrv = result.series.find((s) => s.metricType === "hrv");
      expect(hrv?.points).toHaveLength(2);
      expect(hrv?.points.map((p) => p.value)).toEqual([55, 60]);
    });

    it("returns no series at all for a user with no observations", async () => {
      const { service } = makeService([]);

      const result = await service.getSeries(viewer);

      expect(result.series).toEqual([]);
    });
  });

  describe("listConnections", () => {
    it("scopes the read to the caller's own id and turns the sync checkpoint into an ISO string", async () => {
      const { service, repository } = makeService(
        [],
        [{ source: "health_connect", lastSuccessfulSyncAt: new Date("2026-09-07T03:00:00.000Z") }],
      );

      const result = await service.listConnections(viewer);

      expect(repository.getConnectionsForUser).toHaveBeenCalledWith(viewer.id);
      expect(result.connections).toEqual([{ source: "health_connect", lastSuccessfulSyncAt: "2026-09-07T03:00:00.000Z" }]);
    });

    it("passes through a null sync checkpoint for a connection that has never synced", async () => {
      const { service } = makeService([], [{ source: "whoop", lastSuccessfulSyncAt: null }]);

      const result = await service.listConnections(viewer);

      expect(result.connections[0]?.lastSuccessfulSyncAt).toBeNull();
    });
  });
});
