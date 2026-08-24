// RED first: login and signup both ended in a bare `catch { setError('Incorrect email or
// password...') }`. That message is a claim about *why* the request failed, and the catch
// block had no evidence for it — a user in a tunnel, or with the API down, was told their
// password was wrong. They then retype a correct password, are told again that it is wrong,
// and reasonably conclude the account is broken.
//
// The distinction is available on the error itself, so this classifies it rather than
// guessing. Kinds, not copy: the two screens phrase the same kind differently ("incorrect
// password" is not a thing signup can say), so the wording stays at the call site.
import { AxiosError, AxiosHeaders } from 'axios';

import { actionableServerMessage, classifyRequestFailure } from '../failure';

/** A rejection shaped the way axios shapes one, for a response that did arrive. */
function withStatus(status: number, data: unknown = {}): AxiosError {
  const error = new AxiosError('Request failed');
  error.response = {
    status,
    statusText: '',
    data,
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return error;
}

describe('classifyRequestFailure', () => {
  it('reads a 401 as rejected credentials', () => {
    expect(classifyRequestFailure(withStatus(401))).toBe('unauthorized');
  });

  // The screens' mocked rejections are plain objects, and so are some hand-rolled errors.
  // Classification is structural for that reason: what matters is that a response arrived
  // with a status, not which constructor produced the object carrying it.
  it('reads a plain object carrying a 401 response the same way', () => {
    expect(classifyRequestFailure({ response: { status: 401 } })).toBe('unauthorized');
  });

  it('reads an axios error with no response at all as offline', () => {
    // This is exactly the shape axios produces for DNS failure, a refused connection, or a
    // timeout: the request was made, nothing came back.
    expect(classifyRequestFailure(new AxiosError('Network Error'))).toBe('offline');
  });

  it('does not call a server error offline', () => {
    expect(classifyRequestFailure(withStatus(500))).toBe('unknown');
  });

  it('does not call a 409 rejected credentials', () => {
    expect(classifyRequestFailure(withStatus(409))).toBe('unknown');
  });

  // A TypeError from our own code has no `response` either. Treating "no response" alone as
  // proof of offline would relabel every local bug as a connectivity problem and send the
  // user to check their wifi over a mistake in this app.
  it('does not call a non-request error offline', () => {
    expect(classifyRequestFailure(new TypeError('x is not a function'))).toBe('unknown');
    expect(classifyRequestFailure(undefined)).toBe('unknown');
    expect(classifyRequestFailure('boom')).toBe('unknown');
  });
});

/**
 * RED first, from the slice 14 device walk: signup showed "Could not create your account.
 * Please try again." when the real reason was Supabase's hourly mail quota. "Try again" was
 * advice that could not work for an hour, because the screen threw the server's message away
 * and substituted its own for every non-offline failure.
 *
 * The server writes user-facing copy for exactly two signup rejections — a weak password
 * (400) and the mail rate limit (429). Both are safe to show: neither says anything about
 * whether an address already holds an account. 401 stays excluded on purpose; that is the
 * status the API collapses every enumerable failure into.
 */
describe('actionableServerMessage', () => {
  it('surfaces the message on a 429 so the user knows to wait rather than retry', () => {
    const error = withStatus(429, {
      message: 'Too many sign-up emails have been sent recently. Please try again later.',
      statusCode: 429,
    });

    expect(actionableServerMessage(error)).toBe(
      'Too many sign-up emails have been sent recently. Please try again later.',
    );
  });

  it('surfaces the message on a 400 so a rejected password names the rule', () => {
    const error = withStatus(400, {
      message: 'Password must be at least 8 characters and include an uppercase letter, ...',
      statusCode: 400,
    });

    expect(actionableServerMessage(error)).toMatch(/at least 8 characters/);
  });

  // The enumeration guard. The API answers every enumerable signup failure with a constant
  // 401 string; forwarding whatever it happens to say would put the client one server-side
  // wording change away from leaking which addresses hold accounts.
  it('never surfaces a 401 message, however harmless it looks', () => {
    const error = withStatus(401, { message: 'User already registered', statusCode: 401 });

    expect(actionableServerMessage(error)).toBeUndefined();
  });

  it('ignores statuses the server does not write user copy for', () => {
    expect(actionableServerMessage(withStatus(500, { message: 'boom' }))).toBeUndefined();
    expect(actionableServerMessage(withStatus(409, { message: 'conflict' }))).toBeUndefined();
  });

  it('returns undefined when there is no usable message to show', () => {
    expect(actionableServerMessage(withStatus(429))).toBeUndefined();
    expect(actionableServerMessage(withStatus(429, { message: '   ' }))).toBeUndefined();
    expect(actionableServerMessage(withStatus(429, { message: 42 }))).toBeUndefined();
    expect(actionableServerMessage(new AxiosError('Network Error'))).toBeUndefined();
    expect(actionableServerMessage(undefined)).toBeUndefined();
  });
});
