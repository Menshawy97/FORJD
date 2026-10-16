import Constants from 'expo-constants';
import { memo, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, Pattern, Polyline as SvgPolyline, Rect } from 'react-native-svg';

import { colors } from '@/theme/tokens';

import { DARK_MAP_STYLE } from './map-style';
import { projectRoute, type RoutePoint } from './project-route';

/**
 * ADR-050. The map behind a run's route, on the live run screen and the run-complete screen.
 *
 * **This is the only file that may import `react-native-maps`** (CLAUDE.md rule 4, enforced by
 * `check-architecture-conformance.sh`). It is loaded lazily and inside a try/catch for the reason
 * the location adapter is (ADR-041): it is a native module, so where it is missing (Expo Go, web)
 * importing it at the top would crash at startup.
 *
 * Two renderings of the same route, chosen by what the build has:
 *
 * 1. **Google's street map** on Android, when a Maps key was configured for the build
 *    (`extra.hasMapsKey`) and the native module loads. The route is drawn on top by our own code as
 *    a polyline, so **the route is never sent to Google**; Google's SDK only learns which area is
 *    on screen. That is still real disclosure: its tile requests carry the viewed area at street zoom,
 *    the phone's IP address and the SDK's own telemetry, so Google learns roughly where a run
 *    started. ADR-050 states that trade-off. Without a connection the tiles do not load and the
 *    route is still drawn on the dark base. A wrong SHA-1 on the key also gives a blank map.
 * 2. **Apple Maps** on iPhone (owner decision 2026-10-16, ios-no-account-plan.md slice 4): the same
 *    `react-native-maps` component with no provider draws MapKit, which needs no key. Its dark style
 *    is Apple's own (`userInterfaceStyle`), since Google's custom style does not apply. The route is
 *    drawn the same way, so Apple likewise learns only the area on screen, never the route. Apple's
 *    Maps logo and Legal link must stay visible, so nothing pads or moves them.
 * 3. **The designed striped background** with the route drawn over it, everywhere else: Android with
 *    no key, a missing native module, or the web. This is what an Android run looks like before the
 *    Google Cloud account exists, and what tests see by default.
 *
 * Nothing here throws into a run: a run must work with the map broken (CLAUDE.md rule 6).
 */
export interface RouteMapProps {
  /** The route so far, oldest first. Empty until the first accepted fix. */
  points: readonly RoutePoint[];
  /** 206 on the live screen, 180 on the run-complete screen (the prototype's two heights). */
  height: number;
  /** The small monospace caption on the striped background ("live map · route + km markers"). */
  caption: string;
  /** What a screen reader says, e.g. "Run route, 3.2 km". Defaults to a generic description. */
  accessibilityLabel?: string;
}

type MapsSdk = typeof import('react-native-maps');

let sdk: MapsSdk | null | undefined;

function loadSdk(): MapsSdk | null {
  if (sdk !== undefined) {
    return sdk;
  }
  try {
    // A guarded `require`, not `import()`: it must throw here, inside the try, when the native
    // module is missing, and it behaves the same under Metro and Jest.
    sdk = require('react-native-maps') as MapsSdk;
  } catch {
    sdk = null;
  }
  return sdk;
}

function hasMapsKey(): boolean {
  return Constants.expoConfig?.extra?.hasMapsKey === true;
}

/** Which native map this build can draw, before the module is loaded: Google, Apple, or none. */
type NativeMap = 'google' | 'apple';

function nativeMapFor(os: typeof Platform.OS): NativeMap | null {
  if (os === 'android') return hasMapsKey() ? 'google' : null;
  if (os === 'ios') return 'apple';
  return null;
}

// The prototype's map box (FORJD Mobile.dc.html s_run): radius 16, a 1px hairline, the stripes
// `repeating-linear-gradient(135deg,#141517 0 9px,#191a1c 9px 18px)`, a 4px route in the accent,
// a start marker of r6 with a 3px accent stroke on the page colour, an end marker of r7 solid accent.
const RADIUS = 16;
const STRIPE_DARK = '#141517';
const STRIPE_LIGHT = '#191A1C';
const STRIPE_WIDTH = 9;
const ROUTE_WIDTH = 4;
const START_RADIUS = 6;
const START_STROKE = 3;
const END_RADIUS = 7;
const PADDING = 20;
// The prototype's fallback SVG is 340 wide before the container is measured.
const DEFAULT_WIDTH = 340;
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** How much wider than the route the Google map's view is, and the least it will zoom in to. */
const REGION_MARGIN = 1.6;
const MIN_LATITUDE_DELTA = 0.004;
const MIN_LONGITUDE_DELTA = 0.006;

function regionFor(points: readonly RoutePoint[]) {
  // A single loop, not Math.min(...array): spreading a long run's points can overflow the stack.
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLon = Math.min(minLon, p.longitude);
    maxLon = Math.max(maxLon, p.longitude);
  }
  if (minLat === Infinity) {
    return undefined;
  }
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * REGION_MARGIN, MIN_LATITUDE_DELTA),
    longitudeDelta: Math.max((maxLon - minLon) * REGION_MARGIN, MIN_LONGITUDE_DELTA),
  };
}

