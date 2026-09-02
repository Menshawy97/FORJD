// Phase 4 RED: router.back() from login/signup returns to welcome (stack behaviour).
//
// Uses the imperative `router` API directly rather than expo-router/testing-library's
// `testRouter` helper: `testRouter` asserts through the `@testing-library/react-native`
// `screen` singleton internally, which in this project's install did not reliably bind to
// the same render pass (see root-layout.test.tsx's note on renderRouter's async `render()`).
// `rendered.getPathname()` (from renderRouter itself) is the same info without that
// dependency.
import { act } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(false),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => false),
  consumeSessionExpired: jest.fn(() => false),
}));

describe('back navigation', () => {
  it('returns to welcome from login', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/welcome' });
    const { findByText } = await rendered;
    await findByText(/Training\./);

    await act(async () => router.push('/login'));
    // "Welcome back", not "Log in": the prototype (and the screenshots) are authoritative
    // over 01-screen-inventory.md's paraphrase — see login-fidelity.test.tsx.
    await findByText('Welcome back');
    expect(rendered.getPathname()).toBe('/login');

    await act(async () => router.back());
    await findByText(/Training\./);
    expect(rendered.getPathname()).toBe('/welcome');
  });

  it('returns to welcome from signup', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/welcome' });
    const { findByText } = await rendered;
    await findByText(/Training\./);

    await act(async () => router.push('/signup'));
    await findByText('Create account');
    expect(rendered.getPathname()).toBe('/signup');

    await act(async () => router.back());
    await findByText(/Training\./);
    expect(rendered.getPathname()).toBe('/welcome');
  });
});
