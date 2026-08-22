// RED first: every auth TextInput must carry its own accessible name.
//
// The labels on these screens are sibling <Text> nodes. Sighted users read the association
// from layout — the label sits directly above the box. A screen reader has no layout to read:
// focusing the input announces the placeholder at best ("james.mitchell@example.com") and
// nothing at all for the password field, whose placeholder is a row of bullets. The user is
// told to type into an unnamed box.
//
// React Native has no `htmlFor`/`aria-labelledby` equivalent that RN's accessibility bridge
// honours across both platforms, so `accessibilityLabel` on the input itself is the correct
// fix, not a workaround for one.
//
// Querying by label rather than placeholder is deliberate: it makes the a11y contract the
// thing the test enforces, so it cannot regress silently.
import { renderRouter } from 'expo-router/testing-library';

jest.mock('expo-secure-store');

import * as SecureStore from 'expo-secure-store';

describe('auth screens - accessible field names', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('names every input on the login screen', async () => {
    const { findByLabelText } = await renderRouter('src/app', { initialUrl: '/login' });

    await findByLabelText('Email');
    await findByLabelText('Password');
  });

  it('names every input on the signup screen', async () => {
    const { findByLabelText } = await renderRouter('src/app', { initialUrl: '/signup' });

    await findByLabelText('Full name');
    await findByLabelText('Email');
    await findByLabelText('Password');
  });
});
