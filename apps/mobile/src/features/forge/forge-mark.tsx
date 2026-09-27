import { FORGE_BAND_NAMES, FORGE_LADDER_NAMES, type ForgeBand, type ForgeLadder } from '@forjd/domain';
import { useId } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { BAND_FINISH } from './band-finish';
import { FORGE_GLYPHS, type ForgeGlyphShape } from './forge-glyphs';

/**
 * The Weekly Forge "Hallmark" badge: a silversmith's stamp, as approved in the Phase 7 mock-ups
 * (docs/product/weekly-forge-plan.md, "Phase 7 outcome"). Every number below is the approved
 * geometry on a 48 x 48 box:
 *
 * - an octagon outlined in the band's light colour (2.2) and filled with its main colour at 16%;
 * - the ladder's icon, on its own 24 grid at 1.6, scaled .72 and centred at (24, 21);
 * - one dot per band under the icon (r 1.5, 5 apart, at y 37.6), so the band reads without colour;
 * - Forged only: an inner octagon at 60%, and a white-hot glow.
 *
 * The mock-up drew the glow as a CSS drop-shadow. `react-native-svg` has no dependable shadow on
 * both platforms, so it is a radial gradient behind the octagon instead: brightest just inside the
 * octagon's edge (the edges sit at 83-91% of the radius) and gone at the box's edge.
 */
const OCTAGON = 'M15 4H33L44 15V33L33 44H15L4 33V15Z';
const INNER_OCTAGON = 'M16.4 7.4H31.6L40.6 16.4V31.6L31.6 40.6H16.4L7.4 31.6V16.4Z';
const GLYPH_TRANSFORM = 'translate(15.36 12.36) scale(0.72)';
const DOT_SPACING = 5;
const DOT_RADIUS = 1.5;
const DOT_Y = 37.6;

interface ForgeMarkProps {
  ladder: ForgeLadder;
  band: ForgeBand;
  size: number;
}

export function ForgeMark({ ladder, band, size }: ForgeMarkProps) {
  const finish = BAND_FINISH[band];
  // `useId` returns ":r0:"-style ids; colons are not safe inside an SVG `url(#...)` reference.
  const glowId = `forge-glow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const firstDotX = 24 - ((finish.dots - 1) * DOT_SPACING) / 2;

  return (
    <View
      testID="forge-mark"
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${FORGE_LADDER_NAMES[ladder]}, ${FORGE_BAND_NAMES[band]}`}
      style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 48 48">
        {finish.glow ? (
          <>
            <Defs>
              <RadialGradient id={glowId} cx="24" cy="24" r="24" gradientUnits="userSpaceOnUse">
                <Stop offset="0.75" stopColor={finish.glow.color} stopOpacity={finish.glow.opacity} />
                <Stop offset="1" stopColor={finish.glow.color} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Circle testID="forge-mark-glow" cx="24" cy="24" r="24" fill={`url(#${glowId})`} />
          </>
        ) : null}
        <Path
          d={OCTAGON}
          fill={finish.main}
          fillOpacity={0.16}
          stroke={finish.light}
          strokeWidth={2.2}
          strokeLinejoin="round"
        />
        {finish.glow ? (
          <Path
            d={INNER_OCTAGON}
            fill="none"
            stroke={finish.light}
            strokeWidth={1}
            strokeOpacity={0.6}
            strokeLinejoin="round"
          />
        ) : null}
        <G
          testID={`forge-glyph-${ladder}`}
          transform={GLYPH_TRANSFORM}
          fill="none"
          stroke={finish.light}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round">
          {FORGE_GLYPHS[ladder].map((shape, index) => (
            <GlyphShape key={index} shape={shape} />
          ))}
        </G>
        {Array.from({ length: finish.dots }, (_, index) => (
          <Circle
            key={index}
            testID="forge-mark-dot"
            cx={firstDotX + index * DOT_SPACING}
            cy={DOT_Y}
            r={DOT_RADIUS}
            fill={finish.light}
          />
        ))}
      </Svg>
    </View>
  );
}

function GlyphShape({ shape }: { shape: ForgeGlyphShape }) {
  switch (shape.kind) {
    case 'path':
      return <Path d={shape.d} />;
    case 'circle':
      return <Circle cx={shape.cx} cy={shape.cy} r={shape.r} />;
    case 'rect':
      return <Rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} />;
  }
}
