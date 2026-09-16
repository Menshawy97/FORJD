// Asserts the typed token re-export (used where a raw color string is required — e.g.
// react-native-svg icon fills — rather than a NativeWind className) matches the exact hex
// values specified in
// `FORJD mobile app design/design_handoff_forjd_mobile/02-design-tokens.md`.
// Per ADR-010: write exact values, no derived/seeded theme. This test is the guard against
// tailwind.config.ts and tokens.ts drifting apart.
import tailwindConfig from '../../../tailwind.config';
import { colors } from '../tokens';

// WCAG 2.x relative-luminance / contrast-ratio formulas
// (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance,
// https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio). Only used against the app's own solid hex
// tokens, so it takes a `#rrggbb` string, not the alpha-aware `rgba(...)` strings this file
// also carries -- those never sit behind small body text.
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) {
    throw new Error(`Not a solid #rrggbb hex color: ${hex}`);
  }
  // Non-null assertions: the regex has exactly three capture groups and `match` is
  // already confirmed non-null above, so `match[1..3]` are provably present --
  // `noUncheckedIndexedAccess` cannot see that guarantee through a fixed-arity regex match.
  return {
    r: parseInt(match[1]!, 16),
    g: parseInt(match[2]!, 16),
    b: parseInt(match[3]!, 16),
  };
}

function channelLuminance(channel8Bit: number): number {
  const channel = channel8Bit / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('contrastRatio (WCAG formula self-check)', () => {
  it('rates black on white at the known 21:1 maximum', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  });

  it('rates a color against itself at 1:1', () => {
    expect(contrastRatio('#E9712F', '#E9712F')).toBeCloseTo(1, 5);
  });

  it('is symmetric in argument order', () => {
    expect(contrastRatio('#F6F5F3', '#08090A')).toBeCloseTo(contrastRatio('#08090A', '#F6F5F3'), 10);
  });
});

describe('theme tokens', () => {
  // The header above calls this file "the guard against them drifting apart", but until now
  // it only spot-checked five values in tokens.ts and never opened tailwind.config.ts at
  // all — a token added to one file and forgotten in the other passed. This compares the two
  // colour maps outright, so "in sync" is checked rather than asserted.
  it('matches tailwind.config.ts colour for colour', () => {
    const configColors = tailwindConfig.theme?.extend?.colors as Record<string, string>;

    expect(colors).toEqual(configColors);
  });
  it('matches the design handoff surface colors', () => {
    expect(colors.bg).toBe('#08090A');
    expect(colors.screenBg).toBe('#101011');
    expect(colors.surface).toBe('#17181A');
  });

  it('matches the design handoff accent orange', () => {
    expect(colors.accent).toBe('#E9712F');
  });

  it('matches the design handoff semantic green', () => {
    expect(colors.green).toBe('#79B98A');
  });

  it('matches the design handoff primary text color', () => {
    expect(colors.text).toBe('#F6F5F3');
  });

  // Both measured off the prototype: the toast pill's ground (`flash()`), and the scrim the
  // prototype lays behind its modal sheets.
  it('carries the toast and scrim grounds', () => {
    expect(colors.toastBg).toBe('rgba(28,29,32,.97)');
    expect(colors.scrim).toBe('rgba(10,10,11,.72)');
  });

  // The prototype's profile name is `font:'700 19px/1 Archivo'` — the `/1` is a line height,
  // and it was the one part of that shorthand the token dropped. Without it the name renders
  // at the platform default leading and the identity row grows taller than the design's.
  it('pins the profile name to the prototype line height', () => {
    // Tailwind's fontSize map is heterogeneous — a bare string for sizes with no extras,
    // a [size, options] tuple otherwise — so it is read as `unknown` and indexed, rather
    // than cast to a tuple shape the map as a whole does not have.
    const fontSize = tailwindConfig.theme?.extend?.fontSize as Record<string, unknown>;

    expect(fontSize['profile-name']).toEqual(['19px', { lineHeight: '1', letterSpacing: '-.01em' }]);
  });
});

// R19 (docs/product/audit-remediation-plan.md) -- H13: white `onAccent` text painted directly on
// the raw `accent` fill measures 3.06:1, below the 4.5:1 WCAG AA floor for body-weight text, on
// every primary CTA (Finish, Complete Set, Log In, Save Changes, and the many other buttons that
// share this "white text on a solid accent fill" style). Recorded here rather than skipped: the
// user has chosen Option A (darken the fill to the existing `accentDark` token, keep white text)
// over Option B (near-black text on the unchanged `accent`), so this asserts the pair every
// primary-CTA call site now actually paints, not a pair nobody has approved.
describe('primary accent CTA contrast (R19, H13)', () => {
  it('confirms the original white-on-accent CTA fill actually failed AA (3.06:1)', () => {
    expect(contrastRatio(colors.onAccent, colors.accent)).toBeCloseTo(3.06, 1);
    expect(contrastRatio(colors.onAccent, colors.accent)).toBeLessThan(4.5);
  });

  it('clears AA body-text contrast (4.5:1) for white text on the decided accentDark fill', () => {
    const ratio = contrastRatio(colors.onAccent, colors.accentDark);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeCloseTo(5.6, 1);
  });
});
