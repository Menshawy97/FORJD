import { formatDrainSummary } from './push-drain';

// Phase 12F slice 6. One line for the workflow log, with counts only: never a token, a title or a person.
describe('formatDrainSummary', () => {
  it('names what each step did', () => {
    expect(
      formatDrainSummary({
        dispatched: { claimed: 5, sent: 3, dropped: 1, held: 0, retried: 1, failed: 0 },
        receipts: { checked: 4, removedTokens: 1, expired: 0 },
        purged: 7,
        failedSteps: [],
      }),
    ).toBe('push drain: 5 claimed (3 sent, 1 dropped, 0 held, 1 retried, 0 failed), 4 receipts checked (1 dead phones removed, 0 expired), 7 old rows purged\n');
  });

  it('names the steps that failed', () => {
    const text = formatDrainSummary({
      dispatched: { claimed: 0, sent: 0, dropped: 0, held: 0, retried: 0, failed: 0 },
      receipts: { checked: 0, removedTokens: 0, expired: 0 },
      purged: 0,
      failedSteps: ['dispatch', 'purge'],
    });

    expect(text).toContain(', FAILED: dispatch, purge' + String.fromCharCode(10));
  });
});
