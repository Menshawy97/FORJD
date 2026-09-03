import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import type {
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

  @Get(":id")
  getById(@Req() request: AuthenticatedRequest, @Param("id") id: string): Promise<ProgramResponse> {
    return this.programsService.getById(request.user, id);
  }
}
