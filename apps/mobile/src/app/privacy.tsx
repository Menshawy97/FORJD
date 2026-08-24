import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { PrivacySettingsResponse } from '@forjd/contracts';

import { getMe, updatePrivacy } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { Icon, type IconName } from '@/components/icon';
import { pressGhost, pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';
import { Toast, useToast } from '@/components/toast';
import { ToggleRow } from '@/components/toggle-row';
import { colors } from '@/theme/tokens';

// docs/design/slice2-screen-specs.md §6. The spec's "blocked on backend" note for this screen
// is stale: PATCH /api/v1/users/me/privacy exists with all five flags.
//
// Structure is hdr → scroll → **pinned CTA bar** → tabbar (§6.1), so Save stays visible above
// the tab bar rather than scrolling away with the content.
//
// Copy is verbatim from §6.2, including the British "Analyse" (the `goals` subtitle uses US
// "programs" — inconsistent in the prototype, copied as-is pending a ruling) and the em dashes.

/** The five writable flags. `aiFeaturesConsentAt` is server-derived and never sent. */
interface PrivacyFlags {
  leaderboardOptIn: boolean;
  locationForLeaderboard: boolean;
  aiFeaturesConsent: boolean;
  publicProfile: boolean;
  crashDiagnostics: boolean;
}

const TOGGLE_ROWS: ReadonlyArray<{ key: keyof PrivacyFlags; title: string; subtitle: string }> = [
  {
    key: 'leaderboardOptIn',
    title: 'Appear on city leaderboards',
    subtitle: 'Your name and score are visible to others in your city.',
  },
  {
    key: 'locationForLeaderboard',
    title: 'Use approximate location',
    subtitle: 'Assigns you to a city once. Never tracked in the background.',
  },
  {
    key: 'aiFeaturesConsent',
    title: 'AI insights',
    subtitle: 'Analyse your training and recovery to write your weekly insights.',
  },
  {
    key: 'publicProfile',
    title: 'Public profile',
    subtitle: 'Let other athletes open your profile and see your PRs.',
  },
  {
    key: 'crashDiagnostics',
    title: 'Crash diagnostics',
    subtitle: 'Anonymous crash reports only — never health data.',
  },
];

const EMPTY_FLAGS: PrivacyFlags = {
  leaderboardOptIn: false,
  locationForLeaderboard: false,
  aiFeaturesConsent: false,
  publicProfile: false,
  crashDiagnostics: false,
};

function toFlags(privacy: PrivacySettingsResponse): PrivacyFlags {
  return {
    leaderboardOptIn: privacy.leaderboardOptIn,
    locationForLeaderboard: privacy.locationForLeaderboard,
    aiFeaturesConsent: privacy.aiFeaturesConsent,
    publicProfile: privacy.publicProfile,
    crashDiagnostics: privacy.crashDiagnostics,
  };
}

/**
 * Mirrors the server's leaderboard/location dependency client-side, in both directions.
 *
 * The server rejects `locationForLeaderboard: true` without `leaderboardOptIn` with a 400, and
 * cascades the child off when the parent goes off. The design defines no disabled row state,
 * so rather than invent one, the rule is mirrored here: parent off turns the child off, child
 * on turns the parent on. Single tap either way, and that 400 becomes structurally
 * unreachable. Same approach `units.tsx` took for ADR-016's preset coupling.
 */
function applyToggle(flags: PrivacyFlags, key: keyof PrivacyFlags): PrivacyFlags {
  const next = { ...flags, [key]: !flags[key] };
  if (key === 'leaderboardOptIn' && !next.leaderboardOptIn) {
    next.locationForLeaderboard = false;
  }
  if (key === 'locationForLeaderboard' && next.locationForLeaderboard) {
    next.leaderboardOptIn = true;
  }
  return next;
}

function describeSaveFailure(error: unknown): string {
  return classifyRequestFailure(error) === 'offline'
    ? OFFLINE_MESSAGE
    : 'Could not update your privacy settings. Please try again.';
}

function describeLoadFailure(error: unknown): string {
  return classifyRequestFailure(error) === 'offline'
    ? OFFLINE_MESSAGE
    : 'Could not load your privacy settings. Please try again.';
}

export default function PrivacyScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [flags, setFlags] = useState<PrivacyFlags>(EMPTY_FLAGS);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => {
        if (cancelled) return;
        setUserId(me.id);
        if (me.privacy) {
          setFlags(toFlags(me.privacy));
        }
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        // Phase H's review caught this handler missing on a sibling screen: without it a
        // rejected read leaves a permanently blank screen with no way to tell why.
        if (!cancelled) {
          setLoadError(describeLoadFailure(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const goBack = () => router.replace('/profile');

  const handleSave = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      await updatePrivacy(flags);
      toast.show('Privacy settings updated');
      goBack();
    } catch (cause) {
      setSaveError(describeSaveFailure(cause));
      setSaving(false);
    }
  };

  return (
    <ScreenBackground>
      <Header title="Privacy Settings" onBack={goBack} />

      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        {loadError ? (
          <Text className="mt-3 font-archivo text-inline-error font-medium text-errorText">
            {loadError}
          </Text>
        ) : (
          loaded && (
            <>
              <Text className="mb-2 font-archivo text-[13px] leading-[1.5] text-dim">
                You choose what leaves your phone. Health data never goes to advertisers.
              </Text>

              {TOGGLE_ROWS.map((row) => (
                <ToggleRow
                  key={row.key}
                  title={row.title}
                  subtitle={row.subtitle}
                  on={flags[row.key]}
                  onToggle={() => setFlags((current) => applyToggle(current, row.key))}
                />
              ))}

              <Text className="mb-[2px] mt-6 font-archivo text-section-label font-semibold uppercase text-label">
                Permissions
              </Text>

              {/* This row is what makes Phase H's `?back=privacy` param real — location.tsx
                  was built to accept it with nothing setting it until now. */}
              <PermissionRow
                icon="pin"
                title="Location permission"
                subtitle="How your city is assigned"
                onPress={() => router.replace('/location?back=privacy')}
              />
              {/* Phase J shipped the athlete screen — self always gets data back from
                  GET /athletes/:userId regardless of the privacy flag (see
                  athletes.service.ts), so the current flag has to travel as a query param;
                  PublicProfileResponse deliberately never includes privacy flags. */}
              <PermissionRow
                icon="profile"
                title="Preview my public profile"
                subtitle="See exactly what other athletes see"
                onPress={
                  userId
                    ? () =>
                        router.replace({
                          pathname: '/athlete/[userId]',
                          params: { userId, publicProfile: String(flags.publicProfile) },
                        })
                    : undefined
                }
              />
              {/* Inert: POST /me/export does not exist. The prototype's "Export requested —
                  we will email you" toast would be factually untrue. Same precedent as
                  profile.tsx — a Pressable to nowhere is worse than no Pressable. */}
              <PermissionRow
                icon="shield"
                title="Download my data"
                subtitle="Export everything FORJD holds"
              />

              <View className="mt-4 flex-row gap-[11px] rounded-card border border-border bg-surface px-[14px] py-[13px]">
                <View className="flex-none" style={{ marginTop: 1 }}>
                  <Icon name="shield" size={18} color={colors.metadata} />
                </View>
                <Text className="flex-1 font-archivo text-[12px] leading-[1.5] text-dimmer">
                  Turning off AI insights stops new insights being generated. Your history
                  stays on your device either way.
                </Text>
              </View>
            </>
          )
        )}
      </ScrollView>

      {/* Pinned CTA bar (§6.1): sits between the scroll area and the tab bar, so Save is
          always visible rather than scrolling away with the content. */}
      <View className="flex-none border-t border-borderCell px-screen-x pb-6 pt-3">
        {saveError && (
          <Text className="mb-[10px] font-archivo text-inline-error font-medium text-errorText">
            {saveError}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: saving }}
          disabled={saving}
          onPress={handleSave}
          style={pressScale}
          className="h-[52px] items-center justify-center rounded-button bg-accent shadow-primary-button">
          <Text className="font-archivo text-button font-bold text-white">Save</Text>
        </Pressable>
      </View>

      <TabBar active="profile" />
      <Toast message={toast.message} />
    </ScreenBackground>
  );
}

interface PermissionRowProps {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress?: () => void;
}

/**
 * Inert rows render as a plain `View`, not a role-less `Pressable`: announcing "button" to a
 * screen reader for a row that does nothing is the exact "Pressable to nowhere" outcome these
 * rows exist to avoid, and the trailing chevron would promise a destination just as falsely.
 * Only the row that actually navigates gets the role, the press feedback and the chevron —
 * same treatment `(tabs)/profile.tsx` gives its own not-yet-built rows.
 */
function PermissionRow({ icon, title, subtitle, onPress }: PermissionRowProps) {
  const Container = onPress ? Pressable : View;
  return (
    <Container
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      style={onPress ? pressGhost : undefined}
      className="flex-row items-center gap-[14px] border-b border-borderFaint px-[2px] py-[15px]">
      <Icon name={icon} size={22} color={colors.metadata} />
      <View className="flex-1">
        <Text className="font-archivo text-row-title font-semibold text-text">{title}</Text>
        <Text className="mt-[3px] font-archivo text-row-subtitle text-dimmer">{subtitle}</Text>
      </View>
      {onPress && (
        <View style={{ opacity: 0.5 }}>
          <Icon name="chevron" size={18} color={colors.metadata} />
        </View>
      )}
    </Container>
  );
}
