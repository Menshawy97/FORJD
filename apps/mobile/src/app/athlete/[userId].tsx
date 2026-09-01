import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { getAthlete } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';
import { colors } from '@/theme/tokens';

// Ports the prototype's `s_athlete()`. Reached today only from `privacy.tsx`'s "Preview my
// public profile" row (self-view) — `rank` has no real leaderboard rows to tap yet (Phase
// 10) — but the screen and `getAthlete()` both take any userId, so it already works for a
// future stranger-view entry point without changes here.
//
// Two deliberate divergences from the prototype, both forced by the real backend
// (apps/api/src/athletes/athletes.service.ts):
//
// 1. **Identity only.** §11 Q4's resolution: the stat tiles, personal records and recent
//    sessions all need Phase 10 leaderboard/analytics data that does not exist, so they are
//    omitted rather than faked with placeholder numbers. The footnote card describing that
//    content is omitted too — it would describe screen content that is not there.
// 2. **One generic error state, not the prototype's stranger-specific "this profile is
//    private" message.** The backend makes a private profile and a nonexistent one return
//    byte-identical 404s on purpose — accounts hold health data, and a distinguishable
//    refusal would be an enumeration oracle. Reproducing the prototype's specific copy for a
//    404 would leak exactly the distinction the backend refuses to make. The self-view
//    "your profile is private" nudge below is NOT this case: self always gets data back
//    regardless of the privacy flag (see athletes.service.ts), so it renders from a real
//    successful response, not from a refusal.
//
// A THIRD divergence — "no handle line" — used to be listed here, reflecting the slice-2
// decision that the product had no handle concept at all. ADR-019 reverses that decision:
// `s_athlete()`'s own `@handle` line (immediately below the name, above the city/rank row)
// now renders for real, from `PublicProfileResponse.username`, and is `null` rather than
// omitted for the pre-ADR-019 accounts that predate the field.
//
// `PublicProfileResponse` never includes privacy flags (by design — see the contract's own
// comment), so the current `publicProfile` value has to travel as a query param from
// `privacy.tsx`, which already holds it in state at the moment the row is tapped.
export default function AthleteScreen() {
  const params = useLocalSearchParams<{ userId: string; publicProfile?: string }>();
  // Expo Router's actual runtime type for a route param is `string | string[]` — the generic
  // above only asserts, it does not validate (react-native/patterns.md's Navigation section
  // calls for exactly this guard on any deep-link-reachable param). A `string[]` here would
  // otherwise get silently stringified into `getAthlete`'s request path below.
  const userId = Array.isArray(params.userId) ? params.userId[0] : params.userId;
  const publicProfile = Array.isArray(params.publicProfile)
    ? params.publicProfile[0]
    : params.publicProfile;
  const [profile, setProfile] = useState<{
    displayName: string | null;
    username: string | null;
    city: string | null;
    isSelf: boolean;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Cleared up front, not just on a fresh success: Expo Router does not remount this
    // screen for a param-only change to the same dynamic route, so without this the
    // previous athlete's identity (and a stale `isPrivateSelfView`) would stay on screen
    // for the duration of the new request. Only one caller exists today (self-view from
    // privacy.tsx, always the same userId), but getAthlete already accepts any id, so this
    // is the first thing a future stranger-view entry point would trip over.
    setProfile(null);
    setLoadError(null);

    if (typeof userId !== 'string') {
      setLoadError('Could not load this profile. Please try again.');
      return;
    }

    getAthlete(userId)
      .then((athlete) => {
        if (cancelled) return;
        setProfile({
          displayName: athlete.displayName,
          username: athlete.username,
          city: athlete.city,
          isSelf: athlete.isSelf,
        });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoadError(
            classifyRequestFailure(cause) === 'offline'
              ? OFFLINE_MESSAGE
              : 'Could not load this profile. Please try again.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const goBack = () => router.replace('/privacy');

  // Self always gets data back regardless of the privacy flag, so this reads the value
  // carried from privacy.tsx rather than anything the response itself says.
  const isPrivateSelfView = profile?.isSelf === true && publicProfile === 'false';

  return (
    <ScreenBackground>
      <Header title={profile?.isSelf ? 'Your public profile' : 'Athlete'} onBack={goBack} />

      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        {loadError && (
          <Text className="mt-3 font-archivo text-inline-error font-medium text-errorText">
            {loadError}
          </Text>
        )}

        {profile && isPrivateSelfView && (
          <View className="items-center rounded-card border border-border bg-surface px-4 py-5">
            <View className="h-[44px] w-[44px] items-center justify-center rounded-card bg-elevated2">
              <Icon name="shield" size={22} color={colors.metadata} />
            </View>
            <Text className="mt-[14px] font-archivo text-[16px] font-bold leading-[1.2] text-text">
              Your profile is private
            </Text>
            <Text className="mt-[9px] max-w-[250px] text-center font-archivo text-[12.5px] leading-[1.5] text-dim">
              Turn on Public profile and other athletes will see your rank, records and recent
              sessions — nothing else.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace('/privacy')}
              style={pressScale}
              className="mt-4 h-[52px] w-full items-center justify-center rounded-button bg-accent shadow-primary-button">
              <Text className="font-archivo text-button font-bold text-white">
                Open Privacy Settings
              </Text>
            </Pressable>
          </View>
        )}

        {profile && !isPrivateSelfView && (
          <View className="flex-row items-center" style={{ gap: 14 }}>
            {/* Decorative: the name right beside it already carries this information for a
                screen reader, so the two-letter initials should not be announced literally. */}
            <View
              accessible={false}
              className="h-[60px] w-[60px] items-center justify-center rounded-[16px] border border-borderAthleteAvatar bg-athleteAvatarBg">
              <Text className="font-archivo text-[21px] font-bold text-accent">
                {initials(profile.displayName)}
              </Text>
            </View>
            <View className="flex-1">
              <Text
                className="font-archivo text-[20px] font-bold leading-[1.15] text-text"
                style={{ letterSpacing: -0.01 * 20 }}>
                {profile.displayName ?? '—'}
              </Text>
              {profile.username && (
                <Text className="mt-[6px] font-archivo text-[12px] text-dimmer">
                  {`@${profile.username}`}
                </Text>
              )}
              {profile.city && (
                <View className="mt-2 flex-row items-center" style={{ gap: 6 }}>
                  <Icon name="pin" size={13} color={colors.metadata} />
                  <Text className="font-archivo text-[11.5px] font-medium text-metadata">
                    {profile.city}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      <TabBar active="profile" />
    </ScreenBackground>
  );
}

function initials(displayName: string | null): string {
  if (!displayName) return '—';
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
