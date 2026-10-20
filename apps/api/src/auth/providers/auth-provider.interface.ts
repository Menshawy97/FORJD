import type { SocialAuthProvider } from '@forjd/domain';

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface AuthIdentity {
  // The upstream provider's identifier, stored as users.supabase_user_id today. Named for the
  // role it plays rather than the vendor, so a future provider swap is a mapping change.
  externalId: string;
  email: string;
  emailVerified: boolean;
}

export interface AuthResult {
  identity: AuthIdentity;
  session: AuthSession;
}

/**
 * Registration does not always produce a session. When the provider requires email
 * confirmation the account exists but cannot be used until the link is clicked, so the
 * absence of a session is expressed in the type rather than discovered at runtime.
 */
export interface SignUpResult {
  identity: AuthIdentity;
  session: AuthSession | null;
}

export interface IdTokenCredentials {
  provider: SocialAuthProvider;
  /** The ID token the phone got from Google or Apple. Verified upstream, never here. */
  idToken: string;
  /** The raw nonce the token was requested with; required for Apple. */
  nonce?: string;
}

export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');

export interface AuthProvider {
  signUp(credentials: AuthCredentials): Promise<SignUpResult>;
  signIn(credentials: AuthCredentials): Promise<AuthResult>;
  /**
   * Exchanges a Google or Apple ID token for a session (ADR-041). The identity provider
   * verifies the token; an account that shares a verified email with an existing one is linked
   * to it, so a person who signed up by email keeps their data when they later use Google.
   */
  signInWithIdToken(credentials: IdTokenCredentials): Promise<AuthResult>;
  refreshSession(refreshToken: string): Promise<AuthSession>;
  signOut(accessToken: string): Promise<void>;
  /**
   * Fire-and-forget by contract. Implementations must not signal whether the address has an
   * account: the return type carries no information, so a caller cannot build an
   * enumeration oracle out of it even by accident.
   */
  requestPasswordReset(email: string): Promise<void>;
  /**
   * Sends the sign-up confirmation email again. Fire-and-forget by the same contract as
   * `requestPasswordReset`: it must not signal whether the address has an account, or whether
   * it is already confirmed.
   */
  resendConfirmation(email: string): Promise<void>;
  verifyAccessToken(accessToken: string): Promise<AuthIdentity>;
  /**
   * Removes the upstream login itself (email, password hash, linked identities). Without it,
   * deleting our own rows leaves an account that can still sign in, and the next login would
   * lazily recreate an empty user. An already-absent user is success, so a retry can finish.
   */
  deleteUser(externalId: string): Promise<void>;
  /**
   * Whether the upstream login still exists. Asked only before creating a local row for a login
   * seen for the first time: a token is verified locally (ADR-012), so a deleted account's token
   * still verifies until it expires, and without this check it would recreate the account. Throws
   * on any failure other than "not found", so an outage is never read as either answer.
   */
  userExists(externalId: string): Promise<boolean>;
}
