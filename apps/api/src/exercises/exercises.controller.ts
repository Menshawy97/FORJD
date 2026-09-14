import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import type {
  CreateExerciseRequest,
  ExerciseCatalogueResponse,
  ExerciseListQuery,
  ExerciseListResponse,
  ExerciseResponse,
  UpdateExerciseRequest,
} from "@forjd/contracts";
import { createExerciseRequestSchema, exerciseListQuerySchema, updateExerciseRequestSchema } from "@forjd/contracts";

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
   * Declared before `:id`, on purpose, for the same reason `:id` is declared after the
   * collection route: Nest matches in declaration order, and a `:id` route declared first
   * would swallow this one, treating "catalogue" as an exercise id rather than the literal
   * path segment it is.
   *
   * **Conditional GET (R20).** `If-None-Match` carries the mobile store's locally cached
   * `catalogueVersion` (`ExercisesService.deriveCatalogueVersion`'s own hash, unchanged) --
   * when it still matches, this answers `304` with no body rather than re-sending the whole
   * catalogue on every app launch. `@Res({ passthrough: true })` is required the moment a
   * route needs to reach for `304`/headers directly: Nest's default response handling only
   * ever sends `200`.
   */
  @Get("catalogue")
  async getCatalogue(
    @Req() request: AuthenticatedRequest,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ExerciseCatalogueResponse | undefined> {
    const result = await this.exercisesService.getCatalogueConditional(request.user, ifNoneMatch);

    if (result.notModified) {
      response.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    response.setHeader("ETag", `"${result.catalogue.catalogueVersion}"`);
    return result.catalogue;
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

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createExerciseRequestSchema)) body: CreateExerciseRequest,
  ): Promise<ExerciseResponse> {
    return this.exercisesService.create(request.user, body);
  }

  @Patch(":id")
  update(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateExerciseRequestSchema)) body: UpdateExerciseRequest,
  ): Promise<ExerciseResponse> {
    return this.exercisesService.update(request.user, id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Req() request: AuthenticatedRequest, @Param("id") id: string): Promise<void> {
    return this.exercisesService.delete(request.user, id);
  }

  @Put(":id/favourite")
  @HttpCode(HttpStatus.NO_CONTENT)
  addFavourite(@Req() request: AuthenticatedRequest, @Param("id") id: string): Promise<void> {
    return this.exercisesService.setFavourite(request.user, id, true);
  }

  @Delete(":id/favourite")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeFavourite(@Req() request: AuthenticatedRequest, @Param("id") id: string): Promise<void> {
    return this.exercisesService.setFavourite(request.user, id, false);
  }
}
