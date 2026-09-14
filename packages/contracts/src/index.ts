/**
 * Wire contracts for /api/v1. Schemas are the source of truth; types are inferred from them,
 * so a validator and its type can never drift apart.
 *
 * Closed value sets are imported from @forjd/domain rather than restated here. They used to
 * be written out twice — once as a domain union, once as a `z.enum([...])` — and the two
 * copies of `sex` drifted, which is a bug this package exists to prevent. Building the
 * schemas from the domain tuples makes that class of drift unrepresentable rather than
 * merely testable, which matters more now that slice 2 adds five more such sets.
 *
 * The dependency direction is deliberate and legal: domain is pure TypeScript with no
 * imports at all, so contracts depending on it cannot pull a framework or an SDK into the
 * domain layer (CLAUDE.md rules 1-2).
 *
 * This file is a pure re-export barrel (R23d). The schemas themselves live in one module per
 * bounded context — auth, users, exercises, nutrition, workouts, programs, progress, body,
 * health, integrations, account-export — so that a consumer's `import { X } from
 * '@forjd/contracts'` keeps resolving to the same `X` regardless of which internal file
 * defines it. Add a new bounded context as a new module and re-export it here; do not add new
 * schemas directly to this file.
 */

export * from './common';
export * from './auth';
export * from './users';
export * from './exercises';
export * from './nutrition';
export * from './workouts';
export * from './programs';
export * from './progress';
export * from './body';
export * from './health';
export * from './integrations';
export * from './account-export';
