import { render } from '@testing-library/react-native';

import { LogoLoader } from '../logo-loader';
import { PULSE_PIECES } from '../brand-paths';

interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children: (HostNode | string)[] | null;
}

function flatten(node: HostNode | string | null): HostNode[] {
  if (!node || typeof node === 'string') return [];
  return [node, ...(node.children ?? []).flatMap((child) => flatten(child))];
}

/** Animation #3 "Pulse loader" from the FORJD Logo canvas (ADR-052). */
describe('LogoLoader', () => {
  it('is announced as a loading progress indicator', async () => {
    const { getByLabelText } = await render(<LogoLoader />);

    const loader = getByLabelText('Loading');
    expect(loader.props.accessibilityRole).toBe('progressbar');
  });

  it('draws the symbol as its four separately pulsing pieces, in ember', async () => {
    const { toJSON } = await render(<LogoLoader />);

    const nodes = flatten(toJSON() as HostNode);
    const pieces = nodes.filter((node) => node.type === 'RNSVGPath');
    expect(pieces.map((piece) => piece.props.d)).toEqual(PULSE_PIECES.map((piece) => piece.d));
  });

  it('sizes itself from the size prop', async () => {
    const { getByLabelText } = await render(<LogoLoader size={56} />);

    expect(getByLabelText('Loading')).toHaveStyle({ width: 56, height: 56 });
  });
});
