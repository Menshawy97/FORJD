import type { WorkoutSessionResponse, WorkoutTemplateSummary } from '@forjd/contracts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { getWorkoutSession, listWorkoutSessions, listWorkoutTemplates } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Icon, type IconName } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { TypeChip } from '@/components/type-chip';
import { PreviousWorkoutCard } from '@/features/train/previous-workout-card';
import { getCachedExercise, openExerciseCatalogueDb } from '@/store/exercise-catalogue';
import { setCompletedSummary, setPendingLiveSession } from '@/workouts/live-handoff';
import {
  formatRelativeDay,
  formatSessionDuration,
  type ResolvedExercise,
  sessionExerciseChips,
  sessionVolumeKg,
  toRepeatExercises,
} from '@/workouts/previous-workout';
import { newSessionId } from '@/workouts/start-session';
import { colors } from '@/theme/tokens';

/**
 * `s_train()` / `train2.png`. Phase 2 shipped only the quick-action row
 * (`docs/design/phase2-screen-specs.md` §9); **Phase 3J adds My Workouts and the Previous
 * Workout card** — the first of which gives a saved workout somewhere to be seen, and the
 * second of which is the first thing in the app that reads a finished session back at all.
 *
 * Still to come from the screenshot: the **programs** sections (Phase 3K). The header's
 * favourites star is still omitted — nothing backs a workout-favourites feature yet.
 *
 * `Start a run` targets a Phase 3 screen that does not exist — rendered per §9's own
 * instruction ("render the card, route it nowhere yet"), so it is not wired to `onPress` at
 * all. `Exercise library` is real: it is `library.tsx`, shipped this same phase.
 *
 * **The header "+" button** (`train1.png`) is Phase 3G's own minimal, screenshot-faithful
 * addition -- the one real entry point to `/builder` this phase ships.
 */
const QUICK_ACTIONS: ReadonlyArray<{ key: string; label: string; icon: IconName; href: '/library' | null }> = [
  { key: 'run', label: 'Start a run', icon: 'runner', href: null },
  { key: 'library', label: 'Exercise library', icon: 'dumb', href: '/library' },
];

/**
 * What the card renders, plus the session behind it so `Repeat` and `Summary` do not have to
 * refetch. Names are resolved once, here, rather than per button press: the catalogue is a
 * local SQLite read (ADR-022), and a button that has to await one before navigating would
 * feel slower than one that does not.
 */
interface PreviousWorkout {
  session: WorkoutSessionResponse;
  meta: string;
  chips: string[];
  performedAt: string;
  resolved: Map<string, ResolvedExercise>;
}

/**
 * Reads the most recent session and everything the card derives from it.
 *
 * Two requests, because the list response is a summary and carries neither the volume nor the
 * exercises — see `docs/product/phase-3j-plan.md` for why widening the list contract was
 * rejected rather than forgotten.
 */
async function loadPreviousWorkout(): Promise<PreviousWorkout | null> {
  const { items } = await listWorkoutSessions({ limit: 1 });
  const latest = items[0];
  if (!latest) return null;

  const session = await getWorkoutSession(latest.id);

  const resolved = new Map<string, ResolvedExercise>();
  try {
    const db = await openExerciseCatalogueDb();
    for (const exercise of session.exercises) {
      const cached = await getCachedExercise(db, exercise.exerciseId);
      if (cached) {
        resolved.set(exercise.exerciseId, { name: cached.name, goal: cached.goal ?? null });
      }
    }
  } catch {
    // The catalogue being unavailable costs the chips their names, not the card its existence.
  }

  const performedAt = formatRelativeDay(new Date(session.startedAt), new Date());
  return {
    session,
    performedAt,
    // `avg 151 bpm` is in the design and not in the data — no HealthProvider feeds this app.
    meta: `${performedAt} · ${formatSessionDuration(session.durationSeconds)} · ${sessionVolumeKg(
      session,
    ).toLocaleString()} kg`,
    chips: sessionExerciseChips(session, (id) => resolved.get(id)?.name ?? null),
    resolved,
  };
}

