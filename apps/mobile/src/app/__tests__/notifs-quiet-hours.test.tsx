// The quiet-hours editor on the Notifications screen (approved mock-up, 2026-10-06): the row keeps its look and gains
// one line of help; Change opens a small sheet with a From time and an Until time, Save, and a reset to the default.
import { act, fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  Link: 'Link',
}));

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
  queueQuietHoursChange: jest.fn(),
}));
// The real module imports AsyncStorage, a native module with no Jest binding here; its behaviour is proven in
// `store/__tests__/quiet-hours.test.ts`. The formatting helpers live apart from it and run for real.
jest.mock('@/store/quiet-hours', () => ({
  loadQuietHours: jest.fn(),
}));

// A stand-in for the phone's time picker: pressing it "picks" whatever time the test chose.
let mockPickedMinute = 0;
jest.mock('@react-native-community/datetimepicker', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: (props: { testID?: string; value: Date; onChange: (event: { type: string }, date?: Date) => void }) => (
      <Pressable
        testID={props.testID ?? 'time-picker'}
        accessibilityRole="button"
        onPress={() => {
          const picked = new Date(props.value);
          picked.setHours(Math.floor(mockPickedMinute / 60), mockPickedMinute % 60, 0, 0);
          props.onChange({ type: 'set' }, picked);
        }}>
        <Text>picker</Text>
      </Pressable>
    ),
  };
});

import { requestLocalNotificationReconcile } from '@/features/notifications/use-local-notifications';
import {
  ensureLocalNotificationPermission,
  readNotificationPermission,
} from '@/features/notifications/local-notifications';
import { DEFAULT_NOTIFICATION_PREFERENCES, loadNotificationPreferences, saveNotificationPreferences } from '@/store/notification-preferences';
import { queueNotificationChange, queueQuietHoursChange, syncNotificationPreferences } from '@/store/notification-preferences-sync';
import { loadQuietHours } from '@/store/quiet-hours';
import NotifsScreen from '../notifs';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const NIGHT = { startMinute: 23 * 60, endMinute: 6 * 60 };
const DEFAULT = { startMinute: 22 * 60, endMinute: 7 * 60 };

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

