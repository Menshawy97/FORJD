/**
 * Pro pricing shown on /pricing. The amounts come from the app's Go Pro screen
 * (FORJD mobile app design/screenshots/payment gate.png). That screen labels the yearly plan
 * "Save 40%", which is wrong: the saving is computed here instead, so the site can't repeat it.
 */
export interface ProPrices {
  readonly monthlyUsd: number;
  readonly yearlyUsd: number;
}

export type BillingPeriod = 'monthly' | 'yearly';

export interface BillingCopy {
  readonly price: string;
  readonly per: string;
  readonly note: string;
}

export const PRO_PRICES: ProPrices = { monthlyUsd: 9.99, yearlyUsd: 59.99 };

const MONTHS_PER_YEAR = 12;

/** Saving of yearly over twelve monthly payments, to the nearest whole percent (49.96% shows as 50%). */
export function yearlySavingPercent({ monthlyUsd, yearlyUsd }: ProPrices): number {
  const twelveMonths = monthlyUsd * MONTHS_PER_YEAR;
  return Math.max(0, Math.round((1 - yearlyUsd / twelveMonths) * 100));
}

function formatUsd(amount: number): string {
  const cents = Math.round(amount * 100);
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export function billingCopy(period: BillingPeriod, prices: ProPrices): BillingCopy {
  if (period === 'monthly') {
    return { price: formatUsd(prices.monthlyUsd), per: '/ month', note: 'Billed monthly.' };
  }
  const perMonth = formatUsd(prices.yearlyUsd / MONTHS_PER_YEAR);
  return {
    price: formatUsd(prices.yearlyUsd),
    per: '/ year',
    note: `${perMonth} a month, billed once a year.`,
  };
}
