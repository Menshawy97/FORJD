import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  ExerciseHistoryQuery,
  ExerciseHistoryResponse,
  WorkoutSessionListQuery,
  WorkoutSessionListResponse,
  WorkoutSessionResponse,
  WorkoutSessionSummary,
  WorkoutSessionUploadRequest,
  WorkoutStatsQuery,
  WorkoutStatsResponse,
} from "@forjd/contracts";
import { User, WorkoutSession, WorkoutSessionExercise, WorkoutSet } from "@forjd/domain";

import { CityResolverService } from "../cities/city-resolver.service";
import { ExercisesRepository } from "../exercises/exercises.repository";
import { PrivacyService } from "../privacy/privacy.service";
import { PrCelebrationService } from "./pr-celebration.service";
import { decodeWorkoutSessionCursor, encodeWorkoutSessionCursor } from "./workout-cursor";
import {
  CreateRunSummaryInput,
  CreateWorkoutSessionExerciseInput,
  CreateWorkoutSessionInput,
  WorkoutSessionSummaryRow,
  WorkoutsRepository,
} from "./workouts.repository";

/** Same pattern, same reason as `WorkoutsService`: a malformed id never reaches Postgres. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The session half of the workout engine (Phase E) -- a separate service from
 * `WorkoutsService`, as that class's own docblock already committed to: templates and
 * sessions are two independent aggregates sharing a module, not one service covering both.
 *
 * A session has no curated/shared concept, unlike a template -- ownership is always strict
 * (`userId` equality), so there is no `visibleTo`-style OR-null visibility check here.
 */
@Injectable()
export class WorkoutSessionsService {
  private readonly logger = new Logger(WorkoutSessionsService.name);

  constructor(
    private readonly workoutsRepository: WorkoutsRepository,
    private readonly exercisesRepository: ExercisesRepository,
    private readonly privacyService: PrivacyService,
    private readonly cityResolver: CityResolverService,
    private readonly prCelebration: PrCelebrationService,
  ) {}

  /**
   * Idempotent by `body.id`. Every referenced exercise must exist and be visible to the
   * caller; each one's `measure` is snapshotted from the server's own lookup, never trusted
   * from the request (`workoutSessionExerciseInputSchema`'s own docblock). A `templateId`
   * the caller cannot see is rejected the same way an unknown exercise id is -- a 400 on the
   * request body, not a 404 naming the session (which does not exist yet on a first upload).
   */
  async upload(owner: User, body: WorkoutSessionUploadRequest): Promise<WorkoutSessionResponse> {
    if (body.templateId) {
      const template = await this.workoutsRepository.findByIdForUser(body.templateId, owner.id);
      if (!template) {
        throw new BadRequestException("Unknown templateId");
      }
    }

    const exerciseIds = [...new Set(body.exercises.map((exercise) => exercise.exerciseId))];
    const visibleExercises = await this.exercisesRepository.findManyVisibleForUser(
      exerciseIds,
      owner.id,
    );
    const missing = exerciseIds.filter((id) => !visibleExercises.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`Unknown exercise id(s): ${missing.join(", ")}`);
    }

    const { city, citySlug } = await this.deriveCity(owner.id, body.startLocation);
    const run = await this.resolveRun(owner.id, body.run);
    const input = this.toRepositoryInput(owner.id, body, visibleExercises, city, citySlug, run);
    const session = await this.workoutsRepository.upsertSession(input);

    // A new best queues a push (Phase 12F). Never throws: the workout is already stored.
    await this.prCelebration.celebrate(
      session,
      new Map([...visibleExercises].map(([id, exercise]) => [id, exercise.name])),
    );