describe('NotifsScreen quiet hours', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPickedMinute = 0;
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    (loadNotificationPreferences as jest.Mock).mockResolvedValue(DEFAULT_NOTIFICATION_PREFERENCES);
    (saveNotificationPreferences as jest.Mock).mockResolvedValue(undefined);
    (syncNotificationPreferences as jest.Mock).mockResolvedValue(null);
    (queueNotificationChange as jest.Mock).mockResolvedValue(undefined);
    (queueQuietHoursChange as jest.Mock).mockResolvedValue(undefined);
    (readNotificationPermission as jest.Mock).mockResolvedValue('granted');
    (ensureLocalNotificationPermission as jest.Mock).mockResolvedValue(true);
    (loadQuietHours as jest.Mock).mockResolvedValue(DEFAULT);
  });

  async function openSheet() {
    const screen = await render(<NotifsScreen />);
    fireEvent.press(await screen.findByText('Change'));
    await screen.findByText('Save');
    return screen;
  }

  async function pick(screen: Awaited<ReturnType<typeof render>>, pill: string, minute: number) {
    mockPickedMinute = minute;
    fireEvent.press(screen.getByLabelText(pill));
    // Wait for this pill's own wheel, not the previous pill's that is still on screen until the update commits.
    await waitFor(() => expect(screen.getByLabelText(pill).props.accessibilityState.expanded).toBe(true));
    fireEvent.press(await screen.findByTestId('quiet-hours-picker'));
    const clock = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    await screen.findByLabelText(`${pill.split(',')[0]}, ${clock}`);
  }

  it('shows the window the person chose, with a line saying what it does', async () => {
    (loadQuietHours as jest.Mock).mockResolvedValue(NIGHT);

    const { findByText } = await render(<NotifsScreen />);

    expect(await findByText('23:00 — 06:00')).toBeTruthy();
    expect(await findByText('No reminders arrive during this time.')).toBeTruthy();
  });

  it('opens the sheet from Change with the current From and Until times, and no toast', async () => {
    (loadQuietHours as jest.Mock).mockResolvedValue(NIGHT);
    const { findByText, getByLabelText, queryByText } = await render(<NotifsScreen />);
    await findByText('23:00 — 06:00');

    fireEvent.press(await findByText('Change'));

    expect(await findByText('Save')).toBeTruthy();
    expect(getByLabelText('From, 23:00')).toBeTruthy();
    expect(getByLabelText('Until, 06:00')).toBeTruthy();
    expect(queryByText('Edit quiet hours')).toBeNull();
  });

  it('saves a new From time: keeps it on the phone, sends it, plans again and shows it', async () => {
    const screen = await openSheet();

    await pick(screen, 'From, 22:00', 21 * 60 + 30);
    await act(async () => {
      fireEvent.press(screen.getByText('Save'));
    });

    const saved = { startMinute: 21 * 60 + 30, endMinute: 7 * 60 };
    await waitFor(() => expect(queueQuietHoursChange).toHaveBeenCalledWith(saved));
    await waitFor(() => expect(requestLocalNotificationReconcile).toHaveBeenCalled());
    expect(await screen.findByText('21:30 — 07:00')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Save')).toBeNull());
  });

  it('saves a new Until time, and a same-day window like 13:00 to 15:00', async () => {
    const screen = await openSheet();

    await pick(screen, 'From, 22:00', 13 * 60);
    await pick(screen, 'Until, 07:00', 15 * 60);
    await act(async () => {
      fireEvent.press(screen.getByText('Save'));
    });

    await waitFor(() => expect(queueQuietHoursChange).toHaveBeenCalledWith({ startMinute: 780, endMinute: 900 }));
    expect(await screen.findByText('13:00 — 15:00')).toBeTruthy();
  });

  it('refuses two equal times with a plain message, and keeps the sheet open', async () => {
    const screen = await openSheet();

    await pick(screen, 'Until, 07:00', 22 * 60);
    fireEvent.press(screen.getByText('Save'));

    expect(await screen.findByText('Pick two different times.')).toBeTruthy();
    expect(queueQuietHoursChange).not.toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Pick two different times.');
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('clears the message as soon as a time is changed', async () => {
    const screen = await openSheet();
    await pick(screen, 'Until, 07:00', 22 * 60);
    fireEvent.press(screen.getByText('Save'));
    await screen.findByText('Pick two different times.');

    await pick(screen, 'From, 22:00', 21 * 60);

    expect(screen.queryByText('Pick two different times.')).toBeNull();
  });

  it('resets the times in the sheet to 22:00 and 07:00, saved only when Save is pressed', async () => {
    (loadQuietHours as jest.Mock).mockResolvedValue(NIGHT);
    const screen = await openSheet();

    fireEvent.press(screen.getByText('Reset to 22:00 — 07:00'));

    expect(await screen.findByLabelText('From, 22:00')).toBeTruthy();
    expect(await screen.findByLabelText('Until, 07:00')).toBeTruthy();
    expect(queueQuietHoursChange).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByText('Save'));
    });
    await waitFor(() => expect(queueQuietHoursChange).toHaveBeenCalledWith(DEFAULT));
  });

  it('closes without saving when the person taps outside the sheet', async () => {
    const screen = await openSheet();
    await pick(screen, 'From, 22:00', 20 * 60);

    fireEvent.press(screen.getByLabelText('Close quiet hours'));

    await waitFor(() => expect(screen.queryByText('Save')).toBeNull());
    expect(queueQuietHoursChange).not.toHaveBeenCalled();
    expect(await screen.findByText('22:00 — 07:00')).toBeTruthy();
  });

  it('starts each opening from what is saved, not from an abandoned edit', async () => {
    const screen = await openSheet();
    await pick(screen, 'From, 22:00', 20 * 60);
    fireEvent.press(screen.getByLabelText('Close quiet hours'));

    fireEvent.press(await screen.findByText('Change'));

    expect(await screen.findByLabelText('From, 22:00')).toBeTruthy();
  });

  it("adopts the server's quiet hours after the screen opens", async () => {
    (syncNotificationPreferences as jest.Mock).mockResolvedValue(DEFAULT_NOTIFICATION_PREFERENCES);
    (loadQuietHours as jest.Mock).mockResolvedValueOnce(DEFAULT).mockResolvedValue(NIGHT);

    const { findByText } = await render(<NotifsScreen />);

    expect(await findByText('23:00 — 06:00')).toBeTruthy();
  });

  it('keeps what the person saved when the first sync was still on its way, and plans again after the save', async () => {
    let finishSync: (value: typeof DEFAULT_NOTIFICATION_PREFERENCES) => void = () => undefined;
    (syncNotificationPreferences as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        finishSync = resolve;
      }),
    );
    // After the sync the device copy briefly holds the server's older window, as when the sync saved it over the new one.
    (loadQuietHours as jest.Mock).mockResolvedValue(DEFAULT);
    let finishQueue: () => void = () => undefined;
    (queueQuietHoursChange as jest.Mock).mockReturnValue(
      new Promise<void>((resolve) => {
        finishQueue = resolve;
      }),
    );
    const screen = await openSheet();

    await pick(screen, 'From, 22:00', 21 * 60);
    await act(async () => {
      fireEvent.press(screen.getByText('Save'));
    });
    await act(async () => {
      finishSync(DEFAULT_NOTIFICATION_PREFERENCES);
    });

    expect(await screen.findByText('21:00 — 07:00')).toBeTruthy();
    // The plan made when the sync ended is not the last word: the saved window is planned around once it is kept.
    const plannedBeforeSave = (requestLocalNotificationReconcile as jest.Mock).mock.calls.length;
    await act(async () => {
      finishQueue();
    });
    await waitFor(() => expect(requestLocalNotificationReconcile).toHaveBeenCalledTimes(plannedBeforeSave + 1));
  });

  it('sends a double tap on Save once', async () => {
    const screen = await openSheet();
    await pick(screen, 'From, 22:00', 21 * 60);

    await act(async () => {
      fireEvent.press(screen.getByText('Save'));
      fireEvent.press(screen.getByText('Save'));
    });

    await waitFor(() => expect(queueQuietHoursChange).toHaveBeenCalledTimes(1));
  });

  it('describes the controls to a screen reader', async () => {
    const { getByLabelText, findByText } = await render(<NotifsScreen />);

    fireEvent.press(await findByText('Change'));
    await findByText('Save');

    expect(getByLabelText('From, 22:00').props.accessibilityRole).toBe('button');
    expect(getByLabelText('Until, 07:00').props.accessibilityRole).toBe('button');
  });
});
