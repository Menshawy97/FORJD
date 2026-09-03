import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { colors } from '@/theme/tokens';

/**
 * Train's "Previous Workout" card (`screenshots/train2.png`, the prototype's `s_train()`).
 *
 * Presentational only -- every figure it shows is derived in `workouts/previous-workout.ts`,
 * which is where the arithmetic is tested. This file owns the geometry, transcribed from the
 * prototype: a `15px 16px` card, a 16px title over an 11.5px meta line at `marginTop:7`,
 * chips at `marginTop:13` with a 6px gap, and the button row at `marginTop:15` with a gap of 8.
 *
 * **Two elements of the design are deliberately absent**, both because nothing in Phase 3
 * supplies them and inventing an athlete's own training data was rejected in Phase J:
 * the meta line's `avg 151 bpm` (no `HealthProvider` yet) and the `PR +` badge (a personal
 * record is a claim about all history, which the device does not have). See
 * `docs/product/phase-3j-plan.md`.
 */
interface PreviousWorkoutCardProps {
  name: string;
  /** `Yesterday · 45:12 · 14,200 kg` -- already assembled by the caller. */
  meta: string;
  /** `Bench 82.5×6`, `Dips BW×12` -- the heaviest completed set per exercise. */
  chips: string[];
  onRepeat: () => void;
  onSummary: () => void;
}

export function PreviousWorkoutCard({
  name,
  meta,
  chips,
  onRepeat,
  onSummary,
}: PreviousWorkoutCardProps) {
  return (
    <View
      className="rounded-card px-[16px] py-[15px]"
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <Text className="font-archivo text-[16px] font-bold leading-[1] text-text" numberOfLines={1}>
        {name}
      </Text>
      <Text className="mt-[7px] font-archivo text-[11.5px] leading-[1.45] text-dimmer">{meta}</Text>

      {chips.length > 0 ? (
        <View className="mt-[13px] flex-row flex-wrap" style={{ gap: 6 }}>
          {/*
            Keyed by position, not by the label. Two exercises the on-device catalogue cannot
            resolve both fall back to the name `Exercise`, so two of them with the same heaviest
            set produce the same string -- and React would silently render only one, showing
            fewer chips than the athlete actually performed. The array is rebuilt whole whenever
            the session changes, so a positional key is stable.
          */}
          {chips.map((chip, index) => (
            <Text
              key={`${index}-${chip}`}
              className="rounded-[7px] bg-tagBg px-[10px] py-[6px] font-archivo text-[11px] font-medium leading-[1] text-tooltipBody"
              style={{ fontVariant: ['tabular-nums'] }}>
              {chip}
            </Text>
          ))}
        </View>
      ) : null}

      <View className="mt-[15px] flex-row" style={{ gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Repeat ${name}`}
          onPress={onRepeat}
          className="h-[44px] min-w-0 flex-1 flex-row items-center justify-center gap-[7px] rounded-field bg-accent shadow-repeat-button">
          {/*
            The one filled glyph in the set: the prototype draws this triangle with `fill:'#fff'`
            and no stroke, so `strokeWidth={0}` keeps it at exactly that geometry.
          */}
          <Icon name="play" size={14} color="#fff" filled strokeWidth={0} />
          <Text className="font-archivo text-[12.5px] font-bold leading-[1] text-white">Repeat</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Summary of ${name}`}
          onPress={onSummary}
          className="h-[44px] min-w-0 flex-1 flex-row items-center justify-center gap-[7px] rounded-field"
          style={{ borderWidth: 1, borderColor: colors.border }}>
          <Icon name="bars" size={14} color={colors.dim} strokeWidth={1.8} />
          <Text className="font-archivo text-[12.5px] font-semibold leading-[1] text-dim">
            Summary
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
