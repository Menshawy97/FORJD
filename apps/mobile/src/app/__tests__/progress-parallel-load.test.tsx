// Whole-app review 8.5, L9b-1. Progress loads four independent sections. It used to wait for each
// before asking for the next -- four cross-region round trips one after another (~2.5-3 s) on every
// visit. All four must now be asked for together.
import { render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (callback: () => void) => {
    const react = require('react');
    react.useEffect(() => {
      callback();
    }, []);
  },
}));

// Never answer, so a loader that waits for one before starting the next would only ever start one.
const pending = () => new Promise<never>(() => undefined);
jest.mock('@/auth/apiClient', () => ({
  getProgressStrength: jest.fn(() => pending()),
  getBodyScanSeries: jest.fn(() => pending()),
  getHealthObservationSeries: jest.fn(() => pending()),
  getReadiness: jest.fn(() => pending()),
  getLeaderboard: jest.fn(() => pending()),
}));

import { getBodyScanSeries, getHealthObservationSeries, getProgressStrength, getReadiness } from '@/auth/apiClient';

import ProgressScreen from '../(tabs)/progress';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

it('asks for all four sections at once, not one after another', async () => {
  await render(<ProgressScreen />);

  await waitFor(() => expect(getProgressStrength).toHaveBeenCalledTimes(1));
  expect(getBodyScanSeries).toHaveBeenCalledTimes(1);
  expect(getHealthObservationSeries).toHaveBeenCalledTimes(1);
  expect(getReadiness).toHaveBeenCalledTimes(1);
});
