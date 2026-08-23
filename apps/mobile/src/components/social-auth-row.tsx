import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

// Geometry and path data transcribed verbatim from the prototype's `socialRow()`/`socialBtn()`
// in `FORJD mobile app design/FORJD Mobile.dc.html` lines 1141-1165. `components/icon.tsx` is
// a monochrome stroke-only registry — Google's mark is four filled paths in four brand colors
// and Apple's is a single filled path, neither of which fits that shape — so this is its own
// small component rather than a new `Icon` entry.
//
// There is no OAuth backend (see the plan): the two buttons call the given handlers and
// nothing else. No *scale* transform on press, unlike the primary `btn()` — the prototype has
// no active-state rule to transcribe for these — but a plain `Pressable` with zero pressed
// feedback at all reads as broken on a touch device, so a background lift is applied while
// held (not drawn from the prototype, which has no touch semantics to draw one from).
interface SocialAuthRowProps {
  onGooglePress: () => void;
  onApplePress: () => void;
}

export function SocialAuthRow({ onGooglePress, onApplePress }: SocialAuthRowProps) {
  return (
    <View style={{ marginTop: 22, gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
        <Text
          className="font-archivo"
          style={{
            fontSize: 11,
            lineHeight: 11,
            fontWeight: '500',
            letterSpacing: 0.04 * 11,
            color: colors.dimmer,
          }}>
          OR CONTINUE WITH
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      </View>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <SocialButton
          label="Google"
          accessibilityLabel="Continue with Google"
          onPress={onGooglePress}
          icon={<GoogleMark />}
        />
        <SocialButton
          label="Apple"
          accessibilityLabel="Continue with Apple"
          onPress={onApplePress}
          icon={<AppleMark />}
        />
      </View>
    </View>
  );
}

interface SocialButtonProps {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  icon: React.ReactNode;
}

function SocialButton({ label, accessibilityLabel, onPress, icon }: SocialButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.elevated2 : colors.fieldBg })}
      className="h-[52px] flex-1 flex-row items-center justify-center gap-[9px] rounded-button border border-border">
      {icon}
      <Text
        className="font-archivo"
        style={{ fontSize: 14, lineHeight: 14, fontWeight: '600', color: colors.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

function GoogleMark() {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18">
      <Path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.6z"
      />
      <Path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.19l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.36 0-4.36-1.6-5.08-3.75H.9v2.33A9 9 0 0 0 9 18z"
      />
      <Path
        fill="#FBBC05"
        d="M3.92 10.66A5.4 5.4 0 0 1 3.63 9c0-.58.1-1.14.29-1.66V5.01H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4l3.02-2.34z"
      />
      <Path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .9 5.01l3.02 2.33C4.64 5.19 6.64 3.58 9 3.58z"
      />
    </Svg>
  );
}

function AppleMark() {
  return (
    <Svg width={16} height={19} viewBox="0 0 16 19" fill="none">
      <Path
        fill={colors.text}
        d="M13.1 10.02c-.03-2.05 1.67-3.03 1.75-3.08-.95-1.39-2.44-1.58-2.97-1.6-1.36-.14-2.62.79-3.31.79-.7 0-1.77-.77-2.9-.75-1.49.02-2.87.87-3.63 2.21-1.55 2.69-.4 6.68 1.11 8.86.73 1.06 1.6 2.26 2.75 2.22 1.1-.04 1.52-.71 2.85-.71 1.32 0 1.72.71 2.9.69 1.2-.02 1.96-1.07 2.69-2.14.85-1.24 1.2-2.44 1.22-2.5-.03-.01-2.34-.9-2.46-3.99zM9.98 3.61c.62-.75 1.03-1.79.92-2.83-.89.04-1.98.6-2.62 1.34-.58.66-1.08 1.72-.95 2.72.98.08 1.99-.5 2.65-1.23z"
      />
    </Svg>
  );
}
