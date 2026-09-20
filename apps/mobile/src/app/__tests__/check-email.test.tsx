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

jest.mock('@/auth/apiClient', () => ({ resendConfirmation: jest.fn() }));

// The real countdown is an interval; `renderApp` swaps fake timers for real ones right after the
// first render, which would strand an interval started on arrival. The hook has its own timer
// tests (auth/__tests__/use-resend-cooldown.test.ts), so the screen is tested against a double
// that records `start()` and only counts down when a test asks it to.
let mockStartCountsDown = false;
const mockStart = jest.fn();
jest.mock('@/auth/use-resend-cooldown', () => {
  const { useCallback, useState } = jest.requireActual('react');
  return {
    useResendCooldown: (seconds: number) => {
      const [secondsLeft, setSecondsLeft] = useState(0);
      // Stable across renders, like the real hook's, so the screen's arrival effect runs once.
      const start = useCallback(() => {
        mockStart(seconds);
        if (mockStartCountsDown) setSecondsLeft(seconds);
      }, [seconds]);
      return { secondsLeft, start };
    },
  };
});

import { AxiosError } from 'axios';
import { resendConfirmation } from '@/auth/apiClient';

function serverError(status: number) {
  return new AxiosError('failed', undefined, undefined, undefined, {
    status,
    data: {},
    statusText: '',
    headers: {},
    config: {} as never,
  });
}

describe('check-email screen - resend', () => {
  const url = '/check-email?email=ada%40example.com';

  beforeEach(() => {
    (resendConfirmation as jest.Mock).mockReset();
    (resendConfirmation as jest.Mock).mockResolvedValue(undefined);
    mockStart.mockClear();
    mockStartCountsDown = false;
  });

  // The sign-up that led here has just sent an email, and Supabase keeps about a minute between
  // emails to one address, so a resend tapped straight away would be silently dropped.
  it('starts the countdown as soon as it opens, for a 60-second wait', async () => {
    const { findByText } = await renderApp({ initialUrl: url });

    await findByText('Check your email');

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart).toHaveBeenCalledWith(60);
  });

  it('starts no countdown when the address is unknown, since nothing was just sent', async () => {
    const { findByText } = await renderApp({ initialUrl: '/check-email' });

    await findByText('Check your email');

    expect(mockStart).not.toHaveBeenCalled();
  });

  it('sends the confirmation email again to the address on screen and says so', async () => {
    const { findByText } = await renderApp({ initialUrl: url });

    fireEvent.press(await findByText('Resend email'));

    await findByText('Confirmation email sent');
    expect(resendConfirmation).toHaveBeenCalledTimes(1);
    expect(resendConfirmation).toHaveBeenCalledWith('ada@example.com');
  });

  it('shows a countdown afterwards and ignores taps while it runs', async () => {
    const { findByText } = await renderApp({ initialUrl: url });
    mockStartCountsDown = true;

    fireEvent.press(await findByText('Resend email'));
    const counting = await findByText(/^Resend in \d+s$/);
    fireEvent.press(counting);

    expect(resendConfirmation).toHaveBeenCalledTimes(1);
  });

  it('a failed send says so and leaves the button ready to try again', async () => {
    (resendConfirmation as jest.Mock).mockRejectedValue(new Error('boom'));
    const { findByText } = await renderApp({ initialUrl: url });

    fireEvent.press(await findByText('Resend email'));

    await findByText('Could not resend the email. Please try again.');
    await findByText('Resend email');
  });

  it('a rate-limited send asks for patience and starts the countdown', async () => {
    (resendConfirmation as jest.Mock).mockRejectedValue(serverError(429));
    const { findByText } = await renderApp({ initialUrl: url });
    mockStartCountsDown = true;

    fireEvent.press(await findByText('Resend email'));

    await findByText('Too many requests. Please wait a few minutes and try again.');
    await findByText(/^Resend in \d+s$/);
  });

  it('offers no resend when the address is unknown', async () => {
    const { findByText, queryByText } = await renderApp({ initialUrl: '/check-email' });

    await findByText('Check your email');
    expect(queryByText('Resend email')).toBeNull();
  });
});

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
