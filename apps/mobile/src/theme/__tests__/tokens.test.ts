// Asserts the typed token re-export (used where a raw color string is required — e.g.
// react-native-svg icon fills — rather than a NativeWind className) matches the exact hex
// values specified in
// `FORJD mobile app design/design_handoff_forjd_mobile/02-design-tokens.md`.
// Per ADR-010: write exact values, no derived/seeded theme. This test is the guard against
// tailwind.config.ts and tokens.ts drifting apart.
import tailwindConfig from '../../../tailwind.config';
import { colors } from '../tokens';

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
