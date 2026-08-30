import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import type { ExerciseListQuery, ExerciseListResponse, ExerciseResponse } from "@forjd/contracts";
import { exerciseListQuerySchema } from "@forjd/contracts";

import { AuthenticatedRequest, JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ExercisesService } from "./exercises.service";

/**
 * Authenticated-only, like every other read in this API. The catalogue is not secret, but the
 * same endpoint also returns the caller's own custom exercises and their favourites, and
 * splitting that into a public route and a private one would mean two code paths deciding the
 * same visibility question.
 *
 * **The first `@Query` validation in the codebase.** `ZodValidationPipe` has only ever been
 * applied to `@Body` until now, where every value is already correctly typed by JSON. A query
 * string is all strings, which is why `exerciseListQuerySchema` needs `z.coerce` for `limit`
 * and an explicit enum -- not `z.coerce.boolean()` -- for `favourite`.
 */
@Controller("exercises")
@UseGuards(JwtAuthGuard)
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(exerciseListQuerySchema)) query: ExerciseListQuery,
  ): Promise<ExerciseListResponse> {
    return this.exercisesService.list(request.user, query);
  }

  /**
   * Declared after the collection route on purpose: Nest matches in declaration order, and a
   * `:id` route declared first would swallow `GET /exercises` as an exercise whose id is the
   * empty string.
   */
  @Get(":id")
  getById(@Req() request: AuthenticatedRequest, @Param("id") id: string): Promise<ExerciseResponse> {
    return this.exercisesService.getById(request.user, id);
  }
}
