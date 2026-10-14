import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { ViewShotRef } from 'react-native-view-shot';
import Svg, { Circle, Path } from 'react-native-svg';

import { Header } from '@/components/header';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import {
  formatDuration,
  formatPace,
  formatRunDistance,
  formatRunElevation,
  formatRunPace,
  RUN_UNIT_LABELS,
  splitBarPercent,
} from '@/features/run/run-format';
import { routeLinePath } from '@/features/run/route-path';
import { SharePermissionDeniedError, isExpoGo, saveShareCardToPhotos, shareShareCard } from '@/media/share-capture';
import { ShareCardShot } from '@/media/share-card-shot';
import { getCompletedRun, type CompletedRun } from '@/workouts/run-handoff';
import { colors } from '@/theme/tokens';

/**
 * Share Run (docs/product/run-share-card-plan.md; replica approved 2026-10-14), opened from the run summary's Share
 * button. Built like Share Workout (`workout-share.tsx`): a 4:5 card in a `ViewShot`, a layout chooser, and Save Image,
 * Instagram and More through `media/share-capture.ts`.
 *
 * - **Route & Splits:** the route as a line from the GPS track (`routeLinePath`; no map, so no street names), the
 *   numbers, and up to five splits.
 * - **Stats Card:** the numbers only, for someone who would rather not show where they ran.
 *
 * A share card leaves the app, so it carries no health value: never heart rate or calories (CLAUDE.md rule 15's line).
 * Numbers are in the unit the run was shown in (`run-miles-plan.md`).
 */
type LayoutId = 'route' | 'stats';

interface Layout {
  id: LayoutId;
  label: string;
  desc: string;
  gradient: [string, string];
}

const LAYOUTS: Layout[] = [
  { id: 'route', label: 'Route & Splits', desc: 'Your route and splits', gradient: ['#1D1408', '#101011'] },
  { id: 'stats', label: 'Stats Card', desc: 'Distance · Time · Pace', gradient: ['#14161D', '#101011'] },
];

/** The prototype's share cards show at most five split rows in this space. */
const MAX_SPLITS = 5;
const ROUTE_WIDTH = 200;
const ROUTE_HEIGHT = 120;

