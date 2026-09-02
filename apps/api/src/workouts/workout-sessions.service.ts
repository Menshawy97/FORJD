import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  WorkoutSessionListQuery,
  WorkoutSessionListResponse,
  WorkoutSessionResponse,
  WorkoutSessionSummary,
  WorkoutSessionUploadRequest,
} from "@forjd/contracts";
import { User, WorkoutSession, WorkoutSessionExercise, WorkoutSet } from "@forjd/domain";

import { ExercisesRepository } from "../exercises/exercises.repository";
import { decodeWorkoutSessionCursor, encodeWorkoutSessionCursor } from "./workout-cursor";
import {
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
  constructor(
    private readonly workoutsRepository: WorkoutsRepository,
    private readonly exercisesRepository: ExercisesRepository,
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

    const input = this.toRepositoryInput(owner.id, body, visibleExercises);
    const session = await this.workoutsRepository.upsertSession(input);

    return this.toDetail(session);
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
      city: body.city ?? null,
      citySlug: body.citySlug ?? null,
      isLiveTracked: body.isLiveTracked,
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
