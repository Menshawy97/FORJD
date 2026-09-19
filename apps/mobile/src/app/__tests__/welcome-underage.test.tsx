// ADR-042. After the "Your Profile" step turns an under-16 away, the account is already gone
// and the session cleared, so the person lands on /welcome. This is the one place that can
// tell them why. The notice is read once (like the expired-session banner), so an ordinary
// later visit to /welcome never shows it.
import { setUnderageNotice } from '@/auth/account-notice';
import { renderApp } from './render-app';

jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(false),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => false),
  consumeSessionExpired: jest.fn(() => false),
}));

describe('welcome screen - under-16 notice', () => {
  it('tells someone whose sign-up was turned away why, once', async () => {
    setUnderageNotice();

    const { findByText } = await renderApp({ initialUrl: '/welcome' });

    await findByText('You must be at least 16 to use FORJD. Your account has been removed.');
  });
});
