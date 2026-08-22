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

import { classifyRequestFailure } from '../failure';

/** A rejection shaped the way axios shapes one, for a response that did arrive. */
function withStatus(status: number): AxiosError {
  const error = new AxiosError('Request failed');
  error.response = {
    status,
    statusText: '',
    data: {},
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
