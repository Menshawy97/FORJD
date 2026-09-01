// ADR-019. RED first: the new onboarding screen that sits between signup and goals, porting
// the prototype's `s_pickUsername()`. See signup-submit.test.tsx for the navigation change
// that lands on this screen, and edit-profile.test.tsx for the same username/avatar controls
// reused on the settings side.
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import { AxiosError } from 'axios';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { replace: (...args: unknown[]) => mockReplace(...args) } }));

jest.mock('@/auth/apiClient', () => ({
  updateProfile: jest.fn(),
  uploadAvatar: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

import * as ImagePicker from 'expo-image-picker';
import { updateProfile, uploadAvatar } from '@/auth/apiClient';
import PickUsernameScreen from '../pick-username';

describe('PickUsernameScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the design copy and controls', async () => {
    const { findByText, findByLabelText, findByPlaceholderText } = await render(
      <PickUsernameScreen />,
    );

    await findByText('Your Profile');
    await findByText('Pick a unique username and add a photo so friends can find you.');
    await findByText('Upload photo');
    await findByPlaceholderText('e.g. jsmith');
    await findByText('3–20 characters: letters, numbers, underscores.');
    await findByLabelText('Continue');
  });

  // The prototype's own sanitizer, verbatim: `toLowerCase().replace(/[^a-z0-9_]/g,'')`.
  it('sanitizes username input as it is typed', async () => {
    const { findByLabelText, findByDisplayValue } = await render(<PickUsernameScreen />);

    fireEvent.changeText(await findByLabelText('Username'), 'Ada King!!');

    expect(await findByDisplayValue('adaking')).toBeTruthy();
  });

  it('shows an inline error and does not submit for a too-short username', async () => {
    const { findByLabelText, findByText } = await render(<PickUsernameScreen />);

    fireEvent.changeText(await findByLabelText('Username'), 'ab');
    fireEvent.press(await findByLabelText('Continue'));

    expect(await findByText('Enter 3–20 letters, numbers, or underscores.')).toBeTruthy();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('navigates to goals as a first-run once the username is accepted', async () => {
    (updateProfile as jest.Mock).mockResolvedValue({});

    const { findByLabelText } = await render(<PickUsernameScreen />);

    fireEvent.changeText(await findByLabelText('Username'), 'jsmith');
    fireEvent.press(await findByLabelText('Continue'));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ username: 'jsmith' }));
    expect(mockReplace).toHaveBeenCalledWith('/goals?returnTo=newAccount');
  });

  it('shows "That username is taken." on a 409 conflict and does not navigate', async () => {
    (updateProfile as jest.Mock).mockRejectedValue(
      new AxiosError('Conflict', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 409,
      } as never),
    );

    const { findByLabelText, findByText } = await render(<PickUsernameScreen />);

    fireEvent.changeText(await findByLabelText('Username'), 'jmitch');
    fireEvent.press(await findByLabelText('Continue'));

    expect(await findByText('That username is taken.')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('uploads a picked photo and includes the returned URL in the profile patch', async () => {
    (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
    });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/photo.jpg' }],
    });
    (uploadAvatar as jest.Mock).mockResolvedValue({
      avatarUrl: 'https://cdn.example.com/avatars/u1.jpg',
    });
    (updateProfile as jest.Mock).mockResolvedValue({});

    const { findByLabelText } = await render(<PickUsernameScreen />);

    fireEvent.press(await findByLabelText('Add photo'));
    await waitFor(() => expect(uploadAvatar).toHaveBeenCalledWith('file:///tmp/photo.jpg'));

    fireEvent.changeText(await findByLabelText('Username'), 'jsmith');
    fireEvent.press(await findByLabelText('Continue'));

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith({
        username: 'jsmith',
        avatarUrl: 'https://cdn.example.com/avatars/u1.jpg',
      }),
    );
  });

  it('back navigates to signup', async () => {
    const { findByLabelText } = await render(<PickUsernameScreen />);

    fireEvent.press(await findByLabelText('Back'));

    expect(mockReplace).toHaveBeenCalledWith('/signup');
  });
});
