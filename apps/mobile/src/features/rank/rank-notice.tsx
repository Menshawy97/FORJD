import type { LeaderboardResponse } from '@forjd/contracts';
import { Pressable, Text, View } from 'react-native';

import { colors } from '@/theme/tokens';
import { metricLabel } from './rank-format';

/**
 * What the list area says when there is no list. The prototype only ever draws the ranked board,
 * so these states have no design of their own: each is a plain card in the app's existing card
 * treatment (`#17181A` ground, `.07` outline, `borderRadius:14`, `padding:'15px 16px'`) carrying
 * a title, one sentence and, where the athlete can do something about it, one button.
 *
 * One state per server status, so a number can never appear beside "coming soon":
 *
 * - `coming_soon`: the chip is real and the score is not built yet.
 * - `not_opted_in` / `no_city`: the athlete has not joined, or has not allowed location, so the
 *   button goes to the Location screen, which asks once and turns both on.
 * - `no_eligible_sessions`: joined, but nothing counted yet. Only workouts run through the live
 *   runner count (ADR-044), which is what the sentence says.
 * - `cohort_too_small`: the true head-count against the floor, so the wait has a size.
 */
export interface Notice {
  title: string;
  body: string;
  action?: string;
}

export function noticeFor(
  response: Pick<LeaderboardResponse, 'status' | 'metric' | 'city' | 'cohortSize' | 'minCohortSize'>,
): Notice | null {
  const city = response.city?.name ?? 'your city';
  switch (response.status) {
    case 'ranked':
      return null;
    case 'coming_soon':
      return {
        title: `${metricLabel(response.metric)} rankings are coming soon`,
        body: 'For now, Activity is the score you can climb.',
      };
    case 'not_opted_in':
      return {
        title: 'Join your city’s leaderboard',
        body: 'Allow approximate location and FORJD places you in a city. Your exact location is never stored.',
        action: 'Set up',
      };
    case 'no_city':
      return {
        title: 'Allow location to find your city',
        body: 'You are on the leaderboard, but FORJD does not know your city yet. Your exact location is never stored.',
        action: 'Set up',
      };
    case 'no_eligible_sessions':
      return {
        title: 'Nothing to rank yet',
        body: 'Finish a workout with the timer running and you will appear here. Workouts logged afterwards do not count.',
      };
    case 'cohort_too_small':
      return {
        title: `${city} is getting started`,
        body: `${response.cohortSize} of the ${response.minCohortSize} athletes needed to show a leaderboard have joined so far.`,
      };
  }
}

interface RankNoticeProps {
  notice: Notice;
  onAction?: () => void;
}

export function RankNotice({ notice, onAction }: RankNoticeProps) {
  return (
    <View
      style={{
        marginTop: 18,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 14,
        paddingVertical: 15,
        paddingHorizontal: 16,
      }}>
      <Text style={{ fontFamily: 'Archivo', fontSize: 14, fontWeight: '700', color: colors.text }}>
        {notice.title}
      </Text>
      <Text
        style={{
          marginTop: 6,
          fontFamily: 'Archivo',
          fontSize: 12.5,
          lineHeight: 12.5 * 1.5,
          color: colors.dimmer,
        }}>
        {notice.body}
      </Text>
      {notice.action && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          className="mt-[14px] h-[44px] items-center justify-center rounded-[12px] bg-accentDark">
          <Text style={{ fontFamily: 'Archivo', fontSize: 14, fontWeight: '700', color: colors.onAccent }}>
            {notice.action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
