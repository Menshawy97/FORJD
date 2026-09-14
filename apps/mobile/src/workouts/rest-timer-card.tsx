import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { colors } from '@/theme/tokens';

/** The rest card reads `1:30`, never `90` -- it is a duration, not a count. */
function formatRest(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The live workout screen's rest-timer settings card -- extracted from `app/live.tsx` (R23a),
 * geometry unchanged: radius 14, `12px 15px` padding, gap 11, 30px icon tile. Sets how long the
 * *next* rest period will be; it does not itself run a countdown -- that lives on the separate
 * `/rest` route, reached from `live-session`'s `restStartedSeconds`.
 */
interface RestTimerCardProps {
  restSeconds: number;
  onDecrease: () => void;
  onIncrease: () => void;
}

export function RestTimerCard({ restSeconds, onDecrease, onIncrease }: RestTimerCardProps) {
  return (
    <View
      className="mb-[14px] flex-row items-center rounded-[14px] px-[15px] py-[12px]"
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 11 }}>
      <View
        className="h-[30px] w-[30px] items-center justify-center rounded-[9px]"
        style={{ backgroundColor: 'rgba(255,255,255,.05)' }}>
        <Icon name="clock" size={16} color="#8B8B83" />
      </View>
      <View className="flex-1">
        <Text className="font-archivo text-[13px] font-semibold text-text">Rest timer</Text>
        <Text className="mt-[4px] font-archivo text-[11px]" style={{ color: '#6E6E66' }}>
          Applies to every set in this workout
        </Text>
      </View>
      <View
        className="flex-row items-center rounded-[9px] p-[2px]"
        style={{ backgroundColor: '#101011', borderWidth: 1, borderColor: colors.border, gap: 2 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Decrease rest"
          onPress={onDecrease}
          className="h-[26px] w-[28px] items-center justify-center rounded-[7px]">
          <Text className="font-archivo text-[15px] font-bold" style={{ color: '#9A9A92' }}>
            −
          </Text>
        </Pressable>
        <Text className="min-w-[46px] text-center font-archivo text-[13px] font-bold text-text">
          {formatRest(restSeconds)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Increase rest"
          onPress={onIncrease}
          className="h-[26px] w-[28px] items-center justify-center rounded-[7px]">
          <Text className="font-archivo text-[15px] font-bold" style={{ color: '#9A9A92' }}>
            +
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
