import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateWorkoutTemplateRequest,
  UpdateWorkoutTemplateRequest,
  WorkoutBlockResponse,
  WorkoutExerciseResponse,
  WorkoutTemplateListQuery,
  WorkoutTemplateListResponse,
  WorkoutTemplateResponse,
  WorkoutTemplateSummary,
} from "@forjd/contracts";
import { User, WorkoutBlock, WorkoutExercise, WorkoutTemplate } from "@forjd/domain";

import { ExercisesRepository } from "../exercises/exercises.repository";
import { decodeWorkoutTemplateCursor, encodeWorkoutTemplateCursor } from "./workout-cursor";
import {
  CreateWorkoutBlockInput,
  CreateWorkoutTemplateInput,
  UpdateWorkoutTemplateInput,
  WorkoutTemplateSummaryRow,
  WorkoutsRepository,
} from "./workouts.repository";

/** Same pattern, same reason as `ExercisesService`: a malformed id never reaches Postgres. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The template half of the workout engine -- CRUD for `WorkoutTemplate` (Phase D). The
 * session half (Phase E) is a separate service in this module, mirroring how
 * `NutritionService` covers several tables under one class while `ExercisesService` covers
 * one -- workouts genuinely has two independent aggregates (template, session), not six
 * variations on one.
 *
 * Same division of responsibility as `ExercisesService`: visibility lives in the repository's
 * `WHERE` clause, this file turns a `null` into a 404 (never a 403), an unreadable cursor into
 * a 400, and an unknown/invisible referenced exercise into a 400 the caller can act on.
 */
@Injectable()
export class WorkoutsService {
  constructor(
    private readonly workoutsRepository: WorkoutsRepository,
    private readonly exercisesRepository: ExercisesRepository,
  ) {}

  async list(viewer: User, query: WorkoutTemplateListQuery): Promise<WorkoutTemplateListResponse> {
    const after = query.cursor ? decodeWorkoutTemplateCursor(query.cursor) : undefined;

    if (query.cursor && !after) {
      throw new BadRequestException("Invalid cursor");
    }

    const page = await this.workoutsRepository.listForUser({
      userId: viewer.id,
      after: after ?? undefined,
      limit: query.limit,
    });

    const last = page.rows[page.rows.length - 1];

    return {
      items: page.rows.map((row) => this.toSummary(row)),
      nextCursor:
        page.hasMore && last
          ? encodeWorkoutTemplateCursor({ name: last.name, id: last.id })
          : null,
    };
  }

  async getById(viewer: User, id: string): Promise<WorkoutTemplateResponse> {
    if (!UUID_PATTERN.test(id)) {
      throw this.refuse();
    }

    const found = await this.workoutsRepository.findByIdForUser(id, viewer.id);
    if (!found) {
      throw this.refuse();
    }

    return this.toDetail(found);
  }

  async create(owner: User, body: CreateWorkoutTemplateRequest): Promise<WorkoutTemplateResponse> {
    await this.assertExercisesVisible(owner, body.blocks);

    const created = await this.workoutsRepository.createTemplate(owner.id, this.toRepositoryInput(body));

    return this.toDetail(created);
  }

  async update(
    owner: User,
    id: string,
    patch: UpdateWorkoutTemplateRequest,
  ): Promise<WorkoutTemplateResponse> {
    if (!UUID_PATTERN.test(id)) {
      throw this.refuse();
    }

    if (patch.blocks) {
      await this.assertExercisesVisible(owner, patch.blocks);
    }

    const repositoryPatch: UpdateWorkoutTemplateInput = {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.activity !== undefined && { activity: patch.activity }),
      ...(patch.notes !== undefined && { notes: patch.notes }),
      ...(patch.estimatedDurationMinutes !== undefined && {
        estimatedDurationMinutes: patch.estimatedDurationMinutes,
      }),
      ...(patch.blocks !== undefined && { blocks: this.toRepositoryBlocks(patch.blocks) }),
    };

    const updated = await this.workoutsRepository.updateTemplate(id, owner.id, repositoryPatch);
    if (!updated) {
      throw this.refuse();
    }