export function RouteMap({ points, height, caption, accessibilityLabel }: RouteMapProps) {
  const kind = nativeMapFor(Platform.OS);
  const maps = kind ? loadSdk() : null;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? 'Map of your run route'}
      style={[styles.frame, { height }]}>
      {maps && kind ? (
        <NativeRoute maps={maps} kind={kind} points={points} />
      ) : (
        <StripedRoute points={points} height={height} caption={caption} />
      )}
    </View>
  );
}

// What differs between the two native maps; everything else (no gestures, no compass, the route and
// markers) is shared. Google takes the app's dark style; Apple only has its own dark appearance.
const GOOGLE_PROPS = { customMapStyle: DARK_MAP_STYLE, toolbarEnabled: false } as const;
const APPLE_PROPS = { userInterfaceStyle: 'dark', showsPointsOfInterests: false } as const;

const NativeRoute = memo(function NativeRoute({
  maps,
  kind,
  points,
}: {
  maps: MapsSdk;
  kind: NativeMap;
  points: readonly RoutePoint[];
}) {
  const { default: MapView, Polyline, Marker, PROVIDER_GOOGLE } = maps;
  // Recomputed only when the route changes, not on every render of a screen with a 1 s timer.
  const region = useMemo(() => regionFor(points), [points]);
  const coordinates = useMemo(() => [...points], [points]);
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <MapView
      {...(kind === 'google' ? { provider: PROVIDER_GOOGLE, ...GOOGLE_PROPS } : APPLE_PROPS)}
      style={StyleSheet.absoluteFill}
      region={region}
      scrollEnabled={false}
      zoomEnabled={false}
      pitchEnabled={false}
      rotateEnabled={false}
      showsCompass={false}
      showsTraffic={false}
      showsUserLocation={false}>
      {points.length >= 2 ? (
        <Polyline coordinates={coordinates} strokeColor={colors.accent} strokeWidth={ROUTE_WIDTH} />
      ) : null}
      {first ? (
        <Marker coordinate={first} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.startMarker} />
        </Marker>
      ) : null}
      {last && points.length >= 2 ? (
        <Marker coordinate={last} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.endMarker} />
        </Marker>
      ) : null}
    </MapView>
  );
});

const StripedRoute = memo(function StripedRoute({
  points,
  height,
  caption,
}: {
  points: readonly RoutePoint[];
  height: number;
  caption: string;
}) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const onLayout = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width;
    if (measured > 0 && measured !== width) {
      setWidth(measured);
    }
  };

  const projected = useMemo(
    () => projectRoute(points, { width, height, padding: PADDING }),
    [points, width, height],
  );
  const start = projected[0];
  const end = projected.length >= 2 ? projected[projected.length - 1] : undefined;
  const line = projected.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <View testID="route-map-fallback" onLayout={onLayout} style={{ height }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          <Pattern
            id="stripes"
            patternUnits="userSpaceOnUse"
            width={STRIPE_WIDTH * 2}
            height={STRIPE_WIDTH * 2}
            patternTransform="rotate(45)">
            <Rect x={0} y={0} width={STRIPE_WIDTH} height={STRIPE_WIDTH * 2} fill={STRIPE_DARK} />
            <Rect x={STRIPE_WIDTH} y={0} width={STRIPE_WIDTH} height={STRIPE_WIDTH * 2} fill={STRIPE_LIGHT} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#stripes)" />
        {projected.length >= 2 ? (
          <SvgPolyline
            testID="route-line"
            points={line}
            fill="none"
            stroke={colors.accent}
            strokeWidth={ROUTE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {start ? (
          <Circle
            testID="route-start"
            cx={start.x}
            cy={start.y}
            r={START_RADIUS}
            fill={colors.bg}
            stroke={colors.accent}
            strokeWidth={START_STROKE}
          />
        ) : null}
        {end ? <Circle testID="route-end" cx={end.x} cy={end.y} r={END_RADIUS} fill={colors.accent} /> : null}
      </Svg>
      <Text style={styles.caption}>{caption}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  frame: {
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    backgroundColor: STRIPE_DARK,
  },
  caption: {
    position: 'absolute',
    left: 12,
    bottom: 10,
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: '500',
    color: colors.label,
  },
  startMarker: {
    width: START_RADIUS * 2 + START_STROKE,
    height: START_RADIUS * 2 + START_STROKE,
    borderRadius: START_RADIUS + START_STROKE / 2,
    backgroundColor: colors.bg,
    borderWidth: START_STROKE,
    borderColor: colors.accent,
  },
  endMarker: {
    width: END_RADIUS * 2,
    height: END_RADIUS * 2,
    borderRadius: END_RADIUS,
    backgroundColor: colors.accent,
  },
});
