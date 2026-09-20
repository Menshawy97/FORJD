// Phase 10L. Profile's "Data sources" row opens the attribution page, the way every other settings
// destination off Profile does (`router.replace`, ADR-011).
import { fireEvent, render as rtlRender } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: { replace: (...args: unknown[]) => mockReplace(...args), push: jest.fn() },
    useFocusEffect: (callback: () => void) => {
      react.useEffect(() => callback(), []);
    },
    Link: 'Link',
  };
});

jest.mock('@/auth/apiClient', () => ({
  getMe: jest.fn().mockResolvedValue({
    id: 'u1',
    email: 'a@b.com',
    profile: null,
    dateOfBirth: null,
  }),
  getProgramEnrollment: jest.fn().mockResolvedValue({ enrollment: null }),
  getAccountExport: jest.fn(),
}));

import ProfileScreen from '../(tabs)/profile';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

describe('Profile: Data sources row', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens the Data sources page', async () => {
    const { findByText } = await render(<ProfileScreen />);

    await fireEvent.press(await findByText('Data sources'));

    expect(mockReplace).toHaveBeenCalledWith('/data-sources');
  });
});
