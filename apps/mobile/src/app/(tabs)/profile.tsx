import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { clearSession } from '@/auth/secureStorage';
import { Icon, type IconName } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { colors } from '@/theme/tokens';

// Structure, copy and geometry from the prototype's `isProfile` branch of
// `FORJD mobile app design/FORJD Mobile.dc.html`, rendered through the shared `row()` shape:
//   row: gap 14 · padding '15px 2px' · borderBottom 1px rgba(255,255,255,.05)
//        leading glyph 22 (#8b8b83) · title 600 14.5/1.25 · subtitle 400 12/1.3 (#6e6e66)
//        trailing chevron 18 at opacity .5
//
// The identity values and every row subtitle below are the design's *static sample data* —
// there is no backend for any of it yet, and the prototype hardcodes exactly these strings.
// They become real reads in the profile/settings slices.
//
// Every row's destination (edit profile, goals, units, connected sources, InBody history,
// workout history, privacy, notifications) is a later slice and does not exist, so the rows
// are rendered per the design but are deliberately inert — a Pressable to nowhere is worse
// than no Pressable. Only "Log out" is wired, because it is the one destination that exists.
const IDENTITY = {
  name: 'James Mitchell',
  plan: 'Free User',
  handle: 'Alexandria',
} as const;

interface SettingsRow {
  icon: IconName;
  title: string;
  subtitle: string;
  /** Absent means inert — see this file's header comment for why most rows have none yet. */
  onPress?: () => void;
}

const GROUPS: Array<{ label: string; rows: SettingsRow[] }> = [
  {
    label: 'Training',
    rows: [
      {
        icon: 'target',
        title: 'Goals & Activities',
        subtitle: 'Get stronger · Strength, Running',
        // Phase H. Same choice as Units: router.replace, not push (ADR-011) — a settings
        // destination, not a stack the user should accumulate entries on.
        onPress: () => router.replace('/goals'),
      },
      {
        icon: 'bars',
        title: 'Units & Preferences',
        subtitle: 'Metric · kg',
        // Phase G. router.replace, matching the prototype's go('units') and every other
        // navigation off this screen (login/signup use the same choice, ADR-011) — this is a
        // settings destination, not a stack the user should be able to accumulate entries on.
        onPress: () => router.replace('/units'),
      },
    ],
  },
  {
    label: 'Data',
    rows: [
      {
        icon: 'link',
        title: 'Connected Sources',
        subtitle: 'Apple Health, WHOOP, Health Connect',
      },
      { icon: 'scale', title: 'InBody History', subtitle: 'Last scan 8 days ago' },
      { icon: 'clock', title: 'Workout History', subtitle: '147 sessions logged' },
    ],
  },
  {
    label: 'Privacy & permissions',
    rows: [
      {
        icon: 'shield',
        title: 'Privacy Settings',
        subtitle: 'Leaderboard, location, AI',
        onPress: () => router.replace('/privacy'),
      },
      {
        icon: 'bell',
        title: 'Notifications',
        subtitle: 'Workouts, recovery, PRs',
        onPress: () => router.replace('/notifs'),
      },
    ],
  },
];

const ROW_ICON_SIZE = 22;
const CHEVRON_SIZE = 18;

const LOGOUT_ERROR = 'Could not log out. Please try again.';

