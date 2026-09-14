import { Pressable, Text, TextInput, View } from 'react-native';

import {
  EXERCISE_GOAL_DISPLAY_NAMES,
  distanceForDisplay,
  distanceFromDisplay,
  nextDistanceUnit,
  nextWeightUnit,
  weightForDisplay,
  weightFromDisplay,
  type DistanceDisplayUnit,
  type WeightDisplayUnit,
} from '@forjd/domain';

import { Icon } from '@/components/icon';
import { colors } from '@/theme/tokens';
import type { LiveExercise, LiveSet } from '@/workouts/live-session';

const MEASURE_SUBTITLE: Record<string, string> = {
  weight: 'Weight',
  time: 'Time',
  distance: 'Distance',
};

/** A patch applied to one set -- the same shape `updateSet` in `live-session.ts` accepts. */
export type LiveSetPatch = Partial<Pick<LiveSet, 'weightKg' | 'reps' | 'durationSeconds' | 'distanceMeters'>>;

/**
 * One exercise's card in the live workout screen -- extracted from `app/live.tsx` (R23a) with
 * its geometry unchanged: radius 14, `16px 15px` card padding, the `Set / Prev / Target` column
 * headers, and the set-row list itself (radius 10, `11px 10px`, green tint once completed).
 *
 * This is the "set-row list" split named in the R23 plan. It owns layout only -- every number
 * it shows is either passed in already resolved (`weightUnit`, `distanceUnit`) or handed back
 * to the caller unmodified through the `onUpdateSet` / `onCompleteSet` callbacks, which is where
 * `live-session.ts`'s pure reducer actually runs.
 */
interface LiveExerciseCardProps {
  exercise: LiveExercise;
  weightUnit: WeightDisplayUnit;
  distanceUnit: DistanceDisplayUnit;
  onOpenGoalPicker: () => void;
  onToggleMeasure: () => void;
  onToggleUnit: () => void;
  onOpenHistory: () => void;
  onRemoveExercise: () => void;
  onUpdateSet: (setIndex: number, patch: LiveSetPatch) => void;
  onCompleteSet: (setIndex: number) => void;
  onRemoveSet: (setIndex: number) => void;
  onAddSet: () => void;
}

