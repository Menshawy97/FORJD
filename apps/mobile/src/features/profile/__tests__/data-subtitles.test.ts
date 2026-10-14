// Emulator walk finding 15 (notifications-list-and-profile-counts-plan.md, slice A): Profile → Data showed made-up
// numbers ("147 sessions logged", "Last scan 8 days ago"). These read the real ones, and never invent a value.
import {
  SCANS_NEUTRAL,
  SESSIONS_NEUTRAL,
  scansSubtitle,
  sessionsSubtitle,
} from '../data-subtitles';

describe('sessionsSubtitle', () => {
  it('counts sessions, singular and plural', () => {
    expect(sessionsSubtitle(0)).toBe('0 sessions logged');
    expect(sessionsSubtitle(1)).toBe('1 session logged');
    expect(sessionsSubtitle(147)).toBe('147 sessions logged');
  });

  it('shows the neutral line, not a number, while the count is unknown', () => {
    expect(sessionsSubtitle(null)).toBe(SESSIONS_NEUTRAL);
    expect(SESSIONS_NEUTRAL).not.toMatch(/\d/);
  });
});

describe('scansSubtitle', () => {
  it('says there are no scans yet', () => {
    expect(scansSubtitle([])).toBe('No scans yet');
  });

  it('names the newest scan by day and short month, whatever the list order', () => {
    expect(
      scansSubtitle([
        { measuredAt: '2026-09-02T08:00:00.000Z' },
        { measuredAt: '2026-10-14T08:00:00.000Z' },
        { measuredAt: '2026-10-01T08:00:00.000Z' },
      ]),
    ).toBe('Last scan 14 Oct');
  });

  it('falls back to the neutral line when no scan date can be read', () => {
    expect(scansSubtitle([{ measuredAt: 'not a date' }])).toBe(SCANS_NEUTRAL);
  });

  it('shows the neutral line, not a number, while the scans are unknown', () => {
    expect(scansSubtitle(null)).toBe(SCANS_NEUTRAL);
    expect(SCANS_NEUTRAL).not.toMatch(/\d/);
  });
});
