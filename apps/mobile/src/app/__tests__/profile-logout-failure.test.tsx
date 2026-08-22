// RED first: what the profile screen does when signing out *fails*.
//
// `handleLogout` was `() => { void clearSession(); }`. `clearSession` deletes five keystore
// entries with `Promise.all`, so any one of them rejecting rejects the whole thing — and
// `void` discards that rejection. Three consequences, all invisible to the user:
//   - the rejection is unhandled,
//   - `notifySessionChanged()` never runs, so the root layout's AuthGate never redirects,
//   - the screen looks exactly as it did before the tap.
// The user is told nothing and stays signed in. Log out is the one destination on this
// screen that is actually wired (see profile.tsx's header), and the gap it closes is the
// reason this slice exists, so failing silently is the one outcome it cannot have.
//
// Kept in its own file rather than added to profile.test.tsx: that suite mocks
// `deleteItemAsync` as resolving for every test in it, and a rejecting variant would have to
// mutate shared module state mid-suite. Separate file, separate module registry.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('expo-secure-store');

import * as SecureStore from 'expo-secure-store';

/** A promise whose settlement this test controls, so "in flight" is an observable state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('profile screen - sign-out failure', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('access-1');
  });

  // One render, one ladder — same reasoning as signup-field-highlight.test.tsx: a second
  // `renderRouter()` after an earlier test in the file has fired an event renders an empty
  // tree, so the assertions would fail on setup rather than on behaviour.
  //
  // The press is deliberately NOT awaited here, unlike that file. `fireEvent` awaits
  // `act(...)`, and `act` awaits whatever the handler returns — which is `handleLogout`'s
  // promise, gated below on a deletion this test has not settled yet. Awaiting it would
  // deadlock on the very state the test exists to observe. The `await findBy*` on the next
  // line is what flushes the render instead.
  it('reports the failure, stays put, and locks the control while it is in flight', async () => {
    const gate = deferred<void>();
    (SecureStore.deleteItemAsync as jest.Mock).mockReturnValue(gate.promise);

    const rendered = renderRouter('src/app', { initialUrl: '/profile' });
    const { findByText, findByLabelText, queryByText } = await rendered;

    const control = () => findByLabelText('Log out');

    expect((await control()).props.accessibilityState?.disabled).toBe(false);

    fireEvent.press(await control());

    // Mid-flight: a second tap must not fire a second sign-out.
    expect((await control()).props.accessibilityState?.disabled).toBe(true);

    gate.reject(new Error('SecureStore unavailable'));
    await findByText(/could not log out/i);

    // Still signed in, still on the profile screen — no half-completed sign-out, and no
    // silent no-op either.
    expect(rendered.getPathname()).toBe('/profile');
    expect(queryByText(/Training\./)).toBeNull();

    // ...and once it has failed, the user can try again.
    expect((await control()).props.accessibilityState?.disabled).toBe(false);
  });
});
