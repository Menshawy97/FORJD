import { z } from 'zod';

/**
 * Wire contracts for /api/v1. Schemas are the source of truth; types are inferred from them,
 * so a validator and its type can never drift apart.
 */

export const registerRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string().datetime(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/**
 * Registration does not always yield a session: when the Supabase project requires email
 * confirmation, the account exists but cannot be used until the link is clicked. Callers
 * must handle a null session rather than assume one.
 */
export const registerResponseSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  emailVerified: z.boolean(),
  session: sessionResponseSchema.nullable(),
});
export type RegisterResponse = z.infer<typeof registerResponseSchema>;

export const unitSystemSchema = z.enum(['metric', 'imperial']);
export const sexSchema = z.enum(['male', 'female', 'other', 'prefer_not_to_say']);

export const profileResponseSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  sex: sexSchema.nullable(),
  heightCm: z.number().nullable(),
  unitSystem: unitSystemSchema,
  avatarUrl: z.string().nullable(),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

export const meResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  profile: profileResponseSchema.nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const updateProfileRequestSchema = z
  .object({
    displayName: z.string().min(1).max(80).nullable(),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
      .nullable(),
    sex: sexSchema.nullable(),
    heightCm: z.number().positive().max(300).nullable(),
    unitSystem: unitSystemSchema,
    avatarUrl: z.string().url().nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
