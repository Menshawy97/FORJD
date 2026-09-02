import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

/**
 * Nested progress rings, calories outermost through fat innermost -- the "Apple Watch
 * activity ring" look, applied to Home's Nutrition Today card, the main nutrition
 * dashboard's ring, and the share card's Daily Summary preview.
 *
 * `computeRingGeometry` is separated from the component so its arithmetic is unit-testable
 * without rendering react-native-svg. Each ring's radius steps inward from the previous by
 * exactly `strokeWidth + gap`, so bands never overlap and are evenly spaced regardless of how
 * many are passed.
 */
export interface RingBand {
  key: string;
  /** Fraction already clamped to [0, 1] by the caller -- this file does no goal math. */
  filled: number;
  color: string;
}

export interface RingGeometry {
  key: string;
  color: string;
  radius: number;
  circumference: number;
  dashoffset: number;
}

export function computeRingGeometry(
  bands: readonly RingBand[],
  outerRadius: number,
  strokeWidth: number,
  gap: number,
): RingGeometry[] {
  return bands.map((band, index) => {
    const radius = outerRadius - index * (strokeWidth + gap);
    const circumference = 2 * Math.PI * radius;
    return {
      key: band.key,
      color: band.color,
      radius,
      circumference,
      dashoffset: circumference * (1 - band.filled),
    };
  });
}

interface ConcentricRingsProps {
  size: number;
  outerRadius: number;
  strokeWidth: number;
  gap: number;
  bands: readonly RingBand[];
  /**
   * The three screens this replaces each used a *different* track colour in the original
   * design (Home: `rgba(255,255,255,.08)`; the nutrition dashboard: a solid `#1E1F22`; the
   * share card: `rgba(255,255,255,.1)`) -- not one shared value, so this is a prop rather
   * than a hardcoded default, and every caller passes its own screen's token explicitly.
   */
  trackColor: string;
  /** Content centered inside the innermost ring -- e.g. the kcal number. Omit for none. */
  children?: ReactNode;
}

export function ConcentricRings({
  size,
  outerRadius,
  strokeWidth,
  gap,
  bands,
  trackColor,
  children,
}: ConcentricRingsProps) {
  const geometry = computeRingGeometry(bands, outerRadius, strokeWidth, gap);
  const center = size / 2;

  return (
    <View style={{ width: size, height: size }}>
      {/* Rotated so every ring fills clockwise from twelve o'clock, matching the app's
          existing single-ring convention (nutrition.tsx, nutrition-share.tsx). */}
      <View style={{ width: size, height: size, transform: [{ rotate: '-90deg' }] }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {geometry.map((ring) => (
            <G key={ring.key}>
              <Circle
                cx={center}
                cy={center}
                r={ring.radius}
                fill="none"
                stroke={trackColor}
                strokeWidth={strokeWidth}
              />
              <Circle
                cx={center}
                cy={center}
                r={ring.radius}
                fill="none"
                stroke={ring.color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={`${ring.circumference}`}
                strokeDashoffset={ring.dashoffset}
              />
            </G>
          ))}
        </Svg>
      </View>
      {children === undefined ? null : (
        <View className="absolute inset-0 items-center justify-center">{children}</View>
      )}
    </View>
  );
}
