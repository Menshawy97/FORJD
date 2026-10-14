// Emulator walk finding 17 (replica approved 2026-10-14, slice B of
// docs/product/notifications-list-and-profile-counts-plan.md): the Home bell opens a Notifications list of the server's
// own pushes (PR celebrations and leaderboard moves) from the last 30 days. Filled, empty and offline states; a tap opens
// what tapping the push opens; "Notification settings" opens the switches screen.
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderApp } from './render-app';

jest.mock('expo-secure-store');
// Every other API call the screens reached here make (Home's loads, the destination screens) waits for ever, so only
// the list's own answer decides what shows.
jest.mock('@/auth/apiClient', () => {
  const calls: Record<string | symbol, unknown> = { __esModule: true, listNotifications: jest.fn() };
  return new Proxy(calls, {
    get: (target, key) => {
      if (!(key in target)) target[key] = jest.fn(() => new Promise(() => undefined));
      return target[key];
    },
  });
});
jest.mock('@/features/notifications/push-registration', () => ({
  unregisterFromPush: jest.fn().mockResolvedValue(true),
  syncPushRegistration: jest.fn().mockResolvedValue('none'),
}));

import * as SecureStore from 'expo-secure-store';
import { listNotifications } from '@/auth/apiClient';

const SESSION = '0c6f2c8e-1b1a-4c55-9d7e-3a9f8d2b7c11';
const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();
const daysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();

const FILLED = {
  items: [
    {
      id: '5b0e6f4e-8f7a-4d7e-9c1a-2f4b8f6c1d2e',
      kind: 'pr',
      title: 'New PR on Barbell Bench Press',
      body: 'Open FORJD to see it.',
      data: { type: 'pr', sessionId: SESSION },
      sentAt: hoursAgo(0.1),
    },
    {
      id: '6c1f7a5f-9a8b-4e8f-8d2b-3a5c9a7d2e3f',
      kind: 'rank',
      title: 'You moved up in Cairo',
      body: 'See the leaderboard.',
      data: { type: 'rank', weekStart: '2026-10-10' },
      sentAt: daysAgo(3),
    },
  ],
};

function offline(): Error {
  return Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
}

describe('notifications list', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('access-1');
    (listNotifications as jest.Mock).mockReset();
  });

  it('opens from the Home bell', async () => {
    (listNotifications as jest.Mock).mockResolvedValue({ items: [] });
    const app = renderApp({ initialUrl: '/' });
    const rendered = await app;

    fireEvent.press(await rendered.findByLabelText('Notifications'));

    await rendered.findByText('Nothing yet');
    expect(app.getPathname()).toBe('/notifications');
  });

  it('shows the pushes under Today and Earlier, with their text, and the footer', async () => {
    (listNotifications as jest.Mock).mockResolvedValue(FILLED);
    const { findByText, getByText } = await renderApp({ initialUrl: '/notifications' });

    await findByText('New PR on Barbell Bench Press');
    getByText('Today');
    getByText('Earlier');
    getByText('You moved up in Cairo');
    getByText('See the leaderboard.');
    getByText('PR celebrations and leaderboard moves from the last 30 days.');
    getByText('Notification settings');
  });

  it('opens the workout when a PR is tapped', async () => {
    (listNotifications as jest.Mock).mockResolvedValue(FILLED);
    const app = renderApp({ initialUrl: '/notifications' });
    const rendered = await app;

    fireEvent.press(await rendered.findByText('New PR on Barbell Bench Press'));

    await waitFor(() => expect(app.getPathname()).toBe(`/workout/${SESSION}`));
  });

  it('opens Rank when a leaderboard move is tapped', async () => {
    (listNotifications as jest.Mock).mockResolvedValue(FILLED);
    const app = renderApp({ initialUrl: '/notifications' });
    const rendered = await app;

    fireEvent.press(await rendered.findByText('You moved up in Cairo'));

    await waitFor(() => expect(app.getPathname()).toBe('/rank'));
  });

  it('shows the empty state, with the settings link that opens the switches', async () => {
    (listNotifications as jest.Mock).mockResolvedValue({ items: [] });
    const app = renderApp({ initialUrl: '/notifications' });
    const rendered = await app;

    await rendered.findByText('Nothing yet');
    rendered.getByText('Your PR celebrations and leaderboard moves show here for 30 days.');
    fireEvent.press(rendered.getByText('Notification settings'));

    await waitFor(() => expect(app.getPathname()).toBe('/notifs'));
  });

  it('says so when offline, and shows no list', async () => {
    (listNotifications as jest.Mock).mockRejectedValue(offline());
    const { findByText, queryByText } = await renderApp({ initialUrl: '/notifications' });

    await findByText("You're offline. Notifications will show when you're back online.");
    expect(queryByText('Nothing yet')).toBeNull();
    expect(queryByText('Today')).toBeNull();
  });
});