    return this.toDetail(session);
  }

  /**
   * The city a session started in, from the position the phone sent (ADR-045, ADR-048).
   *
   * The client's own `city` and `citySlug` are never read: the slug is the leaderboard key, so a
   * client-chosen one would let anyone place themselves on any city's board. A city is derived
   * only for an athlete who has joined leaderboards **and** allowed location, read live and not
   * remembered so a withdrawal is true on the very next upload. The position is used and then
   * dropped; it never reaches the repository.
   *
   * A failure here must not lose the workout, so it degrades to "no city" and is logged without
   * the position.
   */
  private async deriveCity(
    userId: string,
    startLocation: WorkoutSessionUploadRequest["startLocation"],
  ): Promise<{ city: string | null; citySlug: string | null }> {
    const noCity = { city: null, citySlug: null };
    if (!startLocation) return noCity;

    try {
      const privacy = await this.privacyService.get(userId);
      if (!privacy.leaderboardOptIn || !privacy.locationForLeaderboard) return noCity;

      const resolved = this.cityResolver.resolve(startLocation.latitude, startLocation.longitude);
      return resolved ? { city: resolved.name, citySlug: resolved.slug } : noCity;
    } catch (error) {
      this.logger.warn(
        `Could not derive a city for a workout upload: ${error instanceof Error ? error.message : String(error)}`,
      );
      return noCity;
    }
  }

  /**
   * A GPS run's summary, ready to store (ADR-050).
   *
   * Heart rate and calories are health data, so they are kept only for an athlete whose health-data
   * consent is on, read live and not remembered so a withdrawal is true on the very next upload
   * (ADR-043). Without consent, or when consent cannot be read, they are dropped and the rest of the
   * run is stored anyway: an upload comes from the offline queue and must never fail and lose a
   * finished run. Estimated calories follow the same rule, so the server holds no health figure the
   * person did not allow. Consent is not even read when the run carries no such figure.
   */
  private async resolveRun(
    userId: string,
    run: WorkoutSessionUploadRequest["run"],
  ): Promise<CreateRunSummaryInput | null> {
    if (!run) return null;

    const carriesHealthFigures =
      run.avgHeartRateBpm !== null ||
      run.caloriesKcal !== null ||
      run.splits.some((split) => split.avgHeartRateBpm !== null);
    if (!carriesHealthFigures) return { ...run, splits: run.splits.map((split) => ({ ...split })) };

    let allowed = false;
    try {
      allowed = (await this.privacyService.get(userId)).healthDataConsent;
    } catch (error) {
      this.logger.warn(
        `Could not read health-data consent for a run upload, dropping its health figures: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (allowed) return { ...run, splits: run.splits.map((split) => ({ ...split })) };

    return {
      ...run,
      avgHeartRateBpm: null,
      caloriesKcal: null,
      caloriesSource: null,
      splits: run.splits.map((split) => ({ ...split, avgHeartRateBpm: null })),
    };
  }

  /**
   * Home's stat strip, "This week" and "Recent PR" (Phase 3J-c).
   *
   * A thin pass-through by design: the arithmetic belongs in SQL, next to the data, and this
   * service's only jobs are that the aggregate is scoped to the caller's own id and that the
   * `Date`s coming back become the ISO strings `workoutStatsResponseSchema` declares.
   *
   * `now` is read here rather than inside the repository so the repository stays a pure
   * function of its arguments and its calendar boundaries remain testable.
   */
  async stats(viewer: User, query: WorkoutStatsQuery): Promise<WorkoutStatsResponse> {
    const row = await this.workoutsRepository.statsForUser(viewer.id, query.timeZone, new Date());

    return {
      totalSessions: row.totalSessions,
      sessionsThisMonth: row.sessionsThisMonth,
      weekStreak: row.weekStreak,
      thisWeek: row.thisWeek,
      recentPersonalRecord:
        row.recentPersonalRecord === null
          ? null
          : {
              ...row.recentPersonalRecord,
              achievedAt: row.recentPersonalRecord.achievedAt.toISOString(),
            },
    };
  }

  /**
   * One exercise's history for the caller (Phase 3J-d) -- the exercise-detail screen's tiles,
   * trend and History list.
   *
   * The id is shape-checked before it reaches Postgres, the same way `getById` does it: a
   * malformed uuid is refused here rather than becoming a query that errors.
   *
   * There is deliberately **no visibility check on the exercise itself**. This answers only
   * with sessions the caller performed, so an exercise they cannot see necessarily has none --
   * an empty history, which is both the truthful answer and one that leaks nothing about
   * whether the id exists.
   */
  async exerciseHistory(
    viewer: User,
    exerciseId: string,
    query: ExerciseHistoryQuery,
  ): Promise<ExerciseHistoryResponse> {
    if (!UUID_PATTERN.test(exerciseId)) {
      throw this.refuse();
    }

    const row = await this.workoutsRepository.exerciseHistoryForUser(
      viewer.id,
      exerciseId,
      query.limit,
    );

    return {
      bestSet:
        row.bestSet === null
          ? null
          : { ...row.bestSet, achievedAt: row.bestSet.achievedAt.toISOString() },
      estimatedOneRepMaxKg: row.estimatedOneRepMaxKg,
      sessions: row.sessions.map((session) => ({
        ...session,
        performedAt: session.performedAt.toISOString(),
      })),
    };
  }

  async getById(viewer: User, id: string): Promise<WorkoutSessionResponse> {
    if (!UUID_PATTERN.test(id)) {
      throw this.refuse();
    }

    const found = await this.workoutsRepository.findSessionByIdForUser(id, viewer.id);
    if (!found) {
      throw this.refuse();
    }

    return this.toDetail(found);
  }

  async list(viewer: User, query: WorkoutSessionListQuery): Promise<WorkoutSessionListResponse> {
    const after = query.cursor ? decodeWorkoutSessionCursor(query.cursor) : undefined;

    if (query.cursor && !after) {
      throw new BadRequestException("Invalid cursor");
    }

    const page = await this.workoutsRepository.listSessionsForUser({
      userId: viewer.id,
      after: after ?? undefined,
      limit: query.limit,
    });

    const last = page.rows[page.rows.length - 1];

    return {
      items: page.rows.map((row) => this.toSummary(row)),
      nextCursor:
        page.hasMore && last
          ? encodeWorkoutSessionCursor({ startedAt: last.startedAt.toISOString(), id: last.id })
          : null,
    };
  }

  private toRepositoryInput(
    userId: string,
    body: WorkoutSessionUploadRequest,
    visibleExercises: Map<string, { measure: CreateWorkoutSessionExerciseInput["measure"] }>,
    city: string | null,
    citySlug: string | null,
    run: CreateRunSummaryInput | null,
  ): CreateWorkoutSessionInput {
    return {
      id: body.id,
      userId,
      templateId: body.templateId ?? null,
      name: body.name,
      activity: body.activity,
      status: body.status,
      startedAt: new Date(body.startedAt),
      endedAt: body.endedAt ? new Date(body.endedAt) : null,
      durationSeconds: body.durationSeconds,
      perceivedEffort: body.perceivedEffort ?? null,
      notes: body.notes ?? null,
      city,
      citySlug,
      isLiveTracked: body.isLiveTracked,
      run,
      exercises: body.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        // Never absent here -- `upload` already rejected any id not present in this map.
        measure: visibleExercises.get(exercise.exerciseId)!.measure,
        notes: exercise.notes ?? null,
        sets: exercise.sets.map((set) => ({
          type: set.type,
          isCompleted: set.isCompleted,
          weightKg: set.weightKg ?? null,
          reps: set.reps ?? null,
          durationSeconds: set.durationSeconds ?? null,
          distanceMeters: set.distanceMeters ?? null,
          restSeconds: set.restSeconds ?? null,
          completedAt: set.completedAt ? new Date(set.completedAt) : null,
        })),
      })),
    };
  }

  /** One refusal for every reason -- unknown id, malformed id, somebody else's session. 404, never 403. */
  private refuse(): NotFoundException {
    return new NotFoundException("Workout session not found");
  }

  private toSummary(row: WorkoutSessionSummaryRow): WorkoutSessionSummary {
    return {
      id: row.id,
      name: row.name,
      activity: row.activity,
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt ? row.endedAt.toISOString() : null,
      durationSeconds: row.durationSeconds,
      perceivedEffort: row.perceivedEffort,
    };
  }

  private toDetail(session: WorkoutSession): WorkoutSessionResponse {
    return {
      id: session.id,
      templateId: session.templateId,
      name: session.name,
      activity: session.activity,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt ? session.endedAt.toISOString() : null,
      durationSeconds: session.durationSeconds,
      perceivedEffort: session.perceivedEffort,
      notes: session.notes,
      city: session.city,
      citySlug: session.citySlug,
      isLiveTracked: session.isLiveTracked,
      exercises: session.exercises.map((exercise) => this.toExerciseResponse(exercise)),
    };
  }

  private toExerciseResponse(
    exercise: WorkoutSessionExercise,
  ): WorkoutSessionResponse["exercises"][number] {
    return {
      id: exercise.id,
      exerciseId: exercise.exerciseId,
      orderIndex: exercise.orderIndex,
      measure: exercise.measure,
      notes: exercise.notes,
      sets: exercise.sets.map((set) => this.toSetResponse(set)),
    };
  }

  private toSetResponse(set: WorkoutSet): WorkoutSessionResponse["exercises"][number]["sets"][number] {
    return {
      id: set.id,
      setIndex: set.setIndex,
      type: set.type,
      isCompleted: set.isCompleted,
      weightKg: set.weightKg,
      reps: set.reps,
      durationSeconds: set.durationSeconds,
      distanceMeters: set.distanceMeters,
      restSeconds: set.restSeconds,
      completedAt: set.completedAt ? set.completedAt.toISOString() : null,
    };
  }
}
