import type { ForgeBand, ForgeLadder } from '@forjd/domain';
import { useEffect } from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';

import { TIGHT_TEXT_MAX_FONT_SCALE } from '@/theme/text-scale';
import { ForgeMark } from './forge-mark';

/**
 * The Weekly Forge level-up toast, as approved in the Phase 7 mock-ups (item D): the app's existing
 * toast pill, value for value (`components/toast.tsx`: 22 px from each side, 96 px up, 13/16 px
 * padding, `toastBg`, a `borderToast` outline, the `toast` shadow, 13 px semibold `text`), with
 * the ladder's 20 px badge at the start, 10 px before the words.
 *
 * A new component rather than a change to `Toast`, so the existing toast stays exactly as it is.
 * Like `Toast`, it is announced to screen readers; the badge is decorative, since the words already
 * name the ladder. The `toast` type size has a line height of 1, so font scaling is capped to keep
 * a wrapped line from overlapping. Its host owns how long it stays up.
 */
interface ForgeToastProps {
  ladder: ForgeLadder;
  band: ForgeBand;
  message: string;
}

export function ForgeToast({ ladder, band, message }: ForgeToastProps) {
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  return (
    <View
      accessibilityLiveRegion="polite"
      className="absolute bottom-[96px] left-[22px] right-[22px] flex-row items-center gap-[10px] rounded-button border border-borderToast bg-toastBg px-4 py-[13px] shadow-toast">
      <ForgeMark ladder={ladder} band={band} size={20} decorative />
      <Text
        maxFontSizeMultiplier={TIGHT_TEXT_MAX_FONT_SCALE}
        className="flex-1 font-archivo text-toast font-semibold text-text">
        {message}
      </Text>
    </View>
  );
}
