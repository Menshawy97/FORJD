import type { AthleteRecord, AthleteSession } from '@forjd/contracts';

/**
 * The athlete profile's text, kept out of the components so the wording is testable on its own.
 * The design shows kilograms as "100 kg", big totals with a thousands separator ("14,200 kg"),
 * a run as a clock ("23:42") and a date as day and short month ("19 Aug").
 */

/** "100 kg", "142.5 kg", "14,200 kg". A whole number never carries a ".0". */
export function formatKg(kg: number): string {
  const rounded = Math.round(kg * 10) / 10;
  const text = rounded.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return `${text} kg`;
}

/** "23:42" under an hour, "1:05:09" from an hour. Whole seconds. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const two = (n: number): string => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(rest)}` : `${two(minutes)}:${two(rest)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "19 Aug", in the viewer's own calendar. */
export function formatSessionDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** The one number on a recent-session row: kilograms lifted, else how long it took, else a dash. */
export function sessionValue(session: Pick<AthleteSession, 'volumeKg' | 'durationSeconds'>): string {
  if (session.volumeKg > 0) return formatKg(session.volumeKg);
  if (session.durationSeconds && session.durationSeconds > 0) return formatClock(session.durationSeconds);
  return '—';
}

export function sessionLabel(session: Pick<AthleteSession, 'name' | 'startedAt'>): string {
  return `${session.name} · ${formatSessionDate(session.startedAt)}`;
}

export function recordValue(record: Pick<AthleteRecord, 'weightKg'>): string {
  return formatKg(record.weightKg);
}
