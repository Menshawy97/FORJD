import { z } from 'zod';

/**
 * Wire contracts for /api/v1. Schemas are the source of truth; types are inferred from them,
 * so a validator and its type can never drift apart.
 */

/**
 * Mirrors the password policy configured on the Supabase project. It is duplicated here on
 * purpose: without it the API accepts a password the auth provider then rejects, and the
 * caller gets a failure with nothing actionable in it.
 *
 * Applied to registration only. Login deliberately keeps `min(1)` — validating an existing
 * password against a current policy would lock out everyone whose password predates it.
 */
const newPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[0-9]/, 'Password must include a number')
  // Supabase's policy names an explicit symbol set, and a space is not in it. A broader
  // class such as [^A-Za-z0-9] would accept "Str0ng Pass1" here and let the provider reject
  // it instead — exactly the drift this schema exists to prevent. Found by typing a
  // space-containing password into the real signup form on a device.
  .regex(
    /[!@#$%^&*()_+\-=[\]{};'\\:"|<>?,./`~]/,
    'Password must include a symbol, such as ! @ # $ %',
  );

export const registerRequestSchema = z.object({
  email: z.string().email(),
  password: newPasswordSchema,
  /**
   * Optional so a client predating this field keeps working. The signup screen requires a
   * name; the wire contract does not. Bounds match updateProfileRequestSchema.displayName,
   * so a name accepted here cannot be rejected by the very next profile edit.
   */
  displayName: z.string().min(1).max(80).optional(),
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

/**
 * There is deliberately no response schema. The endpoint answers 202 with an empty body
 * whether or not the address has an account — any field describing what happened would be
 * an account-enumeration oracle for a product whose accounts hold health data.
 */
export const forgotPasswordRequestSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

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

/**
 * A shape check alone lets 2026-13-40 through Zod and fail later as a Postgres cast error,
 * surfacing as a 500 instead of a validation message. Round-tripping through Date rejects
 * impossible dates at the boundary where the caller can act on it.
 */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, 'Not a real calendar date');

/**
 * Restricted to http(s). z.string().url() accepts anything URL can parse, including
 * javascript: and data:, which would become a stored payload the moment a client renders
 * the avatar.
 */
const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'Must be an http(s) URL');

export const updateProfileRequestSchema = z
  .object({
    displayName: z.string().min(1).max(80).nullable(),
    dateOfBirth: isoDateSchema.nullable(),
    sex: sexSchema.nullable(),
    heightCm: z.number().positive().max(300).nullable(),
    unitSystem: unitSystemSchema,
    avatarUrl: httpUrlSchema.nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
