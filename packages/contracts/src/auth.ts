import { SOCIAL_AUTH_PROVIDERS } from '@forjd/domain';
import { z } from 'zod';

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

/**
 * ADR-041: sign in with a Google or Apple ID token, obtained natively on the phone. The token
 * is verified by the identity provider (through Supabase), never by this app or by us, and no
 * password is involved. Apple binds its token to a nonce, so the raw nonce is required there;
 * Google's native SDK does not use one. The size bounds are a sanity floor and a ceiling on
 * what a public endpoint will read, not a claim about token length.
 */
export const socialSignInRequestSchema = z
  .object({
    provider: z.enum(SOCIAL_AUTH_PROVIDERS),
    idToken: z.string().min(20).max(8192),
    nonce: z.string().min(8).max(256).optional(),
  })
  .refine((value) => value.provider !== 'apple' || value.nonce !== undefined, {
    message: 'Apple sign-in requires the nonce the token was requested with',
    path: ['nonce'],
  });
export type SocialSignInRequest = z.infer<typeof socialSignInRequestSchema>;

export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string().datetime(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** The password-login session, plus whether this was the account's first sight of FORJD. */
export const socialSignInResponseSchema = sessionResponseSchema.extend({
  isNewUser: z.boolean(),
});
export type SocialSignInResponse = z.infer<typeof socialSignInResponseSchema>;

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
