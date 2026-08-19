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
  verifyAccessToken(accessToken: string): Promise<AuthIdentity>;
}
