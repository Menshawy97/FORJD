// Design-fidelity RED: the welcome screen's three feature rows each carry a 19px
// accent-orange glyph in the prototype (`bolt`, `heart`, and the inline bar-chart mark).
// The shipped implementation renders the copy with no glyph at all — the single biggest
// visual miss on this screen. Path data is the prototype's.
//
// NOTE: the design-fidelity spec names the third row's glyph "progress". The prototype
// inlines the bar-chart mark `M5 19V11M12 19V5M19 19v-6` there instead, and the prototype
// wins — so that is what this asserts.
import { processColor } from 'react-native';
import { renderRouter } from 'expo-router/testing-library';

import { colors } from '@/theme/tokens';

jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(false),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => false),
  consumeSessionExpired: jest.fn(() => false),
}));

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

const FEATURE_GLYPH_PATHS = {
  bolt: 'M13.4 3.6 6.8 13h4.2l-.6 7.4L17.4 11h-4.4z',
  heart:
    'M12 19.6S4.4 15 4.4 9.8A3.9 3.9 0 0 1 12 8.2a3.9 3.9 0 0 1 7.6 1.6c0 5.2-7.6 9.8-7.6 9.8z',
  bars: 'M5 19V11M12 19V5M19 19v-6',
};

describe('welcome screen - design fidelity', () => {
  it('renders a glyph on each of the three feature rows, in accent orange at 19px', async () => {
    const { findByText, toJSON } = await renderRouter('src/app', { initialUrl: '/welcome' });
    await findByText(/Training\./);

    const nodes = flatten(toJSON());
    const paths = nodes.filter((node) => node.type === 'RNSVGPath');

    for (const [glyph, d] of Object.entries(FEATURE_GLYPH_PATHS)) {
      const match = paths.find((node) => node.props.d === d);
      expect({ glyph, present: Boolean(match) }).toEqual({ glyph, present: true });
      expect({ glyph, stroke: (match?.props.stroke as { payload?: number }).payload }).toEqual({
        glyph,
        stroke: processColor(colors.accent),
      });
    }

    // Filtered to SVGs with a fixed pixel size: the feature glyphs are no longer the only
    // SVG on this screen, since `ScreenBackground` paints the ember atmosphere with a
    // full-bleed <Svg> sized `"100%"`. Counting every RNSVGSvgView would turn this into an
    // assertion about how many SVGs the app happens to render.
    const svgs = nodes.filter(
      (node) => node.type === 'RNSVGSvgView' && typeof node.props.width === 'number',
    );
    expect(svgs).toHaveLength(3);
    for (const svg of svgs) {
      expect(svg.props).toMatchObject({ width: 19, height: 19 });
    }
  });

  it('keeps the wordmark and the three feature captions', async () => {
    const { findByText } = await renderRouter('src/app', { initialUrl: '/welcome' });

    await findByText('FORJD');
    await findByText('Strength · Running · Cross Training · Mobility');
    await findByText('Sleep · HRV · Recovery · Body Composition');
    await findByText('AI Insights · City Leaderboards · Analytics');
  });
});
