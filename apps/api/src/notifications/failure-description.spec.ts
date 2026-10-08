import { describeFailure } from './failure-description';

// The push drain runs in a workflow log, where "Error" alone says nothing. This adds the machine codes that Postgres and the
// network put on an error or its causes (28P01, 42P01, ETIMEDOUT, ENETUNREACH...), which name the problem and hold no secret.
// It never prints a message, which can carry a query's parameters, a connection string or a push token.
describe('describeFailure', () => {
  it('is the error name alone when there is no code', () => {
    expect(describeFailure(new Error('Failed query: select ... params: ExponentPushToken[abc]'))).toBe('Error');
  });

  it('adds the code found on the error or on any cause, outermost first', () => {
    const root = Object.assign(new Error('connect ETIMEDOUT 10.0.0.1:5432'), { code: 'ETIMEDOUT' });
    const wrapped = new Error('Failed query', { cause: root });

    expect(describeFailure(wrapped)).toBe('Error, code ETIMEDOUT');
    expect(describeFailure(Object.assign(new Error('x'), { code: '42P01', cause: root }))).toBe('Error, code 42P01 then ETIMEDOUT');
  });

  it('ignores codes that are not short plain identifiers, and things that are not errors', () => {
    expect(describeFailure(Object.assign(new Error('x'), { code: 'select * from users' }))).toBe('Error');
    expect(describeFailure('plain string')).toBe('unknown error');
    expect(describeFailure(undefined)).toBe('unknown error');
  });

  it('survives a cause that points back at itself', () => {
    const loop: Error & { cause?: unknown } = new Error('loop');
    loop.cause = loop;

    expect(describeFailure(loop)).toBe('Error');
  });
});
