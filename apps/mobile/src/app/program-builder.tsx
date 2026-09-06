import type { CreateProgramRequest, WorkoutTemplateSummary } from '@forjd/contracts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { createProgram, listWorkoutTemplates } from '@/auth/apiClient';
import { actionableServerMessage, classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { colors } from '@/theme/tokens';

/**
 * `s_programBuilder()`, matched against `custom program1.png` / `custom program2.png`
 * (Phase 3K6, the last slice of `phase-3k-plan.md`).
 *
 * Prototype geometry: the name field is `50px` tall at radius 11 on `#151517`/`BRD`; the weeks
 * stepper sits in a `fit-content` pill with the same fill, `gap:12`, `padding:'11px 15px'`; each
 * day card is `CARD`/`BRD` at radius 12 with `12px 13px` padding; a pick chip is `6px 10px` at
 * radius 7 on `#1b1c1e`/`BRD`, and the `+ New` chip is the same size with a dashed accent border.
 *
 * **A day's picker offers the athlete's own workouts, never a preset.** The prototype's
 * `this.state.myWorkouts` already excludes them by construction (`s_train`'s own list source);
 * here that is `isCustom`, the same discriminator `train.tsx` uses to put the athlete's own
 * templates first -- a null-owner catalogue template (including a program's own 38 seeded
 * workouts) is never offered as a day's assignment.
 *
 * **"REST" is a client-only sentinel, never sent.** `createProgramRequestSchema` has no concept
 * of a rest day -- a day with nothing assigned is simply not one of the request's `workouts`
 * rows, matching the prototype's own `assigned=Object.values(np.assign).filter(v=>v&&v!=='REST')`.
 *
 * **"+ New" opens the existing workout builder and comes back to an unchanged form.** The
 * prototype persists `newProgram` in app state across the trip so the just-created workout can be
 * assigned immediately; this app is route-based rather than state-based, so the simpler and still
 * correct behaviour is to reload "My workouts" on refocus (the new workout appears in the pickers)
 * without trying to auto-assign it to the day that opened the builder -- an assignment the athlete
 * did not explicitly make.
 */

const DAYS: ReadonlyArray<{ key: string; label: string; jsDay: number }> = [
  { key: 'Mon', label: 'Mon', jsDay: 1 },
  { key: 'Tue', label: 'Tue', jsDay: 2 },
  { key: 'Wed', label: 'Wed', jsDay: 3 },
  { key: 'Thu', label: 'Thu', jsDay: 4 },
  { key: 'Fri', label: 'Fri', jsDay: 5 },
  { key: 'Sat', label: 'Sat', jsDay: 6 },
  { key: 'Sun', label: 'Sun', jsDay: 0 },
];

const REST = 'REST' as const;
type Assignment = typeof REST | { templateId: string; name: string };

export default function ProgramBuilderScreen() {
  const [name, setName] = useState('');
  const [weeks, setWeeks] = useState(4);
  const [assign, setAssign] = useState<Record<string, Assignment | undefined>>({});
  const [myWorkouts, setMyWorkouts] = useState<WorkoutTemplateSummary[]>([]);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          const { items } = await listWorkoutTemplates();
          if (!cancelled) setMyWorkouts(items.filter((template) => template.isCustom));
        } catch {
          // "My workouts" failing to (re)load costs the pickers a few chips, not the screen.
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const setDay = (day: string, value: Assignment | undefined) => {
    setAssign((current) => ({ ...current, [day]: value }));
  };

  const assignedDays = DAYS.filter((day) => {
    const value = assign[day.key];
    return value && value !== REST;
  });
  const isValid = name.trim().length > 0 && assignedDays.length > 0;

  const save = async () => {
    if (!isValid) {
      setTriedSubmit(true);
      return;
    }
    setSaving(true);
    try {
      const body: CreateProgramRequest = {
        name: name.trim(),
        durationWeeks: weeks,
        workouts: assignedDays.map((day) => {
          const value = assign[day.key] as { templateId: string; name: string };
          return { templateId: value.templateId, dayOfWeek: day.jsDay };
        }),
      };
      await createProgram(body);
      router.back();
    } catch (cause) {
      toast.show(
        classifyRequestFailure(cause) === 'offline'
          ? OFFLINE_MESSAGE
          : (actionableServerMessage(cause) ?? 'Could not save this program. Please try again.'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenBackground>
      <Header title="New Program" onBack={() => router.back()} />

      <ScrollView
        className="flex-1 px-screen-x"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled">
        <Text className="mb-[9px] font-archivo text-section-label font-semibold uppercase text-label">
          Program name
        </Text>
        <TextInput
          accessibilityLabel="Program name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Off-season block"
          placeholderTextColor={colors.placeholder}
          className="h-[50px] rounded-field px-[15px] font-archivo text-[14.5px] font-semibold text-text"
          style={{ backgroundColor: colors.fieldBg, borderWidth: 1, borderColor: colors.border }}
        />

        <Text className="mb-[9px] mt-[22px] font-archivo text-section-label font-semibold uppercase text-label">
          Repeats for
        </Text>
        <View
          className="flex-row items-center self-start rounded-field px-[15px] py-[11px]"
          style={{ backgroundColor: colors.fieldBg, borderWidth: 1, borderColor: colors.border, gap: 12 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Decrease weeks"
            onPress={() => setWeeks((current) => Math.max(1, current - 1))}>
            <Text className="font-archivo text-[16px] font-bold text-dim">−</Text>
          </Pressable>
          <Text className="w-[60px] text-center font-archivo text-[14px] font-bold text-text">
            {weeks} weeks
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Increase weeks"
            onPress={() => setWeeks((current) => current + 1)}>
            <Text className="font-archivo text-[16px] font-bold text-dim">+</Text>
          </Pressable>
        </View>

        <Text className="mb-[10px] mt-6 font-archivo text-section-label font-semibold uppercase text-label">
          Weekly schedule
        </Text>

        <View style={{ gap: 8 }}>
          {DAYS.map((day) => {
            const value = assign[day.key];
            return (
              <View
                key={day.key}
                className="rounded-[12px] px-[13px] py-[12px]"
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                <View className="flex-row items-center justify-between">
                  <Text className="font-archivo text-[12.5px] font-bold text-text">{day.label}</Text>
                  {value ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${day.label}'s assignment`}
                      onPress={() => setDay(day.key, undefined)}>
                      <Text className="font-archivo text-[11px] font-semibold" style={{ color: colors.destructive }}>
                        Remove
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Mark ${day.label} a rest day`}
                      onPress={() => setDay(day.key, REST)}>
                      <Text className="font-archivo text-[11px] font-medium" style={{ color: colors.metadata }}>
                        Rest day
                      </Text>
                    </Pressable>
                  )}
                </View>

                {value === REST ? (
                  <Text className="mt-[8px] font-archivo text-[13px] font-semibold" style={{ color: colors.metadata }}>
                    Rest day
                  </Text>
                ) : value ? (
                  <Text className="mt-[8px] font-archivo text-[13px] font-semibold" style={{ color: colors.accent }}>
                    {value.name}
                  </Text>
                ) : (
                  <View className="mt-[9px] flex-row flex-wrap" style={{ gap: 6 }}>
                    {myWorkouts.map((template) => (
                      <Pressable
                        key={template.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Assign ${template.name} to ${day.label}`}
                        onPress={() => setDay(day.key, { templateId: template.id, name: template.name })}
                        className="rounded-[7px] px-[10px] py-[6px]"
                        style={{ backgroundColor: colors.tagBg, borderWidth: 1, borderColor: colors.border }}>
                        <Text className="font-archivo text-[11px] font-medium" style={{ color: colors.textTertiary }}>
                          {template.name}
                        </Text>
                      </Pressable>
                    ))}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Build a new workout for ${day.label}`}
                      onPress={() => router.push('/builder')}
                      className="rounded-[7px] px-[10px] py-[6px]"
                      style={{
                        backgroundColor: 'rgba(233,113,47,.1)',
                        borderWidth: 1,
                        borderStyle: 'dashed',
                        borderColor: 'rgba(233,113,47,.5)',
                      }}>
                      <Text className="font-archivo text-[11px] font-bold" style={{ color: colors.accent }}>
                        + New
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {triedSubmit && !isValid ? (
          <View
            className="mt-[14px] flex-row items-center rounded-[11px] px-[14px] py-[12px]"
            style={{ backgroundColor: 'rgba(201,80,60,.09)', borderWidth: 1, borderColor: 'rgba(201,80,60,.32)' }}>
            <Text className="flex-1 font-archivo text-[11.5px] font-semibold" style={{ color: '#e0796a' }}>
              Name it and assign at least one workout before saving.
            </Text>
          </View>
        ) : null}

        <View style={{ height: 24 }} />
      </ScrollView>

      <View className="flex-none px-screen-x pb-6 pt-[12px]">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save Program"
          disabled={saving}
          onPress={save}
          className="h-[52px] items-center justify-center rounded-[12px]"
          style={{ backgroundColor: colors.accent, opacity: isValid ? 1 : 0.5 }}>
          <Text className="font-archivo text-[14.5px] font-bold text-white">
            {saving ? 'Saving…' : 'Save Program'}
          </Text>
        </Pressable>
      </View>

      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
