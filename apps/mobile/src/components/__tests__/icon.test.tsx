// RED first: the shared icon component. Path data is transcribed verbatim from the
// prototype's `icon(name,color,size)` helper in `FORJD mobile app design/FORJD Mobile.dc.html`
// — the prototype is the source of truth (see the design-fidelity spec), so these
// assertions pin the exact `d` strings rather than "renders something svg-shaped".
//
// A previous pass on this screen shipped placeholder dots on the claim that no icon assets
// existed. They do — inline in the prototype — and this file is the guard against that
// claim being made again.
//
// Assertions read the *host* tree via `toJSON()` rather than `UNSAFE_getAllByType(Path)`:
// @testing-library/react-native 14 removed the UNSAFE_* type queries, and react-native-svg
// lowers <Path>/<Circle>/<Rect> to RNSVGPath/RNSVGCircle/RNSVGRect host nodes. `d` survives
// verbatim; colors are lowered through `processColor`, hence the comparisons below.
import { processColor } from 'react-native';
import { render } from '@testing-library/react-native';

import { Icon } from '../icon';
import { colors } from '@/theme/tokens';

interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children: HostNode[] | null;
}

function flatten(node: unknown): HostNode[] {
  if (!node || typeof node !== 'object') {
    return [];
  }
  const host = node as HostNode;
  return [host, ...(host.children ?? []).flatMap(flatten)];
}

async function renderIcon(element: React.ReactElement) {
  const rendered = await render(element);
  const nodes = flatten(rendered.toJSON());
  return {
    root: nodes[0],
    ofType: (type: string) => nodes.filter((node) => node.type === type),
  };
}

describe('Icon', () => {
  it('renders the home glyph with the prototype path data', async () => {
    const { ofType } = await renderIcon(<Icon name="home" />);

    expect(ofType('RNSVGPath').map((node) => node.props.d)).toEqual([
      'M4 10.6 12 4.4l8 6.2V20h-5.4v-5.2H9.4V20H4z',
    ]);
  });

  it('renders every shape of a multi-shape glyph (profile = circle + path)', async () => {
    const { ofType } = await renderIcon(<Icon name="profile" />);

    expect(ofType('RNSVGCircle').map((node) => node.props)).toMatchObject([
      { cx: 12, cy: 8, r: 3.3 },
    ]);
    expect(ofType('RNSVGPath').map((node) => node.props.d)).toEqual([
      'M5.4 19.6c0-3.7 3-5.6 6.6-5.6s6.6 1.9 6.6 5.6',
    ]);
  });

  it('renders rect-based glyphs (train) with the prototype geometry', async () => {
    const { ofType } = await renderIcon(<Icon name="train" />);

    expect(ofType('RNSVGRect').map((node) => node.props)).toMatchObject([
      { x: 2.2, y: 9, width: 3.2, height: 6, rx: 1 },
      { x: 18.6, y: 9, width: 3.2, height: 6, rx: 1 },
    ]);
    expect(ofType('RNSVGPath').map((node) => node.props.d)).toEqual(['M5.4 12h13.2']);
  });

  it('applies the color prop to every stroked shape', async () => {
    const { ofType } = await renderIcon(<Icon name="target" color={colors.accent} />);

    const strokes = ofType('RNSVGCircle').map((node) => node.props.stroke);
    expect(strokes).toHaveLength(2);
    for (const stroke of strokes) {
      expect(stroke).toMatchObject({ payload: processColor(colors.accent) });
    }
  });

  it('defaults the color to the dim token when none is given', async () => {
    const { ofType } = await renderIcon(<Icon name="bolt" />);

    expect(ofType('RNSVGPath')[0].props.stroke).toMatchObject({
      payload: processColor(colors.dim),
    });
  });

  it('applies the size prop to the svg and defaults to 22', async () => {
    const sized = await renderIcon(<Icon name="bolt" size={19} />);
    expect(sized.root.props).toMatchObject({ width: 19, height: 19 });

    const defaulted = await renderIcon(<Icon name="bolt" />);
    expect(defaulted.root.props).toMatchObject({ width: 22, height: 22 });
  });

  it('uses the shared 24x24 viewBox and strokeWidth 1.6', async () => {
    const { root, ofType } = await renderIcon(<Icon name="heart" />);

    expect(root.props).toMatchObject({ vbWidth: 24, vbHeight: 24, minX: 0, minY: 0 });
    expect(ofType('RNSVGPath')[0].props).toMatchObject({ strokeWidth: 1.6 });
  });

  it("uses strokeWidth 1.3 for the runner glyph's third path only", async () => {
    const { ofType } = await renderIcon(<Icon name="runner" />);

    expect(ofType('RNSVGPath').map((node) => node.props.strokeWidth)).toEqual([1.6, 1.6, 1.3]);
  });

  it('renders the back chevron as its own 20x20 / strokeWidth 1.7 glyph', async () => {
    const { root, ofType } = await renderIcon(<Icon name="back" />);

    expect(root.props).toMatchObject({ width: 20, height: 20, vbWidth: 20, vbHeight: 20 });
    expect(ofType('RNSVGPath')[0].props).toMatchObject({
      d: 'M12.5 4 6.5 10l6 6',
      strokeWidth: 1.7,
      stroke: { payload: processColor(colors.text) },
    });
    // ...and is NOT the same shape as the 24x24 list-row chevron.
    const listChevron = await renderIcon(<Icon name="chevron" />);
    expect(listChevron.ofType('RNSVGPath')[0].props.d).toBe('m9.6 6.4 5 5.6-5 5.6');
  });

  it('applies an explicit strokeWidth prop over the glyph default', async () => {
    const { ofType } = await renderIcon(<Icon name="check" strokeWidth={2.6} />);

    expect(ofType('RNSVGPath')[0].props.strokeWidth).toBe(2.6);
  });

  it('exposes every glyph the app needs', async () => {
    const names = [
      'home',
      'train',
      'progress',
      'rank',
      'profile',
      'bolt',
      'heart',
      'pin',
      'link',
      'scale',
      'shield',
      'target',
      'upload',
      'plus',
      'search',
      'dumb',
      'star',
      'chevron',
      'check',
      'clock',
      'x',
      'pencil',
      'runner',
      'bars',
      'bell',
      'eye',
      'back',
    ] as const;

    for (const name of names) {
      const { root, ofType } = await renderIcon(<Icon name={name} />);
      expect(root.type).toBe('RNSVGSvgView');
      expect(
        ofType('RNSVGPath').length + ofType('RNSVGCircle').length + ofType('RNSVGRect').length,
      ).toBeGreaterThan(0);
    }
  });
});
