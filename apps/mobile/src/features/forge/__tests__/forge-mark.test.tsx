// The Weekly Forge "Hallmark" badge, as approved in the Phase 7 mock-ups
// (docs/product/weekly-forge-plan.md, "Phase 7 outcome"). The geometry and colours are pinned
// here, so a later edit cannot drift from what the user signed off.
//
// Host-tree assertions, like icon.test.tsx: react-native-svg lowers <Path>/<Circle>/<Rect> to
// RNSVG* host nodes, keeps `d` verbatim, and lowers colours through `processColor`.
import { processColor } from 'react-native';
import { render } from '@testing-library/react-native';
import { FORGE_BANDS, FORGE_LADDERS, type ForgeBand } from '@forjd/domain';

import { BAND_FINISH } from '../band-finish';
import { ForgeMark } from '../forge-mark';
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

const OCTAGON = 'M15 4H33L44 15V33L33 44H15L4 33V15Z';
const INNER_OCTAGON = 'M16.4 7.4H31.6L40.6 16.4V31.6L31.6 40.6H16.4L7.4 31.6V16.4Z';

async function renderMark(band: ForgeBand, ladder: (typeof FORGE_LADDERS)[number] = 'volume') {
  const screen = await render(<ForgeMark ladder={ladder} band={band} size={34} />);
  const nodes = flatten(screen.toJSON());
  return { screen, nodes, ofType: (type: string) => nodes.filter((node) => node.type === type) };
}

describe('BAND_FINISH', () => {
  it('uses the approved Heat colours, reusing accent for Anvil and onAccent for Forged', () => {
    expect(BAND_FINISH).toEqual({
      ore: { main: colors.forgeHeatOre, light: colors.forgeHeatOreLight, dots: 1, glow: null },
      ember: { main: colors.forgeHeatCherry, light: colors.forgeHeatCherryLight, dots: 2, glow: null },
      anvil: { main: colors.accent, light: colors.accentHover, dots: 3, glow: null },
      tempered: { main: colors.forgeHeatYellow, light: colors.forgeHeatYellowLight, dots: 4, glow: null },
      forged: { main: colors.forgeHeatWhite, light: colors.onAccent, dots: 5, glow: { color: colors.forgeHeatWhite, opacity: 0.55 } },
    });
  });
});

describe('ForgeMark', () => {
  it('draws the octagon stamp in the band colour: light outline, main fill at 16%', async () => {
    const { ofType } = await renderMark('ember');
    const octagon = ofType('RNSVGPath').find((node) => node.props.d === OCTAGON);

    expect(octagon).toBeDefined();
    expect(octagon?.props.stroke).toMatchObject({ payload: processColor(colors.forgeHeatCherryLight) });
    expect(octagon?.props.fill).toMatchObject({ payload: processColor(colors.forgeHeatCherry) });
    expect(octagon?.props.fillOpacity).toBe(0.16);
    expect(octagon?.props.strokeWidth).toBe(2.2);
  });

  it.each(FORGE_BANDS.map((band, index) => [band, index + 1] as const))(
    'puts %s on %i dot(s), so a band reads without colour',
    async (band, dots) => {
      const { nodes } = await renderMark(band);

      expect(nodes.filter((node) => node.props.testID === 'forge-mark-dot')).toHaveLength(dots);
    },
  );

  it('gives only Forged the inner octagon and the glow', async () => {
    const forged = await renderMark('forged');
    const tempered = await renderMark('tempered');

    expect(forged.ofType('RNSVGPath').some((node) => node.props.d === INNER_OCTAGON)).toBe(true);
    expect(forged.nodes.some((node) => node.props.testID === 'forge-mark-glow')).toBe(true);
    expect(tempered.ofType('RNSVGPath').some((node) => node.props.d === INNER_OCTAGON)).toBe(false);
    expect(tempered.nodes.some((node) => node.props.testID === 'forge-mark-glow')).toBe(false);
  });

  it.each(FORGE_LADDERS)('stamps the %s icon in the band\x27s light colour', async (ladder) => {
    const { nodes } = await renderMark('anvil', ladder);
    const glyph = nodes.find((node) => node.props.testID === `forge-glyph-${ladder}`);

    expect(glyph).toBeDefined();
    expect(glyph?.props.stroke).toMatchObject({ payload: processColor(colors.accentHover) });
  });

  it('names the ladder and band for screen readers', async () => {
    const { screen } = await renderMark('tempered', 'distance');

    expect(screen.getByLabelText('Distance, Tempered')).toBeTruthy();
  });

  it('renders at the size it is given', async () => {
    const { nodes } = await renderMark('ore');
    const root = nodes.find((node) => node.props.testID === 'forge-mark');

    expect(root?.props.style).toEqual(expect.objectContaining({ width: 34, height: 34 }));
  });
});
