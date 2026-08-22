import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { colors } from '@/theme/tokens';

// Five tabs, always in this order — 03-navigation.md's Shell section. Geometry and colors
// below are the prototype's `tabbar()` helper verbatim:
//
//   height 76 · borderTop 1px rgba(255,255,255,.07) · background rgba(14,14,15,.96)
//   padding '10px 6px 0' · per-item column, gap 5 · icon 22 · label (600|500) 10/1
//   color = active ? #e9712f : #6b6b64
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

export const TAB_BAR_HEIGHT = 76;

/**
 * `backdropFilter:'blur(12px)'` has no direct equivalent: expo-blur's `intensity` is a 0-100
 * scale, not a pixel radius. 60 is the closest reading of a 12px backdrop blur on both
 * platforms — it is a judgement call, and naming it here is the honest way to say so rather
 * than writing `12` and implying the units match.
 */
const TAB_BAR_BLUR_INTENSITY = 60;

/**
 * Exported so the two options that only matter at runtime are assertable.
 *
 * `position: 'absolute'` is what makes the translucency mean anything: laid out in the flow,
 * the bar had nothing behind it, so `rgba(14,14,15,.96)` over the page ground was just a
 * darker opaque strip. Floating it puts the scene behind it — and then `sceneStyle` has to
 * give that 76px back as padding, or the bottom of every tab screen ends up underneath the
 * bar. The two go together; either one alone is a regression.
 */
export const tabsScreenOptions = {
  headerShown: false,
  tabBarActiveTintColor: colors.accent,
  tabBarInactiveTintColor: colors.tabInactive,
  tabBarStyle: {
    position: 'absolute',
    height: TAB_BAR_HEIGHT,
    // Transparent here, because the colour now rides on the blur layer below — leaving it
    // on the bar itself would paint an opaque wash in front of the thing being blurred.
    backgroundColor: 'transparent',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
    paddingHorizontal: 6,
    paddingBottom: 0,
  },
  sceneStyle: { paddingBottom: TAB_BAR_HEIGHT },
  // The prototype's per-item column is `alignItems:center; gap:5` — react-navigation
  // stacks icon over label already, so only the 5px gap needs expressing.
  tabBarIconStyle: { marginBottom: 5 },
} as const;

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
  return (
    <Tabs
      screenOptions={{
        ...tabsScreenOptions,
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
