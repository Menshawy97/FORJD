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
  setDateOfBirth: jest.fn(),
}));

jest.mock('@/auth/secureStorage', () => ({ clearSession: jest.fn() }));
jest.mock('@/store/local-data', () => ({ clearLocalUserData: jest.fn() }));

// A native module with nothing meaningful to render in Jest. This stand-in is a button that
// "picks" whatever date the test set, by invoking onChange the way the real picker does.
const mockPicked: { date: Date } = { date: new Date(1990, 0, 15) };
jest.mock('@react-native-community/datetimepicker', () => {
  const { Pressable } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: (props: { onChange: (event: unknown, date: Date) => void }) => (
      <Pressable testID="date-picker" onPress={() => props.onChange({}, mockPicked.date)} />
    ),
  };
});

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

// ADR-024: the client-side pre-resize step. Mocked at the `expo-image-manipulator` boundary so
// the real `resizeImageForUpload` utility (`@/media/resize-image-for-upload`) is exercised for
// real, same reasoning as every other native-module mock in this file.
//
// Built entirely inside the factory rather than referencing outer `mock`-prefixed consts --
// Jest's hoisting plugin permits that reference syntactically but does not guarantee the const
// is initialized before the factory runs (see `resize-image-for-upload.test.ts` for the
// concrete failure this caused). References are pulled back out via the mocked import instead.
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { WEBP: 'webp', JPEG: 'jpeg', PNG: 'png' },
}));

import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator } from 'expo-image-manipulator';
import { consumeUnderageNotice } from '@/auth/account-notice';
import { setDateOfBirth, updateProfile, uploadAvatar } from '@/auth/apiClient';
import { getDateOfBirthNeeded, requireDateOfBirth } from '@/auth/date-of-birth-gate';
import { clearSession } from '@/auth/secureStorage';
import { clearLocalUserData } from '@/store/local-data';
import PickUsernameScreen from '../pick-username';

/** Picks a birthday through the (mocked) date picker, the way a person would. */
async function chooseBirthday(
  screen: { findByLabelText: (label: string) => Promise<never>; findByTestId: (id: string) => Promise<never> },
  date: Date,
) {
  mockPicked.date = date;
  fireEvent.press(await screen.findByLabelText('Date of birth'));
  fireEvent.press(await screen.findByTestId('date-picker'));
}

const mockManipulate = ImageManipulator.manipulate as jest.Mock;

