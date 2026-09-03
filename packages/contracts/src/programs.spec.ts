import {
  programEnrollmentResponseSchema,
  programListQuerySchema,
  programListResponseSchema,
  programResponseSchema,
  programSummarySchema,
} from './index';

/**
 * Pins the decisions Phase 3K's contracts make, in the same spirit as workouts.spec.ts: the
 * enums are built from @forjd/domain's tuples so an unknown value is rejected rather than
 * carried, the meta line is sent as two numbers rather than as a rendered sentence, and the two
 * program lists the design draws cannot bleed into each other by default.
 */
describe('program contracts', () => {
  const summary = {
    id: '3f1a4d64-6b2f-4d0e-9d0a-3c2f9a5e1b77',
    slug: 'upper-lower',
    name: 'Upper / Lower',
    category: 'strength',
    level: 'intermediate',
    daysPerWeek: 4,
    durationWeeks: 8,
    description: 'Balanced strength for 3–5 sessions a week',
    isOwn: false,
    workoutCount: 4,
  };

  describe('programListQuerySchema', () => {
    /**
     * The catalogue screen sends no `scope` at all. Defaulting to `preset` is what stops it
     * showing a custom program among the nine -- a default of `all` would make that failure a
     * forgotten parameter rather than a visible choice.
     */
    it('defaults scope to preset, so a screen that forgets it still gets the catalogue', () => {
      expect(programListQuerySchema.parse({})).toEqual({ scope: 'preset' });
    });

    it('accepts the three scopes and rejects anything else', () => {
      for (const scope of ['preset', 'mine', 'all']) {
        expect(programListQuerySchema.safeParse({ scope }).success).toBe(true);
      }
      expect(programListQuerySchema.safeParse({ scope: 'everyone' }).success).toBe(false);
    });

    it('accepts each category the domain names and rejects an unknown one', () => {
      for (const category of ['strength', 'hybrid', 'running', 'cross_training']) {
        expect(programListQuerySchema.safeParse({ category }).success).toBe(true);
      }
      expect(programListQuerySchema.safeParse({ category: 'yoga' }).success).toBe(false);
    });

    /** Absence means "All" -- the chip the catalogue opens on -- not a validation error. */
    it('treats an absent category as no filter', () => {
      expect(programListQuerySchema.parse({}).category).toBeUndefined();
    });
  });

  describe('programSummarySchema', () => {
    it('accepts a catalogue row', () => {
      expect(programSummarySchema.safeParse(summary).success).toBe(true);
    });

    /**
     * The meta line is `4 days · 8 weeks` on screen and two integers on the wire. A server that
     * shipped the sentence would have to know the reader's language to ever change it.
     */
    it('carries the meta line as two numbers, never as a rendered string', () => {
      const parsed = programSummarySchema.parse(summary);
      expect(parsed.daysPerWeek).toBe(4);
      expect(parsed.durationWeeks).toBe(8);
      expect(summary).not.toHaveProperty('meta');
    });

    it('rejects a level that is not one of the three the design offers', () => {
      // `expert` belongs to LEVELS, the ingested exercise vocabulary. The design says "Advanced".
      expect(programSummarySchema.safeParse({ ...summary, level: 'expert' }).success).toBe(false);
      expect(programSummarySchema.safeParse({ ...summary, level: 'advanced' }).success).toBe(true);
    });

    it('allows a null description but never a missing one', () => {
      expect(programSummarySchema.safeParse({ ...summary, description: null }).success).toBe(true);

      const withoutDescription: Record<string, unknown> = { ...summary };
      delete withoutDescription.description;
      expect(programSummarySchema.safeParse(withoutDescription).success).toBe(false);
    });
  });

  describe('programListResponseSchema', () => {
    it('is an envelope, so the list can gain a sibling field without a breaking change', () => {
      expect(programListResponseSchema.safeParse({ items: [summary] }).success).toBe(true);
      expect(programListResponseSchema.safeParse([summary]).success).toBe(false);
    });

    it('accepts an empty list -- filtering to a category with no programs is not an error', () => {
      expect(programListResponseSchema.parse({ items: [] }).items).toEqual([]);
    });
  });

  describe('programResponseSchema', () => {
    const overview = {
      ...summary,
      version: 1,
      workouts: [
        {
          templateId: '0f6c9d9e-58f4-4b2e-8b52-1a4a2c9d8e01',
          name: 'Upper Body A',
          activity: 'strength',
          orderIndex: 0,
          dayOfWeek: null,
          exerciseNames: ['Barbell Bench Press - Medium Grip', 'Bent Over Barbell Row'],
        },
      ],
    };

    it('accepts an overview and extends the summary rather than restating it', () => {
      expect(programResponseSchema.safeParse(overview).success).toBe(true);
    });

    /** A preset prescribes a set of workouts, not a calendar. Only the builder pins a weekday. */
    it('allows a null dayOfWeek and bounds a real one to 0-6', () => {
      const withDay = (dayOfWeek: unknown) => ({
        ...overview,
        workouts: [{ ...overview.workouts[0], dayOfWeek }],
      });

      expect(programResponseSchema.safeParse(withDay(null)).success).toBe(true);
      expect(programResponseSchema.safeParse(withDay(0)).success).toBe(true);
      expect(programResponseSchema.safeParse(withDay(6)).success).toBe(true);
      expect(programResponseSchema.safeParse(withDay(7)).success).toBe(false);
      expect(programResponseSchema.safeParse(withDay(-1)).success).toBe(false);
    });

    /**
     * The overview's Start button calls the same handoff Train's own workout rows use, which
     * only works because a program's workout *is* a workout template. Naming the field for what
     * it is keeps that from having to be rediscovered later.
     */
    it('identifies each workout by its template id', () => {
      const parsed = programResponseSchema.parse(overview);
      expect(parsed.workouts[0]?.templateId).toBe('0f6c9d9e-58f4-4b2e-8b52-1a4a2c9d8e01');
    });

    it('carries exercise names, not whole exercises', () => {
      const parsed = programResponseSchema.parse(overview);
      expect(parsed.workouts[0]?.exerciseNames).toEqual([
        'Barbell Bench Press - Medium Grip',
        'Bent Over Barbell Row',
      ]);
    });
  });

  describe('programEnrollmentResponseSchema', () => {
    const enrollment = {
      id: 'a2b7c1d4-3e5f-4a6b-8c9d-0e1f2a3b4c5d',
      programId: '3f1a4d64-6b2f-4d0e-9d0a-3c2f9a5e1b77',
      programSlug: 'upper-lower',
      programName: 'Upper / Lower',
      programVersion: 1,
      startedAt: '2026-09-01T08:30:00.000Z',
    };

    /**
     * Following nothing is the normal state, not an error and not a 404 -- an envelope with a
     * nullable member says so without the client having to read a status code as data.
     */
    it('represents "following nothing" as an explicit null rather than an absent field', () => {
      expect(programEnrollmentResponseSchema.safeParse({ enrollment: null }).success).toBe(true);
      expect(programEnrollmentResponseSchema.safeParse({}).success).toBe(false);
    });

    it('accepts an active enrolment', () => {
      expect(programEnrollmentResponseSchema.safeParse({ enrollment }).success).toBe(true);
    });

    /** The whole point of the column: which version the athlete began under. */
    it('carries the program version the enrolment started on', () => {
      const parsed = programEnrollmentResponseSchema.parse({ enrollment });
      expect(parsed.enrollment?.programVersion).toBe(1);
    });

    it('rejects a startedAt that is not an ISO datetime', () => {
      expect(
        programEnrollmentResponseSchema.safeParse({
          enrollment: { ...enrollment, startedAt: '2026-09-01' },
        }).success,
      ).toBe(false);
    });
  });
});
