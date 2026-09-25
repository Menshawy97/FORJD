// Height and age on scans (docs/product/scan-height-age-plan.md §1, replica approved 2026-09-25):
// when a saved scan's height differs from the profile's, the InBody screen asks before updating
// the profile. Nothing on the server changes the profile by itself.
import { fireEvent, render as rtlRender } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

let mockSearchParams: Record<string, string> = {};
const mockSetParams = jest.fn();

jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: { push: jest.fn(), back: jest.fn(), setParams: (...args: unknown[]) => mockSetParams(...args) },
    useLocalSearchParams: () => mockSearchParams,
    useFocusEffect: (callback: () => void | (() => void)) => {
      react.useEffect(() => callback(), []);
    },
  };
});

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));

jest.mock('@/auth/apiClient', () => ({
  extractBodyScan: jest.fn(),
  listBodyScans: jest.fn(),
  updateProfile: jest.fn(),
}));

import { listBodyScans, updateProfile } from '@/auth/apiClient';

import InBodyScreen from '../inbody';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  (listBodyScans as jest.Mock).mockResolvedValue({ scans: [] });
  (updateProfile as jest.Mock).mockResolvedValue({});
});

describe('profile height prompt after a scan is saved', () => {
  it('asks, with both heights, and updates the profile only when the user taps Update', async () => {
    mockSearchParams = { heightPrompt: '177.8', profileHeight: '175' };
    const { findByText, getByRole, queryByText } = await render(<InBodyScreen />);

    expect(await findByText('Update your profile height to 177.8 cm?')).toBeTruthy();
    expect(updateProfile).not.toHaveBeenCalled();

    await fireEvent.press(getByRole('button', { name: 'Update to 177.8 cm' }));

    expect(updateProfile).toHaveBeenCalledWith({ heightCm: 177.8 });
    expect(await findByText('Profile height updated')).toBeTruthy();
    expect(queryByText('Update your profile height to 177.8 cm?')).toBeNull();
  });

  it('leaves the profile alone when the user keeps their height', async () => {
    mockSearchParams = { heightPrompt: '177.8', profileHeight: '175' };
    const { findByRole, queryByText } = await render(<InBodyScreen />);

    await fireEvent.press(await findByRole('button', { name: 'Keep 175 cm' }));

    expect(updateProfile).not.toHaveBeenCalled();
    expect(queryByText('Update your profile height to 177.8 cm?')).toBeNull();
  });

  it('offers to add a height when the profile has none', async () => {
    mockSearchParams = { heightPrompt: '177.8', profileHeight: '' };
    const { findByText, getByRole } = await render(<InBodyScreen />);

    expect(await findByText(/your profile has no height yet/)).toBeTruthy();
    await fireEvent.press(getByRole('button', { name: 'Not now' }));
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('keeps the prompt and says so when the update fails', async () => {
    mockSearchParams = { heightPrompt: '177.8', profileHeight: '175' };
    (updateProfile as jest.Mock).mockRejectedValue(new Error('Network Error'));
    const { findByRole, findByText } = await render(<InBodyScreen />);

    await fireEvent.press(await findByRole('button', { name: 'Update to 177.8 cm' }));

    expect(await findByText(/Could not update your profile height/)).toBeTruthy();
    expect(await findByText('Update your profile height to 177.8 cm?')).toBeTruthy();
  });

  it('shows nothing without a saved height to offer', async () => {
    mockSearchParams = {};
    const { findByText, queryByText } = await render(<InBodyScreen />);

    expect(await findByText('Take photo or upload')).toBeTruthy();
    expect(queryByText(/Update your profile height/)).toBeNull();
  });
});
