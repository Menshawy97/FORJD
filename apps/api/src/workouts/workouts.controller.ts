import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type {
  CreateWorkoutTemplateRequest,
  UpdateWorkoutTemplateRequest,
  WorkoutTemplateListQuery,
  WorkoutTemplateListResponse,
  WorkoutTemplateResponse,
} from "@forjd/contracts";
import {
  createWorkoutTemplateRequestSchema,
  updateWorkoutTemplateRequestSchema,
  workoutTemplateListQuerySchema,
} from "@forjd/contracts";

import { AuthenticatedRequest, JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { WorkoutsService } from "./workouts.service";

/**
 * Authenticated-only, mirroring `ExercisesController` exactly -- the same endpoint also
 * returns the caller's own custom templates alongside any curated ones, so splitting a
 * public route from a private one would mean two code paths deciding the same visibility
 * question `WorkoutsRepository`'s `visibleTo` already answers once.
 */
@Controller("workouts/templates")
@UseGuards(JwtAuthGuard)
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(workoutTemplateListQuerySchema)) query: WorkoutTemplateListQuery,
  ): Promise<WorkoutTemplateListResponse> {
    return this.workoutsService.list(request.user, query);
  }

  @Get(":id")
  getById(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<WorkoutTemplateResponse> {
    return this.workoutsService.getById(request.user, id);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createWorkoutTemplateRequestSchema)) body: CreateWorkoutTemplateRequest,
  ): Promise<WorkoutTemplateResponse> {
    return this.workoutsService.create(request.user, body);
  }

  @Patch(":id")
  update(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateWorkoutTemplateRequestSchema)) body: UpdateWorkoutTemplateRequest,
  ): Promise<WorkoutTemplateResponse> {
    return this.workoutsService.update(request.user, id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Req() request: AuthenticatedRequest, @Param("id") id: string): Promise<void> {
    return this.workoutsService.delete(request.user, id);
  }
}
