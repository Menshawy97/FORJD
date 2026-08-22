// RED first: the placeholder header rendered at weight 400.
//
// `text-screen-header` is a *size* token — 26px/1.15/-.02em. The design's screen header is
// `700 26px/1.15`, and the 700 lives in a separate `font-bold` class that was never applied,
// so four of the five tabs showed their heading in regular weight. Archivo is a variable
// font, so nothing fell back and nothing looked broken — it just quietly rendered at the
// wrong weight.
//
// NativeWind does not compile `className` to a style under Jest, so the rendered *weight* is
// not observable here; the class list is. That is the same thing signup-field-highlight.test
// and login-fidelity.test assert on, for the same reason.
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PlaceholderScreen } from '../placeholder-screen';

// The screen goes through `ScreenBackground`, which reads the device inset — and
// `useSafeAreaInsets()` throws when no provider is above it. See
// screen-background.test.tsx for why that strictness is kept rather than worked around.
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

describe('PlaceholderScreen', () => {
  it('renders its header at the design weight', async () => {
    const { findByText } = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <PlaceholderScreen name="Train" />
      </SafeAreaProvider>,
    );

    const header = await findByText(/coming soon/);
    const className = String(header.props.className);

    expect(className).toContain('text-screen-header');
    expect(className).toContain('font-bold');
  });
});