export default function TrainScreen() {
  const [templates, setTemplates] = useState<WorkoutTemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<PreviousWorkout | null>(null);

  // Reloaded on focus, not just on mount: returning from the builder having just saved a
  // workout must show it, returning from `workout/[id]` after a delete must not, and finishing
  // a workout must replace the Previous Workout card with the one just performed.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const response = await listWorkoutTemplates();
          if (!cancelled) {
            setTemplates(response.items);
            setError(null);
          }
        } catch (cause) {
          if (!cancelled) {
            setError(
              classifyRequestFailure(cause) === 'offline' ? OFFLINE_MESSAGE : 'Could not load your workouts.',
            );
          }
        }
      })();

      // A separate try/catch from the templates read above, deliberately: the card is an
      // extra, and losing it must not take the rest of Train with it. Its failure is silent
      // for the same reason — there is no honest message to show in place of a workout that
      // may simply not exist yet.
      (async () => {
        try {
          const loaded = await loadPreviousWorkout();
          if (!cancelled) setPrevious(loaded);
        } catch {
          if (!cancelled) setPrevious(null);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  /**
   * A *new* session shaped like the previous one. The id is freshly generated: it is the sync
   * idempotency key, so reusing the finished session's id would make the server treat this
   * workout as a retry of that one and discard it.
   */
  const onRepeat = () => {
    if (!previous) return;
    setPendingLiveSession({
      id: newSessionId(),
      // Carried through, so a repeat of a template-based workout stays attributed to it.
      templateId: previous.session.templateId,
      name: previous.session.name,
      activity: previous.session.activity,
      exercises: toRepeatExercises(previous.session, (id) => previous.resolved.get(id) ?? null),
    });
    router.push('/live');
  };

  const onSummary = () => {
    if (!previous) return;
    const { session } = previous;
    setCompletedSummary({
      name: session.name,
      durationSeconds: session.durationSeconds,
      volumeKg: sessionVolumeKg(session),
      completedSetCount: session.exercises.reduce(
        (count, exercise) => count + exercise.sets.filter((set) => set.isCompleted).length,
        0,
      ),
      exerciseIds: session.exercises.map((exercise) => exercise.exerciseId),
      // Already on the server: the summary screen must not claim it is waiting to sync.
      origin: 'history',
      performedAt: previous.performedAt,
    });
    router.push('/workout-done');
  };

  return (
    <ScreenBackground className="px-screen-x">
      <View className="flex-row items-center justify-between pt-[2px]">
        <Text className="font-archivo text-screen-header font-bold text-text">Train</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New workout"
          onPress={() => router.push('/builder')}
          className="h-[38px] w-[38px] items-center justify-center rounded-[11px] bg-accent">
          <Icon name="plus" size={18} color="#fff" />
        </Pressable>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {previous ? (
          <>
            <Text
              className="mb-[10px] mt-6 font-archivo text-[9.5px] font-semibold uppercase tracking-[.14em]"
              style={{ color: '#77776F' }}>
              Previous workout
            </Text>
            <PreviousWorkoutCard
              name={previous.session.name}
              meta={previous.meta}
              chips={previous.chips}
              onRepeat={onRepeat}
              onSummary={onSummary}
            />
          </>
        ) : null}

        <View className="mt-4 flex-row" style={{ gap: 8 }}>
          {QUICK_ACTIONS.map((action) => (
            <Pressable
              key={action.key}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              disabled={action.href === null}
              onPress={action.href ? () => router.push(action.href as '/library') : undefined}
              className="min-w-0 flex-1 flex-row items-center gap-[9px] rounded-card border border-border bg-surface px-[13px] py-[11px]"
              style={({ pressed }) => (pressed ? { borderColor: 'rgba(233,113,47,.4)' } : null)}>
              <Icon name={action.icon} size={18} color={colors.metadata} />
              <Text
                className="font-archivo text-[12.5px] font-semibold leading-[1.15] text-text"
                style={{ minWidth: 0 }}
                numberOfLines={1}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/*
          MY WORKOUTS -- `train2.png`. Until Phase 3J a saved workout had nowhere to be seen:
          the builder wrote templates the app could never list back, which the roadmap had
          flagged since Phase G. Programs are still to come (Phase 3K).
        */}
        <View className="mt-6 flex-row items-center justify-between">
          <Text
            className="font-archivo text-[9.5px] font-semibold uppercase tracking-[.14em]"
            style={{ color: '#77776F' }}>
            My workouts
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New workout link"
            onPress={() => router.push('/builder')}>
            <Text className="font-archivo text-[11.5px] font-bold text-accent">+ New workout</Text>
          </Pressable>
        </View>

        <View className="mt-[10px]">
          {error ? (
            <Text className="mt-4 font-archivo text-[13px] text-dimmer">{error}</Text>
          ) : templates === null ? (
            <Text className="mt-4 font-archivo text-[13px] text-dimmer">Loading…</Text>
          ) : templates.length === 0 ? (
            <Text className="mt-4 font-archivo text-[13px] text-dimmer">
              No workouts yet. Tap + to build your first.
            </Text>
          ) : (
            templates.map((template) => (
              <View
                key={template.id}
                className="mb-[10px] rounded-card px-[16px] py-[15px]"
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                <View className="flex-row items-start justify-between" style={{ gap: 10 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${template.name}`}
                    onPress={() => router.push(`/workout/${template.id}`)}
                    className="min-w-0 flex-1">
                    <Text className="font-archivo text-[15px] font-bold text-text" numberOfLines={1}>
                      {template.name}
                    </Text>
                    <View className="mt-[8px] flex-row">
                      <TypeChip
                        kind={
                          !template.isCustom ? 'Preset' : template.basedOnTemplateId ? 'Customised preset' : 'Custom'
                        }
                      />
                    </View>
                    <Text className="mt-[8px] font-archivo text-[11.5px]" style={{ color: '#6E6E66' }}>
                      {`${template.exerciseCount} exercises${
                        template.estimatedDurationMinutes ? ` · ~${template.estimatedDurationMinutes} min` : ''
                      }`}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Start ${template.name}`}
                    onPress={() => router.push(`/workout/${template.id}`)}>
                    <Text className="font-archivo text-[12.5px] font-bold text-accent">Start</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>
        <View style={{ height: 16 }} />
      </ScrollView>
    </ScreenBackground>
  );
}
