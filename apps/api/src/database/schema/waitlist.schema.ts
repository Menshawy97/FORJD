import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The getforjd.com waitlist (ADR-051). One row per address, kept forever -- there is no
 * "left the waitlist" flow yet, only the export/delete path any table gets through
 * `PrivacyService` if a launch-day email recipient asks.
 *
 * `email` is the unique key, stored already lower-cased by
 * `waitlistSignupRequestSchema` (`packages/contracts/src/waitlist.ts`), so the constraint
 * means what it says -- two casings of one address are one row, not two.
 *
 * No RLS. `docs/architecture/security.md` (ADR-038) corrected the earlier assumption that
 * RLS acts as defense-in-depth here: `apps/api` reaches Postgres directly with
 * `DATABASE_URL`'s role, never through Supabase's PostgREST/anon-key path that RLS actually
 * gates, so adding it would be bypassed by that role and would only be a policy nobody can
 * unit-test (CLAUDE.md rule 12). Authorization for this table is "nothing but the API reads
 * or writes it", enforced by there being no other credential that can reach the database.
 */
export const waitlistSignups = pgTable('waitlist_signups', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  source: text('source').notNull().default('website'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WaitlistSignupRow = typeof waitlistSignups.$inferSelect;
export type NewWaitlistSignupRow = typeof waitlistSignups.$inferInsert;
