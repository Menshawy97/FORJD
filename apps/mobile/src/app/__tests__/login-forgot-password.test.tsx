// RED first: "Forgot password?" was styled to look tappable and did nothing.
//
// The prototype's login screen wires it to `this.flash('Reset link sent to your email')`.
// login.tsx carried a comment explaining that it stayed inert because "there is no toast
// primitive in the app yet" — there is one now (src/components/toast.tsx), so the reason has
// expired and the control can do what it looks like it does.
//
// The reset *request* is still a later slice: this raises the prototype's confirmation and
// sends nothing. That is exactly what the prototype does too — `flash()` is its only
// behaviour there — so this is fidelity, not a stub pretending to be a feature.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(false),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => false),
}));

describe('login "Forgot password?"', () => {
  it('raises the prototype confirmation and stays on the screen', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/login' });
    const { findByText, queryByText } = await rendered;

    await findByText('Welcome back');
    expect(queryByText('Reset link sent to your email')).toBeNull();

    await fireEvent.press(await findByText('Forgot password?'));

    await findByText('Reset link sent to your email');
    expect(rendered.getPathname()).toBe('/login');
  });
});
