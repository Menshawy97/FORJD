// Emulator walk finding 15 (notifications-list-and-profile-counts-plan.md, slice A, replica approved 2026-10-14):
// Profile → Data's Workout History and InBody History subtitles read the real counts. While they load, or when the
// phone is offline, a neutral line shows instead, never an invented number. The two rows still do nothing on tap.
import { renderApp } from './render-app';

jest.mock('expo-secure-store');
jest.mock('@/auth/apiClient', () => ({
  getMe: jest.fn(),
  getWorkoutStats: jest.fn(),
  listBodyScans: jest.fn(),
}));
jest.mock('@/features/notifications/push-registration', () => ({
  unregisterFromPush: jest.fn().mockResolvedValue(true),
  syncPushRegistration: jest.fn().mockResolvedValue('none'),
}));

import * as SecureStore from 'expo-secure-store';
import { getMe, getWorkoutStats, listBodyScans } from '@/auth/apiClient';
import { SCANS_NEUTRAL, SESSIONS_NEUTRAL } from '@/features/profile/data-subtitles';

const ME = {
  id: 'u1',
  email: 'a@example.com',
  profile: {
    userId: 'u1',
    displayName: 'Ada Lovelace',
    dateOfBirth: '1990-07-04',
    sex: null,
    heightCm: null,
    unitSystem: 'metric',
    weightUnit: 'kg',
    distanceUnit: 'km',
    energyUnit: 'kcal',
    trainingGoals: [],
    activities: [],
    city: null,
    username: null,
    avatarUrl: null,
    plan: 'free',
  },
  privacy: {
    publicProfile: false,
    leaderboardOptIn: false,
    locationForLeaderboard: false,
    aiFeaturesConsent: false,
    aiFeaturesConsentAt: null,
    crashDiagnostics: false,
  },
};

function offline(): Error {
  return Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
}

describe('profile Data counts', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('access-1');
    (getMe as jest.Mock).mockResolvedValue(ME);
  });

  it('shows the real session count and the newest scan date', async () => {
    (getWorkoutStats as jest.Mock).mockResolvedValue({ totalSessions: 3 });
    (listBodyScans as jest.Mock).mockResolvedValue({
      scans: [{ id: 's1', measuredAt: '2026-10-14T08:00:00.000Z', source: 'inbody', weightKg: 80, bodyFatPercent: 15 }],
    });

    const { findByText, queryByText } = await renderApp({ initialUrl: '/profile' });

    await findByText('3 sessions logged');
    await findByText('Last scan 14 Oct');
    expect(queryByText('147 sessions logged')).toBeNull();
    expect(queryByText('Last scan 8 days ago')).toBeNull();
  });

  it('says 1 session and no scans for a new account', async () => {
    (getWorkoutStats as jest.Mock).mockResolvedValue({ totalSessions: 1 });
    (listBodyScans as jest.Mock).mockResolvedValue({ scans: [] });

    const { findByText } = await renderApp({ initialUrl: '/profile' });

    await findByText('1 session logged');
    await findByText('No scans yet');
  });

  it('keeps the neutral lines while offline, with no invented numbers', async () => {
    (getWorkoutStats as jest.Mock).mockRejectedValue(offline());
    (listBodyScans as jest.Mock).mockRejectedValue(offline());

    const { findByText, queryByText } = await renderApp({ initialUrl: '/profile' });

    await findByText('Ada Lovelace');
    await findByText(SESSIONS_NEUTRAL);
    await findByText(SCANS_NEUTRAL);
    expect(queryByText(/sessions? logged/)).toBeNull();
    expect(queryByText(/Last scan/)).toBeNull();
  });

  it('shows the neutral lines while the counts are still loading', async () => {
    (getWorkoutStats as jest.Mock).mockReturnValue(new Promise(() => undefined));
    (listBodyScans as jest.Mock).mockReturnValue(new Promise(() => undefined));

    const { findByText } = await renderApp({ initialUrl: '/profile' });

    await findByText(SESSIONS_NEUTRAL);
    await findByText(SCANS_NEUTRAL);
  });
});
