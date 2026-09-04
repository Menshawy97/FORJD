import { PROGRAM_LEVEL_DISPLAY_NAMES } from '@forjd/domain';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  enrolInProgram,
  getProgram,
  getProgramEnrollment,
  listWorkoutSessions,
  stopFollowingProgram,
} from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';
import { Toast, useToast } from '@/components/toast';
import { colors } from '@/theme/tokens';

import { formatProgramMeta } from '../programs';

import type { ProgramResponse } from '@forjd/contracts';

/**
 * `s_programOverview()`, matched against `screenshots/program.png` (Phase 3K4).
 *
 * Prototype geometry: the meta line is `600 11.5px/1` in the accent colour beside a `4px 9px`
 * level pill at radius 7 on `#1b1c1e`; the description is `400 13px/1.5` with `margin:'0 0 20px'`;
 * workout rows are radius 13 with `14px 15px` padding and `gap:8`, their name `600 14.5px/1.2`,
 * the Start button `8px 14px` at radius 9 on `rgba(233,113,47,.14)`, and the exercise line
 * `400 11.5px/1.5` above a `1px rgba(255,255,255,.06)` divider at `paddingTop:10`.
 *
 * **"Recommended next" is derived, not stored.** It is the first workout of the program the
 * athlete has not performed since enrolling. The session *list* endpoint carries no template id,
 * so the match is on the session's `name` -- which is snapshotted from the template at session
 * start, and is exactly what the prototype's own `progDone` is keyed by. It shows only while the
 * athlete is actually following the program, as in the design.
 *
 * **The favourite star is not shipped.** `screenshots/program.png` has one, but program
 * favourites have no backing anywhere in this system -- the same gap Train's header star has had
 * since Phase G. A star that forgot every tap would be worse than no star; it is recorded as a
 * known gap in `phase-3k-plan.md`.
 *
 * **Customise is not shipped either.** It routes into the program builder, which is K6.
 */

