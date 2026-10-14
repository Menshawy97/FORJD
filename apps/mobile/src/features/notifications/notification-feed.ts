import type { NotificationItem } from '@forjd/contracts';

import type { IconName } from '@/components/icon';
import { routeForPushData } from './push-tap';

/**
 * The rules behind the notifications list on the Home bell (emulator walk finding 17; replica approved 2026-10-14, slice
 * B of docs/product/notifications-list-and-profile-counts-plan.md). Pure, and read in the phone's own calendar: "Today"
 * is the person's today, not UTC's.
 */
export interface NotificationGroup {
  label: 'Today' | 'Earlier';
  items: NotificationItem[];
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const WEEK_DAYS = 7;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const startOfDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const timeOf = (item: NotificationItem): number => new Date(item.sentAt).getTime();

/** Calendar days between two moments in the phone's zone (daylight-saving safe: whole local days, rounded). */
const daysBetween = (earlier: Date, later: Date): number =>
  Math.round((startOfDay(later) - startOfDay(earlier)) / (24 * HOUR_MS));

/** "now", "40m", "2h" today; the weekday within the last week ("Sat"); then the day and short month ("9 Oct"). */
export function relativeNotificationTime(sentAt: string, now: Date): string {
  const sent = new Date(sentAt);
  if (!Number.isFinite(sent.getTime())) return '';
  const days = daysBetween(sent, now);
  if (days <= 0) {
    const elapsed = Math.max(0, now.getTime() - sent.getTime());
    if (elapsed < MINUTE_MS) return 'now';
    if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m`;
    return `${Math.floor(elapsed / HOUR_MS)}h`;
  }
  if (days < WEEK_DAYS) return WEEKDAYS[sent.getDay()]!;
  return `${sent.getDate()} ${MONTHS[sent.getMonth()]}`;
}

/** Today and Earlier, each newest first; a group with nothing in it is left out. */
export function groupNotifications(items: readonly NotificationItem[], now: Date): NotificationGroup[] {
  const sorted = [...items].sort((a, b) => timeOf(b) - timeOf(a));
  const today = startOfDay(now);
  const groups: NotificationGroup[] = [
    { label: 'Today', items: sorted.filter((item) => timeOf(item) >= today) },
    { label: 'Earlier', items: sorted.filter((item) => !(timeOf(item) >= today)) },
  ];
  return groups.filter((group) => group.items.length > 0);
}

/**
 * The trophy (the app's `rank` glyph) for a lift PR, the runner for a run PR, the chart for a leaderboard move. A push's
 * data carries only a kind and an id (ADR-061), so a run PR is told apart by its title, which comes from the domain's
 * push builder (`buildPrPush`: "New PR: your longest run" / "...fastest pace"); the tests build titles with it.
 */
export function iconForNotification(item: NotificationItem): IconName {
  if (item.kind === 'rank') return 'progress';
  return item.title.startsWith('New PR: your ') ? 'runner' : 'rank';
}

/** Where a tap goes: the same place as tapping the push. */
export function routeForNotification(item: NotificationItem): string | null {
  return routeForPushData(item.data);
}
