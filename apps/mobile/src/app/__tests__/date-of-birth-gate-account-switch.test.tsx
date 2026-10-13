// ADR-042, and the whole-app review's unconfirmed 8.5E finding: `AuthenticatedGate` asks the server
// for the date of birth once per sign-in. If the first account's answer arrived late, after a
// sign-out and a sign-in to a second account, could it send the second account to the date-of-birth
// step? It cannot: signing out unmounts the gate (cancelling the old read) and `AuthGate` resets the
// date-of-birth store. This pins that, so a later change to either cannot bring the bug in.
//
// One navigation assertion per file: expo-router's testing library keeps navigation state that
// outlives a single `it()` (see profile-navigation-edit-profile.test.tsx).
import { act, waitFor } from '@testing-library/react-native';

import { renderApp } from './render-app';

jest.mock('expo-secure-store');
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: () => null }));

const privacy = {
  publicProfile: false,
  leaderboardOptIn: false,
  locationForLeaderboard: false,
  aiFeaturesConsent: false,
  aiFeaturesConsentAt: null,
  crashDiagnostics: false,
};

// Every read made while the first account is signed in waits on one answer, released only after
// the second account has signed in: that first account never gave a date of birth.
let releaseFirstAccount: (value: unknown) => void = () => undefined;
const firstAccountAnswer = new Promise((resolve) => {
  releaseFirstAccount = resolve;
});
let signedInAs: 'first' | 'second' = 'first';

// Only `getMe` is controlled. Every other call the home screen makes fails as if offline, which
// those screens already handle. Each failure is marked handled up front, so a synchronous helper
// replaced here (`deviceTimeZone`) cannot surface as an unhandled rejection the app never made.
jest.mock('@/auth/apiClient', () => {
  const actual = jest.requireActual('@/auth/apiClient');
  const offlineCall = () => {
    const failure = Promise.reject(new Error('offline'));
    failure.catch(() => undefined);
    return failure;
  };
  const offline = Object.fromEntries(
    Object.entries(actual).map(([name, value]) => [name, typeof value === 'function' ? jest.fn(offlineCall) : value]),
  );
  return { ...offline, getMe: jest.fn() };
});

import * as SecureStore from 'expo-secure-store';

import { getMe } from '@/auth/apiClient';
import { clearSession, saveSession } from '@/auth/secureStorage';

describe('date-of-birth gate across an account switch (ADR-042, 8.5E)', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('access-1');
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
    (getMe as jest.Mock).mockImplementation(() =>
      signedInAs === 'first'
        ? firstAccountAnswer
        : Promise.resolve({ id: 'u2', email: 'b@example.com', profile: { userId: 'u2', dateOfBirth: '1990-01-01' }, privacy }),
    );
  });

  it('does not send the second account to Your Profile when the first account answers late', async () => {
    const rendered = renderApp({ initialUrl: '/' });
    await rendered;
    await waitFor(() => expect(getMe).toHaveBeenCalled());

    // Sign out, then in as someone else, while the first account's read is still out.
    await act(async () => {
      await clearSession();
    });
    await waitFor(() => expect(rendered.getPathname()).toBe('/welcome'));
    signedInAs = 'second';
    await act(async () => {
      await saveSession(
        { accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: '2099-01-01T00:00:00Z' },
        { userId: 'u2', email: 'b@example.com' },
      );
    });
    await waitFor(() => expect(rendered.getPathname()).toBe('/'));

    // The first account's late answer: no date of birth.
    await act(async () => {
      releaseFirstAccount({ id: 'u1', email: 'a@example.com', profile: { userId: 'u1', dateOfBirth: null }, privacy });
      await firstAccountAnswer;
    });

    expect(rendered.getPathname()).toBe('/');
  });
});
