// Part 1.3 RED: `pressGhost` applied a `scale(.985)` transform on press, the same one
// `pressScale` (the primary-button branch) uses. The prototype's `btn()` puts the active
// transform only on the primary branch — slice2-screen-specs.md §1 calls this out explicitly:
// "(ghost has NO active/pressed rule)". Ghost buttons should only change background on press.
import { pressGhost, pressScale } from '@/components/press-feedback';
import { colors } from '@/theme/tokens';

describe('press-feedback', () => {
  it('pressScale applies a scale transform when pressed', () => {
    expect(pressScale({ pressed: true })).toEqual({ transform: [{ scale: 0.985 }] });
  });

  it('pressScale applies nothing when idle', () => {
    expect(pressScale({ pressed: false })).toBeUndefined();
  });

  it('pressGhost changes only the background when pressed — no transform', () => {
    expect(pressGhost({ pressed: true })).toEqual({ backgroundColor: colors.pressedGhost });
  });

  it('pressGhost applies nothing when idle', () => {
    expect(pressGhost({ pressed: false })).toBeUndefined();
  });
});
