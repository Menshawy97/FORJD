// F1: the FAQ carries health and training claims and their citations into the product, so its
// shape is pinned: the approved sections and questions (docs/product/faq-copy.md), no unfinished
// "verify" note leaking onto a screen, and nothing that calls a rules-based number AI.
import { FAQ_SECTIONS, type FaqBlock } from '../faq-content';

const textOf = (blocks: readonly FaqBlock[]): string =>
  blocks.map((b) => ('p' in b ? b.p : b.list.join(' '))).join(' ');

const allEntries = FAQ_SECTIONS.flatMap((s) => s.entries);

describe('FAQ content', () => {
  it('has the five approved sections in order', () => {
    expect(FAQ_SECTIONS.map((s) => s.title)).toEqual([
      'Your rank and the leaderboard',
      'Your training numbers',
      'Recovery and health data',
      'Runs',
      'Your account and data',
    ]);
  });

  it('has the approved 24 questions, seven, six, four, four and three per section', () => {
    expect(FAQ_SECTIONS.map((s) => s.entries.length)).toEqual([7, 6, 4, 4, 3]);
    expect(allEntries).toHaveLength(24);
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
});
