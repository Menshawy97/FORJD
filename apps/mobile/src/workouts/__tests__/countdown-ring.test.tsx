// R18 (H12): the countdown ring shared by the rest and timed-set screens had no
// `accessibilityLiveRegion`, so a screen reader never learned the number on it had changed.
import { render } from '@testing-library/react-native';
import type { ReactTestRendererJSON } from 'react-test-renderer';

import { CountdownRing } from '../countdown-ring';

/** Depth-first search of the rendered JSON tree for a node carrying the given prop value. */
function findByProp(
  node: ReactTestRendererJSON | ReactTestRendererJSON[] | null,
  propName: string,
  propValue: unknown,
): ReactTestRendererJSON | null {
  if (node === null) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByProp(child, propName, propValue);
      if (found) return found;
    }
    return null;
  }
  if (node.props?.[propName] === propValue) return node;
  return findByProp(node.children as ReactTestRendererJSON[] | null, propName, propValue);
}

describe('CountdownRing', () => {
  it('marks its container as a polite live region so screen readers pick up updates', async () => {
    const { toJSON } = await render(<CountdownRing progress={0.5} label="1:30" caption="until next set" />);

    expect(findByProp(toJSON(), 'accessibilityLiveRegion', 'polite')).toBeTruthy();
  });
});
