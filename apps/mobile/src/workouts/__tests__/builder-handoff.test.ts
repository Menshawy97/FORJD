import {
  consumeBuilderPrefill,
  consumePickedExerciseForBuilder,
  setBuilderPrefill,
  setPickedExerciseForBuilder,
} from '../builder-handoff';

describe('builder-handoff', () => {
  it('returns null when nothing has been set', () => {
    expect(consumePickedExerciseForBuilder()).toBeNull();
    expect(consumeBuilderPrefill()).toBeNull();
  });

  it('returns a picked exercise exactly once, then null', () => {
    setPickedExerciseForBuilder({ exerciseId: 'ex-1', name: 'Bench Press', measure: 'weight' });

    expect(consumePickedExerciseForBuilder()).toEqual({
      exerciseId: 'ex-1',
      name: 'Bench Press',
      measure: 'weight',
    });
    expect(consumePickedExerciseForBuilder()).toBeNull();
  });

  it('returns a prefill exactly once, then null', () => {
    const prefill = {
      basedOnTemplateId: 'template-1',
      name: 'Upper Push',
      activity: 'strength' as const,
      exercises: [
        {
          exerciseId: 'ex-1',
          name: 'Bench Press',
          measure: 'weight' as const,
          setCount: 4,
          targetReps: 8,
          targetSeconds: null,
          targetDistanceMeters: null,
        },
      ],
    };
    setBuilderPrefill(prefill);

    expect(consumeBuilderPrefill()).toEqual(prefill);
    expect(consumeBuilderPrefill()).toBeNull();
  });

  it('keeps the two handoffs independent of each other', () => {
    setPickedExerciseForBuilder({ exerciseId: 'ex-1', name: 'Bench Press', measure: 'weight' });

    expect(consumeBuilderPrefill()).toBeNull();
    expect(consumePickedExerciseForBuilder()).not.toBeNull();
  });
});
