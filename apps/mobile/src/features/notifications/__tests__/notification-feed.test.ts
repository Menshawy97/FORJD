// The notifications list behind the Home bell (emulator walk finding 17; replica approved 2026-10-14, slice B of
// docs/product/notifications-list-and-profile-counts-plan.md): Today and Earlier groups, newest first, a relative time
// on the right ("2h", "Sat", "9 Oct"), an icon per kind, and a tap that opens what tapping the push opens.
import { buildPrPush, buildRankPush } from '@forjd/domain';
import type { NotificationItem } from '@forjd/contracts';

import {
  groupNotifications,
  iconForNotification,
  relativeNotificationTime,
  routeForNotification,
} from '../notification-feed';

// A Wednesday afternoon, in the test run's own time zone, so "today" and weekdays are the device's calendar.
const NOW = new Date(2026, 9, 14, 15, 0, 0);
const at = (days: number, hour: number, minute = 0): string =>
  new Date(2026, 9, 14 + days, hour, minute).toISOString();
const SESSION = '0c6f2c8e-1b1a-4c55-9d7e-3a9f8d2b7c11';

function item(over: Partial<NotificationItem>): NotificationItem {
  return {
    id: 'n1',
    kind: 'pr',
    title: 'New PR on Barbell Bench Press',
    body: 'Open FORJD to see it.',
    data: { type: 'pr', sessionId: SESSION },
    sentAt: at(0, 13),
    ...over,
  };
}

describe('relativeNotificationTime', () => {
  it('reads minutes and hours today', () => {
    expect(relativeNotificationTime(NOW.toISOString(), NOW)).toBe('now');
    expect(relativeNotificationTime(at(0, 14, 20), NOW)).toBe('40m');
    expect(relativeNotificationTime(at(0, 13), NOW)).toBe('2h');
    expect(relativeNotificationTime(at(0, 0, 30), NOW)).toBe('14h');
  });

  it('reads the weekday within the last week, then the day and short month', () => {
    expect(relativeNotificationTime(at(-1, 23), NOW)).toBe('Tue');
    expect(relativeNotificationTime(at(-4, 9), NOW)).toBe('Sat');
    expect(relativeNotificationTime(at(-6, 9), NOW)).toBe('Thu');
    expect(relativeNotificationTime(at(-7, 9), NOW)).toBe('7 Oct');
    expect(relativeNotificationTime(at(-14, 9), NOW)).toBe('30 Sep');
  });

  it('reads an unreadable time as nothing rather than "NaN"', () => {
    expect(relativeNotificationTime('not a date', NOW)).toBe('');
  });
});

describe('groupNotifications', () => {
  it('splits into Today and Earlier by the calendar day, newest first in each', () => {
    const groups = groupNotifications(
      [
        item({ id: 'old', sentAt: at(-3, 9) }),
        item({ id: 'late', sentAt: at(0, 14) }),
        item({ id: 'yesterday', sentAt: at(-1, 23, 59) }),
        item({ id: 'early', sentAt: at(0, 0, 1) }),
      ],
      NOW,
    );

    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Today', ['late', 'early']],
      ['Earlier', ['yesterday', 'old']],
    ]);
  });

  it('leaves out an empty group', () => {
    expect(groupNotifications([item({ sentAt: at(-2, 9) })], NOW).map((g) => g.label)).toEqual(['Earlier']);
    expect(groupNotifications([], NOW)).toEqual([]);
  });
});

describe('iconForNotification', () => {
  // The titles come from the real push builders, so a change there cannot quietly break the icons.
  const pr = (records: Parameters<typeof buildPrPush>[0]['records']) => {
    const push = buildPrPush({ sessionId: SESSION, records })!;
    return item({ title: push.title, body: push.body, data: push.data });
  };

  it('shows the trophy for a lift PR and for several PRs, the runner for a run PR', () => {
    expect(iconForNotification(pr([{ type: 'lift', exerciseName: 'Back Squat' }]))).toBe('rank');
    expect(
      iconForNotification(pr([{ type: 'lift', exerciseName: 'A' }, { type: 'run', record: 'longest_run' }])),
    ).toBe('rank');
    expect(iconForNotification(pr([{ type: 'run', record: 'longest_run' }]))).toBe('runner');
    expect(iconForNotification(pr([{ type: 'run', record: 'fastest_pace' }]))).toBe('runner');
  });

  it('shows the chart for a leaderboard move', () => {
    const push = buildRankPush({ direction: 'up', cityName: 'Cairo', weekStart: '2026-10-10' });
    expect(iconForNotification(item({ kind: 'rank', title: push.title, data: push.data }))).toBe('progress');
  });
});

describe('routeForNotification', () => {
  it('opens the workout for a PR and Rank for a leaderboard move, like the push', () => {
    expect(routeForNotification(item({}))).toBe(`/workout/${SESSION}`);
    expect(routeForNotification(item({ kind: 'rank', data: { type: 'rank', weekStart: '2026-10-10' } }))).toBe('/rank');
  });

  it('opens nothing for data that is not a real id', () => {
    expect(routeForNotification(item({ data: { type: 'pr', sessionId: '../../profile' } }))).toBeNull();
    expect(routeForNotification(item({ data: { type: 'pr' } }))).toBeNull();
    expect(routeForNotification(item({ data: {} }))).toBeNull();
  });
});
