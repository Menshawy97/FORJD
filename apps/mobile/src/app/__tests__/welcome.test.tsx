// Phase 5 RED: welcome screen copy + "Create Account" CTA navigation, per
// 01-screen-inventory.md. The "Log In" CTA gets its own test file
// (welcome-login-cta.test.tsx) — see that file's header comment for why: expo-router's
// global route store is a module-level singleton that is not reset between separate
// renderRouter() calls once real navigation has happened within a test *file*, only between
// separate test *files* (fresh module registry per file).
import { fireEvent } from '@testing-library/react-native';
import { renderApp } from './render-app';

jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(false),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => false),
  consumeSessionExpired: jest.fn(() => false),
}));

describe('welcome screen', () => {
  it('renders the headline and CTA copy', async () => {
    const { findByText } = await renderApp({ initialUrl: '/welcome' });

    await findByText(/Training\./);
    await findByText('One place for everything your body is doing.');
    await findByText('Create Account');
    await findByText('Log In');
  });

  it('tapping "Create Account" navigates to signup', async () => {
    const rendered = renderApp({ initialUrl: '/welcome' });
    const { findByText } = await rendered;

    fireEvent.press(await findByText('Create Account'));
    await findByText('Create account');

    expect(rendered.getPathname()).toBe('/signup');
  });
});
