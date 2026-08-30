import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  ExerciseListQuery,
  ExerciseListResponse,
  ExerciseResponse,
  ExerciseSummary,
} from "@forjd/contracts";
import { Exercise, User } from "@forjd/domain";

import { decodeExerciseCursor, encodeExerciseCursor } from "./exercise-cursor";
import { ExercisesRepository, ExerciseWithFavourite } from "./exercises.repository";

/** Same pattern, same reason as `AthletesService`: a malformed id never reaches Postgres. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Reading the exercise library: browse, search, and one exercise in full.
 *
 * **Where the policy lives.** Visibility ("catalogue rows plus your own") is expressed in the
 * repository's SQL, because deciding it here would mean fetching a row in order to conclude
 * it may not be shown. What lives here is everything that shape of decision cannot express:
 * turning a `null` into a 404 rather than a 403, turning an unreadable cursor into a 400, and
 * choosing which fields reach the wire. CLAUDE.md rule 12 asks for authorization in code that
 * can be unit-tested, which is why this file carries a 100% coverage pin.
 *
 * **Media.** The database stores storage keys and never URLs (ADR-018). Resolving them here,
 * against a configured base, is what makes replacing the stopgap imagery a config change
 * rather than a migration and a contract break.
 */
@Injectable()
export class ExercisesService {
  constructor(
    private readonly exercisesRepository: ExercisesRepository,
    private readonly config: ConfigService,
  ) {}

  async list(viewer: User, query: ExerciseListQuery): Promise<ExerciseListResponse> {
    const after = query.cursor ? decodeExerciseCursor(query.cursor) : undefined;

    // A cursor the server did not mint is a client bug, and it is told so. Ignoring it and
    // starting from the top would look to a paging loop like a page of new results, and the
    // loop would never terminate.
    if (query.cursor && !after) {
      throw new BadRequestException("Invalid cursor");
    }

    const page = await this.exercisesRepository.listExercises({
      userId: viewer.id,
      q: query.q,
      category: query.category,
      muscle: query.muscle,
      equipment: query.equipment,
      // `favourite: false` means "no filter", not "things I have not starred" -- the contract
      // has an explicit note about why that value survives as `false` rather than `undefined`.
      favouriteOnly: query.favourite === true,
      after: after ?? undefined,
      limit: query.limit,
    });

    const last = page.rows[page.rows.length - 1];

    return {
      items: page.rows.map((row) => this.toSummary(row)),
      // Only when another row actually matched. Minting a cursor on a full-but-final page
      // would cost every client one extra empty request at the end of every list.
      nextCursor:
        page.hasMore && last
          ? encodeExerciseCursor({ name: last.exercise.name, id: last.exercise.id })
          : null,
    };
  }

  async getById(viewer: User, id: string): Promise<ExerciseResponse> {
    if (!UUID_PATTERN.test(id)) {
      throw this.refuse();
    }

    const found = await this.exercisesRepository.findByIdForUser(id, viewer.id);
    if (!found) {
      throw this.refuse();
    }

    return this.toDetail(found);
  }

  /**
   * One refusal for every reason -- unknown id, malformed id, somebody else's custom
   * exercise. **404, never 403**, matching `AthletesService`: a 403 would confirm that an id
   * names a real exercise the caller may not see, turning the endpoint into an oracle for
   * enumerating other people's private content. The message is identical in every case,
   * because a difference in wording is a difference an attacker can read.
   */
  private refuse(): NotFoundException {
    return new NotFoundException("Exercise not found");
  }

  /**
   * Every field named explicitly, no spread and no `Pick` -- the `publicProfileResponseSchema`
   * reasoning. A projection derived from the row would make "add a column" and "publish a
   * column" the same action; here it would leak `ownerUserId` and `sourceId` into a 100-row
   * list response the first time somebody added a column to the table.
   */
  private toSummary({ exercise, isFavourite }: ExerciseWithFavourite): ExerciseSummary {
    const [firstKey] = exercise.imageKeys;

    return {
      id: exercise.id,
      name: exercise.name,
      slug: exercise.slug,
      category: exercise.category,
      measure: exercise.measure,
      primaryMuscles: exercise.primaryMuscles,
      equipment: exercise.equipment,
      imageUrl: firstKey ? this.resolveMedia(firstKey) : null,
      isCustom: exercise.ownerUserId !== null,
      isFavourite,
    };
  }

  private toDetail({ exercise, isFavourite }: ExerciseWithFavourite): ExerciseResponse {
    return {
      id: exercise.id,
      name: exercise.name,
      slug: exercise.slug,
      category: exercise.category,
      goal: exercise.goal,
      measure: exercise.measure,
      primaryMuscles: exercise.primaryMuscles,
      secondaryMuscles: exercise.secondaryMuscles,
      equipment: exercise.equipment,
      force: exercise.force,
      level: exercise.level,
      mechanic: exercise.mechanic,
      instructions: exercise.instructions,
      imageUrls: this.resolveAllMedia(exercise),
      description: exercise.description,
      isCustom: exercise.ownerUserId !== null,
      isFavourite,
    };
  }

  private resolveAllMedia(exercise: Exercise): string[] {
    return exercise.imageKeys
      .map((key) => this.resolveMedia(key))
      .filter((url): url is string => url !== null);
  }

  /**
   * Returns `null` until Phase F mirrors the media and sets `EXERCISE_MEDIA_BASE_URL`.
   *
   * Null rather than a relative path or a half-built URL: a client cannot tell "not
   * configured yet" from "404", so it would render a broken image placeholder in every row of
   * the library. An absent image is a state the design already draws (custom exercises have
   * none); a broken one is not.
   *
   * Each path segment is escaped individually, which leaves `/` as the separator and encodes
   * anything else. No key in today's dataset needs it -- they are all
   * `Some_Exercise_Name/0.jpg` -- but a future source's key with a space or a `?` in it would
   * otherwise produce a URL that silently means something different.
   */
  private resolveMedia(key: string): string | null {
    const base = this.config.get<string>("EXERCISE_MEDIA_BASE_URL");
    if (!base) {
      return null;
    }

    const path = key.split("/").map(encodeURIComponent).join("/");

    return `${base.replace(/\/+$/, "")}/${path}`;
  }
}
