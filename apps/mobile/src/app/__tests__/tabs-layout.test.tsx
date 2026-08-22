// Phase 4 RED: the (tabs) group must render exactly 5 tabs, in order, with the correct
// labels, and the active tab must be visually distinguished with the accent orange token.
//
// Design-fidelity RED (this pass): the tab bar must render the *real* glyphs from the
// prototype's `tabbar()` helper, not the placeholder dot the earlier pass shipped. The path
// data below is the prototype's, so a regression back to a placeholder fails here.
import { processColor } from 'react-native';
import { renderRouter } from 'expo-router/testing-library';

import { colors } from '@/theme/tokens';

jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(true),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => true),
}));

function flattenColor(style: unknown): string | undefined {
  const flat = Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity)) : style;
  return (flat as { color?: string } | undefined)?.color;
}

interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children: HostNode[] | null;
}

/** react-native-svg lowers <Path> to an RNSVGPath host node that keeps `d` verbatim. */
function flatten(node: unknown): HostNode[] {
  if (!node || typeof node !== 'object') {
    return [];
  }
  const host = node as HostNode;
  return [host, ...(host.children ?? []).flatMap(flatten)];
}

// Straight from the prototype's icon() map — one entry per tab, in tab order.
const TAB_GLYPH_PATHS: Record<string, string> = {
  home: 'M4 10.6 12 4.4l8 6.2V20h-5.4v-5.2H9.4V20H4z',
  train: 'M5.4 12h13.2',
  progress: 'M3.5 16.5 9 10.8l3.6 3.4 7.4-7.2',
  rank: 'M7.4 4.6h9.2v3.6a4.6 4.6 0 0 1-9.2 0z',
  profile: 'M5.4 19.6c0-3.7 3-5.6 6.6-5.6s6.6 1.9 6.6 5.6',
};

describe('(tabs) shell', () => {
  it('renders exactly 5 tabs, in order, with the correct labels', async () => {
    const { findByText, getAllByText } = await renderRouter('src/app', { initialUrl: '/' });

    await findByText('Home');

    const labels = ['Home', 'Train', 'Progress', 'Rank', 'Profile'];
    const found = labels.map((label) => getAllByText(label)[0]);
    expect(found).toHaveLength(5);

    // Order: every label node in document order should match the design's fixed tab order.
    const allLabelNodes = getAllByText(/^(Home|Train|Progress|Rank|Profile)$/);
    const orderedTexts = allLabelNodes.map((node) => node.props.children);
    expect(orderedTexts).toEqual(labels);
  });

  it('renders the active (initial) tab label in the accent orange token color', async () => {
    const { findByText, getByText } = await renderRouter('src/app', { initialUrl: '/' });

    const home = await findByText('Home');
    expect(flattenColor(home.props.style)).toBe(colors.accent);

    const train = getByText('Train');
    expect(flattenColor(train.props.style)).toBe(colors.tabInactive);
  });

  it('renders the real prototype glyph for every tab, not a placeholder', async () => {
    const { findByText, toJSON } = await renderRouter('src/app', { initialUrl: '/' });
    await findByText('Home');

    const paths = flatten(toJSON())
      .filter((node) => node.type === 'RNSVGPath')
      .map((node) => node.props.d);

    for (const [tab, d] of Object.entries(TAB_GLYPH_PATHS)) {
      expect({ tab, present: paths.includes(d) }).toEqual({ tab, present: true });
    }
  });

  // react-navigation's bottom tab bar renders each icon TWICE — an accent copy and an
  // inactive copy, crossfaded by animated opacity — so "which stroke is on screen" is not
  // readable from the tree. What is readable, and what this asserts, is that both tint
  // states are driven from the design tokens rather than hardcoded. Which of the two is
  // *shown* is covered by the label-color test above, where only one node exists per tab.
  it('strokes every tab glyph from the accent / tab-inactive token pair', async () => {
    const { findByText, toJSON } = await renderRouter('src/app', { initialUrl: '/' });
    await findByText('Home');

    const paths = flatten(toJSON()).filter((node) => node.type === 'RNSVGPath');
    const strokesFor = (d: string) =>
      paths
        .filter((node) => node.props.d === d)
        .map((node) => (node.props.stroke as { payload?: number }).payload)
        .sort();

    for (const [tab, d] of Object.entries(TAB_GLYPH_PATHS)) {
      expect({ tab, strokes: strokesFor(d) }).toEqual({
        tab,
        strokes: [processColor(colors.accent), processColor(colors.tabInactive)].sort(),
      });
    }
  });

  it('renders the tab glyphs at the design size of 22', async () => {
    const { findByText, toJSON } = await renderRouter('src/app', { initialUrl: '/' });
    await findByText('Home');

    // 5 tabs x the accent/inactive crossfade pair described above.
    //
    // Filtered to SVGs with a fixed pixel size, because the tab glyphs are no longer the only
    // SVG on screen: `ScreenBackground` paints the ember atmosphere with a full-bleed
    // <Svg> whose width/height are `"100%"` rather than numbers. Counting every RNSVGSvgView
    // would make this assertion a count of "SVGs anywhere in the app", which is not what it
    // is about.
    const svgs = flatten(toJSON()).filter(
      (node) => node.type === 'RNSVGSvgView' && typeof node.props.width === 'number',
    );
    expect(svgs).toHaveLength(10);
    for (const svg of svgs) {
      expect(svg.props).toMatchObject({ width: 22, height: 22 });
    }
  });
});
