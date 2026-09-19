import { SOCIAL_AUTH_PROVIDER_NAMES, type SocialAuthProvider } from '@forjd/domain';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useCallback, useRef } from 'react';

import { signInWithApple } from '@/integrations/auth/apple';
import { signInWithGoogle } from '@/integrations/auth/google';

import { socialSignIn } from './apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from './failure';
import { saveSession } from './secureStorage';

/**
 * ADR-041. What the two "Continue with ..." buttons do: run the native sheet through its
 * adapter, exchange the resulting ID token with our API, save the returned session, and go
 * into the app. The same code serves the login and signup screens -- for a person's first
 * sign-in the account is new and the date-of-birth gate (ADR-042) sends them to "Your
 * Profile"; for a returning one it simply lands on Home.
 *
 * Apple is built but off: it needs a paid Apple Developer account. `extra.appleSignInEnabled`
 * flips it on at build time, with no code change; until then the button says "coming soon".
 */
const APPLE_COMING_SOON = 'Apple sign-in is coming soon.';

function isAppleEnabled(): boolean {
  return Constants.expoConfig?.extra?.appleSignInEnabled === true;
}

function failureMessage(provider: SocialAuthProvider): string {
  return `Could not sign in with ${SOCIAL_AUTH_PROVIDER_NAMES[provider]}. Please try again.`;
}

export function useSocialSignIn(showToast: (message: string) => void) {
  const inFlight = useRef(false);

  const exchange = useCallback(
    async (request: Parameters<typeof socialSignIn>[0]) => {
      try {
        const session = await socialSignIn(request);
        await saveSession(session);
        // Same stack reset as password login: nothing left underneath for the swipe-back
        // gesture to pop to (ui-remediation-and-phase-i-plan.md section 1.1).
        if (router.canDismiss()) router.dismissAll();
        router.replace('/');
      } catch (cause) {
        showToast(classifyRequestFailure(cause) === 'offline' ? OFFLINE_MESSAGE : failureMessage(request.provider));
      }
    },
    [showToast],
  );

  const run = useCallback(
    async (task: () => Promise<void>) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      try {
        await task();
      } finally {
        inFlight.current = false;
      }
    },
    [],
  );

  const google = useCallback(
    () =>
      run(async () => {
        const result = await signInWithGoogle();
        if (result.status === 'success') {
          await exchange({ provider: 'google', idToken: result.idToken });
        } else if (result.status === 'unavailable') {
          showToast('Google sign-in needs the FORJD app build. It is not available in Expo Go.');
        } else if (result.status === 'failed') {
          showToast(failureMessage('google'));
        }
      }),
    [exchange, run, showToast],
  );

  const apple = useCallback(
    () =>
      run(async () => {
        if (!isAppleEnabled()) {
          showToast(APPLE_COMING_SOON);
          return;
        }
        const result = await signInWithApple();
        if (result.status === 'success') {
          await exchange({ provider: 'apple', idToken: result.idToken, nonce: result.nonce });
        } else if (result.status === 'unavailable') {
          showToast('Apple sign-in is not available on this device.');
        } else if (result.status === 'failed') {
          showToast(failureMessage('apple'));
        }
      }),
    [exchange, run, showToast],
  );

  return { google, apple, appleEnabled: isAppleEnabled() };
}
