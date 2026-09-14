// R18 (H12): the countdown ring shared by the rest and timed-set screens had no
// `accessibilityLiveRegion`, so a screen reader never learned the number on it had changed.
import { render } from '@testing-library/react-native';

import { CountdownRing } from '../countdown-ring';

/**
 * A minimal shape for `toJSON()`'s output, not imported from `react-test-renderer` directly --
 * that package ships no type declarations reachable from this project's `tsc --noEmit` (it is
 * only a transitive dependency of the testing libraries, not a direct one).
 */
interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children: (HostNode | string)[] | null;
}

/** Depth-first search of the rendered JSON tree for a node carrying the given prop value. */
function findByProp(
  node: HostNode | string | (HostNode | string)[] | null,
  propName: string,
  propValue: unknown,
): HostNode | null {
  if (node === null || typeof node === "string") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByProp(child, propName, propValue);
      if (found) return found;
    }
    return null;
  }
  if (node.props?.[propName] === propValue) return node;
  return findByProp(node.children, propName, propValue);
}

describe('CountdownRing', () => {
  it('marks its container as a polite live region so screen readers pick up updates', async () => {
    const { toJSON } = await render(<CountdownRing progress={0.5} label="1:30" caption="until next set" />);

    expect(findByProp(toJSON(), 'accessibilityLiveRegion', 'polite')).toBeTruthy();
  });
});
