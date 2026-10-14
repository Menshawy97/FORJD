import type { NotificationItem } from '@forjd/contracts';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { listNotifications } from '@/auth/apiClient';
import { classifyRequestFailure } from '@/auth/failure';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import {
  groupNotifications,
  iconForNotification,
  relativeNotificationTime,
  routeForNotification,
} from '@/features/notifications/notification-feed';
import { colors } from '@/theme/tokens';

// The Notifications list behind the Home bell (emulator walk finding 17; replica approved 2026-10-14, slice B of
// docs/product/notifications-list-and-profile-counts-plan.md). The server's own pushes (PR celebrations and leaderboard
// moves) from the last 30 days, the same text the push showed. Local reminders are not listed (owner decision), and
// there is no read state or unread dot (not in the design). Not to be confused with `notifs.tsx`, the switches screen,
// which the "Notification settings" link opens.

const FOOTER = 'PR celebrations and leaderboard moves from the last 30 days.';
const EMPTY_TITLE = 'Nothing yet';
const EMPTY_BODY = 'Your PR celebrations and leaderboard moves show here for 30 days.';
const OFFLINE = "You're offline. Notifications will show when you're back online.";
const FAILED = 'Could not load your notifications. Please try again.';

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; items: NotificationItem[] }
  | { status: 'failed'; message: string };

// Back to wherever the bell was tapped (Home); a cold open with nothing behind it lands on Home too.
const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
const openSettings = () => router.push('/notifs');

export default function NotificationsScreen() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    listNotifications()
      .then((response) => {
        if (!cancelled) setState({ status: 'loaded', items: response.items });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState({ status: 'failed', message: classifyRequestFailure(cause) === 'offline' ? OFFLINE : FAILED });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ScreenBackground>
      <Header title="Notifications" onBack={goBack} />
      {state.status === 'loaded' && state.items.length > 0 ? (
        <NotificationList items={state.items} />
      ) : (
        <CentredState state={state} />
      )}
    </ScreenBackground>
  );
}

function NotificationList({ items }: { items: NotificationItem[] }) {
  const now = new Date();
  return (
    <ScrollView className="flex-1 px-screen-x" contentContainerStyle={{ paddingBottom: 26 }} showsVerticalScrollIndicator={false}>
      {groupNotifications(items, now).map((group, index) => (
        <View key={group.label}>
          <Text
            className={`${index === 0 ? 'mt-1' : 'mt-[14px]'} mb-2 font-archivo text-section-label font-semibold uppercase text-label`}>
            {group.label}
          </Text>
          {group.items.map((item) => (
            <NotificationRow key={item.id} item={item} now={now} />
          ))}
        </View>
      ))}
      <Text className="mt-[14px] text-center font-archivo text-row-subtitle text-dimmer">{FOOTER}</Text>
      <SettingsLink />
    </ScrollView>
  );
}

function NotificationRow({ item, now }: { item: NotificationItem; now: Date }) {
  const route = routeForNotification(item);
  const time = relativeNotificationTime(item.sentAt, now);
  return (
    <Pressable
      accessibilityRole={route ? 'button' : undefined}
      disabled={!route}
      onPress={route ? () => router.push(route as Href) : undefined}
      className="flex-row items-center border-b border-borderFaint py-3"
      style={{ gap: 12 }}>
      <View className="h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-surface">
        <Icon name={iconForNotification(item)} size={18} color={colors.accent} />
      </View>
      <View className="flex-1">
        <Text className="font-archivo text-row-title font-semibold text-text">{item.title}</Text>
        <Text className="mt-[2px] font-archivo text-row-subtitle text-dimmer">{item.body}</Text>
      </View>
      <Text className="self-start pt-[2px] font-archivo text-[11px] text-dimmer">{time}</Text>
    </Pressable>
  );
}

function CentredState({ state }: { state: LoadState }) {
  if (state.status === 'loading') return <View className="flex-1" />;
  return (
    <View className="flex-1 items-center justify-center px-[30px] pb-[60px]">
      {state.status === 'failed' ? (
        <Text className="text-center font-archivo text-row-subtitle leading-[18px] text-dimmer">{state.message}</Text>
      ) : (
        <>
          <View className="h-[48px] w-[48px] items-center justify-center rounded-[14px] bg-surface">
            <Icon name="bell" size={22} color={colors.accent} />
          </View>
          <Text className="mt-[14px] font-archivo text-row-title font-semibold text-text">{EMPTY_TITLE}</Text>
          <Text className="mt-[6px] text-center font-archivo text-row-subtitle leading-[18px] text-dimmer">
            {EMPTY_BODY}
          </Text>
        </>
      )}
      <View className="mt-4">
        <SettingsLink />
      </View>
    </View>
  );
}

function SettingsLink() {
  return (
    <Pressable accessibilityRole="link" onPress={openSettings} className="mt-[10px] self-center px-2 py-1">
      <Text className="font-archivo text-[13px] font-semibold text-accent">Notification settings</Text>
    </Pressable>
  );
}
