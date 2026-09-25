import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/icon';
import { colors } from '@/theme/tokens';

// Five tabs, always in this order — 03-navigation.md's Shell section. Geometry and colors
// below follow the prototype's `tabbar()` helper:
//
//   height 76 · borderTop 1px rgba(255,255,255,.07) · background rgba(14,14,15,.96)
//   padding '10px 6px 0' · per-item column, gap 5 · icon 22 · label (600|500) 10/1
//   color = active ? #e9712f : #85857C
//
// with two deliberate departures (2026-09-24): the bar is 64px of content plus the device's
// bottom inset rather than a flat 76, and it has no top border. At 76 with no inset handling it
// read as too tall on the phone and covered the last row of Home's "This week" strip; the 7% white
// hairline read as a stray white line. 64 matches the design's own captures, whose phone frame
// hid the bottom of the prototype's 76.
//
// Colors are driven from the design-token module (raw strings) rather than NativeWind
// classNames, because react-navigation's tabBarStyle and react-native-svg's `stroke` both
// take color values, not classes.
const TABS: Array<{ name: string; label: string; icon: IconName }> = [
  { name: 'index', label: 'Home', icon: 'home' },
  { name: 'train', label: 'Train', icon: 'train' },
  { name: 'progress', label: 'Progress', icon: 'progress' },
  { name: 'rank', label: 'Rank', icon: 'rank' },
  { name: 'profile', label: 'Profile', icon: 'profile' },
];

const TAB_ICON_SIZE = 22;

/** The bar's own height, above the device's bottom safe-area inset (added in `tabsScreenOptions`). */
export const TAB_BAR_HEIGHT = 64;

/**
 * `backdropFilter:'blur(12px)'` has no direct equivalent: expo-blur's `intensity` is a 0-100
 * scale, not a pixel radius. 60 is the closest reading of a 12px backdrop blur on both
 * platforms — it is a judgement call, and naming it here is the honest way to say so rather
 * than writing `12` and implying the units match.
 */
const TAB_BAR_BLUR_INTENSITY = 60;

/**
 * Exported so the options that only matter at runtime are assertable.
 *
 * `position: 'absolute'` is what makes the translucency mean anything: laid out in the flow,
 * the bar had nothing behind it, so `rgba(14,14,15,.96)` over the page ground was just a
 * darker opaque strip. Floating it puts the scene behind it — and then `sceneStyle` has to
 * give the bar's full height back as padding, or the bottom of every tab screen ends up
 * underneath the bar. The two go together; either one alone is a regression.
 *
 * `bottomInset` is the device's bottom safe-area inset (home indicator, Android gesture bar).
 * Setting `height` explicitly stops react-navigation adding it itself, so it is added here:
 * below the tabs as padding, never under them.
 */
export const tabsScreenOptions = (bottomInset: number) => ({
  headerShown: false,
  tabBarActiveTintColor: colors.accent,
  tabBarInactiveTintColor: colors.tabInactive,
  tabBarStyle: {
    position: 'absolute',
    height: TAB_BAR_HEIGHT + bottomInset,
    // Transparent here, because the colour now rides on the blur layer below — leaving it
    // on the bar itself would paint an opaque wash in front of the thing being blurred.
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    paddingTop: 10,
    paddingHorizontal: 6,
    paddingBottom: bottomInset,
  },
  sceneStyle: { paddingBottom: TAB_BAR_HEIGHT + bottomInset },
  // The prototype's per-item column is `alignItems:center; gap:5` — react-navigation
  // stacks icon over label already, so only the gap needs expressing. Its icon box is 28 tall
  // around our 22px glyph, which silently widened that gap, so the box is sized to the glyph.
  // The margin is 2, not 5: the label's own line box adds the rest, and 2 is what puts icon and
  // label where the design's captures have them (measured to the pixel, 2026-09-24).
  tabBarIconStyle: { height: TAB_ICON_SIZE, marginBottom: 2 },
} as const);

/** The prototype's `rgba(14,14,15,.96)` sitting on top of a 12px backdrop blur. */
function TabBarBackground() {
  return (
    <BlurView
      intensity={TAB_BAR_BLUR_INTENSITY}
      tint="dark"
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.tabBarBg }]}
    />
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        ...tabsScreenOptions(insets.bottom),
        tabBarBackground: () => <TabBarBackground />,
      }}>
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.label,
            tabBarLabel: ({ focused }) => (
              <Text
                style={{
                  color: focused ? colors.accent : colors.tabInactive,
                  fontFamily: 'Archivo',
                  fontWeight: focused ? '600' : '500',
                  fontSize: 10,
                  lineHeight: 10,
                }}>
                {tab.label}
              </Text>
            ),
            tabBarIcon: ({ focused }) => (
              <Icon
                name={tab.icon}
                size={TAB_ICON_SIZE}
                color={focused ? colors.accent : colors.tabInactive}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
