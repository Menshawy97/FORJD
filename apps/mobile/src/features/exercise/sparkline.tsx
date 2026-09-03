import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

/**
 * The exercise-detail screen's "Top set — last 8 sessions" trend (Phase 3J-d), transcribed
 * from the prototype's own `sparkline(pts, color, w, hh, fill)` helper.
 *
 * The geometry is the prototype's, verbatim: points are spread evenly across the width, the
 * series is normalised between its own min and max, `hh - 8` leaves four pixels of headroom at
 * each edge so an extreme is not clipped by the stroke, and the filled variant closes the path
 * down to the baseline at 10% opacity beneath a 1.8px line.
 *
 * **A single point draws nothing.** One session is not a trend, and the prototype's own
 * `(pts.length - 1)` divisor is a division by zero there — so the caller renders its "log a set"
 * copy instead, and this guards the case rather than emitting `NaN` into a path.
 */
interface SparklineProps {
  /** In series order, oldest first -- the direction the line is read. */
  points: readonly number[];
  width?: number;
  height?: number;
}

/** The prototype's own `sparkline(pts, O, 300, 80, true)` call at this one call site. */
const VIEWBOX_WIDTH = 300;
const VIEWBOX_HEIGHT = 80;
/** `hh - 8`: four pixels of headroom top and bottom, so a peak is not clipped by the stroke. */
const VERTICAL_PADDING = 8;

export function Sparkline({
  points,
  width = VIEWBOX_WIDTH,
  height = VIEWBOX_HEIGHT,
}: SparklineProps) {
  if (points.length < 2) return null;

  const max = Math.max(...points);
  const min = Math.min(...points);
  /*
   * A flat series has no range to normalise against. The prototype's own `|| 1` is what keeps
   * `0 / 0` out of the path: every point then normalises to 0 and the line draws flat along the
   * baseline, four pixels up. That reads as "no change", which is exactly what a series of
   * identical top sets is -- and it is the prototype's behaviour verbatim, so it stays.
   */
  const range = max - min || 1;

  const line = points
    .map((point, index) => {
      const x = (index * (width / (points.length - 1))).toFixed(1);
      const y = (height - ((point - min) / range) * (height - VERTICAL_PADDING) - 4).toFixed(1);
      return `${index === 0 ? 'M' : 'L'}${x} ${y}`;
    })
    .join(' ');

  return (
    <View style={{ height }}>
      <Svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none">
        <Path
          d={`${line} L${width} ${height} L0 ${height} Z`}
          fill={colors.accent}
          fillOpacity={0.1}
        />
        <Path d={line} fill="none" stroke={colors.accent} strokeWidth={1.8} strokeLinecap="round" />
      </Svg>
    </View>
  );
}
