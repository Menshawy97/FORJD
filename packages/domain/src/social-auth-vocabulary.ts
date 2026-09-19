/**
 * The identity providers a person can sign in with instead of a password (ADR-041). A closed
 * set, in the domain, so the contracts, the API's provider adapter and the app all read the
 * same list -- adding one is a decision made here, not a string typed in three places.
 */
export const SOCIAL_AUTH_PROVIDERS = ["google", "apple"] as const;

export type SocialAuthProvider = (typeof SOCIAL_AUTH_PROVIDERS)[number];

/** Display names, for any screen that has to name the provider (errors, settings). */
export const SOCIAL_AUTH_PROVIDER_NAMES: Record<SocialAuthProvider, string> = {
  google: "Google",
  apple: "Apple",
};
