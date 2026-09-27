import {
  FORGE_BANDS,
  FORGE_CELEBRATIONS,
  FORGE_LADDER_IS_PUBLIC,
  FORGE_LADDER_UNITS,
  FORGE_LADDERS,
  FORGE_OUTCOMES,
  FORGE_REWARD_TYPES,
  isValidTimeZone,
} from '@forjd/domain';
import { z } from 'zod';

// ---------------------------------------------------------------------------------------------
// Weekly Forge (ADR-057). @forjd/domain's tuples are the source of truth for the closed sets; this
// file builds z.enum(...) from them. Every route returns 404 while the `weekly_forge` flag is off.
// ---------------------------------------------------------------------------------------------

export const forgeLadderSchema = z.enum(FORGE_LADDERS);
export const forgeBandSchema = z.enum(FORGE_BANDS);
export const forgeOutcomeSchema = z.enum(FORGE_OUTCOMES);
export const forgeCelebrationSchema = z.enum(FORGE_CELEBRATIONS);
export const forgeRewardTypeSchema = z.enum(FORGE_REWARD_TYPES);
const FORGE_UNITS = [...new Set(Object.values(FORGE_LADDER_UNITS))] as [string, ...string[]];

/** A Saturday week label, `YYYY-MM-DD`. */
const weekStartSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'weekStart must be YYYY-MM-DD');

/** One ladder on the Weekly Forge card: where the athlete is and how this week is going. */
export const forgeLadderProgressSchema = z.object({
  ladder: forgeLadderSchema,
  unit: z.enum(FORGE_UNITS),
  band: forgeBandSchema,
  level: z.number().int().min(1),
  maxLevel: z.number().int().min(1),
  /** This week's target, set by the current level. */
  target: z.number().min(0),
  /** This week's total so far, from what the server has received. */
  total: z.number().min(0),
  /** `total / target`, capped at 1. */
  progress: z.number().min(0).max(1),
  missStreak: z.number().int().min(0),
  forgedStreak: z.number().int().min(0),
  bestForgedStreak: z.number().int().min(0),
  /** Every band the athlete has entered on this ladder (a band badge earned). */
  badges: z.array(forgeBandSchema),
});
export type ForgeLadderProgress = z.infer<typeof forgeLadderProgressSchema>;

/**
 * `GET /api/v1/forge`: the current week on every ladder. Reading it enrols the athlete (Ore 1) the
 * first time, and first evaluates any closed week not yet evaluated, so the answer is never stale.
 */
export const forgeResponseSchema = z.object({
  weekStart: weekStartSchema,
  /** Days left in the week, counting today: 7 on Saturday, 1 on Friday. */
  daysLeft: z.number().int().min(1).max(7),
  timeZone: z.string(),
  ladders: z.array(forgeLadderProgressSchema),
});
export type ForgeResponse = z.infer<typeof forgeResponseSchema>;

export const forgeRewardSchema = z.object({
  type: forgeRewardTypeSchema,
  level: z.number().int().min(1),
  band: forgeBandSchema,
});

export const forgeWeekLadderSchema = z.object({
  ladder: forgeLadderSchema,
  outcome: forgeOutcomeSchema,
  levelBefore: z.number().int().min(1),
  levelAfter: z.number().int().min(1),
  bandBefore: forgeBandSchema,
  bandAfter: forgeBandSchema,
  total: z.number().min(0),
  target: z.number().min(0),
  celebration: forgeCelebrationSchema,
  rewards: z.array(forgeRewardSchema),
});

/** One closed week, summarised for the week-close summary screen: every ladder at once. */
export const forgeWeekSummarySchema = z.object({
  weekStart: weekStartSchema,
  /** The one celebration to play before the summary (`none` plays nothing). */
  biggest: forgeCelebrationSchema,
  biggestLadder: forgeLadderSchema.nullable(),
  /** Whether that celebration may offer a share card. Never for Nourish. */
  shareable: z.boolean(),
  levelsGained: z.number().int().min(0),
  marksEarned: z.number().int().min(0),
  ladders: z.array(forgeWeekLadderSchema),
});
export type ForgeWeekSummary = z.infer<typeof forgeWeekSummarySchema>;

/** `GET /api/v1/forge/weeks/pending`: closed weeks the athlete has not seen yet, oldest first. */
export const forgePendingWeeksResponseSchema = z.object({ weeks: z.array(forgeWeekSummarySchema) });
export type ForgePendingWeeksResponse = z.infer<typeof forgePendingWeeksResponseSchema>;

/** `POST /api/v1/forge/weeks/:weekStart/ack`: marks one closed week as seen. 204. */
export const forgeWeekParamsSchema = z.object({ weekStart: weekStartSchema });
export type ForgeWeekParams = z.infer<typeof forgeWeekParamsSchema>;

const PUBLIC_FORGE_LADDERS = FORGE_LADDERS.filter((ladder) => FORGE_LADDER_IS_PUBLIC[ladder]) as [
  (typeof FORGE_LADDERS)[number],
  ...(typeof FORGE_LADDERS)[number][],
];

/**
 * The Forge block on the public athlete profile (ADR-057 decision 8): bands, levels, badges and
 * Forged status for the public ladders only. **Nourish is not representable here.**
 */
export const publicForgeSchema = z.object({
  ladders: z.array(
    z.object({
      ladder: z.enum(PUBLIC_FORGE_LADDERS),
      band: forgeBandSchema,
      level: z.number().int().min(1),
      forgedStreak: z.number().int().min(0),
      bestForgedStreak: z.number().int().min(0),
      badges: z.array(forgeBandSchema),
    }),
  ),
});
export type PublicForge = z.infer<typeof publicForgeSchema>;

/** `PUT /api/v1/users/me/timezone`: the phone's IANA zone, which closes the athlete's Forge weeks. */
export const timeZoneUpdateRequestSchema = z.object({
  timeZone: z.string().refine(isValidTimeZone, 'timeZone must be an IANA time zone'),
});
export type TimeZoneUpdateRequest = z.infer<typeof timeZoneUpdateRequestSchema>;

/** `GET /api/v1/feature-flags`: the keys of every flag that is switched on. */
export const featureFlagsResponseSchema = z.object({ enabled: z.array(z.string()) });
export type FeatureFlagsResponse = z.infer<typeof featureFlagsResponseSchema>;
