import { evaluateInsight, type InsightInput } from './index';

const NOTHING: InsightInput = {
  volumeKgThisWeek: 0,
  volumeKgLastWeek: 0,
  sessionsThisWeek: 0,
  weeksOfHistory: 0,
  readyToProgress: null,
  estimatedOneRepMaxTrendKg: [],
};

const input = (overrides: Partial<InsightInput>): InsightInput => ({ ...NOTHING, ...overrides });

describe('evaluateInsight', () => {
  it('says nothing at all until there is history to speak from', () => {
    // The honest empty state. A card that invents an observation from one session is the same
    // failure as printing the design's demo numbers.
    expect(evaluateInsight(NOTHING)).toBeNull();
    expect(evaluateInsight(input({ weeksOfHistory: 1, sessionsThisWeek: 1 }))).toBeNull();
  });

  it('leads with the load-increase cue when a lift has outrun its target reps', () => {
    // The one genuinely prescriptive rule the evidence carries: ACSM (2009), Progression Models
    // in Resistance Training for Healthy Adults, Med Sci Sports Exerc 41(3):687-708 -- a 2-10%
    // increase once the athlete exceeds the target reps by one or two on consecutive sessions.
    const result = evaluateInsight(
      input({ weeksOfHistory: 4, sessionsThisWeek: 3, readyToProgress: { exerciseName: 'Back Squat' } }),
    );
    expect(result).not.toBeNull();
    expect(result?.headline).toContain('Back Squat');
    expect(result?.body).toContain('2-10%');
  });

  it('reports a volume rise as an observation, without promising more is better', () => {
    const result = evaluateInsight(
      input({ weeksOfHistory: 4, sessionsThisWeek: 4, volumeKgThisWeek: 11400, volumeKgLastWeek: 10000 }),
    );
    expect(result?.headline).toContain('14%');
    expect(result?.headline.toLowerCase()).toContain('up');
  });

  it('reports a volume drop just as plainly', () => {
    const result = evaluateInsight(
      input({ weeksOfHistory: 4, sessionsThisWeek: 2, volumeKgThisWeek: 9000, volumeKgLastWeek: 10000 }),
    );
    expect(result?.headline).toContain('10%');
    expect(result?.headline.toLowerCase()).toContain('down');
  });

  it('ignores a volume change too small to be worth remarking on', () => {
    // 2% is within a week's normal noise -- there is nothing else to say about this input
    // (no lift ready to progress, no 1RM trend, an adequate session count), so the honest
    // answer is silence rather than a headline manufactured from a rounding-error-sized move.
    const result = evaluateInsight(
      input({ weeksOfHistory: 4, sessionsThisWeek: 3, volumeKgThisWeek: 10200, volumeKgLastWeek: 10000 }),
    );
    expect(result).toBeNull();
  });

  it('falls back to the estimated-1RM trend when volume is flat', () => {
    const result = evaluateInsight(
      input({
        weeksOfHistory: 6,
        sessionsThisWeek: 3,
        volumeKgThisWeek: 10000,
        volumeKgLastWeek: 10000,
        estimatedOneRepMaxTrendKg: [88, 91, 94, 100],
      }),
    );
    expect(result?.headline.toLowerCase()).toContain('estimated one-rep max');
  });

  it('notes the twice-a-week frequency guideline when the week is thin', () => {
    // ACSM (2026) position stand: train each major muscle group at least twice per week.
    const result = evaluateInsight(input({ weeksOfHistory: 5, sessionsThisWeek: 1 }));
    expect(result?.body).toContain('twice a week');
  });

  describe('the claims it must never make', () => {
    // Deloading: PeerJ 2024;12:e16777 found continuous training produced *greater* strength
    // gains than deloading, so a prescribed deload is not supported. Injury risk from a load
    // spike: the acute:chronic workload ratio's "sweet spot" is a statistical artefact
    // (Impellizzeri et al. 2020). Neither belongs in copy shown to an athlete. See ADR-030.
    const FORBIDDEN = ['deload', 'de-load', 'injury', 'injured', 'overtrain', 'at risk', 'overreach'];

    const everyPossibleInsight = [
      input({ weeksOfHistory: 4, sessionsThisWeek: 3, readyToProgress: { exerciseName: 'Bench Press' } }),
      input({ weeksOfHistory: 4, sessionsThisWeek: 5, volumeKgThisWeek: 20000, volumeKgLastWeek: 10000 }),
      input({ weeksOfHistory: 4, sessionsThisWeek: 6, volumeKgThisWeek: 40000, volumeKgLastWeek: 10000 }),
      input({ weeksOfHistory: 4, sessionsThisWeek: 1, volumeKgThisWeek: 2000, volumeKgLastWeek: 10000 }),
      input({ weeksOfHistory: 8, sessionsThisWeek: 3, estimatedOneRepMaxTrendKg: [88, 91, 94, 100] }),
      input({ weeksOfHistory: 5, sessionsThisWeek: 1 }),
    ];

    it.each(FORBIDDEN)('never mentions %s, however extreme the week', (term) => {
      for (const candidate of everyPossibleInsight) {
        const result = evaluateInsight(candidate);
        const text = `${result?.headline ?? ''} ${result?.body ?? ''}`.toLowerCase();
        expect(text).not.toContain(term);
      }
    });

    it('does not escalate a very large volume jump into a warning', () => {
      // Quadrupled volume is still reported as what it is, not framed as dangerous.
      const result = evaluateInsight(
        input({ weeksOfHistory: 4, sessionsThisWeek: 6, volumeKgThisWeek: 40000, volumeKgLastWeek: 10000 }),
      );
      expect(result?.headline).toContain('300%');
      expect(result?.body.toLowerCase()).not.toContain('too much');
    });
  });
});
