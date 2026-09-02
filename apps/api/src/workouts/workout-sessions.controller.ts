import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type {
  WorkoutSessionListQuery,
  WorkoutSessionListResponse,
  WorkoutSessionResponse,
  WorkoutSessionUploadRequest,
} from "@forjd/contracts";
import { workoutSessionListQuerySchema, workoutSessionUploadRequestSchema } from "@forjd/contracts";

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
