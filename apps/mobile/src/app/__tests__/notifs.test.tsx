// Plan step 4 / slice2-screen-specs.md §5. Device-local only — no backend until push
// (Phase 6/8), so this screen talks to `store/notification-preferences` and nothing else.
// There is deliberately no Save button: toggles apply and persist immediately (§5.5).
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Linking } from 'react-native';
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
    meals: false,
    noWorkout: false,
    forgeClosing: false,
    weighIn: false,
  },
  loadNotificationPreferences: jest.fn(),
  saveNotificationPreferences: jest.fn(),
}));

// The phone's notification permission and the schedule behind it are proven in
// `features/notifications/__tests__`; here only what the screen does with them.
jest.mock('@/features/notifications/local-notifications', () => ({
  ensureLocalNotificationPermission: jest.fn(),
  readNotificationPermission: jest.fn(),
}));
jest.mock('@/features/notifications/use-local-notifications', () => ({
  requestLocalNotificationReconcile: jest.fn(),
}));

jest.mock('@/store/notification-preferences-sync', () => ({
  syncNotificationPreferences: jest.fn(),
  queueNotificationChange: jest.fn(),
}));

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  loadNotificationPreferences,
  saveNotificationPreferences,
} from '@/store/notification-preferences';
import {
  ensureLocalNotificationPermission,
  readNotificationPermission,
} from '@/features/notifications/local-notifications';
import { requestLocalNotificationReconcile } from '@/features/notifications/use-local-notifications';
import { queueNotificationChange, syncNotificationPreferences } from '@/store/notification-preferences-sync';
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
    (syncNotificationPreferences as jest.Mock).mockResolvedValue(null);
    (queueNotificationChange as jest.Mock).mockResolvedValue(undefined);
    (readNotificationPermission as jest.Mock).mockResolvedValue('granted');
    (ensureLocalNotificationPermission as jest.Mock).mockResolvedValue(true);
  });

  it('renders the header, intro copy and all seven rows', async () => {
    const { findByText } = await render(<NotifsScreen />);

    expect(await findByText('Notifications')).toBeTruthy();
    expect(
      await findByText('Two rules: nothing at night, nothing you cannot act on.'),
    ).toBeTruthy();
    expect(await findByText('Workout reminders')).toBeTruthy();
    expect(await findByText('30 min before you usually train')).toBeTruthy();
    expect(await findByText('Recovery alerts')).toBeTruthy();
    expect(await findByText('When HRV or sleep drops sharply')).toBeTruthy();
    expect(await findByText('PR celebrations')).toBeTruthy();
    expect(await findByText('When you beat a lift or a run')).toBeTruthy();
    expect(await findByText('Leaderboard moves')).toBeTruthy();
    expect(await findByText('When your city rank changes')).toBeTruthy();
    expect(await findByText('Weekly summary')).toBeTruthy();
    expect(await findByText('Saturday morning, when your week closes')).toBeTruthy();
    expect(await findByText('Log your meals')).toBeTruthy();
    expect(await findByText("Evening, if you haven't logged food yet")).toBeTruthy();
    expect(await findByText('No workout yet this week')).toBeTruthy();
    expect(await findByText("Thursday evening, if you haven't trained")).toBeTruthy();
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

    // Order: workout, recovery, pr, rank, weekly, meals, noWorkout.
    expect(states).toEqual([true, true, true, false, true, false, false]);
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
      meals: true,
      noWorkout: false,
    });

    const { findAllByRole } = await render(<NotifsScreen />);
    const rows = await findAllByRole('switch');

    expect(rows.map((row) => row.props.accessibilityState.checked)).toEqual([
      false,
      false,
      false,
      true,
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

  // Phase 12D: the server is the home of the switches; the phone shows its own copy at once and then
  // adopts the server's answer (the server wins).
  it('adopts the server answer after opening, so every device shows the same switches', async () => {
    (syncNotificationPreferences as jest.Mock).mockResolvedValue({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      workout: false,
      rank: true,
    });

    const { getAllByRole } = await render(<NotifsScreen />);

    await waitFor(() => {
      expect(getAllByRole('switch').map((row) => row.props.accessibilityState.checked)).toEqual([
        false,
        true,
        true,
        true,
        true,
        false,
        false,
      ]);
    });
  });

  it('keeps the device copy when the server cannot be reached', async () => {
    (loadNotificationPreferences as jest.Mock).mockResolvedValue({ ...DEFAULT_NOTIFICATION_PREFERENCES, pr: false });
    (syncNotificationPreferences as jest.Mock).mockResolvedValue(null);

    const { findAllByRole } = await render(<NotifsScreen />);

    const rows = await findAllByRole('switch');
    expect(rows.map((row) => row.props.accessibilityState.checked)).toEqual([true, true, false, false, true, false, false]);
  });

  it('queues only what changed for the server when a row is toggled', async () => {
    const { findByText } = await render(<NotifsScreen />);

    fireEvent.press(await findByText('Leaderboard moves'));

    await waitFor(() => {
      expect(queueNotificationChange).toHaveBeenCalledWith(DEFAULT_NOTIFICATION_PREFERENCES, {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        rank: true,
      });
    });
  });

  it('ignores a late server answer once the person has tapped a switch, so their tap is not undone', async () => {
    let answer: (value: unknown) => void = () => undefined;
    (syncNotificationPreferences as jest.Mock).mockReturnValue(new Promise((resolve) => (answer = resolve)));

    const { findByText, getAllByRole } = await render(<NotifsScreen />);
    fireEvent.press(await findByText('Leaderboard moves'));
    answer({ ...DEFAULT_NOTIFICATION_PREFERENCES, workout: false });

    await waitFor(() => {
      expect(getAllByRole('switch').map((row) => row.props.accessibilityState.checked)).toEqual([
        true,
        true,
        true,
        true,
        true,
        false,
        false,
      ]);
    });
  });

  it('has no Save button — toggles apply immediately', async () => {
    const { queryByText } = await render(<NotifsScreen />);

    expect(queryByText('Save')).toBeNull();
    expect(queryByText('Save Changes')).toBeNull();
  });

  // Phase 12E-4 (approved replica, 2026-10-06): the phone asks the first time a reminder is turned on, and the
  // screen says so when the phone's own setting is off.
  describe('the phone permission', () => {
    it('shows the note, with a link to the phone settings, only when the phone has refused notifications', async () => {
      (readNotificationPermission as jest.Mock).mockResolvedValue('denied');
      const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);

      const { findByText } = await render(<NotifsScreen />);

      expect(await findByText('Notifications are off for FORJD on this phone')).toBeTruthy();
      expect(
        await findByText("Your choices below are saved, but nothing will arrive until you turn them on in your phone's settings."),
      ).toBeTruthy();
      fireEvent.press(await findByText('Open settings'));
      expect(openSettings).toHaveBeenCalledTimes(1);
      openSettings.mockRestore();
    });

    it.each(['granted', 'undetermined'])('shows no note when the permission is %s', async (state) => {
      (readNotificationPermission as jest.Mock).mockResolvedValue(state);

      const { queryByText, findByText } = await render(<NotifsScreen />);
      await findByText('Workout reminders');

      await waitFor(() => expect(readNotificationPermission).toHaveBeenCalled());
      expect(queryByText('Notifications are off for FORJD on this phone')).toBeNull();
    });

    it('asks the phone when a reminder that the phone schedules is turned on, then plans again', async () => {
      (loadNotificationPreferences as jest.Mock).mockResolvedValue({ ...DEFAULT_NOTIFICATION_PREFERENCES, weekly: false });

      const { findByText } = await render(<NotifsScreen />);
      fireEvent.press(await findByText('Weekly summary'));

      await waitFor(() => expect(ensureLocalNotificationPermission).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(requestLocalNotificationReconcile).toHaveBeenCalled());
    });

    it('does not ask when a reminder is turned off, or when a switch the server sends is turned on', async () => {
      const { findByText } = await render(<NotifsScreen />);

      fireEvent.press(await findByText('Workout reminders'));
      fireEvent.press(await findByText('Leaderboard moves'));

      await waitFor(() => expect(saveNotificationPreferences).toHaveBeenCalledTimes(2));
      expect(ensureLocalNotificationPermission).not.toHaveBeenCalled();
    });

    // The switches are on by default, so a new phone has reminders on and nothing asked yet: opening the screen is
    // when the phone is asked, or the reminders would silently never arrive.
    it('asks the phone when the screen opens with a reminder on and the phone not yet asked', async () => {
      (readNotificationPermission as jest.Mock).mockResolvedValue('undetermined');

      const { findByText } = await render(<NotifsScreen />);
      await findByText('Workout reminders');

      await waitFor(() => expect(ensureLocalNotificationPermission).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(requestLocalNotificationReconcile).toHaveBeenCalled());
    });

    it('does not ask on opening when no reminder the phone schedules is on', async () => {
      (readNotificationPermission as jest.Mock).mockResolvedValue('undetermined');
      (loadNotificationPreferences as jest.Mock).mockResolvedValue({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        workout: false,
        weekly: false,
      });

      const { findByText } = await render(<NotifsScreen />);
      await findByText('Workout reminders');

      await waitFor(() => expect(readNotificationPermission).toHaveBeenCalled());
      expect(ensureLocalNotificationPermission).not.toHaveBeenCalled();
    });

    it.each(['granted', 'denied'])('does not ask on opening once the phone has decided (%s)', async (state) => {
      (readNotificationPermission as jest.Mock).mockResolvedValue(state);

      const { findByText } = await render(<NotifsScreen />);
      await findByText('Workout reminders');

      await waitFor(() => expect(readNotificationPermission).toHaveBeenCalled());
      expect(ensureLocalNotificationPermission).not.toHaveBeenCalled();
    });

    it('shows the note after a refusal it has just seen, though Android still says it can ask again', async () => {
      (readNotificationPermission as jest.Mock).mockResolvedValue('undetermined');
      (ensureLocalNotificationPermission as jest.Mock).mockResolvedValue(false);

      const { findByText } = await render(<NotifsScreen />);

      expect(await findByText('Notifications are off for FORJD on this phone')).toBeTruthy();
    });

    it('announces the note to screen readers when it appears', async () => {
      (readNotificationPermission as jest.Mock).mockResolvedValue('denied');

      const { findByTestId } = await render(<NotifsScreen />);

      expect((await findByTestId('notifications-off-note')).props.accessibilityLiveRegion).toBe('polite');
    });

    it('does not ask for a reminder that was turned back off before the prompt', async () => {
      (loadNotificationPreferences as jest.Mock).mockResolvedValue({ ...DEFAULT_NOTIFICATION_PREFERENCES, weekly: false });

      const { findByText } = await render(<NotifsScreen />);
      // The second tap lands while the first one's save is still going.
      let finishSave: (value: undefined) => void = () => undefined;
      (saveNotificationPreferences as jest.Mock).mockReturnValue(new Promise((resolve) => (finishSave = resolve)));
      fireEvent.press(await findByText('Weekly summary'));
      fireEvent.press(await findByText('Weekly summary'));
      finishSave(undefined);

      await waitFor(() => expect(requestLocalNotificationReconcile).toHaveBeenCalled());
      expect(ensureLocalNotificationPermission).not.toHaveBeenCalled();
    });

    it('asks the phone when the meals reminder is turned on', async () => {
      (loadNotificationPreferences as jest.Mock).mockResolvedValue({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        workout: false,
        weekly: false,
      });

      const { findByText } = await render(<NotifsScreen />);
      fireEvent.press(await findByText('Log your meals'));

      await waitFor(() => expect(ensureLocalNotificationPermission).toHaveBeenCalledTimes(1));
      expect(saveNotificationPreferences).toHaveBeenCalledWith({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        workout: false,
        weekly: false,
        meals: true,
      });
    });

    it('asks the phone when the no-workout reminder is turned on', async () => {
      (loadNotificationPreferences as jest.Mock).mockResolvedValue({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        workout: false,
        weekly: false,
      });

      const { findByText } = await render(<NotifsScreen />);
      fireEvent.press(await findByText('No workout yet this week'));

      await waitFor(() => expect(ensureLocalNotificationPermission).toHaveBeenCalledTimes(1));
    });

    it('shows the note once the person refuses the prompt, and still keeps their choice', async () => {
      (loadNotificationPreferences as jest.Mock).mockResolvedValue({ ...DEFAULT_NOTIFICATION_PREFERENCES, weekly: false });
      (readNotificationPermission as jest.Mock).mockResolvedValueOnce('undetermined').mockResolvedValue('denied');
      (ensureLocalNotificationPermission as jest.Mock).mockResolvedValue(false);

      const { findByText } = await render(<NotifsScreen />);
      fireEvent.press(await findByText('Weekly summary'));

      expect(await findByText('Notifications are off for FORJD on this phone')).toBeTruthy();
      expect(saveNotificationPreferences).toHaveBeenCalledWith({ ...DEFAULT_NOTIFICATION_PREFERENCES, weekly: true });
    });
  });
});
