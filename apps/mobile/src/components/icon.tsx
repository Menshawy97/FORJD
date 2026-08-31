import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '@/theme/tokens';

// The app's single icon set. Every `d`/`cx`/`rx` below is transcribed verbatim from the
// prototype's `icon(name,color,size)` helper (and, for `bars`/`bell`/`eye`, from the inline
// SVG the prototype emits at the one call site that uses each) in
// `FORJD mobile app design/FORJD Mobile.dc.html`. That prototype is the source of truth for
// icon geometry — the design handoff has no exported asset files, but the path data is
// right there in the markup, so nothing here is invented.
//
// Shared stroke attributes, from the prototype:
//   stroke=<color>  strokeWidth=1.6  fill=none  strokeLinecap=round  strokeLinejoin=round
// with two documented exceptions, both preserved below:
//   - `runner`'s third path uses strokeWidth 1.3
//   - `back` is a separate 20x20 glyph at strokeWidth 1.7 (the login/signup header chevron,
//     which is NOT the same shape as the 24x24 `chevron` used in list rows)

const DEFAULT_STROKE_WIDTH = 1.6;
const DEFAULT_SIZE = 22;

type Shape =
  | { kind: 'path'; d: string; strokeWidth?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number };

interface Glyph {
  viewBox: string;
  /** Only `back` overrides this — every other glyph renders at the caller's `size`. */
  size?: number;
  strokeWidth?: number;
  shapes: Shape[];
}

const path = (d: string, strokeWidth?: number): Shape => ({ kind: 'path', d, strokeWidth });

const GLYPHS = {
  home: { viewBox: '0 0 24 24', shapes: [path('M4 10.6 12 4.4l8 6.2V20h-5.4v-5.2H9.4V20H4z')] },
  train: {
    viewBox: '0 0 24 24',
    shapes: [
      { kind: 'rect', x: 2.2, y: 9, width: 3.2, height: 6, rx: 1 },
      { kind: 'rect', x: 18.6, y: 9, width: 3.2, height: 6, rx: 1 },
      path('M5.4 12h13.2'),
    ],
  },
  progress: {
    viewBox: '0 0 24 24',
    shapes: [path('M3.5 16.5 9 10.8l3.6 3.4 7.4-7.2'), path('M15.2 6.8H20v4.6')],
  },
  rank: {
    viewBox: '0 0 24 24',
    shapes: [path('M7.4 4.6h9.2v3.6a4.6 4.6 0 0 1-9.2 0z'), path('M12 12.8v3.4M8.4 19.4h7.2')],
  },
  profile: {
    viewBox: '0 0 24 24',
    shapes: [
      { kind: 'circle', cx: 12, cy: 8, r: 3.3 },
      path('M5.4 19.6c0-3.7 3-5.6 6.6-5.6s6.6 1.9 6.6 5.6'),
    ],
  },
  bolt: { viewBox: '0 0 24 24', shapes: [path('M13.4 3.6 6.8 13h4.2l-.6 7.4L17.4 11h-4.4z')] },
  heart: {
    viewBox: '0 0 24 24',
    shapes: [
      path('M12 19.6S4.4 15 4.4 9.8A3.9 3.9 0 0 1 12 8.2a3.9 3.9 0 0 1 7.6 1.6c0 5.2-7.6 9.8-7.6 9.8z'),
    ],
  },
  pin: {
    viewBox: '0 0 24 24',
    shapes: [
      path('M12 21s6-6 6-10.4A6 6 0 0 0 6 10.6C6 15 12 21 12 21z'),
      { kind: 'circle', cx: 12, cy: 10.4, r: 2.2 },
    ],
  },
  link: {
    viewBox: '0 0 24 24',
    shapes: [
      path('M10 14 14 10'),
      path('M8.4 16.6a3.1 3.1 0 0 1-.2-4.4l2-2M15.8 7.4a3.1 3.1 0 0 1 .2 4.4l-2 2'),
    ],
  },
  scale: {
    viewBox: '0 0 24 24',
    shapes: [path('M12 4.6v14.8M6 8.4h12M4.4 8.4 2.6 14h3.6zM19.6 8.4 17.8 14h3.6z')],
  },
  shield: {
    viewBox: '0 0 24 24',
    shapes: [path('M12 3.6 5.6 6v6c0 4 6.4 8.4 6.4 8.4s6.4-4.4 6.4-8.4V6z')],
  },
  target: {
    viewBox: '0 0 24 24',
    shapes: [
      { kind: 'circle', cx: 12, cy: 12, r: 7.6 },
      { kind: 'circle', cx: 12, cy: 12, r: 3.4 },
    ],
  },
  upload: {
    viewBox: '0 0 24 24',
    shapes: [path('M12 15.4V5.6M8.2 9.4 12 5.6l3.8 3.8'), path('M5.4 15.8v2.6h13.2v-2.6')],
  },
  plus: { viewBox: '0 0 24 24', shapes: [path('M12 5.6v12.8M5.6 12h12.8')] },
  search: {
    viewBox: '0 0 24 24',
    shapes: [{ kind: 'circle', cx: 11, cy: 11, r: 5.6 }, path('m15.4 15.4 3.4 3.4')],
  },
  dumb: {
    viewBox: '0 0 24 24',
    shapes: [
      { kind: 'rect', x: 3, y: 9.4, width: 2.6, height: 5.2, rx: 0.8 },
      { kind: 'rect', x: 18.4, y: 9.4, width: 2.6, height: 5.2, rx: 0.8 },
      path('M5.6 12h12.8'),
    ],
  },
  star: {
    viewBox: '0 0 24 24',
    shapes: [path('m12 4.6 2.3 4.9 5.1.7-3.7 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2L4.6 10.2l5.1-.7z')],
  },
  chevron: { viewBox: '0 0 24 24', shapes: [path('m9.6 6.4 5 5.6-5 5.6')] },
  check: { viewBox: '0 0 24 24', shapes: [path('m5.6 12.4 4 4 8.8-9')] },
  clock: {
    viewBox: '0 0 24 24',
    shapes: [{ kind: 'circle', cx: 12, cy: 12, r: 7.8 }, path('M12 7.6V12l3 2')],
  },
  x: { viewBox: '0 0 24 24', shapes: [path('M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6')] },
  pencil: {
    viewBox: '0 0 24 24',
    shapes: [path('M14.6 5.4 18.6 9.4 8.2 19.8 4 20.2l.4-4.2z'), path('M13 7 17 11')],
  },
  runner: {
    viewBox: '0 0 24 24',
    shapes: [
      path(
        'M3.2 16.4V9.9c0-.5.5-.9 1-.7l2.7 1.1 3.1-2.6c.5-.4 1.2-.3 1.6.2l1.6 2.2c.4.5 1 .9 1.7 1l3.4.6c1.8.3 3.1 1.6 3.5 3.3l.2 1.4',
      ),
      path('M3.2 16.4h17.7c0 1.4-1.1 2.5-2.5 2.5H5.7a2.5 2.5 0 0 1-2.5-2.5z'),
      // The prototype deliberately thins this one detail stroke.
      path('M8.3 11.4l2.2 2.1M11.4 9.1l2.1 2.3', 1.3),
    ],
  },
  // `bars`, `bell` and `eye` are not in the prototype's `icon()` map — the prototype inlines
  // each at its single call site (welcome's third feature row and profile's "Units &
  // Preferences" row; profile's "Notifications" row; the password field's reveal control).
  // Same geometry, lifted here so call sites stay uniform.
  bars: { viewBox: '0 0 24 24', shapes: [path('M5 19V11M12 19V5M19 19v-6')] },
  bell: {
    viewBox: '0 0 24 24',
    shapes: [path('M7 10a5 5 0 0 1 10 0c0 4 1.4 5.4 1.4 5.4H5.6S7 14 7 10zM10.4 18.4a1.8 1.8 0 0 0 3.2 0')],
  },
  eye: {
    viewBox: '0 0 20 20',
    strokeWidth: 1.4,
    shapes: [
      path('M1.5 10S4.6 4.8 10 4.8 18.5 10 18.5 10 15.4 15.2 10 15.2 1.5 10 1.5 10Z'),
      { kind: 'circle', cx: 10, cy: 10, r: 2.4 },
    ],
  },
  back: {
    viewBox: '0 0 20 20',
    size: 20,
    strokeWidth: 1.7,
    shapes: [path('M12.5 4 6.5 10l6 6')],
  },
} as const satisfies Record<string, Glyph>;

