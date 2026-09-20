// RED first: staging has email confirmation on, so a sign-up answers 201 with no session. The
// app used to carry on to "Your Profile" as if signed in, bounce off the auth gate and land on
// the welcome page with a misleading "session expired" banner. It now stops on a "Check your
// email" screen instead (mock approved by the user; no design screenshot exists for it).
import { fireEvent } from '@testing-library/react-native';
import { renderApp } from './render-app';

jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(false),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => false),
  consumeSessionExpired: jest.fn(() => false),
}));

describe('check-email screen', () => {
  it('is reachable while signed out and names the address the link was sent to', async () => {
    const rendered = renderApp({ initialUrl: '/check-email?email=ada%40example.com' });
    const { findByText } = await rendered;

    await findByText('Check your email');
    await findByText('ada@example.com');
    expect(rendered.getPathname()).toBe('/check-email');
  });

  it('lays out the three steps and the spam hint', async () => {
    const { findByText } = await renderApp({ initialUrl: '/check-email?email=ada%40example.com' });

    await findByText('Open the email from FORJD and tap the link.');
    await findByText('Come back here and log in.');
    await findByText('Then set your username and date of birth.');
    await findByText("Can't find it? Check your spam folder.");
  });

  it('"Go to Log In" opens the login screen', async () => {
    const rendered = renderApp({ initialUrl: '/check-email?email=ada%40example.com' });
    const { findByText } = await rendered;

    fireEvent.press(await findByText('Go to Log In'));

    await findByText('Welcome back');
    expect(rendered.getPathname()).toBe('/login');
  });

  it('"Use a different email" returns to the sign-up form', async () => {
    const rendered = renderApp({ initialUrl: '/check-email?email=ada%40example.com' });
    const { findByText } = await rendered;

    fireEvent.press(await findByText('Use a different email'));

    await findByText('Create account');
    expect(rendered.getPathname()).toBe('/signup');
  });
});
