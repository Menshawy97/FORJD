// ADR-050. The route map: Google's street map under the route when a key is configured and the
// native module is present, otherwise the designed striped background with the same route drawn
// over it. The native module is mocked at its boundary; what is proven is which of the two
// renders, that the route reaches the map, and that a missing module never crashes a run.
import { render } from '@testing-library/react-native';
import { Platform } from 'react-native';

const mockExtra: { hasMapsKey?: boolean } = {};
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: mockExtra };
    },
  },
}));

const mockMapView = jest.fn();
const mockPolyline = jest.fn();
const mockMarker = jest.fn();
jest.mock('react-native-maps', () => {
  // No JSX and no createElement here: NativeWind's Babel transform rewrites both into references
  // that jest.mock cannot hoist. The map is proven by what it was called with, not by its output.
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      mockMapView(props);
      return props.children ?? null;
    },
    Polyline: (props: Record<string, unknown>) => {
      mockPolyline(props);
      return null;
    },
    Marker: (props: Record<string, unknown>) => {
      mockMarker(props);
      return null;
    },
    PROVIDER_GOOGLE: 'google',
  };
});

import { RouteMap } from '../route-map';

const route = [
  { latitude: 31.2, longitude: 29.9 },
  { latitude: 31.201, longitude: 29.902 },
  { latitude: 31.203, longitude: 29.905 },
];

describe('RouteMap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExtra.hasMapsKey = false;
  });

  describe('without a Maps key', () => {
    it('draws the striped background and the route, not a Google map', async () => {
      const screen = await render(<RouteMap points={route} height={206} caption="live map · route + km markers" />);

      expect(screen.getByTestId('route-map-fallback')).toBeTruthy();
      expect(screen.getByTestId('route-line')).toBeTruthy();
      expect(screen.getByText('live map · route + km markers')).toBeTruthy();
      expect(mockMapView).not.toHaveBeenCalled();
    });

    it('shows the caption alone until there is a route to draw', async () => {
      const screen = await render(<RouteMap points={[]} height={206} caption="route + km markers" />);

      expect(screen.getByText('route + km markers')).toBeTruthy();
      expect(screen.queryByTestId('route-line')).toBeNull();
    });

    it('marks the start and, once there is a route, the end', async () => {
      const screen = await render(<RouteMap points={route} height={180} caption="route" />);

      expect(screen.getByTestId('route-start')).toBeTruthy();
      expect(screen.getByTestId('route-end')).toBeTruthy();
    });

    it('draws a lone point as a start marker only', async () => {
      const screen = await render(<RouteMap points={route.slice(0, 1)} height={180} caption="route" />);

      expect(screen.getByTestId('route-start')).toBeTruthy();
      expect(screen.queryByTestId('route-line')).toBeNull();
      expect(screen.queryByTestId('route-end')).toBeNull();
    });

    it('is described to a screen reader as a route map with its length', async () => {
      const screen = await render(<RouteMap points={route} height={206} caption="route" />);

      expect(screen.getByLabelText('Map of your run route')).toBeTruthy();
    });

    it('uses the callers description for a screen reader when given', async () => {
      const screen = await render(
        <RouteMap points={route} height={206} caption="route" accessibilityLabel="Run route, 3.2 km" />,
      );

      expect(screen.getByLabelText('Run route, 3.2 km')).toBeTruthy();
    });

    it('takes the height it is given', async () => {
      const screen = await render(<RouteMap points={route} height={180} caption="route" />);

      expect(screen.getByTestId('route-map-fallback').props.style).toEqual(
        expect.objectContaining({ height: 180 }),
      );
    });
  });

  describe('with a Maps key on iOS', () => {
    it('still draws the striped background: there is no iOS Google key until Phase 11 decides one', async () => {
      mockExtra.hasMapsKey = true;

      const screen = await render(<RouteMap points={route} height={206} caption="route" />);

      expect(screen.getByTestId('route-map-fallback')).toBeTruthy();
      expect(mockMapView).not.toHaveBeenCalled();
    });
  });

  describe('with a Maps key and the native module, on Android', () => {
    beforeEach(() => {
      mockExtra.hasMapsKey = true;
      jest.replaceProperty(Platform, 'OS', 'android');
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('renders the Google map with the route on top, in the design colour', async () => {
      const screen = await render(<RouteMap points={route} height={206} caption="route" />);

      expect(screen.queryByTestId('route-map-fallback')).toBeNull();
      expect(mockMapView).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google' }));
      expect(mockPolyline).toHaveBeenCalledWith(
        expect.objectContaining({
          coordinates: route,
          strokeColor: '#E9712F',
          strokeWidth: 4,
        }),
      );
    });

    it('turns off everything a run map does not need: gestures, toolbar, compass, traffic', async () => {
      await render(<RouteMap points={route} height={206} caption="route" />);

      expect(mockMapView).toHaveBeenCalledWith(
        expect.objectContaining({
          scrollEnabled: false,
          zoomEnabled: false,
          pitchEnabled: false,
          rotateEnabled: false,
          toolbarEnabled: false,
          showsCompass: false,
          showsTraffic: false,
          showsUserLocation: false,
        }),
      );
    });

    it('passes a dark style so the map sits in the app, not on top of it', async () => {
      await render(<RouteMap points={route} height={206} caption="route" />);

      const props = mockMapView.mock.calls[0]?.[0] as { customMapStyle?: unknown[] };
      expect(Array.isArray(props.customMapStyle)).toBe(true);
      expect(props.customMapStyle?.length).toBeGreaterThan(0);
    });

    it('marks the start and the end', async () => {
      await render(<RouteMap points={route} height={206} caption="route" />);

      expect(mockMarker).toHaveBeenCalledTimes(2);
      expect(mockMarker.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ coordinate: route[0] }));
      expect(mockMarker.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ coordinate: route[2] }));
    });

    it('draws no line for fewer than two points', async () => {
      await render(<RouteMap points={route.slice(0, 1)} height={206} caption="route" />);

      expect(mockPolyline).not.toHaveBeenCalled();
    });

    it('fits the map to the route, with room round it', async () => {
      await render(<RouteMap points={route} height={206} caption="route" />);

      const props = mockMapView.mock.calls[0]?.[0] as { region?: Record<string, number> };
      expect(props.region?.latitude).toBeCloseTo(31.2015, 4);
      expect(props.region?.longitude).toBeCloseTo(29.9025, 4);
      expect(props.region?.latitudeDelta).toBeGreaterThan(0.003);
      expect(props.region?.longitudeDelta).toBeGreaterThan(0.005);
    });

    it('does not paint the Google logo away: it leaves the map padding alone', async () => {
      await render(<RouteMap points={route} height={206} caption="route" />);

      const props = mockMapView.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(props).not.toHaveProperty('mapPadding');
    });
  });
});
