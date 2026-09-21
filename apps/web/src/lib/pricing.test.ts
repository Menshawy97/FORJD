import { describe, expect, it } from 'vitest';

import { PRO_PRICES, billingCopy, yearlySavingPercent } from './pricing';

describe('yearlySavingPercent', () => {
  it('is 50 for $59.99 a year against $9.99 a month', () => {
    // 12 x 9.99 = 119.88; 1 - 59.99 / 119.88 = 0.4996, a 49.96% saving, which rounds to 50%.
    expect(yearlySavingPercent(PRO_PRICES)).toBe(50);
  });

  it('rounds to the nearest whole percent', () => {
    // 1 - 77 / 120 = 0.3583: rounding down would say 35.
    expect(yearlySavingPercent({ monthlyUsd: 10, yearlyUsd: 77 })).toBe(36);
  });

  it('is 0 when yearly costs as much as twelve months', () => {
    expect(yearlySavingPercent({ monthlyUsd: 5, yearlyUsd: 60 })).toBe(0);
  });
});

describe('billingCopy', () => {
  it('describes yearly billing with its monthly equivalent', () => {
    expect(billingCopy('yearly', PRO_PRICES)).toEqual({
      price: '$59.99',
      per: '/ year',
      note: '$5 a month, billed once a year.',
    });
  });

  it('describes monthly billing', () => {
    expect(billingCopy('monthly', PRO_PRICES)).toEqual({
      price: '$9.99',
      per: '/ month',
      note: 'Billed monthly.',
    });
  });

  it('keeps cents in the monthly equivalent when it is not a whole dollar', () => {
    expect(billingCopy('yearly', { monthlyUsd: 9.99, yearlyUsd: 71.88 }).note).toBe(
      '$5.99 a month, billed once a year.',
    );
  });
});
