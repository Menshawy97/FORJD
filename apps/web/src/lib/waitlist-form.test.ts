import { describe, expect, it } from 'vitest';

import { isLikelyEmail, messageForStatus, normalizeEmail } from './waitlist-form';

describe('normalizeEmail', () => {
  it('trims whitespace and lower-cases the address', () => {
    expect(normalizeEmail('  Jane.Doe@Example.COM  ')).toBe('jane.doe@example.com');
  });

  it('leaves an already-normal address unchanged', () => {
    expect(normalizeEmail('a@example.com')).toBe('a@example.com');
  });
});

describe('isLikelyEmail', () => {
  // A fast, forgiving client-side check only -- it exists to skip a pointless network round
  // trip for an empty or obviously malformed field. The contract's own schema
  // (waitlistSignupRequestSchema) is the real validator and always has the final say.
  it('accepts an ordinary address', () => {
    expect(isLikelyEmail('a@example.com')).toBe(true);
  });

  it('rejects an empty field', () => {
    expect(isLikelyEmail('')).toBe(false);
  });

  it('rejects a value with no @ or no domain', () => {
    expect(isLikelyEmail('not-an-email')).toBe(false);
    expect(isLikelyEmail('a@b')).toBe(false);
  });

  it('rejects a value with whitespace inside it', () => {
    expect(isLikelyEmail('a b@example.com')).toBe(false);
  });
});

describe('messageForStatus', () => {
  it('is accepted for 202, the only success this endpoint answers with', () => {
    expect(messageForStatus(202)).toEqual({ kind: 'accepted', message: expect.any(String) });
  });

  it('is a plain, non-alarming message for 400 -- covers both a bad email and a failed Turnstile check, and must not say which', () => {
    const result = messageForStatus(400);
    expect(result.kind).toBe('rejected');
    expect(result.message.toLowerCase()).not.toContain('robot');
  });

  it('is a distinct message for 429, the rate limit', () => {
    expect(messageForStatus(429).kind).toBe('rate-limited');
  });

  it('falls back to a generic error for anything else, including a network failure sentinel', () => {
    expect(messageForStatus(500).kind).toBe('error');
    expect(messageForStatus(0).kind).toBe('error');
  });
});
