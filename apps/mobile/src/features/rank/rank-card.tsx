import type { LeaderboardMe } from '@forjd/contracts';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, View } from 'react-native';

import { colors } from '@/theme/tokens';
import { TIGHT_TEXT_MAX_FONT_SCALE } from '@/theme/text-scale';
import { formatScore, weekLine, type DeltaTone } from './rank-format';

/**
 * The "Your rank" card, from the prototype's `isRank` markup: a `linear-gradient(150deg,
 * #2a1a11, #1d1512)` ground, a 1px `rgba(233,113,47,.28)` outline, `borderRadius:14`,
 * `padding:'15px 16px'`, `justifyContent:'space-between'`, `alignItems:'flex-start'`, `gap:12`.
 *
 * Left: the eyebrow (`600 9.5px/1`, `.14em`, uppercase, `#c9906c`, `marginBottom:8`), then the rank
 * (`700 27px/1`, accent, `letterSpacing:-.02em`) baseline-aligned with the week line (`600
 * 11.5px/1`, green when up, `gap:9`). Right, right-aligned: the score (`700 20px/1`, tabular) and
 * `Top N%` (`400 11px/1`, `#a08167`, `marginTop:6`).
 *
 * 150deg is down and to the right; on `expo-linear-gradient`'s unit square that is the centre
 * plus and minus half the direction vector `(sin 150, -cos 150) = (.5, .866)`. The gradient gets a
 * raw `borderRadius` so its own fill is clipped, and the outline and padding sit on a nested View,
 * as `ReadinessCard` does (a `className` on `LinearGradient` is silently dropped).
 */
interface RankCardProps {
  me: LeaderboardMe;
}

const WEEK_COLOR: Record<DeltaTone, string> = {
  up: colors.green,
  down: colors.destructive,
  flat: colors.legal,
};

export function RankCard({ me }: RankCardProps) {
  const week = weekLine(me.delta);
  return (
    <LinearGradient
      colors={[colors.rankCardFrom, colors.rankCardTo]}
      start={{ x: 0.25, y: 0.067 }}
      end={{ x: 0.75, y: 0.933 }}
      style={{ borderRadius: 14 }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          paddingVertical: 15,
          paddingHorizontal: 16,
          borderWidth: 1,
          borderColor: colors.borderAthleteAvatar,
          borderRadius: 14,
        }}>
        <View>
          <Text
            maxFontSizeMultiplier={TIGHT_TEXT_MAX_FONT_SCALE}
            style={{
              fontFamily: 'Archivo',
              fontSize: 9.5,
              lineHeight: 9.5,
              fontWeight: '600',
              letterSpacing: 0.14 * 9.5,
              textTransform: 'uppercase',
              color: colors.weekScoreLabel,
              marginBottom: 8,
            }}>
            Your rank
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9 }}>
            <Text
              maxFontSizeMultiplier={TIGHT_TEXT_MAX_FONT_SCALE}
              style={{
                fontFamily: 'Archivo',
                fontSize: 27,
                lineHeight: 27,
                fontWeight: '700',
                letterSpacing: -0.02 * 27,
                color: colors.accent,
              }}>
              {`#${me.rank}`}
            </Text>
            {week ? (
              <Text
                maxFontSizeMultiplier={TIGHT_TEXT_MAX_FONT_SCALE}
                style={{
                  fontFamily: 'Archivo',
                  fontSize: 11.5,
                  lineHeight: 11.5,
                  fontWeight: '600',
                  color: WEEK_COLOR[week.tone],
                }}>
                {week.text}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text
            maxFontSizeMultiplier={TIGHT_TEXT_MAX_FONT_SCALE}
            style={{
              fontFamily: 'Archivo',
              fontSize: 20,
              lineHeight: 20,
              fontWeight: '700',
              color: colors.text,
              fontVariant: ['tabular-nums'],
            }}>
            {formatScore(me.score)}
          </Text>
          <Text
            maxFontSizeMultiplier={TIGHT_TEXT_MAX_FONT_SCALE}
            style={{
              marginTop: 6,
              fontFamily: 'Archivo',
              fontSize: 11,
              lineHeight: 11,
              fontWeight: '400',
              color: colors.rankCardMuted,
            }}>
            {`Top ${me.topPercent}%`}
          </Text>
        </View>
      </View>
    </LinearGradient>
  );
}