describe('PickUsernameScreen', () => {
  const mockSaveAsync = jest.fn();
  const mockRenderAsync = jest.fn();
  const mockResize = jest.fn();
  const mockManipulationContext = { resize: mockResize, renderAsync: mockRenderAsync };

  beforeEach(() => {
    jest.clearAllMocks();
    mockManipulate.mockReturnValue(mockManipulationContext);
    (setDateOfBirth as jest.Mock).mockResolvedValue(undefined);
    (clearSession as jest.Mock).mockResolvedValue(undefined);
    (clearLocalUserData as jest.Mock).mockResolvedValue(undefined);
    consumeUnderageNotice();
    requireDateOfBirth();
    mockResize.mockReturnValue(mockManipulationContext);
    mockRenderAsync.mockResolvedValue({ saveAsync: mockSaveAsync });
    mockSaveAsync.mockResolvedValue({
      uri: 'file:///tmp/resized.webp',
      width: 512,
      height: 512,
    });
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

  // signuppage2.png -- the field sits under the username hint, before Continue.
  it('shows the design date of birth field, its placeholder and the age rule', async () => {
    const { findByText, findByLabelText } = await render(<PickUsernameScreen />);

    await findByText('Date of birth');
    expect(await findByLabelText('Date of birth')).toBeTruthy();
    await findByText('mm/dd/yyyy');
    await findByText('You must be at least 16 years old to use FORJD.');
  });

  it('shows the chosen birthday as mm/dd/yyyy', async () => {
    const screen = await render(<PickUsernameScreen />);

    await chooseBirthday(screen as never, new Date(1998, 3, 12));

    expect(await screen.findByText('04/12/1998')).toBeTruthy();
  });

  it('asks for a date of birth and touches the server not at all when none is chosen', async () => {
    const { findByLabelText, findByText } = await render(<PickUsernameScreen />);

    fireEvent.changeText(await findByLabelText('Username'), 'jsmith');
    fireEvent.press(await findByLabelText('Continue'));

    expect(await findByText('Enter your date of birth.')).toBeTruthy();
    expect(setDateOfBirth).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('sends the date of birth first, then the profile, then lifts the age gate and moves on', async () => {
    (updateProfile as jest.Mock).mockResolvedValue({});
    const screen = await render(<PickUsernameScreen />);

    fireEvent.changeText(await screen.findByLabelText('Username'), 'jsmith');
    await chooseBirthday(screen as never, new Date(1998, 3, 12));
    fireEvent.press(await screen.findByLabelText('Continue'));

    await waitFor(() => expect(setDateOfBirth).toHaveBeenCalledWith('1998-04-12'));
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ username: 'jsmith' }));
    expect((setDateOfBirth as jest.Mock).mock.invocationCallOrder[0]!).toBeLessThan(
      (updateProfile as jest.Mock).mock.invocationCallOrder[0]!,
    );
    expect(getDateOfBirthNeeded()).toBe(false);
    expect(mockReplace).toHaveBeenCalledWith('/goals?returnTo=newAccount');
  });

  it('turns an under-16 away: the account is gone, so sign out, wipe the device and say why', async () => {
    (setDateOfBirth as jest.Mock).mockRejectedValue(
      new AxiosError('Forbidden', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 403,
        data: { code: 'underage' },
      } as never),
    );
    const screen = await render(<PickUsernameScreen />);

    fireEvent.changeText(await screen.findByLabelText('Username'), 'jsmith');
    await chooseBirthday(screen as never, new Date(new Date().getFullYear() - 12, 0, 1));
    fireEvent.press(await screen.findByLabelText('Continue'));

    await waitFor(() => expect(clearSession).toHaveBeenCalledTimes(1));
    expect(clearLocalUserData).toHaveBeenCalledTimes(1);
    expect(consumeUnderageNotice()).toBe(true);
    expect(updateProfile).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalledWith('/goals?returnTo=newAccount');
  });

  it('treats "a date is already on file" (409) as done, so a retry after a failed username save works', async () => {
    (setDateOfBirth as jest.Mock).mockRejectedValue(
      new AxiosError('Conflict', 'ERR_BAD_REQUEST', undefined, undefined, { status: 409 } as never),
    );
    (updateProfile as jest.Mock).mockResolvedValue({});
    const screen = await render(<PickUsernameScreen />);

    fireEvent.changeText(await screen.findByLabelText('Username'), 'jsmith');
    await chooseBirthday(screen as never, new Date(1998, 3, 12));
    fireEvent.press(await screen.findByLabelText('Continue'));

    await waitFor(() => expect(updateProfile).toHaveBeenCalled());
    expect(mockReplace).toHaveBeenCalledWith('/goals?returnTo=newAccount');
  });

  it('does not lift the age gate when the date could not be saved', async () => {
    (setDateOfBirth as jest.Mock).mockRejectedValue(new Error('offline'));
    const screen = await render(<PickUsernameScreen />);

    fireEvent.changeText(await screen.findByLabelText('Username'), 'jsmith');
    await chooseBirthday(screen as never, new Date(1998, 3, 12));
    fireEvent.press(await screen.findByLabelText('Continue'));

    await waitFor(() => expect(setDateOfBirth).toHaveBeenCalled());
    expect(getDateOfBirthNeeded()).toBe(true);
    expect(updateProfile).not.toHaveBeenCalled();
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

    const screen = await render(<PickUsernameScreen />);

    fireEvent.changeText(await screen.findByLabelText('Username'), 'jsmith');
    await chooseBirthday(screen as never, new Date(1998, 3, 12));
    fireEvent.press(await screen.findByLabelText('Continue'));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ username: 'jsmith' }));
    expect(mockReplace).toHaveBeenCalledWith('/goals?returnTo=newAccount');
  });

  it('shows "That username is taken." on a 409 conflict and does not navigate', async () => {
    (updateProfile as jest.Mock).mockRejectedValue(
      new AxiosError('Conflict', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 409,
      } as never),
    );

    const screen = await render(<PickUsernameScreen />);

    fireEvent.changeText(await screen.findByLabelText('Username'), 'jmitch');
    await chooseBirthday(screen as never, new Date(1998, 3, 12));
    fireEvent.press(await screen.findByLabelText('Continue'));

    expect(await screen.findByText('That username is taken.')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('uploads a picked photo and includes the returned URL in the profile patch', async () => {
    (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
    });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/photo.jpg', width: 4000, height: 3000 }],
    });
    (uploadAvatar as jest.Mock).mockResolvedValue({
      avatarUrl: 'https://cdn.example.com/avatars/u1.jpg',
    });
    (updateProfile as jest.Mock).mockResolvedValue({});

    const screen = await render(<PickUsernameScreen />);
    const { findByLabelText } = screen;

    fireEvent.press(await findByLabelText('Add photo'));
    // ADR-024: the raw picker URI is resized/re-encoded client-side first -- `uploadAvatar`
    // receives the resized result's URI, not the original picked one.
    await waitFor(() => expect(mockManipulate).toHaveBeenCalledWith('file:///tmp/photo.jpg'));
    await waitFor(() => expect(uploadAvatar).toHaveBeenCalledWith('file:///tmp/resized.webp'));

    fireEvent.changeText(await findByLabelText('Username'), 'jsmith');
    await chooseBirthday(screen as never, new Date(1998, 3, 12));
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
