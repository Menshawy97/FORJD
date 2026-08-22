// RED first: the offline user must not be told their password is wrong.
//
// Both auth screens ended in a bare `catch`, so every failure produced the credentials
// message. login-error.test.tsx already pins the genuine 401 path; this pins the path that
// was being mislabelled as it. The distinction is the whole point of src/auth/failure.ts —
// see its unit tests for the classification itself; this asserts the screens use it.
//
// Login only, in its own file: a second `renderRouter()` after an event has been fired
// renders an empty tree (see signup-field-highlight.test.tsx's header), and signup's own
// offline path is covered in auth-offline-signup.test.tsx for the same reason.
import { fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { AxiosError } from 'axios';

jest.mock('expo-secure-store');
jest.mock('@/auth/apiClient', () => ({
  login: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { login } from '@/auth/apiClient';

describe('login screen - the request never arrived', () => {
  beforeEach(() => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('reports a connection problem, not a wrong password', async () => {
    // The shape axios produces when nothing came back: no `response` at all.
    (login as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));

    const rendered = renderRouter('src/app', { initialUrl: '/login' });
    const { findByText, findByLabelText, queryByText } = await rendered;

    await fireEvent.changeText(await findByLabelText('Email'), 'user@example.com');
    await fireEvent.changeText(await findByLabelText('Password'), 'CorrectPass1!');
    await fireEvent.press(await findByText('Log In'));

    await findByText(/connection/i);

    // The specific regression: the credentials message must be absent, because nothing
    // about this failure says anything about the credentials.
    expect(queryByText(/incorrect email or password/i)).toBeNull();
    expect(rendered.getPathname()).toBe('/login');
  });
});
