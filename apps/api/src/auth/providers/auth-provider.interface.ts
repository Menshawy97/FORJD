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

export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');

export interface AuthProvider {
  signUp(credentials: AuthCredentials): Promise<SignUpResult>;
  signIn(credentials: AuthCredentials): Promise<AuthResult>;
  refreshSession(refreshToken: string): Promise<AuthSession>;
  signOut(accessToken: string): Promise<void>;
  /**
   * Fire-and-forget by contract. Implementations must not signal whether the address has an
   * account: the return type carries no information, so a caller cannot build an
   * enumeration oracle out of it even by accident.
   */
  requestPasswordReset(email: string): Promise<void>;
  verifyAccessToken(accessToken: string): Promise<AuthIdentity>;
}
