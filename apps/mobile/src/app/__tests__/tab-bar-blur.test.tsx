// RED first: the tab bar was opaque.
//
// The prototype's `tabbar()`:
//   height:76 · borderTop:1px rgba(255,255,255,.07)
//   background:'rgba(14,14,15,.96)' · backdropFilter:'blur(12px)'
//
// The translucent colour was already in place (`colors.tabBarBg`), but a translucent colour
// over nothing is just a darker solid: the bar was laid out in the flow, so no content ever
// passed behind it and there was nothing to blur. Two things have to be true together — the
// bar floats over the scene, and what shows through is blurred.
//
// Floating it also takes 76px away from every tab screen, so the scene has to reclaim that
// as padding or the last row of content ends up underneath the bar. That is asserted here
// too, because it is the regression that "just make it absolute" would introduce.
//
// tabs-layout.test.tsx continues to own the tab count, order, labels, glyphs and colours;
// nothing here changes those.
import { renderRouter } from 'expo-router/testing-library';

jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(true),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => true),
  consumeSessionExpired: jest.fn(() => false),
}));

import { TAB_BAR_HEIGHT, tabsScreenOptions } from '../(tabs)/_layout';

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

describe('tab bar', () => {
  it('floats over the scene at the design height', () => {
    expect(TAB_BAR_HEIGHT).toBe(76);
    expect(tabsScreenOptions.tabBarStyle).toMatchObject({
      position: 'absolute',
      height: TAB_BAR_HEIGHT,
    });
  });

  it('gives the scene back the space the floating bar takes', () => {
    expect(tabsScreenOptions.sceneStyle).toEqual({ paddingBottom: TAB_BAR_HEIGHT });
  });

  it('renders a blur behind the bar', async () => {
    const { findByText, toJSON } = await renderRouter('src/app', { initialUrl: '/' });
    await findByText('Home');

    const blurs = flatten(toJSON()).filter((node) => node.type.includes('Blur'));
    expect(blurs.length).toBeGreaterThan(0);

    // 12px in CSS. expo-blur's `intensity` is a 0-100 scale, not pixels, so the value is
    // named as a constant in the layout rather than pretending to be the CSS number.
    expect(blurs[0].props.intensity).toBeGreaterThan(0);
  });
});
