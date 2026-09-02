import { render } from '@testing-library/react-native';

import { TypeChip } from '../type-chip';
import { colors } from '@/theme/tokens';

/**
 * Pins the prototype's `typeChip(t)` colour branching (`FORJD Mobile.dc.html`) after a real
 * device walk found `builder.tsx` and `workout/[id].tsx` both rendering every kind as a solid
 * orange fill -- "Customised preset" is green in the prototype (the `else` branch of
 * `typeChip`, not the `Custom` branch), not orange.
 */
describe('TypeChip', () => {
  it('renders the kind label', async () => {
    const { getByText } = await render(<TypeChip kind="Custom" />);
    expect(getByText('Custom')).toBeTruthy();
  });

  it('colours Custom with the app accent', async () => {
    const { getByText } = await render(<TypeChip kind="Custom" />);
    expect(getByText('Custom').props.style).toEqual(expect.objectContaining({ color: colors.accent }));
  });

  it('colours Customised preset with green, not the accent', async () => {
    const { getByText } = await render(<TypeChip kind="Customised preset" />);
    expect(getByText('Customised preset').props.style).toEqual(
      expect.objectContaining({ color: colors.green }),
    );
  });

  it('colours Preset with a neutral grey', async () => {
    const { getByText } = await render(<TypeChip kind="Preset" />);
    expect(getByText('Preset').props.style).toEqual(expect.objectContaining({ color: '#8B8B83' }));
  });
});
