// Runs in miles (docs/product/run-miles-plan.md): the signed-in app's launch read of the profile keeps the Units
// distance choice on the phone, so a run with no signal still shows miles.
import { waitFor } from '@testing-library/react-native';
import { renderApp } from './render-app';

jest.mock('expo-secure-store');
jest.mock('@/auth/apiClient', () => {
  const calls: Record<string | symbol, unknown> = {
    __esModule: true,
    getMe: jest.fn().mockResolvedValue({
      id: 'u1',
      email: 'a@example.com',
      profile: { userId: 'u1', dateOfBirth: '1990-07-04', distanceUnit: 'mi' },
      privacy: null,
    }),
  };
  // Every other call the Home screen makes waits for ever: only the launch read matters here.
  return new Proxy(calls, {
    get: (target, key) => {
      if (!(key in target)) target[key] = jest.fn(() => new Promise(() => undefined));
      return target[key];
    },
  });
});
jest.mock('@/store/run-distance-unit', () => ({ saveRunDistanceUnit: jest.fn().mockResolvedValue(undefined) }));

import * as SecureStore from 'expo-secure-store';
import { saveRunDistanceUnit } from '@/store/run-distance-unit';

describe('the run distance unit at launch', () => {
  it("keeps the profile's distance choice on the phone", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('access-1');

    await renderApp({ initialUrl: '/' });

    await waitFor(() => expect(saveRunDistanceUnit).toHaveBeenCalledWith('mi'));
  });
});
