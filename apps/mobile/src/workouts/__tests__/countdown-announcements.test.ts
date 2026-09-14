import { shouldAnnounceCountdownSecond } from '../countdown-announcements';

describe('shouldAnnounceCountdownSecond', () => {
  it('is false at and below zero', () => {
    expect(shouldAnnounceCountdownSecond(0)).toBe(false);
    expect(shouldAnnounceCountdownSecond(-1)).toBe(false);
  });

  it('is true for every second in the last ten', () => {
    for (let second = 1; second <= 10; second += 1) {
      expect(shouldAnnounceCountdownSecond(second)).toBe(true);
    }
  });

  it('is true only on multiples of five above ten', () => {
    expect(shouldAnnounceCountdownSecond(15)).toBe(true);
    expect(shouldAnnounceCountdownSecond(55)).toBe(true);
    expect(shouldAnnounceCountdownSecond(11)).toBe(false);
    expect(shouldAnnounceCountdownSecond(14)).toBe(false);
    expect(shouldAnnounceCountdownSecond(23)).toBe(false);
  });
});
