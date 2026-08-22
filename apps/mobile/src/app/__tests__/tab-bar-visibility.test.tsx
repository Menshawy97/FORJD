// Phase 4 RED: welcome/login/signup are flagged tab-bar-hidden in 03-navigation.md. Assert
// they render without any of the tab labels present.
//
// See root-layout.test.tsx for why renderRouter()'s return value must both be held onto
// (for getPathname()-style helpers) and awaited (to unwrap the query helpers).
import { renderRouter } from 'expo-router/testing-library';

jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(false),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => false),
}));

describe('screens without a tab bar', () => {
  it('welcome renders without the tab bar', async () => {
    const { findByText, queryByText } = await renderRouter('src/app', { initialUrl: '/welcome' });

    await findByText(/Training\./);

    expect(queryByText('Train')).toBeNull();
    expect(queryByText('Profile')).toBeNull();
  });

  it('login renders without the tab bar', async () => {
    const { findByText, queryByText } = await renderRouter('src/app', { initialUrl: '/login' });

    // "Welcome back" is the login headline per the prototype — see login-fidelity.test.tsx.
    await findByText('Welcome back');

    expect(queryByText('Train')).toBeNull();
  });

  it('signup renders without the tab bar', async () => {
    const { findByText, queryByText } = await renderRouter('src/app', { initialUrl: '/signup' });

    await findByText('Create account');

    expect(queryByText('Train')).toBeNull();
  });
});
