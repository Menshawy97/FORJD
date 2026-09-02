import type { MacroGoalsResponse, NutritionLogEntryResponse } from '@forjd/contracts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { getMacroGoals, getMe, listNutritionLog } from '@/auth/apiClient';
import { ScreenBackground } from '@/components/screen-background';
import { formatHomeDate } from '@/features/home/date';
import { HomeHeader } from '@/features/home/home-header';
import { InsightCard } from '@/features/home/insight-card';
import { NutritionTodayCard } from '@/features/home/nutrition-today-card';
import { ReadinessCard } from '@/features/home/readiness-card';
import { RecentPr } from '@/features/home/recent-pr';
import { StartWorkoutCta } from '@/features/home/start-workout-cta';
import { StatStrip } from '@/features/home/stat-strip';
import { ThisWeek } from '@/features/home/this-week';
import { todayLocalDate } from '@/nutrition/date';
import { EMPTY_TOTALS, sumTotals } from '@/nutrition/totals';

/**
 * The Home dashboard -- the prototype's `isHome` branch (FORJD Mobile.dc.html lines 130-283),
 * built against the real screenshots `home1.png` / `home2.png`.
 *
 * Home is eight sections, and exactly one of them has a backend today: the Nutrition Today
 * card. Readiness and the four health metrics need Health Connect / HealthKit (Phase 6); the
 * workout counters, "This week" and "Recent PR" need the workout engine (Phase 3). The
 * decision taken when this screen was planned was to build all eight at full visual fidelity
 * with *honest empty values* rather than either shipping a half-screen or printing the
 * design's demo numbers, which would be fabricated data about a user's own health and
 * training. Each section is its own component so that when its data source lands, the change
 * is a prop rather than a rewrite of this file.
 *
 * Loading mirrors `nutrition.tsx`: `useFocusEffect` rather than a mount-only effect (logging
 * a meal and coming back must not leave a stale calorie count), `Promise.allSettled` for the
 * three requests, and one `setState` commit per load. Nothing here shows an error toast --
 * Home is the launch screen, and the honest empty state a failed request falls back to is
 * already the state this screen renders before any data arrives.
 */
export default function HomeScreen() {
  const [firstName, setFirstName] = useState<string | null>(null);
  const [log, setLog] = useState<NutritionLogEntryResponse[]>([]);
  const [goals, setGoals] = useState<MacroGoalsResponse | null>(null);

  // Bumped by every load and by every blur, so only the newest in-flight load may commit.
  // Without it, flicking between tabs can land an older response after a newer one and show
  // stale totals, and a load that resolves after the screen is gone still calls setState.
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = (loadGeneration.current += 1);

    // Recomputed per load rather than memoized at mount: the app can sit open across
    // midnight, and a date frozen at first render would keep asking for yesterday's log --
    // on the one screen whose whole subject is today.
    const today = todayLocalDate();

    const [meResult, logResult, goalsResult] = await Promise.allSettled([
      getMe(),
      listNutritionLog(today),
      getMacroGoals(),
    ]);

    if (generation !== loadGeneration.current) return;

    // `displayName` is nullable (ADR-019) and the profile itself can be absent, so the
    // greeting has three states, not two -- and "Hi, null" is none of them.
    const displayName =
      meResult.status === 'fulfilled' ? (meResult.value.profile?.displayName ?? null) : null;
    const trimmed = displayName === null ? '' : displayName.trim();

    setFirstName(trimmed === '' ? null : (trimmed.split(/\s+/)[0] ?? null));
    setLog(logResult.status === 'fulfilled' ? logResult.value.items : []);
    setGoals(goalsResult.status === 'fulfilled' ? goalsResult.value : null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        loadGeneration.current += 1;
      };
    }, [load]),
  );

  const totals = useMemo(() => (log.length === 0 ? EMPTY_TOTALS : sumTotals(log)), [log]);

  return (
    <ScreenBackground>
      <HomeHeader firstName={firstName} />

      <ScrollView className="flex-1 px-screen-x" showsVerticalScrollIndicator={false}>
        <Text className="mb-[14px] mt-[6px] font-archivo text-home-meta font-medium text-dimmer">
          {formatHomeDate(new Date())}
        </Text>

        <ReadinessCard />
        <NutritionTodayCard
          totals={totals}
          goals={goals}
          onPress={() => router.push('/nutrition')}
        />
        <StatStrip />
        <InsightCard />
        <StartWorkoutCta onPress={() => router.push('/(tabs)/train')} />
        <ThisWeek />
        <RecentPr />
      </ScrollView>
    </ScreenBackground>
  );
}
