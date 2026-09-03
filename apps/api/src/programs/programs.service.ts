import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  ProgramEnrollment,
  ProgramEnrollmentResponse,
  ProgramListQuery,
  ProgramListResponse,
  ProgramResponse,
  ProgramSummary,
} from "@forjd/contracts";
import { User } from "@forjd/domain";

import {
  ProgramEnrollmentRow,
  ProgramSummaryRow,
  ProgramWithWorkouts,
  ProgramsRepository,
} from "./programs.repository";

/** Same pattern, same reason as `ExercisesService`: a malformed id never reaches Postgres. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Reading programs: the catalogue, one program's overview, and what the athlete is following.
 *
 * **Where the policy lives.** Visibility -- presets plus your own, narrowed by `scope` -- is
 * expressed in the repository's SQL, because deciding it here would mean fetching a row in order
 * to conclude it may not be shown. What lives here is what that shape of decision cannot express:
 * turning a `null` into a 404 rather than a 403, refusing a malformed id before it reaches the
 * database, and choosing which fields reach the wire.
 *
 * **404, never 403.** A stranger's program, a soft-deleted one and an id that never existed all
 * produce the same response, so the endpoint cannot be used to discover that a program exists and
 * belongs to somebody else. The same contract `ExercisesService` and `WorkoutsService` hold.
 */
@Injectable()
export class ProgramsService {
  constructor(private readonly programsRepository: ProgramsRepository) {}

  async list(viewer: User, query: ProgramListQuery): Promise<ProgramListResponse> {
    const rows = await this.programsRepository.listForUser({
      userId: viewer.id,
      category: query.category,
      scope: query.scope,
    });

    return { items: rows.map((row) => this.toSummary(row)) };
  }

  async getById(viewer: User, id: string): Promise<ProgramResponse> {
    if (!UUID_PATTERN.test(id)) {
      throw this.refuse();
    }

    const found = await this.programsRepository.findByIdForUser(id, viewer.id);
    if (!found) {
      throw this.refuse();
    }

    return this.toDetail(found);
  }

  /**
   * Following nothing is the ordinary state, so it is `{ enrollment: null }` and a 200 -- not a
   * 404. A client should not have to read a status code as data to draw a screen that says "you
   * are not following a program yet".
   */
  async getEnrollment(viewer: User): Promise<ProgramEnrollmentResponse> {
    const found = await this.programsRepository.findActiveEnrollment(viewer.id);
    return { enrollment: found ? this.toEnrollment(found) : null };
  }

  /**
   * `version` is deliberately absent from a list row and present on the overview. The catalogue
   * has nothing to say about it, and a field a list carries is a field a client starts depending
   * on.
   */
  private toSummary(row: ProgramSummaryRow): ProgramSummary {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category,
      level: row.level,
      daysPerWeek: row.daysPerWeek,
      durationWeeks: row.durationWeeks,
      description: row.description,
      isOwn: row.isOwn,
      workoutCount: row.workoutCount,
    };
  }

  private toDetail(row: ProgramWithWorkouts): ProgramResponse {
    return {
      ...this.toSummary(row),
      version: row.version,
      workouts: row.workouts.map((workout) => ({
        templateId: workout.templateId,
        name: workout.name,
        activity: workout.activity,
        orderIndex: workout.orderIndex,
        dayOfWeek: workout.dayOfWeek,
        exerciseNames: workout.exerciseNames,
      })),
    };
  }

  private toEnrollment(row: ProgramEnrollmentRow): ProgramEnrollment {
    return {
      id: row.id,
      programId: row.programId,
      programSlug: row.programSlug,
      programName: row.programName,
      programVersion: row.programVersion,
      startedAt: row.startedAt.toISOString(),
    };
  }

  private refuse(): NotFoundException {
    return new NotFoundException("Program not found");
  }
}
