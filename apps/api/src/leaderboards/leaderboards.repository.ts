import { Inject, Injectable } from '@nestjs/common';
import { ACTIVITY_SESSION_CAP_SECONDS } from '@forjd/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { Database, DRIZZLE } from '../database/database.module';
import { executeValidated } from '../database/db-utils';

/**
 * One Zod schema per raw-SQL call site (R24), mirroring that query's own `select` list, so a
 * silently renamed or retyped column fails loudly through `executeValidated` instead of flowing
 * into the scoring arithmetic as `undefined`.
 */
export const cityAthleteRowSchema = z.object({
  user_id: z.string(),
  first_started_at: z.coerce.date(),
  working_seconds: z.number(),
  volume_kg: z.number(),
  distance_km: z.number(),
  strength_days: z.number(),
  display_name: z.string().nullable(),
  username: z.string().nullable(),
  avatar_url: z.string().nullable(),
  public_profile: z.boolean(),
});

export const currentMemberRowSchema = z.object({
  user_id: z.string(),
  display_name: z.string().nullable(),
  username: z.string().nullable(),
  avatar_url: z.string().nullable(),
  public_profile: z.boolean(),
});

export const latestCityRowSchema = z.object({
  city_slug: z.string(),
  city: z.string().nullable(),
});

/** How an athlete is shown on a board: read live, never from a reused board. */
export interface BoardIdentity {
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  isPublicProfile: boolean;
}

/** One athlete's raw totals over a window, before any scoring. */
export interface CityAthleteRow {
  userId: string;
  /** The earliest eligible session in the window, for the tie-break. */
  firstStartedAt: Date;
  /** Each session capped at `ACTIVITY_SESSION_CAP_SECONDS`, then summed. */
  workingSeconds: number;
  /** Weight x reps over completed sets with both, in kilograms. Matches the Progress tab's figure. */
  volumeKg: number;
  distanceKm: number;
  /** Distinct days, in the city's own calendar, with at least one completed weighted set. */
  strengthDays: number;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  isPublicProfile: boolean;
}

/**
 * The reads behind a city leaderboard (Phase 10, ADR-046, ADR-047). Standings are **computed on
 * read**: the query is bounded to one city over one window by the partial index from migration
 * 0020, and eligibility is decided inside it, by joining the athlete's privacy settings live, so a
 * withdrawal is true on the very next request. The service reuses these totals for a few seconds,
 * but never who is on the board or how they are shown: `currentMembers` reads that live every time.
 *
 * A session counts only if all of this holds, and this one predicate is the rule (ADR-044):
 * not deleted, completed, ended, run through the live runner, in this city, inside the window,
 * and by an athlete who has joined leaderboards and allowed location right now.
 *
 * Ranking and scoring are not here. They need the whole city's totals, and they live in
 * `@forjd/domain` as pure functions; this returns the raw numbers.
 */
