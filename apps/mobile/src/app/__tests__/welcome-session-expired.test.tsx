// The shared fix for the bug where a forced sign-out (apiClient's response interceptor
// clearing the session after a 401-triggered token refresh itself fails, ADR-011) landed the
// user on /welcome with no explanation -- each authenticated screen showed its own generic
// error instead (e.g. builder.tsx's "Could not save this workout"). `consumeSessionExpired()`
// is the one-shot flag `clearSession({ expired: true })` sets for exactly that case; welcome.tsx
// reads it once on mount and shows a plain-language banner instead of leaving the user to
// wonder why they were signed out.
import { renderRouter } from 'expo-router/testing-library';

const mockConsumeSessionExpired = jest.fn();

jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(false),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => false),
  consumeSessionExpired: () => mockConsumeSessionExpired(),
}));

describe('welcome screen - session-expired banner', () => {
  afterEach(() => {
    mockConsumeSessionExpired.mockReset();
  });

  it('shows the session-expired banner when apiClient force-cleared the session', async () => {
    mockConsumeSessionExpired.mockReturnValue(true);

    const { findByText } = await renderRouter('src/app', { initialUrl: '/welcome' });

    await findByText('Your session expired. Please log in again.');
  });

  it('does not show the banner on an ordinary visit (app launch, manual logout)', async () => {
    mockConsumeSessionExpired.mockReturnValue(false);

    const { findByText, queryByText } = await renderRouter('src/app', {
      initialUrl: '/welcome',
    });

    await findByText(/Training\./);
    expect(queryByText('Your session expired. Please log in again.')).toBeNull();
  });
});
