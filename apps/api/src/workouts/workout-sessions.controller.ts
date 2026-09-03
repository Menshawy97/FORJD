import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type {
  ExerciseHistoryQuery,
  ExerciseHistoryResponse,
  WorkoutSessionListQuery,
  WorkoutSessionListResponse,
  WorkoutSessionResponse,
  WorkoutSessionUploadRequest,
  WorkoutStatsQuery,
  WorkoutStatsResponse,
} from "@forjd/contracts";
import {
  exerciseHistoryQuerySchema,
  workoutSessionListQuerySchema,
  workoutSessionUploadRequestSchema,
  workoutStatsQuerySchema,
} from "@forjd/contracts";

import { AuthenticatedRequest, JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { WorkoutSessionsService } from "./workout-sessions.service";

/**
 * A separate controller from `WorkoutsController`, matching `WorkoutSessionsService` being a
 * separate service from `WorkoutsService` -- same module, two independent aggregates.
 *
 * There is deliberately no `PATCH`/`DELETE` here: a session is uploaded once, complete, after
 * it finishes on-device (CLAUDE.md rule 6); nothing in this phase edits or removes one after
 * the fact.
 */
@Controller("workouts/sessions")
@UseGuards(JwtAuthGuard)
export class WorkoutSessionsController {
  constructor(private readonly workoutSessionsService: WorkoutSessionsService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(workoutSessionListQuerySchema)) query: WorkoutSessionListQuery,
  ): Promise<WorkoutSessionListResponse> {
    return this.workoutSessionsService.list(request.user, query);
  }

  /**
   * Home's stat strip, "This week" and "Recent PR" (Phase 3J-c).
   *
   * **Declared above `@Get(":id")` deliberately, and it must stay there.** Nest matches routes
   * in declaration order, so with these two the other way round `/workouts/sessions/stats`
   * binds to `getById` with `id: "stats"` -- which fails the UUID guard and answers 404 for
   * every request Home makes, with nothing in either method looking wrong.
   */
  @Get("stats")
  stats(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(workoutStatsQuerySchema)) query: WorkoutStatsQuery,
  ): Promise<WorkoutStatsResponse> {
    return this.workoutSessionsService.stats(request.user, query);
  }

  /**
   * One exercise's history (Phase 3J-d) -- the exercise-detail screen's tiles, trend and
   * History list.
   *
   * Three path segments, so unlike `@Get("stats")` above, this one cannot be captured by the
   * single-segment `@Get(":id")` below however they are ordered. It is kept up here anyway,
   * beside the other non-parameterised routes, so the file does not have to be read twice to
   * see which routes are safe from that hazard and which are not.
   */
  @Get("exercise/:exerciseId")
  exerciseHistory(
    @Req() request: AuthenticatedRequest,
    @Param("exerciseId") exerciseId: string,
    @Query(new ZodValidationPipe(exerciseHistoryQuerySchema)) query: ExerciseHistoryQuery,
  ): Promise<ExerciseHistoryResponse> {
    return this.workoutSessionsService.exerciseHistory(request.user, exerciseId, query);
  }

  @Get(":id")
  getById(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<WorkoutSessionResponse> {
    return this.workoutSessionsService.getById(request.user, id);
  }

  @Post()
  upload(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(workoutSessionUploadRequestSchema)) body: WorkoutSessionUploadRequest,
  ): Promise<WorkoutSessionResponse> {
    return this.workoutSessionsService.upload(request.user, body);
  }
}
