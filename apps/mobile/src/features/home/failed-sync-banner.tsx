import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { colors } from '@/theme/tokens';

/**
 * The read path + retry surface the audit found entirely missing (C3): a session that hit
 * `MAX_ATTEMPTS` used to sit in `failed` status forever with no banner, no retry, no report --
 * the finished workout was simply gone as far as the athlete could tell. This is that surface.
 *
 * Deliberately not a `Toast` (`@/components/toast`): a toast disappears after 1900ms, which is
 * the wrong shape for "the app is still holding a workout it could not save" -- that stays
 * visible until the athlete acts on it or it clears itself by succeeding.
 */
export interface FailedSyncBannerSession {
  sessionId: string;
  name: string;
}

interface FailedSyncBannerProps {
  failedSessions: readonly FailedSyncBannerSession[];
  onRetry: (sessionId: string) => Promise<void>;
}

export function FailedSyncBanner({ failedSessions, onRetry }: FailedSyncBannerProps) {
  const [retryingId, setRetryingId] = useState<string | null>(null);

  if (failedSessions.length === 0) {
    return null;
  }

  const first = failedSessions[0]!;
  const label =
    failedSessions.length === 1
      ? `"${first.name}" wasn't saved`
      : `${failedSessions.length} workouts weren't saved`;

  const handleRetry = () => {
    setRetryingId(first.sessionId);
    void onRetry(first.sessionId).finally(() => setRetryingId(null));
  };

  return (
    <View
      accessibilityLiveRegion="assertive"
      className="mb-[14px] flex-row items-center justify-between rounded-card border px-4 py-3"
      style={{ borderColor: 'rgba(233,113,47,.35)', backgroundColor: 'rgba(233,113,47,.10)' }}>
      <Text className="mr-3 flex-1 font-archivo text-[13px] font-semibold text-text">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Retry saving ${first.name}`}
        accessibilityState={{ disabled: retryingId === first.sessionId }}
        disabled={retryingId === first.sessionId}
        onPress={handleRetry}
        className="items-center justify-center rounded-[10px] px-3 py-[6px]"
        style={{ backgroundColor: colors.accent }}>
        <Text className="font-archivo text-[12px] font-bold text-white">
          {retryingId === first.sessionId ? 'Retrying…' : 'Retry'}
        </Text>
      </Pressable>
    </View>
  );
}