export default function ProfileScreen() {
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  // Sign-out goes through the same seam the root layout already listens on: clearing the
  // session notifies `subscribeToSession`, the layout's `useSyncExternalStore` re-renders,
  // and its AuthGate redirects out of the (tabs) group to /welcome. No parallel navigation
  // call here — one mechanism, one source of truth (ADR-011).
  //
  // Awaited rather than `void`-ed. `clearSession` deletes five keystore entries under one
  // `Promise.all`, so a single failing delete rejects the whole call — and a discarded
  // rejection means no `notifySessionChanged()`, no redirect, no message, and the user left
  // signed in staring at an unchanged screen. Surfacing it is the difference between "that
  // did not work" and "nothing happened".
  const handleLogout = async () => {
    setLogoutError(null);
    setLoggingOut(true);
    try {
      await clearSession();
      // Deliberately no `setLoggingOut(false)` on success and no `finally`: the successful
      // path ends with the AuthGate unmounting this screen, so re-enabling the control would
      // only offer a second tap on a session that is already gone.
    } catch {
      setLogoutError(LOGOUT_ERROR);
      setLoggingOut(false);
    }
  };

  return (
    <ScreenBackground>
      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        <IdentityRow />
        <GoProBanner />

        {GROUPS.map((group, groupIndex) => (
          <View key={group.label}>
            <Text
              className={`${groupIndex === 0 ? 'mt-2' : 'mt-section-gap'} mb-[2px] font-archivo text-section-label font-semibold uppercase text-label`}>
              {group.label}
            </Text>
            {group.rows.map((row) => (
              <Row key={row.title} {...row} />
            ))}
          </View>
        ))}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log out"
          accessibilityState={{ disabled: loggingOut }}
          disabled={loggingOut}
          onPress={handleLogout}
          className="mb-1 mt-[26px] self-start">
          <Text className="font-archivo text-logout font-semibold text-destructive">Log out</Text>
        </Pressable>

        {logoutError && (
          <Text className="mt-[10px] font-archivo text-inline-error font-medium text-errorText">
            {logoutError}
          </Text>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}

/**
 * The upgrade banner, from the prototype's `<sc-if value="{{ isFree }}">` block. `isFree` is
 * the default state there, so on the screen as designed this is always present.
 *
 * Non-navigating, like every other row here — the paywall is a later slice. See this file's
 * header for why the rows are inert rather than pointed at routes that do not exist.
 *
 *   padding:14px 16px · margin-bottom:16px · radius 14 · gap 14 · space-between
 *   background: linear-gradient(135deg,#1c1408,#17181a)   border: 1px rgba(233,113,47,.35)
 *
 * A 135deg CSS gradient runs top-left to bottom-right, which is `start {0,0} end {1,1}`.
 * This one is linear, unlike the screen atmosphere's radial, so expo-linear-gradient
 * expresses it directly.
 */
function GoProBanner() {
  return (
    <LinearGradient
      colors={[colors.proBanner, colors.surface]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: 14, marginBottom: 16 }}>
      <View
        className="flex-row items-center justify-between rounded-card border border-borderPro px-4 py-[14px]"
        style={{ gap: 14 }}>
        <Text className="font-archivo text-pro-label font-bold text-text">
          Get Unlimited Access to Everything
        </Text>
        <Text className="rounded-chip bg-accent px-[14px] py-[9px] font-archivo text-chip font-bold text-white">
          Go Pro
        </Text>
      </View>
    </LinearGradient>
  );
}

function IdentityRow() {
  return (
    <Pressable
      accessibilityRole="button"
      // Phase G: this is `editProfile`'s one entry point, matching the prototype's
      // `onClick="{{ editProfile }}"` on this exact row.
      onPress={() => router.replace('/edit-profile')}
      className="mt-[10px] flex-row items-center pb-2 pt-3"
      style={{ gap: 14 }}>
      <View className="h-[52px] w-[52px] items-center justify-center rounded-card bg-elevated2">
        <Icon name="profile" size={26} color={colors.metadata} />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <Text className="font-archivo text-profile-name font-bold text-text">
            {IDENTITY.name}
          </Text>
          <Text className="rounded-[20px] border border-borderBadge bg-borderFaint px-[9px] py-1 font-archivo text-plan-badge font-bold text-metadata">
            {IDENTITY.plan}
          </Text>
        </View>
        <Text className="mt-[6px] font-archivo text-profile-handle text-dimmer">
          {IDENTITY.handle}
        </Text>
      </View>
      <TrailingChevron />
    </Pressable>
  );
}

function Row({ icon, title, subtitle, onPress }: SettingsRow) {
  const Container = onPress ? Pressable : View;
  return (
    <Container
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      className="flex-row items-center border-b border-borderFaint px-[2px] py-[15px]"
      style={{ gap: 14 }}>
      <Icon name={icon} size={ROW_ICON_SIZE} color={colors.metadata} />
      <View className="flex-1">
        <Text className="font-archivo text-row-title font-semibold text-text">{title}</Text>
        <Text className="mt-[3px] font-archivo text-row-subtitle text-dimmer">{subtitle}</Text>
      </View>
      <TrailingChevron />
    </Container>
  );
}

function TrailingChevron() {
  return (
    <View style={{ opacity: 0.5 }}>
      <Icon name="chevron" size={CHEVRON_SIZE} color={colors.metadata} />
    </View>
  );
}
