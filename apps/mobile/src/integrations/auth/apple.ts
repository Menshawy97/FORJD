/**
 * ADR-041. Native Sign in with Apple. Built and tested now, switched on later: it needs a paid
 * Apple Developer account for the entitlement, so the button stays "Coming soon" until
 * `extra.appleSignInEnabled` is set (see `use-social-sign-in.ts`).
 *
 * Apple binds its ID token to a nonce. The SHA-256 of a random value is what Apple is asked
 * to embed; the raw value travels to our API, which gives it to Supabase to verify that the
 * token was requested for this exact sign-in. Sending the raw nonce to Apple would defeat the
 * point, so it never leaves this function except in the returned result.
 *
 * Like `google.ts`, this is the only place the SDK is touched (CLAUDE.md rule 4) and it is
 * loaded lazily: the native module is absent in Expo Go and on Android.
 */
export type AppleSignInResult =
  | { status: 'success'; idToken: string; nonce: string }
  | { status: 'cancelled' }
  | { status: 'failed' }
  | { status: 'unavailable' };

const NONCE_BYTES = 16;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function signInWithApple(): Promise<AppleSignInResult> {
  let AppleAuthentication: typeof import('expo-apple-authentication');
  let Crypto: typeof import('expo-crypto');
  try {
    // Guarded `require`s, not `import()`: they must throw here, inside the try, when the
    // native module is missing (Expo Go, Android), and behave identically under Metro and Jest.
    AppleAuthentication = require('expo-apple-authentication');
    Crypto = require('expo-crypto');
    if (!(await AppleAuthentication.isAvailableAsync())) {
      return { status: 'unavailable' };
    }
  } catch {
    return { status: 'unavailable' };
  }

  try {
    const nonce = toHex(await Crypto.getRandomBytesAsync(NONCE_BYTES));
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    return credential.identityToken
      ? { status: 'success', idToken: credential.identityToken, nonce }
      : { status: 'failed' };
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ERR_REQUEST_CANCELED') {
      return { status: 'cancelled' };
    }
    return { status: 'failed' };
  }
}
