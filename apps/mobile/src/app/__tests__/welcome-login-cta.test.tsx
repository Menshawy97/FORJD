// Phase 5 RED: welcome screen's "Log In" CTA navigation. Split into its own file (rather
// than living alongside the "Create Account" test in welcome.test.tsx) because
// expo-router's global route store is a module-level singleton: once a previous test in the
// same file has navigated away via a real `fireEvent.press`, a later renderRouter() call's
// `initialUrl` is silently ignored and it inherits wherever that navigation left off. Jest
// gives each test *file* its own fresh module registry, so this is file-scoped isolation,
// not per-test.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(false),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => false),
}));

describe('welcome screen - Log In CTA', () => {
  it('tapping "Log In" navigates to login', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/welcome' });
    const { findByText } = await rendered;

    fireEvent.press(await findByText('Log In'));
    // The login screen's headline is "Welcome back" per the prototype — see
    // login-fidelity.test.tsx.
    await findByText('Welcome back');

    expect(rendered.getPathname()).toBe('/login');
  });
});
