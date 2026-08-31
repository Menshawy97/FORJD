import { trainingTip } from '../training-tip';

/**
 * Ports the prototype's `trainingTip(name, muscleStr)` (line 1971 of
 * `FORJD Mobile.dc.html`) -- a real element of `s_exercise()`'s "How to train it" callout
 * that `docs/design/phase2-screen-specs.md` §4.2 missed entirely during spec extraction. It
 * is deterministic client-side copy with no session/analytics dependency, so unlike the stat
 * tiles/sparkline/history it does not need Phase 3 data and belongs in Phase 2.
 */
describe('trainingTip', () => {
  it('returns the curated tip for a named exercise, verbatim from the prototype', () => {
    expect(trainingTip('Bench Press', ['chest'])).toBe(
      'Keep shoulder blades pinned back and drive through your feet — a stable base lets you press harder without straining the shoulders.',
    );
    expect(trainingTip('Deadlift', ['hamstrings'])).toBe(
      'Push the floor away rather than pulling the bar up. Keep the bar against your shins/thighs the whole way to protect your lower back.',
    );
    expect(trainingTip('Pull-Up', ['lats'])).toBe(
      "Start from a dead hang and pull your elbows down and back — think about driving your chest to the bar.",
    );
  });

  it('falls back to a leg-group tip for quads/hamstrings/glutes/calves when the name has no curated tip', () => {
    expect(trainingTip('Leg Press', ['quads'])).toBe(
      'Control the eccentric (lowering) phase and drive through your whole foot — most leg gains come from time under tension, not just the top of the rep.',
    );
    expect(trainingTip('Hip Thrust', ['glutes'])).toContain('Control the eccentric');
    expect(trainingTip('Calf Raise', ['calves'])).toContain('Control the eccentric');
  });

  it('falls back to a chest/shoulder/tricep-group tip when the name has no curated tip', () => {
    expect(trainingTip('Machine Chest Press', ['chest', 'triceps'])).toBe(
      'Warm the joint up with a lighter set first, and keep the movement smooth — jerky reps shift stress to the joint instead of the muscle.',
    );
    expect(trainingTip('Lateral Raise', ['shoulders'])).toContain('Warm the joint up');
  });

  it('falls back to a back/lat/bicep-group tip when the name has no curated tip', () => {
    expect(trainingTip('Lat Pulldown', ['lats'])).toBe(
      'Focus on pulling with your elbows rather than your hands, and avoid using body momentum to move the weight.',
    );
    expect(trainingTip('Barbell Curl', ['biceps'])).toContain('pulling with your elbows');
  });

  it('falls back to a core tip when the name has no curated tip', () => {
    expect(trainingTip('Cable Crunch', ['core'])).toBe(
      'Move slowly and keep your ribs stacked over your hips — speed usually means momentum is doing the work instead of your core.',
    );
  });

  it('falls back to the generic tip for a muscle group none of the buckets cover', () => {
    expect(trainingTip('Wrist Curl', ['forearms'])).toBe(
      'Prioritize full range of motion and a controlled tempo over adding weight — good form now means more progress later.',
    );
  });

  it('falls back to the generic tip when there are no primary muscles at all', () => {
    expect(trainingTip('Mystery Move', [])).toBe(
      'Prioritize full range of motion and a controlled tempo over adding weight — good form now means more progress later.',
    );
  });

  it('checks the curated name map before any muscle-group fallback', () => {
    // Bench Press primarily targets chest, which would also match the chest/shoulder/tricep
    // fallback -- the curated tip must win.
    expect(trainingTip('Bench Press', ['chest'])).not.toContain('Warm the joint up');
  });
});
