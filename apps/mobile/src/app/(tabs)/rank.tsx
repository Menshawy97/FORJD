import type { LeaderboardResponse } from '@forjd/contracts';
import type { LeaderboardMetric, LeaderboardPeriod } from '@forjd/domain';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { getLeaderboard } from '@/auth/apiClient';
import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { SegmentedControl } from '@/components/segmented-control';
import { RankCard } from '@/features/rank/rank-card';
import { RankChip } from '@/features/rank/rank-chip';
import { listHeading, RANK_CHIPS, RANK_PERIODS } from '@/features/rank/rank-format';
import { noticeFor, RankNotice } from '@/features/rank/rank-notice';
import { RankRow } from '@/features/rank/rank-row';
import { colors } from '@/theme/tokens';

/**
 * The Rank tab (Phase 10K), built against `screenshots/leaderboard.png` and the prototype's
 * `isRank` markup and `rankVals()` (`FORJD Mobile.dc.html`).
 *
 * Every figure on it is the server's: the city, the rank, the score, "Top N%", the week movement,
 * the window text and each row. Nothing is a literal from the prototype's demo data.
 *
 * **Every state is a 200 with a status** (`LEADERBOARD_STATUSES`), so the chrome (title, chips and
 * period control) is always drawn and only the area below it changes: the your-rank card and list
 * for `ranked`, a `RankNotice` for the rest. A failed request shows a retry notice in the same
 * place. Loading follows Home's idiom: `useFocusEffect` (finishing a workout and tabbing back
 * must not leave a stale rank), a generation ref so a response that lands after the screen has
 * blurred or the chips have moved on cannot commit.
 *
 * Taps, from the prototype: your own row goes to Profile; another athlete's opens their profile,
 * unless it is private (decision D10, the row is then not a button); the pin opens Location.
 *
 * Deliberate differences from the screenshot: the rank numbers, labels and non-self avatar glyph
 * use `label` / `dimmer` rather than the faint grey retired for readability in 8H.
 */
const LABEL_STYLE = {
  fontFamily: 'Archivo',
  fontSize: 9.5,
  lineHeight: 9.5,
  fontWeight: '600',
  letterSpacing: 0.14 * 9.5,
  textTransform: 'uppercase',
  color: colors.label,
} as const;

export default function RankScreen() {
  const [metric, setMetric] = useState<LeaderboardMetric>('activity');
  const [period, setPeriod] = useState<LeaderboardPeriod>('month');
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = (loadGeneration.current += 1);
    setFailed(false);
    try {
      const response = await getLeaderboard({ metric, period });
      if (generation === loadGeneration.current) setBoard(response);
    } catch {
      if (generation === loadGeneration.current) {
        setBoard(null);
        setFailed(true);
      }
    }
  }, [metric, period]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        loadGeneration.current += 1;
      };
    }, [load]),
  );

  const notice = board ? noticeFor(board) : null;

  return (
    <ScreenBackground>
      <View style={{ paddingHorizontal: 22, paddingBottom: 12 }}>
        <Text style={{ ...LABEL_STYLE, marginBottom: 6 }}>City</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text
            accessibilityRole="header"
            style={{
              fontFamily: 'Archivo',
              fontSize: 25,
              lineHeight: 25 * 1.1,
              fontWeight: '700',
              letterSpacing: -0.02 * 25,
              color: colors.text,
            }}>
            {board?.city?.name ?? 'Your city'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Location settings"
            onPress={() => router.push('/location')}>
            <Icon name="pin" size={21} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        {board?.status === 'ranked' && board.me ? <RankCard me={board.me} /> : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14, marginBottom: 10 }}>
          {RANK_CHIPS.map((chip) => (
            <RankChip
              key={chip.value}
              label={chip.label}
              selected={chip.value === metric}
              onPress={() => setMetric(chip.value)}
            />
          ))}
        </View>

        <SegmentedControl
          options={RANK_PERIODS}
          value={period}
          onChange={setPeriod}
          accessibilityLabel="Leaderboard period"
        />

        {failed ? (
          <RankNotice
            notice={{
              title: 'Could not load the leaderboard',
              body: 'Check your connection and try again.',
              action: 'Try again',
            }}
            onAction={() => void load()}
          />
        ) : null}

        {notice ? (
          <RankNotice
            notice={notice}
            onAction={notice.action ? () => router.push('/location') : undefined}
          />
        ) : null}

        {board?.status === 'ranked' ? (
          <>
            <Text style={{ ...LABEL_STYLE, marginTop: 18, marginBottom: 4 }}>
              {listHeading(board.metric, board.periodLabel)}
            </Text>
            {board.rows.map((row) => (
              <RankRow
                key={row.userId}
                row={row}
                onPress={
                  row.isSelf
                    ? () => router.push('/profile')
                    : row.isPublicProfile
                      ? () =>
                          router.push({
                            pathname: '/athlete/[userId]',
                            params: { userId: row.userId, from: 'rank' },
                          })
                      : undefined
                }
              />
            ))}
          </>
        ) : null}
      </ScrollView>
    </ScreenBackground>
  );
}
