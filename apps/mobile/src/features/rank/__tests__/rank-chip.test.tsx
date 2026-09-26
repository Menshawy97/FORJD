// NOTE: RTL v14 -- render() returns a Promise and must be awaited (see sparkline.test.tsx).
import { render } from '@testing-library/react-native';

import { RankChip } from '../rank-chip';
import { colors } from '@/theme/tokens';

/**
 * 8.5 S8, L8-1: the selected chip painted white text on the raw `accent` fill, 3.06:1 against
 * the 4.5:1 AA floor -- the H13 pattern R19 already fixed on every other CTA by moving the fill
 * to `accentDark` (5.6:1, asserted in theme/__tests__/tokens.test.ts). NativeWind's className
 * transform does not run under Jest, so the class itself is what is asserted.
 */
describe('RankChip', () => {
  it('fills the selected chip with accentDark, not the raw accent', async () => {
    const { getByRole } = await render(<RankChip label="Volume" selected onPress={jest.fn()} />);

    const classes = String(getByRole('button').props.className);
    expect(classes).toContain('bg-accentDark');
    expect(classes).toContain('border-accentDark');
    expect(classes).not.toMatch(/\bbg-accent\b(?!Dark)/);
  });

  it('keeps white text on the selected chip', async () => {
    const { getByText } = await render(<RankChip label="Volume" selected onPress={jest.fn()} />);

    expect(getByText('Volume').props.style).toEqual(expect.objectContaining({ color: colors.onAccent }));
  });

  it('leaves the unselected chip on the elevated fill', async () => {
    const { getByRole } = await render(<RankChip label="Volume" selected={false} onPress={jest.fn()} />);

    expect(String(getByRole('button').props.className)).toContain('bg-elevated');
  });
});
