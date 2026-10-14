import { Pressable, Text, View } from 'react-native';

import { openDeviceHealthSettings } from '@/integrations/health/health-settings';
import { colors } from '@/theme/tokens';

import type { RunMetric } from './run-health';

/**
 * What the run says when Health Connect refused a read the person once allowed (they turned access
 * off there). Without it that looks exactly like a watch that has not synced yet. Replica approved
 * 2026-10-09; the link opens Health Connect's own settings, the only place access can be turned back on.
 */
export const HEALTH_ACCESS_NOTE_TEXT: Record<RunMetric, string> = {
  heart_rate: 'Heart rate is turned off for FORJD in Health Connect.',
  active_energy: 'Watch calories are turned off for FORJD in Health Connect, so this run uses an estimate.',
};

/** With no estimate to show (Calories reads "—", e.g. no weight on the account), the note claims none (walk finding 19). */
const NO_ESTIMATE_CALORIES_TEXT = 'Watch calories are turned off for FORJD in Health Connect.';

interface HealthAccessNoteProps {
  metric: RunMetric;
  /** Whether the run shows a calorie estimate in place of the watch's. Defaults to true. */
  hasEstimate?: boolean;
}

export function HealthAccessNote({ metric, hasEstimate = true }: HealthAccessNoteProps) {
  const text = metric === 'active_energy' && !hasEstimate ? NO_ESTIMATE_CALORIES_TEXT : HEALTH_ACCESS_NOTE_TEXT[metric];
  return (
    <View className="gap-[2px]">
      <Text className="font-archivo text-[13px]" style={{ color: colors.text }}>
        {text}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open Health Connect"
        className="min-h-[44px] justify-center"
        onPress={() => {
          openDeviceHealthSettings();
        }}>
        <Text className="font-archivo text-[13px] font-semibold" style={{ color: colors.destructive }}>
          Open Health Connect
        </Text>
      </Pressable>
    </View>
  );
}
