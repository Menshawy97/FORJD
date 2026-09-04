import type {
  MacroGoalsResponse,
  NutritionLogEntryResponse,
  WorkoutStatsResponse,
} from '@forjd/contracts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text } from 'react-native';

import {
  getMacroGoals,
  getMe,
  getProgramEnrollment,
  getWorkoutStats,
  listNutritionLog,
} from '@/auth/apiClient';
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
 * Home is eight sections. The decision taken when this screen was planned was to build all
 * eight at full visual fidelity with *honest empty values* rather than either shipping a
 * half-screen or printing the design's demo numbers, which would be fabricated data about a
 * user's own health and training — and each section is its own component so that when its data
 * source lands, the change is a prop rather than a rewrite of this file.
 *
 * **That bet is now paying out twice.** The Nutrition Today card was the first section with a
 * backend; Phase 3J-c connects three more — the stat strip's counters, "This week" and
 * "Recent PR" — and each was exactly a prop, as intended.
 *
 * Still empty, and honestly so: Readiness and the four health metrics need Health Connect /
 * HealthKit (Phase 6), and **City Rank** needs the leaderboard behind the Rank tab, itself
 * still a placeholder.
 *
 * Loading mirrors `nutrition.tsx`: `useFocusEffect` rather than a mount-only effect (logging
 * a meal and coming back must not leave a stale calorie count), `Promise.allSettled` so one
 * failed request cannot empty the sections the others fill, and one `setState` commit per
 * load. Nothing here shows an error toast --
 * Home is the launch screen, and the honest empty state a failed request falls back to is
 * already the state this screen renders before any data arrives.
 */
export default function HomeScreen() {
  const [firstName, setFirstName] = useState<string | null>(null);
  const [log, setLog] = useState<NutritionLogEntryResponse[]>([]);
  const [goals, setGoals] = useState<MacroGoalsResponse | null>(null);
  const [stats, setStats] = useState<WorkoutStatsResponse | null>(null);

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

    const [meResult, logResult, goalsResult, statsResult] = await Promise.allSettled([
      getMe(),
      listNutritionLog(today),
      getMacroGoals(),
      getWorkoutStats(),
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
    // `null` on failure, which every consumer renders as the same honest empty state a new
    // account sees. Home is the launch screen: a stats request that fails must leave it
    // looking untrained, not broken.
    setStats(statsResult.status === 'fulfilled' ? statsResult.value : null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        loadGeneration.current += 1;
      };
    }, [load]),
  );

  /**
   * The prototype's `goSuggested`: Start Workout opens the program the athlete is following, and
   * falls back to Train when they are following nothing.
   *
   * `.catch`ed to null -- a failed lookup costs the button its shortcut, never its function.
   */
  const [activeProgramId, setActiveProgramId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getProgramEnrollment()
      .catch(() => ({ enrollment: null }))
      .then((response) => {
        if (!cancelled) setActiveProgramId(response.enrollment?.programId ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        <StatStrip
          totalSessions={stats?.totalSessions ?? null}
          sessionsThisMonth={stats?.sessionsThisMonth ?? null}
          weekStreak={stats?.weekStreak ?? null}
        />
        <InsightCard />
        <StartWorkoutCta
          onPress={() =>
            activeProgramId
              ? router.push({ pathname: '/program/[id]', params: { id: activeProgramId } })
              : router.push('/(tabs)/train')
          }
        />
        <ThisWeek
          sessionCount={stats?.thisWeek.sessionCount ?? null}
          trainedWeekdays={stats?.thisWeek.trainedWeekdays ?? []}
        />
        <RecentPr record={stats?.recentPersonalRecord ?? null} />
      </ScrollView>
    </ScreenBackground>
  );
}
