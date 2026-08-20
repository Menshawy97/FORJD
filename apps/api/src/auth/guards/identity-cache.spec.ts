import { User } from '@forjd/domain';

import { IdentityCache } from './identity-cache';

const user = (id: string): User => ({
  id,
  email: `${id}@example.com`,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});

describe('IdentityCache', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns nothing for an identity it has not seen', () => {
    expect(new IdentityCache().get('ext-1', 'a@example.com')).toBeUndefined();
  });

  it('returns a stored user for the same identity', () => {
    const cache = new IdentityCache();
    cache.set('ext-1', 'a@example.com', user('user-1'));

    expect(cache.get('ext-1', 'a@example.com')).toEqual(user('user-1'));
  });

  it('misses when the same external id presents a different address', () => {
    const cache = new IdentityCache();
    cache.set('ext-1', 'old@example.com', user('user-1'));

    // A miss sends the request back to the repository, which is what re-runs the check
    // that the new address is not already bound to somebody else's account.
    expect(cache.get('ext-1', 'new@example.com')).toBeUndefined();
  });

  it('forgets an entry once its time to live has passed', () => {
    const cache = new IdentityCache({ ttlMs: 1_000, maxEntries: 10 });
    cache.set('ext-1', 'a@example.com', user('user-1'));

    jest.advanceTimersByTime(999);
    expect(cache.get('ext-1', 'a@example.com')).toBeDefined();

    jest.advanceTimersByTime(2);
    expect(cache.get('ext-1', 'a@example.com')).toBeUndefined();
  });

  it('evicts the oldest entry rather than growing without limit', () => {
    // Unbounded growth keyed by user id is a memory leak that only shows up in production,
    // and only after the app is successful enough to have many users.
    const cache = new IdentityCache({ ttlMs: 60_000, maxEntries: 2 });

    cache.set('ext-1', 'a@example.com', user('user-1'));
    cache.set('ext-2', 'b@example.com', user('user-2'));
    cache.set('ext-3', 'c@example.com', user('user-3'));

    expect(cache.get('ext-1', 'a@example.com')).toBeUndefined();
    expect(cache.get('ext-2', 'b@example.com')).toBeDefined();
    expect(cache.get('ext-3', 'c@example.com')).toBeDefined();
  });

  it('never exceeds its capacity even under sustained inserts', () => {
    const cache = new IdentityCache({ ttlMs: 60_000, maxEntries: 3 });

    for (let i = 0; i < 100; i += 1) {
      cache.set(`ext-${i}`, `u${i}@example.com`, user(`user-${i}`));
    }

    expect(cache.size).toBe(3);
  });

  it('drops everything when invalidated', () => {
    const cache = new IdentityCache();
    cache.set('ext-1', 'a@example.com', user('user-1'));

    cache.clear();

    expect(cache.get('ext-1', 'a@example.com')).toBeUndefined();
  });
});
