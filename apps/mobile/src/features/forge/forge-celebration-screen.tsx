import type { ForgeWeekSummary } from '@forjd/contracts';
import {
  FORGE_BAND_NAMES,
  FORGE_COPY,
  FORGE_LADDER_NAMES,
  FORGE_LADDER_UNITS,
  targetOf,
  type ForgeLadder,
} from '@forjd/domain';
import { useContext, useEffect, useId, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { ViewShotRef } from 'react-native-view-shot';
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { getMe } from '@/auth/apiClient';
import { hapticForged, hapticNewBand } from '@/components/haptics';
import { Icon } from '@/components/icon';
import { pressScale } from '@/components/press-feedback';
import { Toast, useToast } from '@/components/toast';
import { useReduceMotion } from '@/components/use-reduce-motion';
import type * as ShareCaptureModule from '@/media/share-capture';
import type * as ShareCardShotModule from '@/media/share-card-shot';
import { colors } from '@/theme/tokens';
import { BAND_FINISH } from './band-finish';
import { formatForgeAmount, unitLabel } from './forge-format';
import { ForgeMark } from './forge-mark';
import { ForgeShareCard } from './forge-share-card';

/**
 * The new-band and Forged full screens, as approved in the Phase 7 mock-ups (items E and F, with
 * the reduce-motion versions, L, and the 10B design notes in docs/product/weekly-forge-plan.md).
 *
 * - A full-screen `Modal`, so it covers Home's tab bar; Android back continues, like the button.
 * - The ember glow for a new band, white-hot for Forged, in the same radial geometry as
 *   `ScreenBackground` (which is left unchanged).
 * - 40/26/28 px padding: the eyebrow, a 200 px stage 34 px below (the 132 px badge struck in:
 *   scale .6 -> 1.08 -> 1 over 700 ms, a glow in the band's light colour, and at most 12 sparks),
 *   the headline (`welcome-headline`, 14 px below), the line under it (14 px, 1.5), two chips 18 px
 *   below, and Share and Continue pinned to the bottom, 9 px apart.
 * - The haptic lands with the badge: medium for a new band, heavy then success for Forged.
 * - Reduce motion: the finished frame at once, no sparks, and the haptic still plays. Nothing moves
 *   until the phone has said whether it wants reduced motion, so no frame of animation slips out.
 * - Share, only when the week may be shared and outside Expo Go: captures the 4:5 card and opens the
 *   share sheet. A second tap while it opens is ignored; a failure says so. The card is laid out on
 *   screen, hidden under the celebration's own opaque layer, the way `nutrition-share.tsx` captures
 *   on screen: `react-native-view-shot` is not reliable for views parked outside the window.
 *
 * Animated with React Native's own `Animated` and the native driver, like the brand splash.
 */
type LadderWeek = ForgeWeekSummary['ladders'][number];

interface ForgeCelebrationScreenProps {
  week: ForgeWeekSummary;
  ladderWeek: LadderWeek;
  onContinue: () => void;
}

const STRIKE_MS = 700;
const LAND_MS = 420;
const HALO_MS = 1400;
const SPARK_DELAY_MS = 350;
const SPARK_MS = 1100;
const SPARK_COUNT = 12;
const STAGE = 200;
const HALO_INSET = 18;
const MARK_SIZE = 132;
const SHARE_ERROR = 'Could not open the share sheet. Please try again.';
const ZERO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * The share helpers, loaded on first use rather than imported: they pull in the photo library and
 * view-shot native modules, which Home (where this screen lives) otherwise never needs, and which
 * break every Home test that does not mock them. The same lazy-`require` pattern
 * `integrations/health/device-health-provider.ts` uses.
 */
function shareModules(): { capture: typeof ShareCaptureModule; shot: typeof ShareCardShotModule } {
  return {
    capture: require('@/media/share-capture') as typeof ShareCaptureModule,
    shot: require('@/media/share-card-shot') as typeof ShareCardShotModule,
  };
}

/** The sparks' angles and distances, fixed: the mock-up's `i * 30 + 8` degrees and 78-106 px. */
const SPARKS = Array.from({ length: SPARK_COUNT }, (_, i) => {
  const radians = ((i * 30 + 8) * Math.PI) / 180;
  const distance = 78 + (i % 3) * 14;
  return { key: i, x: Math.sin(radians) * distance, y: -Math.cos(radians) * distance };
});

export function ForgeCelebrationScreen({
  week,
  ladderWeek,
  onContinue,
}: ForgeCelebrationScreenProps) {
  const isForged = ladderWeek.bandAfter === 'forged';
  const reduceMotion = useReduceMotion();
  const insets = useContext(SafeAreaInsetsContext) ?? ZERO_INSETS;
  const toast = useToast();
  const shotRef = useRef<ViewShotRef | null>(null);
  const isSharing = useRef(false);
  const hasTapped = useRef(false);
  const strike = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(0)).current;
  const sparks = useRef(new Animated.Value(0)).current;
  const [username, setUsername] = useState<string | null>(null);
  const glowId = `forge-cel-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  useEffect(() => {
    const tap = () => {
      if (!hasTapped.current) {
        hasTapped.current = true;
        void (isForged ? hapticForged() : hapticNewBand());
      }
    };
    if (reduceMotion === null) {
      return undefined;
    }
    if (reduceMotion) {
      strike.setValue(1);
      halo.setValue(1);
      tap();
      return undefined;
    }
    const animation = Animated.parallel([
      Animated.timing(strike, {
        toValue: 1,
        duration: STRIKE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(halo, {
        toValue: 1,
        duration: HALO_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(sparks, {
        toValue: 1,
        duration: SPARK_MS,
        delay: SPARK_DELAY_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    const landing = setTimeout(tap, LAND_MS);
    return () => {
      clearTimeout(landing);
      animation.stop();
    };
  }, [reduceMotion, isForged, strike, halo, sparks]);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => {
        if (!cancelled) {
          setUsername(me.profile?.username ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const share = async () => {
    if (isSharing.current) {
      return;
    }
    isSharing.current = true;
    try {
      await shareModules().capture.shareShareCard(shotRef, 'Share your Weekly Forge');
    } catch {
      toast.show(SHARE_ERROR);
    } finally {
      isSharing.current = false;
    }
  };

  const name = FORGE_LADDER_NAMES[ladderWeek.ladder];
  const target = targetLine(ladderWeek.ladder, ladderWeek.levelAfter);
  const line = isForged
    ? `Four weeks held in Tempered, and now Forged.${target ? ` ${target} a week.` : ''}`
    : `${name} reached ${FORGE_BAND_NAMES[ladderWeek.bandAfter]}.${target ? ` Your target is now ${target} a week.` : ''}`;
  const chips = [
    isForged ? 'Forged 1 week' : `Level ${ladderWeek.levelAfter}`,
    `Week of ${weekStartLabel(week.weekStart)}`,
  ];
  const light = BAND_FINISH[ladderWeek.bandAfter].light;
  const shareKit = week.shareable ? shareModules() : null;
  const canShare = shareKit !== null && !shareKit.capture.isExpoGo();
  const ShareCardShot = shareKit?.shot.ShareCardShot;

  return (
    <Modal
      visible
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onContinue}
    >
      <View className="flex-1 bg-screenBg">
        {canShare && ShareCardShot ? (
          <View
            pointerEvents="none"
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            collapsable={false}
            style={styles.shareCard}
          >
            <ShareCardShot
              ref={shotRef}
              options={{ format: 'jpg', quality: 0.92, width: 1080, height: 1350 }}
            >
              <ForgeShareCard
                ladder={ladderWeek.ladder}
                band={ladderWeek.bandAfter}
                level={ladderWeek.levelAfter}
                username={username}
              />
            </ShareCardShot>
          </View>
        ) : null}

        <View style={StyleSheet.absoluteFill} className="bg-screenBg">
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              <RadialGradient
                id={glowId}
                cx="0.5"
                cy="-0.1"
                rx="1.3"
                ry="0.9"
                gradientUnits="objectBoundingBox"
              >
                <Stop
                  offset="0"
                  stopColor={isForged ? colors.forgeHeatWhite : colors.accent}
                  stopOpacity={isForged ? 0.18 : 0.2}
                />
                <Stop offset="0.55" stopColor={colors.screenBg} stopOpacity="1" />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${glowId})`} />
          </Svg>

          <View
            className="flex-1 items-center px-[26px]"
            style={{ paddingTop: insets.top + 40, paddingBottom: insets.bottom + 28 }}
          >
            <Text className="font-archivo text-section-label font-semibold uppercase text-label">
              {isForged ? `Forged · ${name}` : `New band · ${name}`}
            </Text>

            <View
              className="mb-2 mt-[34px] items-center justify-center"
              style={{ width: STAGE, height: STAGE }}
            >
              <Animated.View
                pointerEvents="none"
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
                style={[
                  styles.halo,
                  {
                    opacity: halo.interpolate({
                      inputRange: [0, 0.4, 1],
                      outputRange: [0, 1, 0.85],
                    }),
                    transform: [
                      { scale: halo.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
                    ],
                  },
                ]}
              >
                <Svg width="100%" height="100%">
                  <Defs>
                    <RadialGradient id={`${glowId}-halo`} cx="50%" cy="50%" r="50%">
                      <Stop
                        offset="0"
                        stopColor={isForged ? colors.forgeHeatWhite : light}
                        stopOpacity={isForged ? 0.34 : 0.28}
                      />
                      <Stop
                        offset="1"
                        stopColor={isForged ? colors.forgeHeatWhite : light}
                        stopOpacity="0"
                      />
                    </RadialGradient>
                  </Defs>
                  <Circle cx="50%" cy="50%" r="50%" fill={`url(#${glowId}-halo)`} />
                </Svg>
              </Animated.View>

              {reduceMotion !== false ? null : (
                <View
                  pointerEvents="none"
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                  style={StyleSheet.absoluteFill}
                >
                  {SPARKS.map((spark) => (
                    <Animated.View
                      key={spark.key}
                      testID="forge-spark"
                      style={[
                        styles.spark,
                        {
                          backgroundColor: light,
                          opacity: sparks.interpolate({
                            inputRange: [0, 0.01, 1],
                            outputRange: [0, 1, 0],
                          }),
                          transform: [
                            {
                              translateX: sparks.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0, spark.x],
                              }),
                            },
                            {
                              translateY: sparks.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0, spark.y],
                              }),
                            },
                          ],
                        },
                      ]}
                    />
                  ))}
                </View>
              )}

              <Animated.View
                style={{
                  opacity: strike.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }),
                  transform: [
                    {
                      scale: strike.interpolate({
                        inputRange: [0, 0.6, 1],
                        outputRange: [0.6, 1.08, 1],
                      }),
                    },
                  ],
                }}
              >
                <ForgeMark
                  ladder={ladderWeek.ladder}
                  band={ladderWeek.bandAfter}
                  size={MARK_SIZE}
                  decorative
                />
              </Animated.View>
            </View>

            <Text
              accessibilityRole="header"
              className="mb-2 mt-[14px] text-center font-archivo text-welcome-headline font-bold text-text"
            >
              {isForged ? FORGE_COPY.forged : FORGE_COPY.band}
            </Text>
            <Text className="max-w-[280px] text-center font-archivo text-[14px] leading-[21px] text-textSecondary">
              {line}
            </Text>

            <View className="mt-[18px] flex-row flex-wrap justify-center gap-[10px]">
              {chips.map((chip) => (
                <Text
                  key={chip}
                  className="rounded-chip border border-border bg-elevated2 px-[11px] py-2 font-archivo text-chip font-semibold text-textSecondary"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {chip}
                </Text>
              ))}
            </View>

            <View className="mt-auto w-full gap-[9px] pt-[30px]">
              {canShare ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Share"
                  onPress={() => void share()}
                  style={pressScale}
                  className="h-[52px] w-full flex-row items-center justify-center gap-[9px] rounded-button bg-accentDark shadow-primary-button"
                >
                  <Icon name="share" size={18} color={colors.onAccent} />
                  <Text className="font-archivo text-button font-bold text-white">Share</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Continue"
                onPress={onContinue}
                style={pressScale}
                className="h-[52px] w-full items-center justify-center rounded-button border border-border"
              >
                <Text className="font-archivo text-button font-bold text-text">Continue</Text>
              </Pressable>
            </View>
          </View>

          <Toast message={toast.message} />
        </View>
      </View>
    </Modal>
  );
}

/** "5,600 kg", or null when a level is outside the tier table (the line then leaves it out). */
function targetLine(ladder: ForgeLadder, level: number): string | null {
  try {
    const unit = FORGE_LADDER_UNITS[ladder];
    return `${formatForgeAmount(targetOf(ladder, level), unit)} ${unitLabel(unit)}`;
  } catch {
    return null;
  }
}

/** "19 Sep", the Saturday the week began. */
function weekStartLabel(weekStart: string): string {
  const [, month, day] = weekStart.split('-').map(Number) as [number, number, number];
  return `${day} ${MONTHS[month - 1]}`;
}

const styles = StyleSheet.create({
  halo: {
    position: 'absolute',
    top: HALO_INSET,
    left: HALO_INSET,
    right: HALO_INSET,
    bottom: HALO_INSET,
  },
  spark: {
    position: 'absolute',
    left: STAGE / 2 - 2,
    top: STAGE / 2 - 2,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  /** On screen but under the opaque celebration layer drawn after it: captured, never seen. */
  shareCard: { position: 'absolute', left: 0, top: 0 },
});
