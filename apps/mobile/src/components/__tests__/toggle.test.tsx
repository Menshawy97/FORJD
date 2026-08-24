// docs/design/slice2-screen-specs.md §1 `toggle(on, onClick)`. Presentational only — the row
// (toggle-row.tsx) owns the tap target, per the plan's whole-row-tappable deviation, so this
// component takes no onPress of its own. Geometry is exact: track 46x27 radius 14 padding 3,
// knob 21x21 radius 11 white, translateX 19 (not 21 — the handoff doc's own §9 discrepancy #3)
// when on.
import { render } from '@testing-library/react-native';

import { Toggle } from '../toggle';
import { colors } from '@/theme/tokens';

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
function flatStyle(style: unknown): Record<string, unknown> {
  return Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity)) : ((style ?? {}) as never);
}

describe('Toggle', () => {
  it('renders the track at 46x27 with the accent background when on', async () => {
    const { toJSON } = await render(<Toggle on />);
    const nodes = flatten(toJSON());
    const track = nodes.find(
      (n) => n.type === 'View' && flatStyle(n.props.style).width === 46,
    );
    expect(track).toBeTruthy();
    const style = flatStyle(track!.props.style);
    expect(style.height).toBe(27);
    expect(style.borderRadius).toBe(14);
    expect(style.padding).toBe(3);
    expect(style.backgroundColor).toBe(colors.accent);
  });

  it('renders the track with the off background when off', async () => {
    const { toJSON } = await render(<Toggle on={false} />);
    const nodes = flatten(toJSON());
    const track = nodes.find(
      (n) => n.type === 'View' && flatStyle(n.props.style).width === 46,
    );
    const style = flatStyle(track!.props.style);
    expect(style.backgroundColor).toBe(colors.toggleTrackOff);
  });

  it('renders the knob at 21x21 translated 19px right when on', async () => {
    const { toJSON } = await render(<Toggle on />);
    const nodes = flatten(toJSON());
    const knob = nodes.find(
      (n) => n.type === 'View' && flatStyle(n.props.style).width === 21,
    );
    expect(knob).toBeTruthy();
    const style = flatStyle(knob!.props.style);
    expect(style.height).toBe(21);
    expect(style.borderRadius).toBe(11);
    expect(style.backgroundColor).toBe('#fff');
    expect(style.transform).toEqual([{ translateX: 19 }]);
  });

  it('renders the knob with no translation when off', async () => {
    const { toJSON } = await render(<Toggle on={false} />);
    const nodes = flatten(toJSON());
    const knob = nodes.find(
      (n) => n.type === 'View' && flatStyle(n.props.style).width === 21,
    );
    const style = flatStyle(knob!.props.style);
    expect(style.transform ?? undefined).toBeFalsy();
  });

  // Real device crash: "Cannot read property 'forEach' of null" inside RN Fabric's
  // transform validator. `transform: on ? [...] : undefined` keeps the `transform` key
  // present with an `undefined` value, which RN's native prop diffing can turn into
  // `transform: null` — and Fabric's validator does `.forEach` on it with no null guard.
  // Every other transform in this codebase (press-feedback.ts) avoids this by omitting the
  // whole style object rather than a key with an undefined value; `toJSON()` under Jest does
  // not reproduce the native diffing step, so this has to be asserted structurally.
  it('does not include a transform key at all when off, not just a falsy one', async () => {
    const { toJSON } = await render(<Toggle on={false} />);
    const nodes = flatten(toJSON());
    const knob = nodes.find(
      (n) => n.type === 'View' && flatStyle(n.props.style).width === 21,
    );
    const style = flatStyle(knob!.props.style);
    expect('transform' in style).toBe(false);
  });
});
