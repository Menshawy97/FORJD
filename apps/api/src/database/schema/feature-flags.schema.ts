import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Schema only in Phase 1 — no endpoints yet. Keyed by name rather than a surrogate id,
// because a flag is referenced in code by its key.
export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type FeatureFlagRow = typeof featureFlags.$inferSelect;
