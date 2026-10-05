import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, Text, View } from 'react-native';

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
import {
  ensureLocalNotificationPermission,
  readNotificationPermission,
  type NotificationPermission,
} from '@/features/notifications/local-notifications';
import { requestLocalNotificationReconcile } from '@/features/notifications/use-local-notifications';
import { queueNotificationChange, syncNotificationPreferences } from '@/store/notification-preferences-sync';
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
  { key: 'workout', title: 'Workout reminders', subtitle: '30 min before you usually train' },
  { key: 'recovery', title: 'Recovery alerts', subtitle: 'When HRV or sleep drops sharply' },
  { key: 'pr', title: 'PR celebrations', subtitle: 'When you beat a lift or a run' },
  { key: 'rank', title: 'Leaderboard moves', subtitle: 'When your city rank changes' },
  { key: 'weekly', title: 'Weekly summary', subtitle: 'Saturday morning, when your week closes' },
  { key: 'meals', title: 'Log your meals', subtitle: "Evening, if you haven't logged food yet" },
  { key: 'noWorkout', title: 'No workout yet this week', subtitle: "Thursday evening, if you haven't trained" },
];

/**
 * The switches whose notifications the phone schedules itself (Phase 12E), so turning one on is the moment to ask
 * the phone for permission. The others are sent by the server (push, 12F and later) and need no prompt yet.
 */
const SCHEDULED_ON_PHONE: ReadonlySet<keyof NotificationPreferences> = new Set(['workout', 'weekly', 'meals', 'noWorkout']);

/** §5.2, verbatim: em dash U+2014 with a space either side, not a hyphen. */
const QUIET_HOURS = '22:00 — 07:00';

export default function NotifsScreen() {
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const toast = useToast();
  // Whether the phone lets FORJD show notifications. The note below only appears for a refusal, which only the
  // phone's own settings can undo; before the first question there is nothing to say.
  const [permission, setPermission] = useState<NotificationPermission>('undetermined');
  const [permissionKnown, setPermissionKnown] = useState(false);
  // Android 13 and later still say "can ask again" after a first refusal, so a refusal seen on this screen counts.
  const [sawRefusal, setSawRefusal] = useState(false);
  // The stored switches have been read, so "a reminder is on" below means what the person chose, not the defaults.
  const [loaded, setLoaded] = useState(false);
  // Set once the person taps a switch, so a server answer that arrives later never undoes their tap.
  const touchedRef = useRef(false);
  // The latest switches, readable from async steps that started before the latest tap.
  const preferencesRef = useRef(preferences);
  // Numbers every permission read, so a slow older read cannot overwrite a newer one.
  const readCount = useRef(0);
  const askedOnOpen = useRef(false);

  const applyPreferences = useCallback((next: NotificationPreferences) => {
    preferencesRef.current = next;
    setPreferences(next);
  }, []);

  const refreshPermission = useCallback(async () => {
    const mine = ++readCount.current;
    const state = await readNotificationPermission();
    if (mine !== readCount.current) return;
    setPermission(state);
    setPermissionKnown(true);
    if (state === 'granted') setSawRefusal(false);
  }, []);

  // Asks the phone (only if it has not decided), shows the note on a refusal, then plans the schedule again.
  const askPhone = useCallback(async () => {
    const granted = await ensureLocalNotificationPermission();
    if (!granted) setSawRefusal(true);
    await refreshPermission();
    requestLocalNotificationReconcile();
  }, [refreshPermission]);

  useEffect(() => {
    let cancelled = false;
    loadNotificationPreferences().then((stored) => {
      if (!cancelled) {
        applyPreferences(stored);
        setLoaded(true);
      }
    });
    // Phase 12D: the server is the home of the switches. Show the device copy at once (above), then
    // adopt the server's answer. Silent when it cannot be reached: the device copy stays.
    void syncNotificationPreferences().then((fromServer) => {
      if (!cancelled && fromServer !== null && !touchedRef.current) {
        applyPreferences(fromServer);
      }
      // The server's answer may differ from the device copy, so the schedule follows it.
      if (fromServer !== null) requestLocalNotificationReconcile();
    });
    return () => {
      cancelled = true;
    };
  }, [applyPreferences]);

  // Read on opening and again whenever the app comes back to the front, because the person may have just changed
  // the setting in the phone's settings.
  useEffect(() => {
    void refreshPermission();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPermission();
    });
    return () => subscription.remove();
  }, [refreshPermission]);

  // The switches start on, so a new phone has reminders on and nothing asked yet: opening the screen is when the
  // phone is asked, once, or those reminders would silently never arrive.
  useEffect(() => {
    if (!loaded || !permissionKnown || permission !== 'undetermined' || askedOnOpen.current) return;
    if (![...SCHEDULED_ON_PHONE].some((key) => preferences[key])) return;
    askedOnOpen.current = true;
    void askPhone();
  }, [loaded, permissionKnown, permission, preferences, askPhone]);

  const goBack = () => router.replace('/profile');

  const toggle = (key: keyof NotificationPreferences) => {
    const next = { ...preferences, [key]: !preferences[key] };
    touchedRef.current = true;
    applyPreferences(next);
    void (async () => {
      await saveNotificationPreferences(next);
      // The prompt appears at the moment its reason is obvious: when a reminder is switched on. It is skipped for
      // one that was switched straight back off. A refusal keeps the choice; the note then says why nothing arrives.
      if (preferencesRef.current[key] && SCHEDULED_ON_PHONE.has(key)) {
        await askPhone();
      } else {
        requestLocalNotificationReconcile();
      }
    })();
    void queueNotificationChange(preferences, next);
  };

  return (
    <ScreenBackground>
      <Header title="Notifications" onBack={goBack} />

      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        {(permission === 'denied' || sawRefusal) && (
          <View
            testID="notifications-off-note"
            accessibilityLiveRegion="polite"
            className="mb-[10px] rounded-card border border-borderPro bg-surface px-4 py-[13px]">
            <Text className="font-archivo text-[14px] font-semibold text-text">
              Notifications are off for FORJD on this phone
            </Text>
            <Text className="mt-[3px] font-archivo text-row-subtitle text-dimmer">
              Your choices below are saved, but nothing will arrive until you turn them on in your phone's settings.
            </Text>
            <Pressable
              accessibilityRole="link"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              className="mt-[9px] self-start"
              onPress={() => void Linking.openSettings()}>
              <Text className="font-archivo text-[12.5px] font-semibold text-accent">Open settings</Text>
            </Pressable>
          </View>
        )}

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
