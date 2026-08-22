/**
 * Canonical domain types. Pure TypeScript by rule: no NestJS, no Supabase, no UI framework
 * may be imported here (CLAUDE.md rules 1-2, enforced by the CI conformance check).
 */

export type UnitSystem = 'metric' | 'imperial';

/**
 * Kept in step with `sexSchema` in @forjd/contracts — three options by product decision
 * (Male, Female, Rather not say), matching the three chips the design actually draws.
 * `other` was removed from both rather than left accepted-but-unoffered.
 */
export type Sex = 'male' | 'female' | 'prefer_not_to_say';

export interface User {
  id: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Profile {
  userId: string;
  displayName: string | null;
  dateOfBirth: string | null;
  sex: Sex | null;
  /** Always metric. Imperial is a display concern, converted at the edge. */
  heightCm: number | null;
  unitSystem: UnitSystem;
  avatarUrl: string | null;
}