export type IconName = keyof typeof GLYPHS;

interface IconProps {
  name: IconName;
  /** Raw color string (not a NativeWind class) — svg props take colors, not classNames. */
  color?: string;
  size?: number;
  /** Overrides the glyph's own stroke width. Only `goals`' selected checkmark needs this. */
  strokeWidth?: number;
  /**
   * The prototype's `starIcon(filled, size, color)`: `fill: filled ? O : 'none'`. Only the
   * favourite star uses this — every other glyph in the app is stroke-only — but it is a
   * generic prop rather than a `star`-only special case, the same way `strokeWidth` above is
   * generic despite only `goals` needing it.
   */
  filled?: boolean;
}

export function Icon({
  name,
  color,
  size,
  strokeWidth: strokeWidthOverride,
  filled = false,
}: IconProps) {
  const glyph: Glyph = GLYPHS[name];
  const stroke = color ?? (name === 'back' ? colors.text : colors.dim);
  const rendered = size ?? glyph.size ?? DEFAULT_SIZE;
  const strokeWidth = strokeWidthOverride ?? glyph.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  const fill = filled ? stroke : 'none';

  return (
    <Svg width={rendered} height={rendered} viewBox={glyph.viewBox} fill="none">
      {glyph.shapes.map((shape, index) => {
        const common = {
          stroke,
          strokeWidth: shape.kind === 'path' ? (shape.strokeWidth ?? strokeWidth) : strokeWidth,
          fill,
          strokeLinecap: 'round' as const,
          strokeLinejoin: 'round' as const,
        };

        if (shape.kind === 'circle') {
          return <Circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} {...common} />;
        }
        if (shape.kind === 'rect') {
          return (
            <Rect
              key={index}
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              rx={shape.rx}
              {...common}
            />
          );
        }
        return <Path key={index} d={shape.d} {...common} />;
      })}
    </Svg>
  );
}
