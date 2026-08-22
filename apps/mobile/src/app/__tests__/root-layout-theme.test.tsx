// RED first: the app could render in a light theme, and never styled the status bar.
//
// The root layout passed `colorScheme === 'dark' ? DarkTheme : DefaultTheme`, and
// app.config.ts asked for `userInterfaceStyle: 'automatic'`. There is no light variant of
// this design — 02-design-tokens.md defines one palette, every screen is drawn on #101011 —
// so on a phone set to light mode react-navigation was handed `DefaultTheme`, whose scene
// background is white. It does not repaint the screens (those carry their own colours), it
// shows through *between* them: a white flash on every push and pop.
//
// Both facts under test are wiring, not pixels. Nothing in Jest rasterises a navigator
// transition, so what is asserted is which theme object the provider receives and which
// status-bar style is requested — the two inputs the flash follows from.
import { renderRouter } from 'expo-router/testing-library';
import { DarkTheme, DefaultTheme } from '@react-navigation/native';
import { Appearance } from 'react-native';

import { colors } from '@/theme/tokens';

// `mock`-prefixed so the jest.mock factories below may close over them — jest allows the
// out-of-scope reference only for that prefix.
const mockThemeValues: unknown[] = [];
const mockStatusBarProps: Record<string, unknown>[] = [];

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    ThemeProvider: (props: { value: unknown; children: unknown }) => {
      mockThemeValues.push(props.value);
      return actual.ThemeProvider(props);
    },
  };
});

jest.mock('expo-status-bar', () => ({
  StatusBar: (props: Record<string, unknown>) => {
    mockStatusBarProps.push(props);
    return null;
  },
}));

jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(false),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => false),
}));

import { stackScreenOptions } from '../_layout';

describe('root layout theming', () => {
  it('uses the dark theme even on a device set to light mode', async () => {
    // The condition that used to select DefaultTheme. Set on the real Appearance module so
    // `useColorScheme()` reports it the way it would on such a device.
    Appearance.setColorScheme('light');

    const { findByText } = await renderRouter('src/app', { initialUrl: '/welcome' });
    await findByText(/Training\./);

    expect(mockThemeValues.length).toBeGreaterThan(0);
    for (const value of mockThemeValues) {
      expect(value).toBe(DarkTheme);
      expect(value).not.toBe(DefaultTheme);
    }
  });

  it('paints the navigator scene background instead of leaving it to the theme default', async () => {
    // The scene sits behind and between screens during a transition. Naming it explicitly is
    // what removes the flash; inheriting it from the theme is what caused one.
    expect(stackScreenOptions.contentStyle).toEqual({ backgroundColor: colors.screenBg });
  });

  it('renders light status bar content', async () => {
    const { findByText } = await renderRouter('src/app', { initialUrl: '/welcome' });
    await findByText(/Training\./);

    // Dark ground, so the clock and battery must be light. `expo-status-bar` is a
    // dependency that nothing imported.
    expect(mockStatusBarProps.length).toBeGreaterThan(0);
    expect(mockStatusBarProps[0]).toMatchObject({ style: 'light' });
  });
});