@Injectable()
export class LeaderboardsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Every athlete with at least one eligible session in `citySlug` inside `window` (null for all
   * time), with their totals. `timeZone` is the city's, and dates a session by the city's calendar.
   */
  async cityAthletes(
    citySlug: string,
    timeZone: string,
    window: { start: Date; end: Date } | null,
  ): Promise<CityAthleteRow[]> {
    const windowClause = window
      ? sql`and ws.started_at >= ${window.start.toISOString()}::timestamptz and ws.started_at < ${window.end.toISOString()}::timestamptz`
      : sql``;

    const rows = await executeValidated(
      this.db,
      sql`
      with eligible as (
        select
          ws.id,
          ws.user_id,
          ws.started_at,
          least(ws.duration_seconds, ${ACTIVITY_SESSION_CAP_SECONDS})::int as capped_seconds,
          (ws.started_at at time zone ${timeZone})::date as local_date
        from workout_sessions ws
        join privacy_settings ps on ps.user_id = ws.user_id
        where ws.city_slug = ${citySlug}
          and ws.deleted_at is null
          and ws.status = 'completed'
          and ws.is_live_tracked = true
          and ws.ended_at is not null
          and ps.leaderboard_opt_in = true
          and ps.location_for_leaderboard = true
          ${windowClause}
      ), per_session as (
        select
          e.id as session_id,
          coalesce(sum(case when wset.weight_kg is not null and wset.reps is not null then wset.weight_kg * wset.reps end), 0) as volume_kg,
          coalesce(sum(wset.distance_meters), 0) / 1000 as distance_km,
          coalesce(bool_or(wset.weight_kg > 0), false) as has_weighted
        from eligible e
        left join workout_session_exercises wse on wse.session_id = e.id
        left join workout_sets wset on wset.session_exercise_id = wse.id and wset.is_completed = true
        group by e.id
      )
      select
        e.user_id,
        min(e.started_at) as first_started_at,
        sum(e.capped_seconds)::float8 as working_seconds,
        coalesce(sum(p.volume_kg), 0)::float8 as volume_kg,
        coalesce(sum(p.distance_km), 0)::float8 as distance_km,
        (count(distinct e.local_date) filter (where p.has_weighted))::int as strength_days,
        pr.display_name,
        pr.username,
        pr.avatar_url,
        ps.public_profile
      from eligible e
      join per_session p on p.session_id = e.id
      join privacy_settings ps on ps.user_id = e.user_id
      left join profiles pr on pr.user_id = e.user_id
      group by e.user_id, pr.display_name, pr.username, pr.avatar_url, ps.public_profile
      `,
      cityAthleteRowSchema,
      'LeaderboardsRepository.cityAthletes',
    );

    return rows.map((row) => ({
      userId: row.user_id,
      firstStartedAt: row.first_started_at,
      workingSeconds: row.working_seconds,
      volumeKg: row.volume_kg,
      distanceKm: row.distance_km,
      strengthDays: row.strength_days,
      displayName: row.display_name,
      username: row.username,
      avatarUrl: row.avatar_url,
      isPublicProfile: row.public_profile,
    }));
  }

  /**
   * Which of `userIds` are on the leaderboard right now, with how they are shown right now. The
   * service reuses a computed board's totals for a few seconds, and calls this on every request, so
   * a withdrawal, a rename or a switch to private is still true on the very next request (ADR-047).
   * A lookup by id, cheap next to recomputing the city's totals.
   */
  async currentMembers(userIds: readonly string[]): Promise<Map<string, BoardIdentity>> {
    if (userIds.length === 0) return new Map();
    const ids = sql.join(
      userIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const rows = await executeValidated(
      this.db,
      sql`
      select ps.user_id, pr.display_name, pr.username, pr.avatar_url, ps.public_profile
      from privacy_settings ps
      left join profiles pr on pr.user_id = ps.user_id
      where ps.user_id in (${ids})
        and ps.leaderboard_opt_in = true
        and ps.location_for_leaderboard = true
      `,
      currentMemberRowSchema,
      'LeaderboardsRepository.currentMembers',
    );
    return new Map(
      rows.map((row) => [
        row.user_id,
        { displayName: row.display_name, username: row.username, avatarUrl: row.avatar_url, isPublicProfile: row.public_profile },
      ]),
    );
  }

  /**
   * The city of the athlete's most recent session that could count, whichever window it was in.
   * Read from the sessions and not from the profile, which is volunteered and unvalidated: this is
   * what makes "the leaderboard does not follow you when you relocate" true by construction. It
   * does not look at consent; the service does, live.
   */
  async latestEligibleCity(userId: string): Promise<{ citySlug: string; city: string | null } | null> {
    const rows = await executeValidated(
      this.db,
      sql`
      select ws.city_slug, ws.city
      from workout_sessions ws
      where ws.user_id = ${userId}::uuid
        and ws.deleted_at is null
        and ws.status = 'completed'
        and ws.is_live_tracked = true
        and ws.ended_at is not null
        and ws.city_slug is not null
      order by ws.started_at desc
      limit 1
      `,
      latestCityRowSchema,
      'LeaderboardsRepository.latestEligibleCity',
    );
    const row = rows[0];
    return row ? { citySlug: row.city_slug, city: row.city } : null;
  }
}