export default function RunShareScreen() {
  const [run] = useState<CompletedRun | null>(() => getCompletedRun());
  const [selected, setSelected] = useState<LayoutId>('route');
  const toast = useToast();
  const shotRef = useRef<ViewShotRef>(null);

  // Expo Go cannot load react-native-view-shot (see workout-share.tsx), so it gets the toast only.
  const saveImage = async () => {
    if (isExpoGo()) {
      toast.show('Image saved to Photos');
      return;
    }
    try {
      await saveShareCardToPhotos(shotRef);
      toast.show('Image saved to Photos');
    } catch (cause) {
      toast.show(
        cause instanceof SharePermissionDeniedError
          ? 'Photo access is needed to save the image.'
          : 'Could not save the image. Please try again.',
      );
    }
  };

  const shareTo = async (label: string) => {
    if (isExpoGo()) {
      toast.show(`Sharing to ${label}…`);
      return;
    }
    try {
      await shareShareCard(shotRef, `Share to ${label}`);
    } catch {
      toast.show('Could not open the share sheet. Please try again.');
    }
  };

  if (!run) {
    return (
      <ScreenBackground>
        <Header title="Share Run" onBack={() => router.back()} />
        <View className="flex-1 items-center justify-center px-screen-x">
          <Text className="text-center font-archivo text-[13px]" style={{ color: '#94948B' }}>
            Finish a run to share it.
          </Text>
        </View>
      </ScreenBackground>
    );
  }

  const unit = run.unit ?? 'km';
  const labels = RUN_UNIT_LABELS[unit];
  const active = LAYOUTS.find((layout) => layout.id === selected) ?? LAYOUTS[0]!;
  const route = active.id === 'route' ? routeLinePath(run.route, ROUTE_WIDTH, ROUTE_HEIGHT, 10) : null;
  const splits = active.id === 'route' ? run.splits.slice(0, MAX_SPLITS) : [];
  const fastest = splits.reduce((least, split) => Math.min(least, split.durationSeconds), Infinity);
  const stats: Array<[string, string]> = [
    ['Time', formatDuration(run.movingSeconds)],
    ['Avg pace', `${formatRunPace(run.averagePaceSecondsPerKm, unit)} ${labels.pace}`],
  ];
  if (run.elevationGainMeters !== null) {
    stats.push(['Climb', `${formatRunElevation(run.elevationGainMeters, unit)} ${labels.elevation}`]);
  }

  return (
    <ScreenBackground>
      <Header title="Share Run" onBack={() => router.back()} />

      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        <ShareCardShot ref={shotRef} options={{ format: 'jpg', quality: 0.92 }}>
          <LinearGradient
            accessibilityLabel={`${active.label} preview`}
            colors={active.gradient}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={{
              borderRadius: 18,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: 20,
              paddingVertical: 26,
              aspectRatio: 4 / 5,
            }}>
            <Text className="font-archivo text-[13px] font-extrabold tracking-[.06em]" style={{ color: colors.accent }}>
              FORJD
            </Text>

            {route ? (
              <View testID="share-route-line" className="mt-[10px]">
                <Svg width="100%" height={110} viewBox={`0 0 ${ROUTE_WIDTH} ${ROUTE_HEIGHT}`}>
                  <Path
                    d={route.d}
                    fill="none"
                    stroke={colors.accent}
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <Circle cx={route.start.x} cy={route.start.y} r={5} fill="#08090A" stroke={colors.accent} strokeWidth={3} />
                  <Circle cx={route.end.x} cy={route.end.y} r={5} fill={colors.text} />
                </Svg>
              </View>
            ) : null}

            <View className="mt-auto">
              <Text className="font-archivo text-[22px] font-bold" style={{ color: colors.text }}>
                Outdoor Run
              </Text>
              <Text className="mt-[2px] font-archivo text-[12px] font-medium" style={{ color: '#8B8B83' }}>
                {`Today · ${formatRunDistance(run.distanceMeters, unit)} ${labels.distance}`}
              </Text>

              <View className="mt-[8px] flex-row" style={{ gap: 18 }}>
                {stats.map(([label, value]) => (
                  <View key={label}>
                    <Text className="font-archivo text-[17px] font-bold" style={{ color: colors.text }}>
                      {value}
                    </Text>
                    <Text className="mt-[3px] font-archivo text-[10px] font-medium" style={{ color: '#94948B' }}>
                      {label}
                    </Text>
                  </View>
                ))}
              </View>

              {splits.map((split) => (
                <View key={split.index} className="mt-[5px] flex-row items-center" style={{ gap: 8 }}>
                  <Text className="w-[32px] font-archivo text-[11px] font-semibold" style={{ color: '#D8D8D0' }}>
                    {`${split.index} ${unit}`}
                  </Text>
                  <View className="h-[5px] flex-1 overflow-hidden rounded-[3px]" style={{ backgroundColor: 'rgba(255,255,255,.08)' }}>
                    <View
                      className="h-[5px] rounded-[3px]"
                      style={{ width: `${splitBarPercent(split.durationSeconds, fastest)}%`, backgroundColor: colors.accent }}
                    />
                  </View>
                  <Text className="w-[36px] text-right font-archivo text-[11px] font-semibold" style={{ color: colors.text }}>
                    {formatPace(split.durationSeconds)}
                  </Text>
                </View>
              ))}
            </View>
          </LinearGradient>
        </ShareCardShot>

        <Text
          className="mb-[10px] mt-[22px] font-archivo text-[9.5px] font-semibold uppercase tracking-[.14em]"
          style={{ color: '#94948B' }}>
          Choose a layout
        </Text>

        <View className="flex-row" style={{ gap: 10 }}>
          {LAYOUTS.map((layout) => {
            const isSelected = layout.id === active.id;
            return (
              <Pressable
                key={layout.id}
                accessibilityRole="button"
                accessibilityLabel={`Use the ${layout.label} layout`}
                accessibilityState={{ selected: isSelected }}
                onPress={() => setSelected(layout.id)}
                style={{ width: 100 }}>
                <LinearGradient
                  colors={layout.gradient}
                  start={{ x: 0.15, y: 0 }}
                  end={{ x: 0.85, y: 1 }}
                  style={{
                    width: 100,
                    height: 125,
                    borderRadius: 12,
                    borderWidth: isSelected ? 2 : 1,
                    borderColor: isSelected ? colors.accent : colors.border,
                  }}
                />
                <Text
                  className="mt-[7px] font-archivo text-[11.5px] font-semibold"
                  style={{ color: isSelected ? colors.accent : colors.text }}>
                  {layout.label}
                </Text>
                <Text className="mt-[3px] font-archivo text-[10px]" style={{ color: '#8A8A82' }}>
                  {layout.desc}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View className="mt-[24px]" style={{ gap: 10 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save Image"
            onPress={() => void saveImage()}
            className="h-[48px] items-center justify-center rounded-[11px]"
            style={{ backgroundColor: colors.accentDark }}>
            <Text className="font-archivo text-[14px] font-bold text-white">Save Image</Text>
          </Pressable>
          <View className="flex-row" style={{ gap: 10 }}>
            {['Instagram', 'More'].map((label) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => void shareTo(label)}
                className="h-[48px] flex-1 items-center justify-center rounded-[11px]"
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                <Text className="font-archivo text-[12.5px] font-semibold" style={{ color: colors.text }}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>

      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
