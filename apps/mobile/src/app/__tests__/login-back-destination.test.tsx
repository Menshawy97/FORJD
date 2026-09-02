// RED first: login's back control used `router.back()`, which is "undo the last navigation",
// not a destination. The prototype's header calls `go('welcome')` — an explicit place, the
// same one every time.
//
// The two agree only when login was reached by pushing from welcome. Reached any other way
// — a deep link, a `replace` from signup's "No account?" row, a cold start on /login —
// `back()` goes wherever the stack happens to point, which may be nowhere at all. That is
// what this asserts: entering login directly and pressing back must still land on welcome.
//
// back-navigation.test.tsx covers the stack behaviour itself and drives `router.back()`
// directly rather than through this control, so it is unaffected by this change.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(false),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => false),
  consumeSessionExpired: jest.fn(() => false),
}));

describe('login back control', () => {
  it('goes to welcome even when login was not reached from welcome', async () => {
    const rendered = renderRouter('src/app', { initialUrl: '/login' });
    const { findByText, findByLabelText } = await rendered;

    await findByText('Welcome back');

    await fireEvent.press(await findByLabelText('Back'));

    await findByText(/Training\./);
    expect(rendered.getPathname()).toBe('/welcome');
  });
});
