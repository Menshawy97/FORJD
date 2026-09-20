import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import { AxiosError } from 'axios';
import type { ReactElement } from 'react';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
const mockUseLocalSearchParams = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

jest.mock('@/auth/apiClient', () => ({
  updatePrivacy: jest.fn(),
  updateProfile: jest.fn(),
}));

jest.mock('@/integrations/location/location-provider', () => ({
  requestCoarsePermission: jest.fn(),
}));

import { updatePrivacy, updateProfile } from '@/auth/apiClient';
import { requestCoarsePermission } from '@/integrations/location/location-provider';
import LocationScreen from '../location';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

// ADR-048. This screen is the one place the app asks for location, once. Allowing it records the
// person's consent (both flags, in one request); it never writes a city, because the server
// derives that from the position a workout starts with.
describe('LocationScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
    (requestCoarsePermission as jest.Mock).mockResolvedValue('granted');
    (updatePrivacy as jest.Mock).mockResolvedValue({});
  });

  it('renders the explainer copy and the Q&A block', async () => {
    const { findByText } = await render(<LocationScreen />);

    expect(await findByText('City Leaderboard Location')).toBeTruthy();
    expect(await findByText(/FORJD uses your approximate location/i)).toBeTruthy();
    expect(await findByText('Why is location used?')).toBeTruthy();
    expect(await findByText('When is it used?')).toBeTruthy();
    expect(await findByText('What if you decline?')).toBeTruthy();
  });

  it('says truthfully when location is read: at the start of a workout, never in the background', async () => {
    const { findByText, queryByText } = await render(<LocationScreen />);

    expect(await findByText(/start a workout/i)).toBeTruthy();
    expect(await findByText(/never tracked in the background/i)).toBeTruthy();
    // The design's own wording said "once during setup", which stopped being true.
    expect(queryByText(/once during setup/i)).toBeNull();
  });

  it('does not ask for permission until the person taps Allow', async () => {
    await render(<LocationScreen />);

    expect(requestCoarsePermission).not.toHaveBeenCalled();
  });

  it('defaults the tab bar to Rank when no back param is given', async () => {
    const { findByLabelText } = await render(<LocationScreen />);

    expect((await findByLabelText('Rank')).props.accessibilityState?.selected).toBe(true);
  });

  it('shows the tab bar on Profile when back=privacy', async () => {
    mockUseLocalSearchParams.mockReturnValue({ back: 'privacy' });

    const { findByLabelText } = await render(<LocationScreen />);

    expect((await findByLabelText('Profile')).props.accessibilityState?.selected).toBe(true);
  });

  describe('Allow Location', () => {
    it('asks for permission, then records both consents in one request', async () => {
      const { findByText } = await render(<LocationScreen />);

      await fireEvent.press(await findByText('Allow Location'));

      await waitFor(() =>
        expect(updatePrivacy).toHaveBeenCalledWith({ leaderboardOptIn: true, locationForLeaderboard: true }),
      );
      expect(requestCoarsePermission).toHaveBeenCalledTimes(1);
    });

    it('records nothing until the system permission has been granted', async () => {
      let resolvePermission: (value: string) => void = () => undefined;
      (requestCoarsePermission as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          resolvePermission = resolve;
        }),
      );

      const { findByText } = await render(<LocationScreen />);
      // Not awaited: the handler is still waiting on the system dialog, and awaiting its promise would wait for it.
      void fireEvent.press(await findByText('Allow Location'));

      await waitFor(() => expect(requestCoarsePermission).toHaveBeenCalledTimes(1));
      expect(updatePrivacy).not.toHaveBeenCalled();
      resolvePermission('granted');
      await waitFor(() => expect(updatePrivacy).toHaveBeenCalledTimes(1));
    });

    it('never writes a city: the server derives it from the position a workout starts with', async () => {
      const { findByText } = await render(<LocationScreen />);

      await fireEvent.press(await findByText('Allow Location'));

      await waitFor(() => expect(updatePrivacy).toHaveBeenCalled());
      expect(updateProfile).not.toHaveBeenCalled();
    });

    it('confirms with a toast, and does not claim a city it does not know yet', async () => {
      const { findByText, queryByText } = await render(<LocationScreen />);

      await fireEvent.press(await findByText('Allow Location'));

      expect(await findByText('Location allowed')).toBeTruthy();
      expect(queryByText(/assigned to/i)).toBeNull();
    });

    it('navigates to the rank tab by default', async () => {
      const { findByText } = await render(<LocationScreen />);

      await fireEvent.press(await findByText('Allow Location'));

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/rank'));
    });

    it('navigates to the back param destination when set', async () => {
      mockUseLocalSearchParams.mockReturnValue({ back: 'privacy' });

      const { findByText } = await render(<LocationScreen />);

      await fireEvent.press(await findByText('Allow Location'));

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/privacy'));
    });

    it('asks only once when the button is pressed again while it works', async () => {
      let resolvePermission: (value: string) => void = () => undefined;
      (requestCoarsePermission as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          resolvePermission = resolve;
        }),
      );

      const { findByText, findByRole } = await render(<LocationScreen />);
      void fireEvent.press(await findByText('Allow Location'));

      // While it works the button is disabled, so a second tap cannot ask again.
      await waitFor(() => expect(requestCoarsePermission).toHaveBeenCalledTimes(1));
      const button = await findByRole('button', { name: 'Allow Location', disabled: true });
      await fireEvent.press(button);
      await fireEvent.press(button);
      expect(requestCoarsePermission).toHaveBeenCalledTimes(1);
      resolvePermission('granted');
      await waitFor(() => expect(updatePrivacy).toHaveBeenCalledTimes(1));
    });

    it('shows an inline error and does not navigate when saving the consent fails', async () => {
      (updatePrivacy as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));

      const { findByText } = await render(<LocationScreen />);

      await fireEvent.press(await findByText('Allow Location'));

      expect(await findByText(/cannot reach forjd/i)).toBeTruthy();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('offers the button again after a failure, so the person can retry', async () => {
      (updatePrivacy as jest.Mock).mockRejectedValueOnce(new AxiosError('Network Error'));

      const { findByText } = await render(<LocationScreen />);
      await fireEvent.press(await findByText('Allow Location'));
      await findByText(/cannot reach forjd/i);

      await fireEvent.press(await findByText('Allow Location'));

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/rank'));
    });

    it('shows a generic message for a failure that is not the network', async () => {
      (updatePrivacy as jest.Mock).mockRejectedValue(new Error('boom'));

      const { findByText } = await render(<LocationScreen />);
      await fireEvent.press(await findByText('Allow Location'));

      expect(await findByText('Could not update your location. Please try again.')).toBeTruthy();
    });
  });

  describe('leaving while a request is still in flight', () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('does not record consent after the person has pressed Not Now during the system dialog', async () => {
      let resolvePermission: (value: string) => void = () => undefined;
      (requestCoarsePermission as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          resolvePermission = resolve;
        }),
      );

      const { findByText } = await render(<LocationScreen />);
      void fireEvent.press(await findByText('Allow Location'));
      await waitFor(() => expect(requestCoarsePermission).toHaveBeenCalledTimes(1));

      await fireEvent.press(await findByText('Not Now'));
      resolvePermission('granted');
      await settle();

      expect(updatePrivacy).not.toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });

    it('does not navigate a second time when the save finishes after the person has left', async () => {
      let resolveSave: (value: object) => void = () => undefined;
      (updatePrivacy as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
      );

      const { findByText, findByLabelText } = await render(<LocationScreen />);
      void fireEvent.press(await findByText('Allow Location'));
      await waitFor(() => expect(updatePrivacy).toHaveBeenCalledTimes(1));

      await fireEvent.press(await findByLabelText('Back'));
      resolveSave({});
      await settle();

      expect(mockReplace).toHaveBeenCalledTimes(1);
    });

    it('does not show a message for a decline that arrives after the person has left', async () => {
      let resolvePermission: (value: string) => void = () => undefined;
      (requestCoarsePermission as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          resolvePermission = resolve;
        }),
      );

      const { findByText, queryByText } = await render(<LocationScreen />);
      void fireEvent.press(await findByText('Allow Location'));
      await waitFor(() => expect(requestCoarsePermission).toHaveBeenCalledTimes(1));
      await fireEvent.press(await findByText('Not Now'));
      resolvePermission('denied');
      await settle();

      expect(queryByText(/location is off for forjd/i)).toBeNull();
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the system permission is unavailable and the person tries again', () => {
    it('shows the message, then records consent once the permission works', async () => {
      (requestCoarsePermission as jest.Mock).mockResolvedValueOnce('unavailable').mockResolvedValueOnce('granted');

      const { findByText, queryByText } = await render(<LocationScreen />);
      await fireEvent.press(await findByText('Allow Location'));
      await findByText(/isn't available in this version of the app/i);

      await fireEvent.press(await findByText('Allow Location'));

      await waitFor(() => expect(updatePrivacy).toHaveBeenCalledTimes(1));
      expect(queryByText(/isn't available in this version of the app/i)).toBeNull();
    });
  });

  describe('when the person declines the system permission', () => {
    beforeEach(() => {
      (requestCoarsePermission as jest.Mock).mockResolvedValue('denied');
    });

    it('says what that means, records no consent, and stays on the screen', async () => {
      const { findByText } = await render(<LocationScreen />);

      await fireEvent.press(await findByText('Allow Location'));

      expect(await findByText(/location is off for forjd/i)).toBeTruthy();
      expect(updatePrivacy).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('offers to open the system settings, where the permission can be changed later', async () => {
      const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();

      const { findByText } = await render(<LocationScreen />);
      await fireEvent.press(await findByText('Allow Location'));
      await fireEvent.press(await findByText('Open Settings'));

      expect(openSettings).toHaveBeenCalledTimes(1);
      openSettings.mockRestore();
    });

    it('does not show the settings shortcut before a decline', async () => {
      const { findByText, queryByText } = await render(<LocationScreen />);

      await findByText('Allow Location');

      expect(queryByText('Open Settings')).toBeNull();
    });

    it('still lets the person leave with Not Now', async () => {
      const { findByText } = await render(<LocationScreen />);
      await fireEvent.press(await findByText('Allow Location'));
      await findByText(/location is off for forjd/i);

      await fireEvent.press(await findByText('Not Now'));

      expect(mockReplace).toHaveBeenCalledWith('/rank');
    });

    it('clears the message once the person tries again and it works', async () => {
      (requestCoarsePermission as jest.Mock).mockResolvedValueOnce('denied').mockResolvedValueOnce('granted');

      const { findByText, queryByText } = await render(<LocationScreen />);
      await fireEvent.press(await findByText('Allow Location'));
      await findByText(/location is off for forjd/i);

      await fireEvent.press(await findByText('Allow Location'));

      await waitFor(() => expect(updatePrivacy).toHaveBeenCalledTimes(1));
      expect(queryByText(/location is off for forjd/i)).toBeNull();
    });
  });

  describe('when location is not available in this build', () => {
    it('says the app build is needed and records nothing', async () => {
      (requestCoarsePermission as jest.Mock).mockResolvedValue('unavailable');

      const { findByText } = await render(<LocationScreen />);
      await fireEvent.press(await findByText('Allow Location'));

      expect(await findByText(/isn't available in this version of the app/i)).toBeTruthy();
      expect(updatePrivacy).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  it('Not Now navigates away without asking or writing anything', async () => {
    const { findByText } = await render(<LocationScreen />);

    await fireEvent.press(await findByText('Not Now'));

    expect(requestCoarsePermission).not.toHaveBeenCalled();
    expect(updatePrivacy).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/rank');
  });

  it('the back chevron navigates to the same destination as Not Now', async () => {
    mockUseLocalSearchParams.mockReturnValue({ back: 'privacy' });

    const { findByLabelText } = await render(<LocationScreen />);

    await fireEvent.press(await findByLabelText('Back'));

    expect(mockReplace).toHaveBeenCalledWith('/privacy');
  });
});
