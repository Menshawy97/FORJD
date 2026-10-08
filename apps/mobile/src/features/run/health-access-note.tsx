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

interface HealthAccessNoteProps {
  metric: RunMetric;
}

export function HealthAccessNote({ metric }: HealthAccessNoteProps) {
  return (
    <View className="gap-[2px]">
      <Text className="font-archivo text-[13px]" style={{ color: colors.text }}>
        {HEALTH_ACCESS_NOTE_TEXT[metric]}
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
