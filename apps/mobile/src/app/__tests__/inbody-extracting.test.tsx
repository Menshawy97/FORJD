// ADR-052: while an InBody photo is being read -- the app's longest wait, several seconds
// of server-side extraction -- the drop zone shows animation #3, the pulsing FORJD symbol.
import { fireEvent, render as rtlRender } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: { push: jest.fn(), back: jest.fn() },
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
}));

import * as ImagePicker from 'expo-image-picker';

import { extractBodyScan, listBodyScans } from '@/auth/apiClient';

import InBodyScreen from '../inbody';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

describe('InBody photo extraction', () => {
  it('shows the logo loader while the photo is being read', async () => {
    (listBodyScans as jest.Mock).mockResolvedValue({ scans: [] });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///sheet.jpg' }],
    });
    (extractBodyScan as jest.Mock).mockReturnValue(new Promise(() => {}));

    const { findByText, findByLabelText, queryByText } = await render(<InBodyScreen />);
    await fireEvent.press(await findByText('Choose from library instead'));

    expect(await findByLabelText('Loading')).toBeTruthy();
    expect(queryByText('Take photo or upload')).toBeNull();
  });
});
