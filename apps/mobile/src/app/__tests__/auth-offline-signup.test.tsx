// RED first: signup's half of the same defect — see auth-offline.test.tsx's header for why
// this lives in a separate file rather than as a second test beside it.
//
// Signup's bare `catch` produced "Could not create your account", which is true but says
// nothing the user can act on: it reads as "we declined you" when the real answer is "we
// never heard from the server". The account may well be creatable a minute later.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { AxiosError } from 'axios';

jest.mock('expo-secure-store');
jest.mock('@/auth/apiClient', () => ({
  signup: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { signup } from '@/auth/apiClient';

describe('signup screen - the request never arrived', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  });

  it('reports a connection problem, not a rejected account', async () => {
    (signup as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));

    const rendered = renderRouter('src/app', { initialUrl: '/signup' });
    const { findByText, findByLabelText, queryByText } = await rendered;

    await fireEvent.changeText(await findByLabelText('Full name'), 'James Mitchell');
    await fireEvent.changeText(await findByLabelText('Email'), 'james@example.com');
    await fireEvent.changeText(await findByLabelText('Password'), 'Str0ng!pass');
    await fireEvent.press(await findByText('Create Account'));

    await findByText(/connection/i);

    expect(queryByText(/could not create your account/i)).toBeNull();
    expect(rendered.getPathname()).toBe('/signup');
  });
});
