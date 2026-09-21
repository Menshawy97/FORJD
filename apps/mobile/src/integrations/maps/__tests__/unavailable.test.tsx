// ADR-050. `react-native-maps` is a native module, and Expo Go does not bundle it. The route map must
// degrade to the striped background, never crash, so a missing module cannot take a run down with
// it. Its own file, with its own module registry, so the lazy-load cache starts clean.
import { render } from '@testing-library/react-native';
import { Platform } from 'react-native';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { hasMapsKey: true } } },
}));

jest.mock('react-native-maps', () => {
  throw new Error("Cannot find native module 'AirMaps'");
});

import { RouteMap } from '../route-map';

describe('RouteMap when the native module is missing', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'android');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('falls back to the striped background even with a key on Android, instead of crashing', async () => {
    const screen = await render(
      <RouteMap points={[{ latitude: 31.2, longitude: 29.9 }, { latitude: 31.201, longitude: 29.902 }]} height={206} caption="route" />,
    );

    expect(screen.getByTestId('route-map-fallback')).toBeTruthy();
    expect(screen.getByTestId('route-line')).toBeTruthy();
  });
});
