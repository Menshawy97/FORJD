// The exercise-detail screen's top-set trend (Phase 3J-d). Its geometry is transcribed from
// the prototype's own `sparkline()` helper, and the cases below are the ones where a plausible
// simplification would put `NaN` into an SVG path -- which renders as nothing at all, silently.
//
// NOTE: RTL v14 -- render() returns a Promise and must be awaited.
import { render as rtlRender } from '@testing-library/react-native';

import { Sparkline } from '../exercise/sparkline';

interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children: HostNode[] | null;
}

function flatten(node: unknown): HostNode[] {
  if (!node || typeof node !== 'object') return [];
  const host = node as HostNode;
  return [host, ...(host.children ?? []).flatMap(flatten)];
}

async function paths(points: number[]) {
  const { toJSON } = await rtlRender(<Sparkline points={points} />);
  return flatten(toJSON())
    .filter((node) => node.type === 'RNSVGPath')
    .map((node) => String(node.props.d));
}

describe('Sparkline', () => {
  it('draws a filled area beneath the line, as the prototype does', async () => {
    const drawn = await paths([88, 90, 95, 100]);

    expect(drawn).toHaveLength(2);
    // The fill closes the line down to the baseline and back; the line itself does not.
    expect(drawn[0]).toContain('Z');
    expect(drawn[1]).not.toContain('Z');
  });

  it('spreads the points evenly across the full width and starts at the left edge', async () => {
    const [, line] = await paths([0, 10, 20, 30]);

    expect(line.startsWith('M0.0 ')).toBe(true);
    expect(line).toContain('L100.0 ');
    expect(line).toContain('L300.0 ');
  });

  // The highest point sits four pixels below the top and the lowest four above the baseline --
  // the prototype's `hh - 8` headroom, which stops a peak being clipped by its own stroke.
  it('normalises the series between its own extremes, with headroom at each edge', async () => {
    const [, line] = await paths([10, 90]);

    expect(line).toBe('M0.0 76.0 L300.0 4.0');
  });

  /*
   * The case that would divide by zero without the prototype's `|| 1`. `NaN` in a path
   * attribute renders as nothing at all, with no error -- so this asserts real coordinates
   * rather than merely that something was drawn.
   */
  it('draws a flat line rather than NaN when every session lifted the same', async () => {
    const [, line] = await paths([80, 80, 80]);

    expect(line).not.toContain('NaN');
    expect(line).toBe('M0.0 76.0 L150.0 76.0 L300.0 76.0');
  });

  // One session is not a trend, and `(pts.length - 1)` is a division by zero there. The screen
  // shows its "log a set" copy instead.
  it('draws nothing at all from a single point', async () => {
    expect(await paths([80])).toEqual([]);
    expect(await paths([])).toEqual([]);
  });
});
