import { Pressable, Text, View } from 'react-native';

import { colors } from '@/theme/tokens';
import { Icon } from './icon';

/**
 * The prototype's `hdr(title, onBack, right)`. `right` is unused by every slice-2 screen
 * (per the spec) and is therefore not modelled here — the smallest honest surface for the
 * screens that actually exist.
 *
 *   container: padding '2px 22px 14px' (onBack is always present at every call site so far)
 *   back chevron: 34×34 box, margin '0 0 10px -8px', radius 10, hover bg rgba(255,255,255,.06)
 *   h1: font 700 26px/1.15 Archivo; letter-spacing -.02em; color #f6f5f3
 *
 * The 20×20 chevron glyph itself (`M12.5 4 6.5 10l6 6`, stroke #f6f5f3, sw 1.7) is
 * `Icon name="back"` — the same glyph login/signup's bespoke header already uses.
 */
interface HeaderProps {
  title: string;
  onBack: () => void;
}

export function Header({ title, onBack }: HeaderProps) {
  return (
    <View className="flex-none px-screen-x pb-[14px] pt-[2px]">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        className="h-[34px] w-[34px] items-center justify-center rounded-[10px]"
        style={({ pressed }) => [
          { marginBottom: 10, marginLeft: -8 },
          pressed && { backgroundColor: colors.pressedGhost },
        ]}>
        <Icon name="back" />
      </Pressable>
      <Text className="font-archivo text-screen-header font-bold text-text" numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}
