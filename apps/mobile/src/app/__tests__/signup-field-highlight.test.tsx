// RED first: the red border must land on the field that actually failed.
//
// `hasError` was computed as "this field is empty", but validation has three branches —
// empty fields, bad email format, weak password. Only the first of those correlates with
// emptiness. So a user who typed "james@" (non-empty, invalid) or "weak" (non-empty, too
// weak) got the generic message with every border still calm grey: the app says something is
// wrong and declines to say where, which is the failure mode error highlighting exists to
// prevent.
//
// **One render, one test, walked through the ladder.** Not a stylistic choice: a second
// `renderRouter()` in a file where an earlier test already fired an event renders an empty
// tree (the root layout's `authChecked` gate never flips), so the assertions would fail on
// setup rather than on behaviour — the same module-registry isolation boundary
// login.test.tsx's header documents. Keeping it to one mounted screen also suits the
// subject: these branches are a ladder the user climbs in one sitting, and checking them in
// sequence proves each step clears the one before it.
//
// Every node is re-fetched through `await findBy*` rather than captured once or read with a
// synchronous `getBy*`. Both shortcuts fail here, for the same reason: this screen's tree
// settles asynchronously, and a node read before it settles carries handlers and props from
// an earlier pass — the edit lands on a stale `onChangeText` and silently does nothing.
//
// Every `fireEvent` call is awaited. In RNTL 14 `fireEvent` is itself `async` — it wraps the
// handler in `await act(...)` — so an un-awaited call leaves that act scope open. A second
// un-awaited call then opens a scope inside it, React logs "overlapping act() calls", and the
// update from the inner one is dropped: the edit lands on the component but never reaches the
// rendered tree. That is a property of this ladder specifically (several events in one test,
// no `await` between them), and it is why the awaits are load-bearing rather than cosmetic.
//
// The error border is a NativeWind class (`border-errorBorder`). NativeWind resolves
// `className` to `style` through its babel transform at build time, so inside Jest the
// compiled style is absent but the `className` prop survives on the host node — that is what
// these assertions read.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { registerRequestSchema } from '@forjd/contracts';

// Structural type rather than `ReactTestInstance` from react-test-renderer: that package is
// not a dependency here (RNTL 14 bundles its own renderer), and the only thing read below is
// `props.className`, so the narrow shape is both sufficient and honest about what is used.
type NodeWithClassName = { props: { className?: unknown } };

jest.mock('expo-secure-store');
jest.mock('@/auth/apiClient', () => ({
  signup: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { signup } from '@/auth/apiClient';

const ERROR_BORDER = 'border-errorBorder';

const WEAK_PASSWORD = 'weak';

/**
 * Read out of the contract rather than written down here, for the same reason signup.tsx
 * validates against the contract instead of a paraphrase: if the policy changes, this test
 * follows it instead of failing on a stale copy.
 *
 * A regex like /password/i cannot be used in its place — the field's own "PASSWORD" label is
 * on screen too, so the query would be ambiguous rather than wrong.
 */
const weakPasswordMessage = (() => {
  const result = registerRequestSchema.shape.password.safeParse(WEAK_PASSWORD);
  if (result.success) {
    throw new Error(`Contract accepts "${WEAK_PASSWORD}" — this test needs a rejected password.`);
  }
  return result.error.issues[0].message;
})();

function highlighted(input: NodeWithClassName): boolean {
  return String(input.props.className ?? '').includes(ERROR_BORDER);
}

describe('signup screen - which field gets the error border', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  });

  it('points at the field that actually failed, at every step of the validation ladder', async () => {
    const { findByText, findByLabelText, queryByText } = await renderRouter('src/app', {
      initialUrl: '/signup',
    });

    const name = () => findByLabelText('Full name');
    const email = () => findByLabelText('Email');
    const password = () => findByLabelText('Password');
    const submit = () => findByText('Create Account');

    // 1. Nothing filled in: the empty-fields branch implicates all three, and says so.
    await fireEvent.press(await submit());
    await findByText('All fields are required.');
    expect(highlighted(await name())).toBe(true);
    expect(highlighted(await email())).toBe(true);
    expect(highlighted(await password())).toBe(true);

    // 2. Editing any field clears message and highlight together. The design doc flags this
    //    as a real fixed bug, so it is guarded rather than assumed.
    await fireEvent.changeText(await name(), 'James Mitchell');
    // The awaited query settles the tree; only then is the synchronous absence check
    // meaningful — read any earlier it would still see the pre-flush render.
    expect(highlighted(await name())).toBe(false);
    expect(queryByText('All fields are required.')).toBeNull();
    expect(highlighted(await email())).toBe(false);
    expect(highlighted(await password())).toBe(false);

    // 3. Still the empty-fields branch, but now only one field is empty — so only that one
    //    should be marked, not every field on the screen.
    await fireEvent.changeText(await password(), 'Str0ng!pass');
    await fireEvent.press(await submit());
    await findByText('All fields are required.');
    expect(highlighted(await email())).toBe(true);
    expect(highlighted(await name())).toBe(false);
    expect(highlighted(await password())).toBe(false);

    // 4. The bug, case 1: non-empty but malformed. `!email.trim()` is false here, which is
    //    exactly why the old code left this field unmarked.
    await fireEvent.changeText(await email(), 'james@');
    await fireEvent.press(await submit());
    await findByText('Enter a valid email address.');
    expect(highlighted(await email())).toBe(true);
    expect(highlighted(await name())).toBe(false);
    expect(highlighted(await password())).toBe(false);

    // 5. The bug, case 2: non-empty but too weak. Same shape, other field.
    await fireEvent.changeText(await email(), 'james@example.com');
    await fireEvent.changeText(await password(), WEAK_PASSWORD);
    await fireEvent.press(await submit());
    // The message is the contract's own, not a paraphrase — see signup.tsx's header.
    await findByText(weakPasswordMessage);
    expect(highlighted(await password())).toBe(true);
    expect(highlighted(await name())).toBe(false);
    expect(highlighted(await email())).toBe(false);

    // Nothing above ever reached the network: every branch is client-side validation.
    expect(signup).not.toHaveBeenCalled();
  });
});
