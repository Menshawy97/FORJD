import { View } from 'react-native';

import { colors } from '@/theme/tokens';

// docs/design/slice2-screen-specs.md §1 `toggle(on, onClick)`. Presentational only: the row
// (toggle-row.tsx) owns the tap target, per the project's whole-row-tappable deviation (§11
// Q7 resolution), so this component has no `onPress` of its own and no pressed/disabled state
// — matching the prototype ("No pressed or disabled state").
interface ToggleProps {
  on: boolean;
}

export function Toggle({ on }: ToggleProps) {
  return (
    <View
      style={{
        width: 46,
        height: 27,
        borderRadius: 14,
        padding: 3,
        backgroundColor: on ? colors.accent : colors.toggleTrackOff,
      }}>
      <View
        style={{
          width: 21,
          height: 21,
          borderRadius: 11,
          backgroundColor: '#fff',
          // Conditionally spread, not `transform: on ? [...] : undefined` — a `transform` key
          // present with an `undefined` value can diff to `transform: null` on native, which
          // crashes RN Fabric's transform validator ("Cannot read property 'forEach' of
          // null"). Omitting the key entirely when off is the only safe way to say "no
          // transform" — see press-feedback.ts, which does the same for the same reason.
          ...(on ? { transform: [{ translateX: 19 }] } : null),
        }}
      />
    </View>
  );
}
