import { Pressable, Text, View } from 'react-native';

import { Toggle } from '@/components/toggle';

// docs/design/slice2-screen-specs.md §5.4/§6.3. Row geometry: padding '15px 2px',
// borderBottomWidth 1 in borderFaint (including the last row), title 600 14.5/1.25, subtitle
// marginTop 3 / 400 12/1.3, trailing Toggle.
//
// **The whole row is the tap target**, not the prototype's 46x27 track. That is this
// project's one approved deviation from the prototype — an accessibility minimum-tap-target
// fix recorded in slice2-screen-specs.md §11 Q7, slice-2-plan.md and roadmap.md. It changes
// behaviour, not appearance, and `toggle-row.test.tsx` guards it.
//
// Box-model lives in className, not an inline style object: raw inline style box-model props
// on a Pressable were observed not applying on a native device (they worked on web) — see
// social-auth-row.tsx, where the same shape had to be rewritten this way.
interface ToggleRowProps {
  title: string;
  subtitle: string;
  on: boolean;
  onToggle: () => void;
}

export function ToggleRow({ title, subtitle, on, onToggle }: ToggleRowProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      // Subtitle folded into the label deliberately: an accessibility-role-bearing Pressable
      // collapses its subtree into one node, so a separate subtitle Text is never announced.
      // On privacy toggles that detail is what tells the user what the switch actually does.
      accessibilityLabel={`${title}. ${subtitle}`}
      accessibilityState={{ checked: on }}
      onPress={onToggle}
      className="flex-row items-center justify-between gap-[14px] border-b border-borderFaint px-[2px] py-[15px]">
      <View className="flex-1">
        <Text className="font-archivo text-row-title font-semibold text-text">{title}</Text>
        <Text className="mt-[3px] font-archivo text-row-subtitle text-dimmer">{subtitle}</Text>
      </View>
      <Toggle on={on} />
    </Pressable>
  );
}