export default function ProgramOverviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [program, setProgram] = useState<ProgramResponse | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  /** Names of this program's workouts already performed since enrolling. */
  const [completedNames, setCompletedNames] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const describeFailure = (cause: unknown, fallback: string): string =>
    classifyRequestFailure(cause) === 'offline' ? OFFLINE_MESSAGE : fallback;

  /**
   * One load for the program, the enrolment and the sessions behind "Recommended next".
   *
   * The sessions call is `.catch`ed to an empty list rather than allowed to fail the screen: not
   * knowing which workouts are done costs the athlete one orange label, and refusing to show the
   * program at all over it would be a poor trade.
   */
  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [detail, enrollment] = await Promise.all([getProgram(id), getProgramEnrollment()]);
      setProgram(detail);

      const following = enrollment.enrollment?.programId === detail.id;
      setIsFollowing(following);

      if (!following || !enrollment.enrollment) {
        setCompletedNames(new Set());
        return;
      }

      const since = new Date(enrollment.enrollment.startedAt).getTime();
      const sessions = await listWorkoutSessions().catch(() => ({ items: [] }));
      setCompletedNames(
        new Set(
          sessions.items
            .filter(
              (session) =>
                session.status === 'completed' && new Date(session.startedAt).getTime() >= since,
            )
            .map((session) => session.name),
        ),
      );
    } catch (cause) {
      setProgram(null);
      setError(describeFailure(cause, 'Could not load this program. Please try again.'));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const follow = async () => {
    if (!program || busy) return;
    setBusy(true);
    try {
      await enrolInProgram(program.id);
      setIsFollowing(true);
      toast.show(`Following ${program.name}`);
      // Reload so "Recommended next" appears against a real enrolment rather than a guess.
      await load();
    } catch (cause) {
      toast.show(describeFailure(cause, 'Could not follow this program. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const unfollow = async () => {
    if (!program || busy) return;
    setBusy(true);
    try {
      await stopFollowingProgram();
      setIsFollowing(false);
      setCompletedNames(new Set());
    } catch (cause) {
      toast.show(describeFailure(cause, 'Could not stop following. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (error || !program) {
    return (
      <ScreenBackground>
        <Header title="Program" onBack={() => router.back()} />
        <View className="flex-1 items-center justify-center px-screen-x">
          <Text className="text-center font-archivo text-[13px]" style={{ color: '#77776F' }}>
            {error ?? 'Loading…'}
          </Text>
        </View>
        <TabBar active="train" />
      </ScreenBackground>
    );
  }

  // The first workout not yet performed since enrolling; the first workout once all are done,
  // matching the prototype's `if (recIdx < 0) recIdx = 0`.
  const recommendedIndex = (() => {
    const index = program.workouts.findIndex((workout) => !completedNames.has(workout.name));
    return index < 0 ? 0 : index;
  })();

  return (
    <ScreenBackground>
      <Header title={program.name} onBack={() => router.back()} />

      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        <View className="mb-[12px] flex-row items-center" style={{ gap: 8 }}>
          <Text
            className="font-archivo text-[11.5px] font-semibold"
            style={{ color: colors.accent, fontVariant: ['tabular-nums'] }}>
            {formatProgramMeta(program.daysPerWeek, program.durationWeeks)}
          </Text>
          <View className="rounded-[7px] px-[9px] py-[4px]" style={{ backgroundColor: '#1B1C1E' }}>
            <Text className="font-archivo text-[10px] font-semibold" style={{ color: '#8B8B83' }}>
              {PROGRAM_LEVEL_DISPLAY_NAMES[program.level]}
            </Text>
          </View>
        </View>

        {program.description ? (
          <Text
            className="mb-[20px] font-archivo text-[13px]"
            style={{ color: '#8B8B83', lineHeight: 19.5 }}>
            {program.description}
          </Text>
        ) : null}

        <Text
          className="mb-[10px] font-archivo text-[9.5px] font-semibold uppercase tracking-[.14em]"
          style={{ color: '#77776F' }}>
          Workouts
        </Text>

        <View style={{ gap: 8 }}>
          {program.workouts.map((workout, index) => (
            <Pressable
              key={workout.templateId}
              accessibilityRole="button"
              accessibilityLabel={`Open ${workout.name}`}
              onPress={() => router.push({ pathname: '/workout/[id]', params: { id: workout.templateId } })}
              className="rounded-[13px] px-[15px] py-[14px]"
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
              }}>
              <View className="flex-row items-center justify-between" style={{ gap: 10 }}>
                <View className="min-w-0 flex-1">
                  <Text
                    className="font-archivo text-[14.5px] font-semibold"
                    style={{ color: colors.text }}>
                    {workout.name}
                  </Text>
                  {isFollowing && index === recommendedIndex ? (
                    <Text
                      className="mt-[6px] font-archivo text-[10.5px] font-semibold"
                      style={{ color: colors.accent }}>
                      Recommended next
                    </Text>
                  ) : null}
                </View>

                {/*
                  Starts the workout through the same route Train's own rows use -- which only
                  works because a program's workout *is* a workout template.
                */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Start ${workout.name}`}
                  onPress={() => router.push({ pathname: '/workout/[id]', params: { id: workout.templateId } })}
                  className="flex-none rounded-[9px] px-[14px] py-[8px]"
                  style={{ backgroundColor: 'rgba(233,113,47,.14)' }}>
                  <Text
                    className="font-archivo text-[11.5px] font-bold"
                    style={{ color: colors.accent }}>
                    Start
                  </Text>
                </Pressable>
              </View>

              {workout.exerciseNames.length > 0 ? (
                <View
                  className="mt-[10px] pt-[10px]"
                  style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.06)' }}>
                  <Text
                    className="font-archivo text-[11.5px]"
                    style={{ color: '#6E6E66', lineHeight: 17 }}>
                    {workout.exerciseNames.join(' · ')}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>

        <View className="mt-[24px]" style={{ gap: 10 }}>
          {isFollowing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop Following"
              onPress={() => void unfollow()}
              className="h-[48px] items-center justify-center rounded-[11px]"
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
              }}>
              <Text
                className="font-archivo text-[13.5px] font-semibold"
                style={{ color: colors.text }}>
                Stop Following
              </Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start Following"
              onPress={() => void follow()}
              className="h-[48px] items-center justify-center rounded-[11px]"
              style={{ backgroundColor: colors.accent }}>
              <Text className="font-archivo text-[14px] font-bold text-white">Start Following</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      <Toast message={toast.message} />
      <TabBar active="train" />
    </ScreenBackground>
  );
}
