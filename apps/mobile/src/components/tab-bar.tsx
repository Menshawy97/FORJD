import { router, type Href } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { colors } from '@/theme/tokens';
import { Icon, type IconName } from './icon';

/**
 * The prototype's `tabbar(active)`, for the one screen so far that shows it outside the
 * `(tabs)` group: `location`. `(tabs)/_layout.tsx`'s real bottom bar only exists inside that
 * navigator's own screens, so this is a presentational copy that navigates by route replace
 * (same choice `units`/`editProfile` made for their own back buttons) rather than a tab
 * switch — there is no tab-stack state to preserve from a screen that isn't itself a tab.
 *
 * Laid out inline (`flex: none`, last child in a column), not the real bar's floating
 * `position: absolute` — that positioning exists only to let content scroll under a blurred
 * overlay inside the `Tabs` navigator's own scene, which this standalone screen has no part
 * of. The prototype's own `tabbar()` is unconditionally the same static, non-blurred strip
 * here as inside `(tabs)`.
 */
export type TabId = 'home' | 'train' | 'progress' | 'rank' | 'profile';

const TABS: Array<{ id: TabId; route: Href; label: string; icon: IconName }> = [
  { id: 'home', route: '/', label: 'Home', icon: 'home' },
  { id: 'train', route: '/train', label: 'Train', icon: 'train' },
  { id: 'progress', route: '/progress', label: 'Progress', icon: 'progress' },
  { id: 'rank', route: '/rank', label: 'Rank', icon: 'rank' },
  { id: 'profile', route: '/profile', label: 'Profile', icon: 'profile' },
];

const TAB_ICON_SIZE = 22;

interface TabBarProps {
  active: TabId;
}

export function TabBar({ active }: TabBarProps) {
  return (
    <View
      accessibilityRole="tablist"
      className="h-[76px] flex-none flex-row border-t border-border pt-[10px]"
      style={{ paddingHorizontal: 6, backgroundColor: colors.tabBarBg }}>
      {TABS.map((tab) => {
        const selected = tab.id === active;
        const tint = selected ? colors.accent : colors.tabInactive;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) router.replace(tab.route);
            }}
            className="flex-1 items-center"
            style={{ gap: 5 }}>
            <Icon name={tab.icon} size={TAB_ICON_SIZE} color={tint} />
            <Text
              className="font-archivo text-tab-label"
              style={{ color: tint, fontWeight: selected ? '600' : '500' }}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
