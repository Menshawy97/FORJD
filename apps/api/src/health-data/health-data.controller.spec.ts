import {
  batchIngestHealthObservationsRequestSchema,
  healthObservationSeriesQuerySchema,
  readinessQuerySchema,
} from "@forjd/contracts";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { getBodySchema, getClassGuards, getQuerySchema } from "../test-support/controller-metadata";
import { fakeAuthenticatedRequest } from "../test-support/fake-authenticated-request";
import { HealthDataController } from "./health-data.controller";
import { HealthDataService } from "./health-data.service";

describe("HealthDataController", () => {
  let service: jest.Mocked<HealthDataService>;
  let controller: HealthDataController;

  beforeEach(() => {
    service = {
      ingestBatch: jest.fn(),
      getSeries: jest.fn(),
      listConnections: jest.fn(),
      getReadiness: jest.fn(),
    } as unknown as jest.Mocked<HealthDataService>;
    controller = new HealthDataController(service);
  });

  it("carries JwtAuthGuard at the class level", () => {
    expect(getClassGuards(HealthDataController)).toContain(JwtAuthGuard);
  });

  it("binds ingest's body to batchIngestHealthObservationsRequestSchema", () => {
    expect(getBodySchema(HealthDataController, "ingest")).toBe(batchIngestHealthObservationsRequestSchema);
  });

  it("binds readiness's query to readinessQuerySchema", () => {
    expect(getQuerySchema(HealthDataController, "readiness")).toBe(readinessQuerySchema);
  });

  it("ingest forwards request.user and the validated batch to the service", async () => {
    const request = fakeAuthenticatedRequest();
    const body = { observations: [] } as never;

    await controller.ingest(request, body);

    expect(service.ingestBatch).toHaveBeenCalledWith(request.user, body);
  });

  it("binds series's query to healthObservationSeriesQuerySchema", () => {
    expect(getQuerySchema(HealthDataController, "series")).toBe(healthObservationSeriesQuerySchema);
  });

  it("series forwards request.user and the validated bounded-window query, never an unbounded call", async () => {
    const request = fakeAuthenticatedRequest();
    const query = { metricTypes: ["hrv"], since: "2026-09-01T00:00:00.000Z", limit: 500 } as never;

    await controller.series(request, query);

    expect(service.getSeries).toHaveBeenCalledWith(request.user, query);
  });

  it("connections scopes by request.user only", async () => {
    const request = fakeAuthenticatedRequest();
    await controller.connections(request);
    expect(service.listConnections).toHaveBeenCalledWith(request.user);
  });

  it("readiness forwards request.user and the validated timeZone, never a client-supplied user id", async () => {
    const request = fakeAuthenticatedRequest();
    const query = { timeZone: "America/New_York" };

    await controller.readiness(request, query);

    expect(service.getReadiness).toHaveBeenCalledWith(request.user, query.timeZone);
  });
});