    return this.toDetail(updated);
  }

  /** Soft delete, so a session that referenced this template is never orphaned. */
  async delete(owner: User, id: string): Promise<void> {
    if (!UUID_PATTERN.test(id)) {
      throw this.refuse();
    }

    const deleted = await this.workoutsRepository.softDeleteTemplate(id, owner.id);
    if (!deleted) {
      throw this.refuse();
    }
  }

  /**
   * Every referenced `exerciseId` must exist and be visible to the caller -- catalogue or
   * their own custom exercise, never someone else's private one, never a soft-deleted row.
   * One bulk query for the whole set of ids across every block, not a lookup per exercise
   * (`ExercisesRepository.findVisibleIds`'s own docblock explains why).
   *
   * A `BadRequestException`, not a 404: the problem is a field in the request body, not the
   * URL's own resource, the same distinction `list`'s invalid-cursor check draws.
   */
  private async assertExercisesVisible(
    viewer: User,
    blocks: ReadonlyArray<{ exercises: ReadonlyArray<{ exerciseId: string }> }>,
  ): Promise<void> {
    const ids = [...new Set(blocks.flatMap((block) => block.exercises.map((ex) => ex.exerciseId)))];
    if (ids.length === 0) {
      return;
    }

    const visible = await this.exercisesRepository.findVisibleIds(ids, viewer.id);
    const missing = ids.filter((id) => !visible.has(id));

    if (missing.length > 0) {
      throw new BadRequestException(`Unknown exercise id(s): ${missing.join(", ")}`);
    }
  }

  private toRepositoryInput(body: CreateWorkoutTemplateRequest): CreateWorkoutTemplateInput {
    return {
      name: body.name,
      activity: body.activity,
      notes: body.notes ?? null,
      estimatedDurationMinutes: body.estimatedDurationMinutes ?? null,
      blocks: this.toRepositoryBlocks(body.blocks),
    };
  }

  private toRepositoryBlocks(
    blocks: CreateWorkoutTemplateRequest["blocks"],
  ): CreateWorkoutBlockInput[] {
    return blocks.map((block) => ({
      type: block.type,
      name: block.name ?? null,
      rounds: block.rounds ?? null,
      workSeconds: block.workSeconds ?? null,
      restSeconds: block.restSeconds ?? null,
      capSeconds: block.capSeconds ?? null,
      exercises: block.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        setCount: exercise.setCount ?? null,
        targetReps: exercise.targetReps ?? null,
        targetRepsMax: exercise.targetRepsMax ?? null,
        targetWeightKg: exercise.targetWeightKg ?? null,
        targetSeconds: exercise.targetSeconds ?? null,
        targetDistanceMeters: exercise.targetDistanceMeters ?? null,
        restSeconds: exercise.restSeconds ?? null,
        notes: exercise.notes ?? null,
      })),
    }));
  }

  /**
   * One refusal for every reason -- unknown id, malformed id, somebody else's template, a
   * curated template nobody may edit directly. **404, never 403**, matching
   * `ExercisesService.refuse`.
   */
  private refuse(): NotFoundException {
    return new NotFoundException("Workout template not found");
  }

  private toSummary(row: WorkoutTemplateSummaryRow): WorkoutTemplateSummary {
    return {
      id: row.id,
      name: row.name,
      activity: row.activity,
      estimatedDurationMinutes: row.estimatedDurationMinutes,
      exerciseCount: row.exerciseCount,
      isCustom: row.ownerUserId !== null,
    };
  }

  private toDetail(template: WorkoutTemplate): WorkoutTemplateResponse {
    return {
      id: template.id,
      name: template.name,
      activity: template.activity,
      basedOnTemplateId: template.basedOnTemplateId,
      notes: template.notes,
      estimatedDurationMinutes: template.estimatedDurationMinutes,
      isCustom: template.ownerUserId !== null,
      blocks: template.blocks.map((block) => this.toBlockResponse(block)),
    };
  }

  private toBlockResponse(block: WorkoutBlock): WorkoutBlockResponse {
    return {
      id: block.id,
      type: block.type,
      orderIndex: block.orderIndex,
      name: block.name,
      rounds: block.rounds,
      workSeconds: block.workSeconds,
      restSeconds: block.restSeconds,
      capSeconds: block.capSeconds,
      exercises: block.exercises.map((exercise) => this.toExerciseResponse(exercise)),
    };
  }

  private toExerciseResponse(exercise: WorkoutExercise): WorkoutExerciseResponse {
    return {
      id: exercise.id,
      exerciseId: exercise.exerciseId,
      orderIndex: exercise.orderIndex,
      setCount: exercise.setCount,
      targetReps: exercise.targetReps,
      targetRepsMax: exercise.targetRepsMax,
      targetWeightKg: exercise.targetWeightKg,
      targetSeconds: exercise.targetSeconds,
      targetDistanceMeters: exercise.targetDistanceMeters,
      restSeconds: exercise.restSeconds,
      notes: exercise.notes,
    };
  }
}
