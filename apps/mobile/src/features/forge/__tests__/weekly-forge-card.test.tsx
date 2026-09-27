// The Weekly Forge card on Home, as approved in the Phase 7 mock-ups (item C): a heading row that
// copies This week's ("Weekly Forge", days left on the right), then one row per ladder with its
// badge, band and level, total against target, and a rail. A met target turns green with a tick.
import type { ForgeLadderProgress, ForgeResponse } from '@forjd/contracts';
import { render, screen } from '@testing-library/react-native';

import { WeeklyForgeCard } from '../weekly-forge-card';
import { daysLeftLabel, formatForgeAmount } from '../forge-format';

const ladder = (over: Partial<ForgeLadderProgress>): ForgeLadderProgress => ({
  ladder: 'volume',
  unit: 'kg',
  band: 'ember',
  level: 7,
  maxLevel: 33,
  target: 5600,
  total: 3000,
  progress: 3000 / 5600,
  missStreak: 0,
  forgedStreak: 0,
  bestForgedStreak: 0,
  badges: ['ore', 'ember'],
  ...over,
});

const FORGE: ForgeResponse = {
  weekStart: '2026-09-26',
  daysLeft: 3,
  timeZone: 'Africa/Cairo',
  ladders: [
    ladder({ ladder: 'consistency', unit: 'workouts', band: 'anvil', level: 4, target: 4, total: 2, progress: 0.5 }),
    ladder({}),
    ladder({ ladder: 'distance', unit: 'km', band: 'ore', level: 5, target: 11, total: 8.4, progress: 8.4 / 11 }),
    ladder({ ladder: 'minutes', unit: 'minutes', band: 'ember', level: 9, target: 210, total: 145, progress: 145 / 210 }),
    ladder({ ladder: 'nourish', unit: 'days', band: 'ember', level: 4, target: 4, total: 4, progress: 1 }),
  ],
};

describe('formatForgeAmount', () => {
  it('writes each unit the way the approved card does', () => {
    expect(formatForgeAmount(3000, 'kg')).toBe('3,000');
    expect(formatForgeAmount(12400.4, 'kg')).toBe('12,400');
    expect(formatForgeAmount(8.44, 'km')).toBe('8.4');
    expect(formatForgeAmount(11, 'km')).toBe('11');
    expect(formatForgeAmount(157.5, 'km')).toBe('157.5');
    expect(formatForgeAmount(145.6, 'minutes')).toBe('146');
    expect(formatForgeAmount(2, 'workouts')).toBe('2');
  });
});

describe('daysLeftLabel', () => {
  it('counts the days left, and says "Last day" on Friday', () => {
    expect(daysLeftLabel(7)).toBe('7 days left');
    expect(daysLeftLabel(3)).toBe('3 days left');
    expect(daysLeftLabel(1)).toBe('Last day');
  });
});

describe('WeeklyForgeCard', () => {
  it('heads the card like This week, with the days left on the right', async () => {
    await render(<WeeklyForgeCard forge={FORGE} />);

    expect(screen.getByText('Weekly Forge')).toBeTruthy();
    expect(screen.getByText('3 days left')).toBeTruthy();
  });

  it('shows every ladder with its band, level and this week against the target', async () => {
    await render(<WeeklyForgeCard forge={FORGE} />);

    expect(screen.getByText('Consistency')).toBeTruthy();
    expect(screen.getByText('Anvil · Level 4')).toBeTruthy();
    expect(screen.getByLabelText('Volume, Ember level 7: 3,000 of 5,600 kg')).toBeTruthy();
    expect(screen.getByLabelText('Distance, Ore level 5: 8.4 of 11 km')).toBeTruthy();
    expect(screen.getByLabelText('Active minutes, Ember level 9: 145 of 210 minutes')).toBeTruthy();
    // One screen-reader stop per row: the badge inside it is decorative.
    expect(screen.queryByLabelText('Volume, Ember')).toBeNull();
  });

  it('marks a met target as done', async () => {
    await render(<WeeklyForgeCard forge={FORGE} />);

    expect(screen.getByLabelText('Nourish, Ember level 4: 4 of 4 days, target met')).toBeTruthy();
  });

  it('shows a dash for every ladder while the week is loading or unavailable', async () => {
    await render(<WeeklyForgeCard forge={null} />);

    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.getByLabelText('Volume: not loaded yet')).toBeTruthy();
    expect(screen.getByText('Nourish')).toBeTruthy();
  });
});