export function LiveExerciseCard({
  exercise,
  weightUnit,
  distanceUnit,
  onOpenGoalPicker,
  onToggleMeasure,
  onToggleUnit,
  onOpenHistory,
  onRemoveExercise,
  onUpdateSet,
  onCompleteSet,
  onRemoveSet,
  onAddSet,
}: LiveExerciseCardProps) {
  return (
    <View
      className="mb-[14px] rounded-[14px] px-[16px] py-[15px]"
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <View className="flex-row items-start justify-between" style={{ gap: 10 }}>
        <View className="flex-1">
          <Text className="font-archivo text-[15.5px] font-bold text-text">{exercise.name}</Text>
          <View className="mt-[7px] flex-row flex-wrap items-center" style={{ gap: 7 }}>
            {/*
              The goal chip, and the sheet behind it. `goal` arrives derived server-side from
              `measure` -- a client must not invent one -- but the athlete chooses how to train
              it *today*, which is the prototype's own `sessionGoals` override. The chevron was
              always drawn here; now it leads somewhere.
            */}
            {exercise.goal ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Training goal for ${exercise.name}`}
                onPress={onOpenGoalPicker}
                hitSlop={6}
                className="flex-row items-center rounded-[5px] px-[7px] py-[3px]"
                style={{ backgroundColor: 'rgba(233,113,47,.13)', gap: 5 }}>
                <Text className="font-archivo text-[8.5px] font-bold uppercase tracking-[.1em] text-accent">
                  {EXERCISE_GOAL_DISPLAY_NAMES[exercise.goal]}
                </Text>
                <Icon name="chevron" size={9} color={colors.accent} />
              </Pressable>
            ) : null}
            <Text className="font-archivo text-[11.5px]" style={{ color: '#6E6E66' }}>
              {`${MEASURE_SUBTITLE[exercise.measure] ?? 'Weight'} · ${exercise.sets.length} sets`}
            </Text>
          </View>
        </View>

        <View className="flex-row items-center" style={{ gap: 4 }}>
          {exercise.measure === 'distance' || exercise.sets.some((set) => set.distanceMeters !== null) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                exercise.measure === 'distance' ? `Set ${exercise.name} as time` : `Set ${exercise.name} as distance`
              }
              onPress={onToggleMeasure}
              className="rounded-[8px] px-[9px] py-[5px]"
              style={{
                backgroundColor: 'rgba(233,113,47,.1)',
                borderWidth: 1,
                borderColor: 'rgba(233,113,47,.28)',
              }}>
              <Text className="font-archivo text-[10px] font-bold tracking-[.04em] text-accent">
                {exercise.measure === 'distance' ? 'Set as time' : 'Set as distance'}
              </Text>
            </Pressable>
          ) : null}
          {/*
            The unit chip is a button, not a label -- the prototype wires it to
            `toggleUnit(e.name, m)` and shows it whenever the measure is not time. It changes
            only what is displayed: the set keeps the kilograms it already held.
          */}
          {exercise.measure === 'time' ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Switch ${exercise.name} to ${
                exercise.measure === 'distance' ? nextDistanceUnit(distanceUnit) : nextWeightUnit(weightUnit)
              }`}
              onPress={onToggleUnit}
              hitSlop={6}
              className="rounded-[8px] px-[9px] py-[5px]"
              style={{ backgroundColor: 'rgba(255,255,255,.05)', borderWidth: 1, borderColor: colors.border }}>
              <Text
                className="font-archivo text-[10px] font-bold uppercase tracking-[.06em]"
                style={{ color: '#9A9A92' }}>
                {(exercise.measure === 'distance' ? distanceUnit : weightUnit).toUpperCase()}
              </Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${exercise.name} history`}
            onPress={onOpenHistory}
            className="p-[4px]"
            style={{ opacity: 0.55 }}>
            <Icon name="bars" size={18} color="#C8C8C0" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${exercise.name}`}
            onPress={onRemoveExercise}
            className="p-[4px]"
            style={{ opacity: 0.45 }}>
            <Icon name="x" size={15} color="#C9503C" />
          </Pressable>
        </View>
      </View>

      {/* Column headers: `padding:'0 11px 6px'`, widths 16 / 66 / flex / 44. */}
      <View className="mt-[12px] flex-row items-center px-[11px] pb-[6px]" style={{ gap: 8 }}>
        <Text
          className="w-[16px] text-center font-archivo text-[8.5px] font-semibold uppercase tracking-[.1em]"
          style={{ color: '#4D4D47' }}>
          Set
        </Text>
        <Text
          className="w-[66px] text-center font-archivo text-[8.5px] font-semibold uppercase tracking-[.1em]"
          style={{ color: '#4D4D47' }}>
          Prev
        </Text>
        <Text
          className="flex-1 text-center font-archivo text-[8.5px] font-semibold uppercase tracking-[.1em]"
          style={{ color: '#4D4D47' }}>
          Target
        </Text>
        <View className="w-[44px]" />
      </View>

      <View style={{ gap: 7 }}>
        {exercise.sets.map((set, setIndex) => {
          const numberColor = set.isCompleted ? colors.green : colors.text;
          return (
            <View
              key={setIndex}
              className="flex-row items-center rounded-[10px] px-[11px] py-[10px]"
              style={{
                backgroundColor: set.isCompleted ? 'rgba(121,185,138,.09)' : '#141517',
                borderWidth: 1,
                borderColor: set.isCompleted ? 'rgba(121,185,138,.25)' : colors.border,
                gap: 8,
              }}>
              <Text className="w-[16px] text-center font-archivo text-[11.5px] font-semibold" style={{ color: '#5C5C55' }}>
                {setIndex + 1}
              </Text>
              {/*
                PREV stays blank until local history exists -- same principle as the Watch card.
                A first-ever session has nothing to compare against, and inventing a previous
                performance would be inventing the athlete's own past.
              */}
              <Text
                numberOfLines={1}
                className="w-[66px] text-center font-archivo text-[10.5px] font-medium"
                style={{ color: '#5C5C55' }}>
                —
              </Text>

              <View className="flex-1 flex-row items-center justify-center" style={{ gap: exercise.measure === 'time' ? 4 : 6 }}>
                {exercise.measure === 'weight' ? (
                  <>
                    <TextInput
                      accessibilityLabel={`Weight for set ${setIndex + 1} of ${exercise.name}`}
                      // Displayed in this exercise's unit, stored in kilograms always (ADR-016).
                      // The conversion is symmetric, so toggling the chip and toggling back
                      // leaves the bar at exactly the weight it started at --
                      // `unit-conversion.spec.ts` pins that round trip.
                      value={set.weightKg === null ? '' : String(weightForDisplay(set.weightKg, weightUnit))}
                      keyboardType="decimal-pad"
                      onChangeText={(raw) =>
                        onUpdateSet(setIndex, {
                          weightKg:
                            raw === '' ? null : weightFromDisplay(Number(raw.replace(/[^0-9.]/g, '')) || 0, weightUnit),
                        })
                      }
                      className="w-[30px] py-[1px] text-center font-archivo text-[14px] font-semibold"
                      style={{ color: numberColor }}
                    />
                    <Text className="font-archivo text-[10.5px] font-medium" style={{ color: '#6E6E66' }}>
                      {weightUnit}
                    </Text>
                    <Text className="font-archivo text-[11px]" style={{ color: '#6E6E66' }}>
                      ×
                    </Text>
                    <TextInput
                      accessibilityLabel={`Reps for set ${setIndex + 1} of ${exercise.name}`}
                      value={set.reps === null ? '' : String(set.reps)}
                      keyboardType="number-pad"
                      onChangeText={(raw) =>
                        onUpdateSet(setIndex, {
                          reps: raw === '' ? null : parseInt(raw.replace(/[^0-9]/g, ''), 10) || 0,
                        })
                      }
                      className="w-[30px] py-[1px] text-center font-archivo text-[14px] font-semibold"
                      style={{ color: numberColor }}
                    />
                  </>
                ) : exercise.measure === 'time' ? (
                  <>
                    {/* The design logs a timed set as mm:ss, not one seconds field. */}
                    <TextInput
                      accessibilityLabel={`Minutes for set ${setIndex + 1} of ${exercise.name}`}
                      value={String(Math.floor((set.durationSeconds ?? 0) / 60))}
                      keyboardType="number-pad"
                      onChangeText={(raw) =>
                        onUpdateSet(setIndex, {
                          durationSeconds:
                            (parseInt(raw.replace(/[^0-9]/g, ''), 10) || 0) * 60 + ((set.durationSeconds ?? 0) % 60),
                        })
                      }
                      className="w-[26px] py-[1px] text-right font-archivo text-[14px] font-semibold"
                      style={{ color: numberColor }}
                    />
                    <Text className="font-archivo text-[14px] font-bold" style={{ color: '#6E6E66' }}>
                      :
                    </Text>
                    <TextInput
                      accessibilityLabel={`Seconds for set ${setIndex + 1} of ${exercise.name}`}
                      value={String((set.durationSeconds ?? 0) % 60)}
                      keyboardType="number-pad"
                      onChangeText={(raw) =>
                        onUpdateSet(setIndex, {
                          durationSeconds:
                            Math.floor((set.durationSeconds ?? 0) / 60) * 60 +
                            (parseInt(raw.replace(/[^0-9]/g, ''), 10) || 0),
                        })
                      }
                      className="w-[30px] py-[1px] text-center font-archivo text-[14px] font-semibold"
                      style={{ color: numberColor }}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Start timer for set ${setIndex + 1} of ${exercise.name}`}
                      onPress={() => onCompleteSet(setIndex)}
                      className="ml-[2px] flex-row items-center rounded-[8px] px-[9px] py-[5px]"
                      style={{ backgroundColor: 'rgba(233,113,47,.14)', gap: 5 }}>
                      <Icon name="chevron" size={10} color={colors.accent} />
                      <Text className="font-archivo text-[10.5px] font-bold text-accent">Timer</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <TextInput
                      accessibilityLabel={`Distance for set ${setIndex + 1} of ${exercise.name}`}
                      // Metres on the wire and in the log, miles only on screen -- the same
                      // display-only conversion the weight row above does.
                      value={
                        set.distanceMeters === null
                          ? ''
                          : String(distanceForDisplay(set.distanceMeters, distanceUnit))
                      }
                      keyboardType="decimal-pad"
                      onChangeText={(raw) =>
                        onUpdateSet(setIndex, {
                          distanceMeters:
                            raw === ''
                              ? null
                              : distanceFromDisplay(Number(raw.replace(/[^0-9.]/g, '')) || 0, distanceUnit),
                        })
                      }
                      className="w-[44px] py-[1px] text-center font-archivo text-[14px] font-semibold"
                      style={{ color: numberColor }}
                    />
                    <Text className="font-archivo text-[10.5px] font-medium" style={{ color: '#6E6E66' }}>
                      {distanceUnit}
                    </Text>
                  </>
                )}
              </View>

              {exercise.sets.length > 1 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove set ${setIndex + 1} of ${exercise.name}`}
                  onPress={() => onRemoveSet(setIndex)}
                  hitSlop={6}
                  style={{ opacity: 0.4 }}>
                  <Icon name="x" size={14} color="#C9503C" />
                </Pressable>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  set.isCompleted
                    ? `Untick set ${setIndex + 1} of ${exercise.name}`
                    : `Complete set ${setIndex + 1} of ${exercise.name}`
                }
                onPress={() => onCompleteSet(setIndex)}
                className="h-[24px] w-[24px] items-center justify-center rounded-[12px]"
                style={set.isCompleted ? { backgroundColor: colors.green } : { borderWidth: 1.5, borderColor: '#37383C' }}>
                {set.isCompleted ? <Icon name="check" size={13} color="#101011" /> : null}
              </Pressable>
            </View>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add set to ${exercise.name}`}
        onPress={onAddSet}
        className="mt-[9px] h-[36px] flex-row items-center justify-center rounded-[9px]"
        style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,.13)', gap: 7 }}>
        <Icon name="plus" size={15} color={colors.accent} />
        <Text className="font-archivo text-[12px] font-semibold" style={{ color: '#9A9A92' }}>
          Add set
        </Text>
      </Pressable>
    </View>
  );
}
