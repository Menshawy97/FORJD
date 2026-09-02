import { Text, View } from 'react-native';

import { colors } from '@/theme/tokens';

/**
 * The workout-kind badge from the prototype's own `typeChip(t)` helper (`FORJD Mobile.dc.html`):
 * a translucent-white pill (`rgba(255,255,255,.05)`) outlined in the kind's own colour at ~27%
 * opacity (`<color>44`), with bold uppercase text in that same solid colour -- never a filled
 * colour background, which is a different chip style used elsewhere in this app
 * (`FilterChip`). `workout custom.png` shows this exact outlined treatment for "CUSTOM".
 *
 * Colour is keyed off the kind, matching `typeChip`'s own branching: Preset is a neutral grey
 * (not accent-coloured -- it is the "no customisation happened" case), Custom is the app accent,
 * and "Customised preset" falls into the prototype's `else` branch, which resolves to green, not
 * orange -- a real and easy-to-miss detail, since the badges the surrounding builder and
 * workout-detail screens already had *were* orange for every kind before this component existed.
 */
export type WorkoutKind = 'Preset' | 'Custom' | 'Customised preset';

const COLOR_BY_KIND: Record<WorkoutKind, string> = {
  Preset: '#8B8B83',
  Custom: colors.accent,
  'Customised preset': colors.green,
};

interface TypeChipProps {
  kind: WorkoutKind;
}

export function TypeChip({ kind }: TypeChipProps) {
  const color = COLOR_BY_KIND[kind];
  return (
    <View
      className="rounded-[6px] px-[8px] py-[4px]"
      style={{ backgroundColor: 'rgba(255,255,255,.05)', borderWidth: 1, borderColor: `${color}44` }}>
      <Text
        className="font-archivo text-[9.5px] font-bold uppercase tracking-[.06em]"
        style={{ color }}>
        {kind}
      </Text>
    </View>
  );
}
