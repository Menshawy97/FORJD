import { boolean, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.schema';

/**
 * Consent flags, kept out of `profiles` because they are a different kind of data: `profiles`
 * is what the app displays, this table is what the server is *permitted to do*. Splitting them
 * means a query that reads a profile cannot accidentally carry a consent flag into a response,
 * and an audit of "what did this user agree to" reads one table.
 *
 * Every flag is NOT NULL and defaults to **false**, crash diagnostics included. Opt-in is the
 * decision (see docs/product/slice-2-plan.md); a nullable flag would introduce a third state
 * that is neither consent nor refusal and that every caller would then have to interpret.
 *
 * Booleans only — no Postgres enum, matching the reasoning in profiles.schema.ts.
 */
export const privacySettings = pgTable('privacy_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Gates GET /api/v1/athletes/:userId for everyone except the owner. */
  publicProfile: boolean('public_profile').notNull().default(false),
  leaderboardOptIn: boolean('leaderboard_opt_in').notNull().default(false),
  /**
   * Only meaningful while `leaderboardOptIn` is true. The dependency is enforced in
   * PrivacyService rather than by a CHECK constraint: rule 12 wants authorization and consent
   * rules in code that can be unit-tested, and a constraint would surface a violation as an
   * opaque 500 instead of the 400 the client can act on.
   */
  locationForLeaderboard: boolean('location_for_leaderboard').notNull().default(false),
  aiFeaturesConsent: boolean('ai_features_consent').notNull().default(false),
  /** Set when consent is granted, nulled when withdrawn. Only real transitions write it. */
  aiFeaturesConsentAt: timestamp('ai_features_consent_at', { withTimezone: true }),
  /**
   * Off by default. Note this flag is not the enforcement mechanism for rule 15 — health data
   * must never reach a diagnostics SDK regardless of its position. It controls whether crash
   * reports are sent at all, and whether the user identifier is attached when they are.
   */
  crashDiagnostics: boolean('crash_diagnostics').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PrivacySettingsRow = typeof privacySettings.$inferSelect;
export type NewPrivacySettingsRow = typeof privacySettings.$inferInsert;
