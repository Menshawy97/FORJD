// F1: the FAQ carries health and training claims and their citations into the product, so its
// shape is pinned: the approved sections and questions (docs/product/faq-copy.md), no unfinished
// "verify" note leaking onto a screen, and nothing that calls a rules-based number AI.
import { FAQ_SECTIONS, type FaqBlock } from '../faq-content';

const textOf = (blocks: readonly FaqBlock[]): string =>
  blocks.map((b) => ('p' in b ? b.p : b.list.join(' '))).join(' ');

const allEntries = FAQ_SECTIONS.flatMap((s) => s.entries);

describe('FAQ content', () => {
  it('has the eight approved sections in order, Weekly Forge after the rank (X5), Workouts after Runs (12B), Notifications after Workouts (12E)', () => {
    expect(FAQ_SECTIONS.map((s) => s.title)).toEqual([
      'Your rank and the leaderboard',
      'Weekly Forge',
      'Your training numbers',
      'Recovery and health data',
      'Runs',
      'Workouts',
      'Notifications',
      'Your account and data',
    ]);
  });

  it('has the approved 44 questions, seven, nine, six, four, five, three, seven and three per section', () => {
    expect(FAQ_SECTIONS.map((s) => s.entries.length)).toEqual([7, 9, 6, 4, 5, 3, 7, 3]);
    expect(allEntries).toHaveLength(44);
  });

  it('ties only the Weekly Forge section to a feature flag', () => {
    expect(FAQ_SECTIONS.filter((s) => s.flag).map((s) => [s.title, s.flag])).toEqual([['Weekly Forge', 'weekly_forge']]);
  });

  it('gives every entry a unique id, a question and an answer', () => {
    expect(new Set(allEntries.map((e) => e.id)).size).toBe(allEntries.length);
    for (const entry of allEntries) {
      expect(entry.question.endsWith('?')).toBe(true);
      expect(entry.answer.length).toBeGreaterThan(0);
    }
  });

  it('cites a published source for the health and training claims that have one', () => {
    const withSource = (id: string) => allEntries.find((e) => e.id === id)?.source;
    expect(withSource('activity-score')).toMatch(/Bull FC/);
    expect(withSource('one-rep-max')).toMatch(/Epley/);
    expect(withSource('training-volume')).toMatch(/Hornsby/);
    expect(withSource('readiness')).toMatch(/Plews/);
    expect(withSource('calories')).toMatch(/ACSM/);
    // scan-height-age-plan.md §4.4: the heart-rate estimate cites its equation too.
    expect(withSource('calories')).toMatch(/Keytel/);
  });

  // 12E, approved by the owner 2026-10-06 (docs/product/faq-copy.md): ADR-061 says the FAQ must say what
  // notifications contain, and these claims are what the code does.
  it('has the approved Notifications section, and says what the notifications contain and that they stay on the phone', () => {
    const section = FAQ_SECTIONS.find((s) => s.title === 'Notifications');
    expect(section?.entries.map((e) => e.id)).toEqual([
      'notifications-which',
      'notifications-when-to-train',
      'notifications-contents',
      'notifications-missing',
      'notifications-server',
      'notifications-shared',
      'notifications-permission',
    ]);
    const answer = (id: string) => textOf(section?.entries.find((e) => e.id === id)?.answer ?? []);
    expect(answer('notifications-which')).toMatch(/22:00 and 07:00/);
    expect(answer('notifications-when-to-train')).toMatch(/at least two of the last four weeks/);
    expect(answer('notifications-contents')).toMatch(/nothing in them is sent anywhere/);
    expect(answer('notifications-contents')).toMatch(/never a health reading/);
    expect(answer('notifications-missing')).toMatch(/two weeks/);
  });

  // 12F, approved by the owner 2026-10-08 (docs/product/faq-copy.md): what the server pushes are, and what is shared to send them.
  it('explains PR and leaderboard pushes and what is shared, with no health reading in them', () => {
    const section = FAQ_SECTIONS.find((s) => s.title === 'Notifications');
    const entry = (id: string) => section?.entries.find((e) => e.id === id);
    expect(entry('notifications-server')?.question).toBe('What are PR and leaderboard notifications?');
    expect(textOf(entry('notifications-server')?.answer ?? [])).toMatch(/never a weight, a time or a health reading/);
    expect(textOf(entry('notifications-server')?.answer ?? [])).toMatch(/longest run or your fastest pace over 2 km or more/);
    expect(entry('notifications-shared')?.question).toBe('What does FORJD share to send these?');
    expect(textOf(entry('notifications-shared')?.answer ?? [])).toMatch(/It contains no health reading/);
    expect(textOf(entry('notifications-shared')?.answer ?? [])).toMatch(/removed from FORJD's servers/);
  });

  it('never shows an unfinished note to a user', () => {
    const everything = allEntries.map((e) => `${e.question} ${textOf(e.answer)} ${e.source ?? ''}`).join(' ');
    expect(everything).not.toMatch(/verify/i);
    expect(everything).not.toMatch(/draft|TODO/i);
  });

  it('says Insight is not AI', () => {
    const insight = allEntries.find((e) => e.id === 'insight');
    expect(insight?.question).toMatch(/is it AI\?/);
    expect(textOf(insight?.answer ?? [])).toMatch(/^It is not AI\./);
  });

  it('keeps the run route on the phone, in words', () => {
    const route = allEntries.find((e) => e.id === 'run-route');
    expect(textOf(route?.answer ?? [])).toMatch(/Your route stays on your phone\./);
  });

  it('says a run is measured with the screen locked too, and explains the run notification (12A)', () => {
    const measure = allEntries.find((e) => e.id === 'run-measure');
    expect(textOf(measure?.answer ?? [])).toMatch(/^From your phone's GPS while a run is open, including with the screen locked./);
    const notification = allEntries.find((e) => e.id === 'run-notification');
    expect(notification?.question).toBe('Why is there a notification while I run?');
    expect(textOf(notification?.answer ?? [])).toMatch(/Pause ands+Finish buttons|Pause and Finish buttons/);
    expect(textOf(notification?.answer ?? [])).toMatch(/your route stays on your phone/);
  });

  it('explains the workout notification, its permission and the bar, and keeps it all on the phone (12B)', () => {
    const workouts = FAQ_SECTIONS.find((section) => section.title === 'Workouts');
    expect(workouts?.entries.map((e) => e.id)).toEqual(['workout-notification', 'workout-permission', 'workout-bar']);

    const notification = allEntries.find((e) => e.id === 'workout-notification');
    expect(notification?.question).toBe('What is the notification during my workout?');
    expect(textOf(notification?.answer ?? [])).toMatch(/nothing in it is sent anywhere/i);
    expect(textOf(notification?.answer ?? [])).toMatch(/three hours/);

    const permission = allEntries.find((e) => e.id === 'workout-permission');
    expect(textOf(permission?.answer ?? [])).toMatch(/at the start of your first workout/);

    const bar = allEntries.find((e) => e.id === 'workout-bar');
    expect(bar?.question).toBe('What is the bar above my tabs?');
    expect(textOf(bar?.answer ?? [])).toMatch(/Tap the bin to throw the workout away/);
  });

  it('describes weeks as Saturday to Friday, the week the whole app counts (ADR-056)', () => {
    const all = allEntries.map((e) => textOf(e.answer)).join(' ');

    expect(all).not.toMatch(/Monday/);
    expect(all).toContain('starting each Saturday');
    expect(all).toContain('saved just after midnight on Saturday (UTC)');
  });
});
