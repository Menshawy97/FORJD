import { Injectable, Inject } from "@nestjs/common";
import { WorkoutSession, WorkoutTemplate } from "@forjd/domain";

import { Database, DRIZZLE } from "../database/database.module";
import {
  CreateWorkoutSessionInput,
  ListWorkoutSessionsFilter,
  WorkoutExerciseHistoryRow,
  WorkoutSessionPage,
  WorkoutSessionsRepository,
  WorkoutStatsRow,
} from "./workout-sessions.repository";
import {
  CreateWorkoutTemplateInput,
  ListWorkoutTemplatesFilter,
  UpdateWorkoutTemplateInput,
  WorkoutTemplatePage,
  WorkoutTemplatesRepository,
} from "./workout-templates.repository";

/**
 * R23c: everything this file used to define directly -- the calendar/date arithmetic, the
 * template CRUD, and the session CRUD -- now lives in `calendar-utils.ts`,
 * `workout-templates.repository.ts` and `workout-sessions.repository.ts` respectively. This
 * file re-exports all three so every existing import of a type or function from
 * `"./workouts.repository"` (there are several, across `workout-cursor.ts`,
 * `progress.repository.ts`, `health-data.service.ts`, both services in this module and their
 * specs) keeps resolving unchanged.
 */
export * from "./calendar-utils";
export * from "./workout-templates.repository";
export * from "./workout-sessions.repository";

/**
 * Data access for the workout engine -- templates (the "what the program tells the user to
 * do" half) and sessions (the "what the user actually did" half), behind one class.
 *
 * **R23c split**: this used to be one 1,246-line class doing three jobs (template CRUD,
 * session CRUD, and calendar-day arithmetic). It now composes `WorkoutTemplatesRepository`
 * and `WorkoutSessionsRepository` and delegates every public method to one or the other,
 * unchanged in signature and behaviour -- a pure refactor, not a behaviour change.
 *
 * **Why a composing facade and not two separately-injected repositories**: `WorkoutsRepository`
 * is injected directly into `WorkoutsService`, `WorkoutSessionsService`,
 * `progress.repository.ts` (for the calendar functions) and, via `WorkoutsModule`'s own
 * `exports`, into `AccountModule`'s `AccountExportService` (R4) -- four consumers across two
 * modules, none of which should need to change their constructor to ask for two repositories
 * instead of one just because this file's internals were reorganised. `WorkoutsModule`'s
 * provider/export list is unchanged for the same reason. `WorkoutTemplatesRepository` and
 * `WorkoutSessionsRepository` are still `@Injectable()` in their own right (so Nest *could*
 * wire them independently later, e.g. if a future consumer only ever needs one half), but
 * today's facade builds them directly rather than asking Nest's DI container for them, since
 * both only need the same `Database` handle this class already receives.
 */
@Injectable()
export class WorkoutsRepository {
  private readonly templates: WorkoutTemplatesRepository;
  private readonly sessions: WorkoutSessionsRepository;

  constructor(@Inject(DRIZZLE) db: Database) {
    this.templates = new WorkoutTemplatesRepository(db);
    this.sessions = new WorkoutSessionsRepository(db);
  }

  /* ---------------------------------------------------------------------------------------
   * Template half -- delegates to `WorkoutTemplatesRepository`.
   * --------------------------------------------------------------------------------------- */

  findByIdForUser(id: string, userId: string): Promise<WorkoutTemplate | null> {
    return this.templates.findByIdForUser(id, userId);
  }

  listOwnTemplateIdsForUser(userId: string): Promise<string[]> {
    return this.templates.listOwnTemplateIdsForUser(userId);
  }

  listForUser(filter: ListWorkoutTemplatesFilter): Promise<WorkoutTemplatePage> {
    return this.templates.listForUser(filter);
  }

  createTemplate(ownerUserId: string, input: CreateWorkoutTemplateInput): Promise<WorkoutTemplate> {
    return this.templates.createTemplate(ownerUserId, input);
  }

  updateTemplate(
    id: string,
    ownerUserId: string,
    patch: UpdateWorkoutTemplateInput,
  ): Promise<WorkoutTemplate | null> {
    return this.templates.updateTemplate(id, ownerUserId, patch);
  }

  softDeleteTemplate(id: string, ownerUserId: string): Promise<boolean> {
    return this.templates.softDeleteTemplate(id, ownerUserId);
  }

  /* ---------------------------------------------------------------------------------------
   * Session half -- delegates to `WorkoutSessionsRepository`.
   * --------------------------------------------------------------------------------------- */

  listSessionIdsForUser(userId: string): Promise<string[]> {
    return this.sessions.listSessionIdsForUser(userId);
  }

  upsertSession(input: CreateWorkoutSessionInput): Promise<WorkoutSession> {
    return this.sessions.upsertSession(input);
  }

  findSessionByIdForUser(id: string, userId: string): Promise<WorkoutSession | null> {
    return this.sessions.findSessionByIdForUser(id, userId);
  }

  listSessionsForUser(filter: ListWorkoutSessionsFilter): Promise<WorkoutSessionPage> {
    return this.sessions.listSessionsForUser(filter);
  }

  statsForUser(userId: string, timeZone: string, now: Date): Promise<WorkoutStatsRow> {
    return this.sessions.statsForUser(userId, timeZone, now);
  }

  exerciseHistoryForUser(
    userId: string,
    exerciseId: string,
    limit: number,
  ): Promise<WorkoutExerciseHistoryRow> {
    return this.sessions.exerciseHistoryForUser(userId, exerciseId, limit);
  }
}
