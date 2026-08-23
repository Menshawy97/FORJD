// Plan step 4 / slice2-screen-specs.md §5. Device-local only — no backend until push
// (Phase 6/8), so this screen talks to `store/notification-preferences` and nothing else.
// There is deliberately no Save button: toggles apply and persist immediately (§5.5).
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  Link: 'Link',
}));

// Mocked wholesale rather than via requireActual: the real module imports AsyncStorage, a
// native module with no Jest binding here. The defaults are re-declared rather than imported
// for the same reason — and `notification-preferences.test.ts` is what pins them to the spec.
jest.mock('@/store/notification-preferences', () => ({
  DEFAULT_NOTIFICATION_PREFERENCES: {
    workout: true,
    recovery: true,
    pr: true,
    rank: false,
    weekly: true,
  },
  loadNotificationPreferences: jest.fn(),
  saveNotificationPreferences: jest.fn(),
}));

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  loadNotificationPreferences,
  saveNotificationPreferences,
} from '@/store/notification-preferences';
import NotifsScreen from '../notifs';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

describe('NotifsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (loadNotificationPreferences as jest.Mock).mockResolvedValue(
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    (saveNotificationPreferences as jest.Mock).mockResolvedValue(undefined);
  });

  it('renders the header, intro copy and all five rows', async () => {
    const { findByText } = await render(<NotifsScreen />);

    expect(await findByText('Notifications')).toBeTruthy();
    expect(
      await findByText('Two rules: nothing at night, nothing you cannot act on.'),
    ).toBeTruthy();
    expect(await findByText('Workout reminders')).toBeTruthy();
    expect(await findByText('On your program days, 30 min before')).toBeTruthy();
    expect(await findByText('Recovery alerts')).toBeTruthy();
    expect(await findByText('When HRV or sleep drops sharply')).toBeTruthy();
    expect(await findByText('PR celebrations')).toBeTruthy();
    expect(await findByText('When you beat a lift or a run')).toBeTruthy();
    expect(await findByText('Leaderboard moves')).toBeTruthy();
    expect(await findByText('When your city rank changes')).toBeTruthy();
    expect(await findByText('Weekly summary')).toBeTruthy();
    expect(await findByText('Sunday evening recap')).toBeTruthy();
  });

  it('renders the quiet hours block with the literal window and Change control', async () => {
    const { findByText } = await render(<NotifsScreen />);

    expect(await findByText('Quiet hours')).toBeTruthy();
    // em dash U+2014 with spaces either side — §5.2 calls this out explicitly.
    expect(await findByText('22:00 — 07:00')).toBeTruthy();
    expect(await findByText('Change')).toBeTruthy();
  });

  it('starts from the stored preferences, with Leaderboard moves off by default', async () => {
    const { findAllByRole } = await render(<NotifsScreen />);

    const rows = await findAllByRole('switch');
    const states = rows.map((row) => row.props.accessibilityState.checked);

    // Order: workout, recovery, pr, rank, weekly.
    expect(states).toEqual([true, true, true, false, true]);
  });

  it('persists through the store when a row is toggled', async () => {
    const { findByText } = await render(<NotifsScreen />);

    fireEvent.press(await findByText('Leaderboard moves'));

    await waitFor(() => {
      expect(saveNotificationPreferences).toHaveBeenCalledWith({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        rank: true,
      });
    });
  });

  it('reflects a previously stored value on mount, proving persistence not local state', async () => {
    (loadNotificationPreferences as jest.Mock).mockResolvedValue({
      workout: false,
      recovery: false,
      pr: false,
      rank: true,
      weekly: false,
    });

    const { findAllByRole } = await render(<NotifsScreen />);
    const rows = await findAllByRole('switch');

    expect(rows.map((row) => row.props.accessibilityState.checked)).toEqual([
      false,
      false,
      false,
      true,
      false,
    ]);
  });

  it('fires the toast and nothing else when Change is pressed', async () => {
    const { findByText } = await render(<NotifsScreen />);

    fireEvent.press(await findByText('Change'));

    expect(await findByText('Edit quiet hours')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(saveNotificationPreferences).not.toHaveBeenCalled();
  });

  it('backs out to the profile tab', async () => {
    const { findByLabelText } = await render(<NotifsScreen />);

    fireEvent.press(await findByLabelText('Back'));

    expect(mockReplace).toHaveBeenCalledWith('/profile');
  });

  it('has no Save button — toggles apply immediately', async () => {
    const { queryByText } = await render(<NotifsScreen />);

    expect(queryByText('Save')).toBeNull();
    expect(queryByText('Save Changes')).toBeNull();
  });
});
