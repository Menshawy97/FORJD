import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type {
  ProgramEnrolResponse,
  ProgramEnrollmentResponse,
  ProgramListQuery,
  ProgramListResponse,
  ProgramResponse,
} from "@forjd/contracts";
import { programListQuerySchema } from "@forjd/contracts";

import { AuthenticatedRequest, JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ProgramsService } from "./programs.service";

/**
 * Authenticated-only, like every other read in this API. The nine presets are not secret, but the
 * same endpoint also returns the caller's own custom programs and their enrolment, and splitting
 * that into a public route and a private one would mean two code paths answering the same
 * visibility question.
 */
@Controller("programs")
@UseGuards(JwtAuthGuard)
export class ProgramsController {
  constructor(private readonly programsService: ProgramsService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(programListQuerySchema)) query: ProgramListQuery,
  ): Promise<ProgramListResponse> {
    return this.programsService.list(request.user, query);
  }

  /**
   * **Declared above `@Get(":id")` deliberately, and it must stay there.** Nest matches routes in
   * declaration order, so a single-segment `:id` route declared first would swallow this one and
   * treat "enrollment" as a program id -- which then 404s, because it is not a uuid. The same
   * trap `@Get("stats")` documents in `workout-sessions.controller.ts` and `@Get("catalogue")` in
   * `exercises.controller.ts`; it has caught this codebase before.
   */
  @Get("enrollment")
  getEnrollment(@Req() request: AuthenticatedRequest): Promise<ProgramEnrollmentResponse> {
    return this.programsService.getEnrollment(request.user);
  }

  /**
   * Stop Following. Declared above `@Get(":id")` for tidiness rather than necessity -- it is a
   * `DELETE`, so it could not collide with a `GET` however it were ordered, but keeping every
   * literal `enrollment` route together is what stops the next person from having to re-derive
   * which ones actually matter.
   *
   * 204, and 204 again when nothing was being followed: a second tap on Stop Following, or a tap
   * from a screen one request out of date, is not a client error.
   */
  @Delete("enrollment")
  @HttpCode(HttpStatus.NO_CONTENT)
  stopFollowing(@Req() request: AuthenticatedRequest): Promise<void> {
    return this.programsService.stopFollowing(request.user);
  }

  @Get(":id")
  getById(@Req() request: AuthenticatedRequest, @Param("id") id: string): Promise<ProgramResponse> {
    return this.programsService.getById(request.user, id);
  }

  /**
   * Start Following. No request body -- the program is named by the path and there is nothing else
   * to choose, so there is no schema to validate and no way for a client to send a program id that
   * disagrees with the URL.
   *
   * 201: enrolling creates an enrolment. It stays 201 even when it ends a previous one, because
   * what the request produced is still a new enrolment; the one case that creates nothing is
   * re-following the program you already follow, which returns the existing enrolment rather than
   * resetting its `startedAt` and silently erasing the athlete's progress through it.
   */
  @Post(":id/enrol")
  enrol(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<ProgramEnrolResponse> {
    return this.programsService.enrol(request.user, id);
  }
}
