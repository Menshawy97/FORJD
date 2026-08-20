import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.schema';

/**
 * Required by docs/architecture/security.md. Written for auth lifecycle events from Phase 1;
 * user_id is nullable so a failed login against an unknown address is still recorded.
 *
 * user_id is indexed because Postgres does not index a foreign key for you. Without it,
 * `ON DELETE SET NULL` sequential-scans what will become the largest table in the schema
 * every time an account is deleted, and reading one user's audit trail does the same.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_logs_user_id_idx').on(table.userId)],
);

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type NewAuditLogRow = typeof auditLogs.$inferInsert;
