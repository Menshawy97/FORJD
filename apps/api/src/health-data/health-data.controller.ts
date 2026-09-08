import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from "@nestjs/common";
import { batchIngestHealthObservationsRequestSchema, readinessQuerySchema } from "@forjd/contracts";
import type {
  BatchIngestHealthObservationsRequest,
  HealthConnectionListResponse,
  HealthObservationSeriesResponse,
  ReadinessQuery,
  ReadinessResponse,
} from "@forjd/contracts";

import { AuthenticatedRequest, JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { HealthDataService } from "./health-data.service";

/**
 * Named `health-data`, not `health` -- `apps/api/src/common/health/` already owns that
 * route/module name as the liveness probe (`GET /api/v1/health`), per Phase 6 plan decision
 * 2. This controller has no `:id` route, so there is no `series`-vs-`:id` ordering hazard
 * the way `body-scans/series` had to be registered ahead of `body-scans/:id`.
 */
@Controller("health-data")
@UseGuards(JwtAuthGuard)
export class HealthDataController {
  constructor(private readonly healthDataService: HealthDataService) {}

  /** One sync batch from a provider adapter (or a manual entry). Idempotent -- see
   *  `HealthDataService.ingestBatch`'s docblock. No response body: nothing in the mobile UI
   *  needs the ingested rows echoed back, the same reasoning `favourite`/`delete` already
   *  apply elsewhere in this codebase for a mutation with nothing useful to return. */
  @Post("observations")
  @HttpCode(HttpStatus.NO_CONTENT)
  ingest(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(batchIngestHealthObservationsRequestSchema))
    body: BatchIngestHealthObservationsRequest,
  ): Promise<void> {
    return this.healthDataService.ingestBatch(request.user, body);
  }

  @Get("observations/series")
  series(@Req() request: AuthenticatedRequest): Promise<HealthObservationSeriesResponse> {
    return this.healthDataService.getSeries(request.user);
  }

  @Get("connections")
  connections(@Req() request: AuthenticatedRequest): Promise<HealthConnectionListResponse> {
    return this.healthDataService.listConnections(request.user);
  }

  /** ADR-031's readiness score. `timeZone` is required for the same reason
   *  `workouts/sessions/stats` requires it -- readiness buckets by local calendar day. */
  @Get("readiness")
  readiness(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(readinessQuerySchema)) query: ReadinessQuery,
  ): Promise<ReadinessResponse> {
    return this.healthDataService.getReadiness(request.user, query.timeZone);
  }
}
