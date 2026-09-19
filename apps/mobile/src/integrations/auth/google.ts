import Constants from 'expo-constants';

/**
 * ADR-041. Native Google sign-in: the phone's own account sheet returns an ID token, which the
 * app hands to our API (`POST /auth/social`) -- no browser, no client secret, no password.
 *
 * This file is the only place the native SDK is touched (CLAUDE.md rule 4: integrations are
 * isolated; `check-architecture-conformance.sh` enforces it). The SDK is loaded lazily and
 * inside a try/catch on purpose: it is a native module, so in Expo Go -- which does not bundle
 * it -- importing it would throw at startup and take the whole login screen down with it. A
 * failed load instead reports `unavailable`, and the screen says the app build is needed.
 *
 * The only value read from config is the OAuth **web client ID**, which is public by design
 * (CLAUDE.md rule 5 concerns secrets; a client ID is not one). The client secret lives in the
 * Supabase dashboard and never reaches this repo or the app.
 */
export type GoogleSignInResult =
  | { status: 'success'; idToken: string }
  | { status: 'cancelled' }
  | { status: 'failed' }
  | { status: 'unavailable' };

type GoogleSdk = typeof import('@react-native-google-signin/google-signin');

let sdk: GoogleSdk | null | undefined;
let configured = false;

function webClientId(): string {
  const value = Constants.expoConfig?.extra?.googleWebClientId;
  return typeof value === 'string' ? value : '';
}

/** Whether a web client ID is present in this build's config (it is empty until Google Cloud is set up). */
export function isGoogleSignInConfigured(): boolean {
  return webClientId().length > 0;
}

async function loadSdk(): Promise<GoogleSdk | null> {
  if (sdk !== undefined) {
    return sdk;
  }
  try {
    // A guarded `require`, not `import()`: it must throw *here*, inside the try, when the
    // native module is missing (Expo Go), and it behaves identically under Metro and Jest.
    sdk = require('@react-native-google-signin/google-signin') as GoogleSdk;
  } catch {
    sdk = null;
  }
  return sdk;
}

export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const id = webClientId();
  const loaded = id.length > 0 ? await loadSdk() : null;
  if (!loaded) {
    return { status: 'unavailable' };
  }

  const { GoogleSignin, isErrorWithCode, statusCodes } = loaded;

  try {
    if (!configured) {
      GoogleSignin.configure({ webClientId: id, scopes: ['email', 'profile'] });
      configured = true;
    }
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();

    if (response.type === 'cancelled') {
      return { status: 'cancelled' };
    }

    const idToken = response.data?.idToken;
    return idToken ? { status: 'success', idToken } : { status: 'failed' };
  } catch (error) {
    if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) {
      return { status: 'cancelled' };
    }
    return { status: 'failed' };
  }
}
