import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';
import { Toast, useToast } from '@/components/toast';
import { ToggleRow } from '@/components/toggle-row';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  loadNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
} from '@/store/notification-preferences';
import { colors } from '@/theme/tokens';

// docs/design/slice2-screen-specs.md §5. Device-local only: there is no notifications backend
// and won't be until push (Phase 6/8), so every toggle writes straight to
// `store/notification-preferences` — see that file for why AsyncStorage and why behind a seam.
//
// **No Save button** (§5.5): toggles apply and persist immediately, and there is no toast on
// toggle. The only toast is `Edit quiet hours`, fired by `Change`, which is a stub — the
// design has no quiet-hours editor to navigate to.
//
// Not to be confused with `notifsFeed`, a different prototype screen with the same header
// title that backs out to `home` with the Home tab lit (§5.1).
const ROWS: ReadonlyArray<{
  key: keyof NotificationPreferences;
  title: string;
  subtitle: string;
}> = [
  { key: 'workout', title: 'Workout reminders', subtitle: 'On your program days, 30 min before' },
  { key: 'recovery', title: 'Recovery alerts', subtitle: 'When HRV or sleep drops sharply' },
  { key: 'pr', title: 'PR celebrations', subtitle: 'When you beat a lift or a run' },
  { key: 'rank', title: 'Leaderboard moves', subtitle: 'When your city rank changes' },
  { key: 'weekly', title: 'Weekly summary', subtitle: 'Sunday evening recap' },
];

/** §5.2, verbatim: em dash U+2014 with a space either side, not a hyphen. */
const QUIET_HOURS = '22:00 — 07:00';

export default function NotifsScreen() {
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    loadNotificationPreferences().then((stored) => {
      if (!cancelled) {
        setPreferences(stored);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const goBack = () => router.replace('/profile');

  const toggle = (key: keyof NotificationPreferences) => {
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    void saveNotificationPreferences(next);
  };

  return (
    <ScreenBackground>
      <Header title="Notifications" onBack={goBack} />

      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        <Text className="mb-2 font-archivo text-[13px] leading-[1.5] text-dim">
          Two rules: nothing at night, nothing you cannot act on.
        </Text>

        {ROWS.map((row) => (
          <ToggleRow
            key={row.key}
            title={row.title}
            subtitle={row.subtitle}
            on={preferences[row.key]}
            onToggle={() => toggle(row.key)}
          />
        ))}

        <Text className="mb-[10px] mt-6 font-archivo text-section-label font-semibold uppercase text-label">
          Quiet hours
        </Text>
        <View
          className="flex-row items-center justify-between gap-[10px] rounded-card border border-border bg-surface px-4 py-[15px]">
          <View className="flex-row items-center gap-[12px]">
            <Icon name="clock" size={20} color={colors.metadata} />
            <Text className="font-archivo text-[14px] font-semibold text-text">{QUIET_HOURS}</Text>
          </View>
          {/* A stub by design: the prototype toasts and does nothing else, because no
              quiet-hours editor screen exists anywhere in the design (§5.5). */}
          {/* hitSlop, not padding: the design fixes this row's geometry, so the tap target is
              grown outward to the 44pt accessibility minimum without moving the label. */}
          <Pressable
            accessibilityRole="button"
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            onPress={() => toast.show('Edit quiet hours')}>
            <Text className="font-archivo text-[12.5px] font-semibold text-accent">Change</Text>
          </Pressable>
        </View>
      </ScrollView>

      <TabBar active="profile" />
      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
