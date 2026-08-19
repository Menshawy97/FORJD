import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The application owns `id`. `supabaseUserId` is a mapped external identifier, nullable so a
 * user can exist before (or after) any particular auth provider knows about them — the same
 * shape as ExternalConnection.provider for health integrations. See ADR-008.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  supabaseUserId: uuid('supabase_user_id').unique(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
