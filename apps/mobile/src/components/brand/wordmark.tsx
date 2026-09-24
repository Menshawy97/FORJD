import Svg, { G, Path } from 'react-native-svg';

import { BRAND_BONE, WORDMARK_PATHS, WORDMARK_VIEWBOX } from './brand-paths';

interface WordmarkProps {
  /** Rendered height in px; the width follows the wordmark's 5.44:1 proportion. */
  height: number;
  color?: string;
}

/** The drawn FORJD wordmark (ADR-052) -- paths, not type, so it never waits on a font. */
export function Wordmark({ height, color = BRAND_BONE }: WordmarkProps) {
  const width = (height * WORDMARK_VIEWBOX.width) / WORDMARK_VIEWBOX.height;
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${WORDMARK_VIEWBOX.width} ${WORDMARK_VIEWBOX.height}`}
      accessibilityLabel="FORJD"
      accessibilityRole="image">
      <G fill={color}>
        {WORDMARK_PATHS.map((path) => (
          <Path key={path.d} d={path.d} fillRule={path.evenOdd ? 'evenodd' : 'nonzero'} />
        ))}
      </G>
    </Svg>
  );
}
