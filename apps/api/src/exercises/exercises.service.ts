import { createHash } from "crypto";

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  CreateExerciseRequest,
  ExerciseCatalogueResponse,
  ExerciseListQuery,
  ExerciseListResponse,
  ExerciseResponse,
  ExerciseSummary,
  UpdateExerciseRequest,
} from "@forjd/contracts";
import { Exercise, ExerciseGoal, ExerciseMeasure, User } from "@forjd/domain";

import { decodeExerciseCursor, encodeExerciseCursor } from "./exercise-cursor";
import {
  ExercisesRepository,
  ExerciseWithFavourite,
  UpdateCustomExerciseInput,
} from "./exercises.repository";

/** Same pattern, same reason as `AthletesService`: a malformed id never reaches Postgres. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * "Derived, not chosen" (`docs/design/phase2-screen-specs.md` §6.1): the create/edit screen
 * never lets a user pick a goal, it computes one from `measure` alone. Kept server-side,
 * not trusted from the wire, so `createExerciseRequestSchema` carries no `goal` field at all
 * -- see that schema's own comment for why accepting one would be worse than deriving it
 * twice.
 */
function deriveGoal(measure: ExerciseMeasure): ExerciseGoal {
  return measure === "weight" ? "hypertrophy" : "muscular_endurance";
}

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

  /**
   * The whole visible set, unpaginated, for the on-device store (Phase H) to mirror into
   * SQLite. Full `toDetail` rows, not `toSummary` -- offline workout execution needs
   * everything a detail screen would show, not just a list row's worth (CLAUDE.md rule 6:
   * the network is never in the critical path of a live session).
   *
   * **`catalogueVersion` deliberately ignores `isFavourite`.** Hashing it in would force a
   * full re-sync of ~1,700+ rows on every star tap, for state that changes far more often
   * than the exercise data itself. The mobile store is expected to write a favourite toggle
   * into its own local mirror immediately after `PUT`/`DELETE .../favourite` succeeds,
   * independently of this endpoint -- the two are different frequencies of change and do not
   * need one invalidation signal.
   */
  async getCatalogue(viewer: User): Promise<ExerciseCatalogueResponse> {
    const rows = await this.exercisesRepository.listForSync(viewer.id);

    return {
      exercises: rows.map((row) => this.toDetail(row)),
      catalogueVersion: this.deriveCatalogueVersion(rows),
    };
  }

  /**
   * A content hash, not a counter or a bare `MAX(updatedAt)`: a counter needs somewhere to
   * live and something to remember to bump, and a timestamp alone misses a soft-delete --
   * removing a row from the visible set changes nothing about any *surviving* row's
   * `updatedAt`. Hashing every row's `id:updatedAt` in the repository's stable `(name, id)`
   * order changes the digest for an add, an edit, or a delete alike, and for nothing else.
   */
  private deriveCatalogueVersion(rows: ExerciseWithFavourite[]): string {
    const hash = createHash("sha256");
    for (const { exercise } of rows) {
      hash.update(`${exercise.id}:${exercise.updatedAt.toISOString()}`);
    }
    return hash.digest("hex");
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
   * A freshly created exercise cannot be favourited yet -- there is no request race where it
   * could be, since the row does not exist until this call returns -- so `isFavourite: false`
   * is asserted rather than queried, and this is the one place in the file that skips
   * `findByIdForUser`.
   */
  async create(owner: User, body: CreateExerciseRequest): Promise<ExerciseResponse> {
    const created = await this.exercisesRepository.createCustomExercise(owner.id, {
      name: body.name,
      category: body.category,
      goal: deriveGoal(body.measure),
      measure: body.measure,
      primaryMuscles: body.primaryMuscles,
      equipment: body.equipment,
      description: body.description ?? null,
    });

    return this.toDetail({ exercise: created, isFavourite: false });
  }

  /**
   * Ownership is enforced in the repository's `WHERE` clause (`id`, `ownerUserId`,
   * `deletedAt IS NULL` together), not just here (rule 12's "not only in SQL" cuts both
   * ways -- SQL alone is not enough, but skipping it and trusting only application code
   * would leave the constraint unverifiable by a query plan). A `null` back from the
   * repository covers three different reasons -- no such id, someone else's exercise, a
   * catalogue row with no owner at all -- and `refuse()` deliberately does not distinguish
   * them, same reasoning as `getById`.
   */
  async update(owner: User, id: string, patch: UpdateExerciseRequest): Promise<ExerciseResponse> {
    if (!UUID_PATTERN.test(id)) {
      throw this.refuse();
    }

    const repositoryPatch: UpdateCustomExerciseInput = {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.category !== undefined && { category: patch.category }),
      // Goal tracks measure, not the other way around: if measure is not part of this patch,
      // the existing goal is left untouched rather than re-derived from the unchanged value.
      ...(patch.measure !== undefined && { measure: patch.measure, goal: deriveGoal(patch.measure) }),
      ...(patch.primaryMuscles !== undefined && { primaryMuscles: patch.primaryMuscles }),
      ...(patch.equipment !== undefined && { equipment: patch.equipment }),
      ...(patch.description !== undefined && { description: patch.description ?? null }),
    };

    const updated = await this.exercisesRepository.updateCustomExercise(id, owner.id, repositoryPatch);
    if (!updated) {
      throw this.refuse();
    }

    const isFavourite = await this.exercisesRepository.isFavourite(owner.id, id);
    return this.toDetail({ exercise: updated, isFavourite });
  }

  /** Soft delete, so nothing 404s that a live workout session still references (ADR-017). */
  async delete(owner: User, id: string): Promise<void> {
    if (!UUID_PATTERN.test(id)) {
      throw this.refuse();
    }

    const deleted = await this.exercisesRepository.softDeleteCustomExercise(id, owner.id);
    if (!deleted) {
      throw this.refuse();
    }
  }

  /**
   * Favouriting is not ownership -- any visible exercise, catalogue or someone else's is not
   * even reachable, can be starred, not just the caller's own. `findByIdForUser` is the
   * existence-and-visibility check `getById` already relies on; skipping it and calling
   * straight into `addFavourite`/`removeFavourite` would let a bogus id reach the
   * `exercise_favourites` foreign key and surface as a raw 500, not the clean 404 every other
   * bad-id path in this file returns.
   */
  async setFavourite(viewer: User, id: string, favourite: boolean): Promise<void> {
    if (!UUID_PATTERN.test(id)) {
      throw this.refuse();
    }

    const found = await this.exercisesRepository.findByIdForUser(id, viewer.id);
    if (!found) {
      throw this.refuse();
    }

    if (favourite) {
      await this.exercisesRepository.addFavourite(viewer.id, id);
    } else {
      await this.exercisesRepository.removeFavourite(viewer.id, id);
    }
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
