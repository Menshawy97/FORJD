import { z } from 'zod';

import {
  exerciseListQuerySchema,
  exerciseListResponseSchema,
  exerciseResponseSchema,
  exerciseSummarySchema,
  listResponseSchema,
} from './index';

/**
 * The list envelope becomes the house pattern for every list endpoint after this one, and
 * the query schema is the codebase's first `@Query` validation — two things worth pinning
 * before anything depends on them.
 *
 * Query parameters arrive as strings, always. Every coercion below is a place where a
 * plausible-looking schema silently does the wrong thing (`z.coerce.boolean()` on the
 * string "false" being the sharpest), so each is asserted rather than assumed.
 */
describe('exercise contracts', () => {
  describe('listResponseSchema', () => {
    it('wraps any item schema in { items, nextCursor }', () => {
      const schema = listResponseSchema(z.object({ id: z.string() }));

      expect(schema.parse({ items: [{ id: 'a' }], nextCursor: 'abc' })).toEqual({
        items: [{ id: 'a' }],
        nextCursor: 'abc',
      });
    });

    it('accepts a null cursor for the last page', () => {
      const schema = listResponseSchema(z.object({ id: z.string() }));

      expect(schema.parse({ items: [], nextCursor: null }).nextCursor).toBeNull();
    });

    it('requires nextCursor to be present, so "last page" is stated rather than omitted', () => {
      const schema = listResponseSchema(z.object({ id: z.string() }));

      expect(schema.safeParse({ items: [] }).success).toBe(false);
    });
  });

  describe('exerciseListQuerySchema', () => {
    it('defaults limit when the caller sends none', () => {
      expect(exerciseListQuerySchema.parse({}).limit).toBe(50);
    });

    it('coerces limit from the string a query string actually delivers', () => {
      expect(exerciseListQuerySchema.parse({ limit: '20' }).limit).toBe(20);
    });

    it('rejects a limit above the maximum rather than silently clamping it', () => {
      expect(exerciseListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    });

    it('rejects a fractional limit', () => {
      expect(exerciseListQuerySchema.safeParse({ limit: '1.5' }).success).toBe(false);
    });

    it('rejects a limit of zero', () => {
      expect(exerciseListQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    });

    it('reads favourite=true as true', () => {
      expect(exerciseListQuerySchema.parse({ favourite: 'true' }).favourite).toBe(true);
    });

    /**
     * The reason `favourite` is not `z.coerce.boolean()`: that coerces via `Boolean(value)`,
     * and every non-empty string is truthy, so `?favourite=false` would filter the list down
     * to favourites — the exact opposite of what the caller asked for, with no error.
     */
    it('reads favourite=false as false, not as truthy', () => {
      expect(exerciseListQuerySchema.parse({ favourite: 'false' }).favourite).toBe(false);
    });

    it('rejects a favourite value that is neither true nor false', () => {
      expect(exerciseListQuerySchema.safeParse({ favourite: '1' }).success).toBe(false);
    });

    it('leaves favourite undefined when absent, which means no filter', () => {
      expect(exerciseListQuerySchema.parse({}).favourite).toBeUndefined();
    });

    it('trims a search term', () => {
      expect(exerciseListQuerySchema.parse({ q: '  bench  ' }).q).toBe('bench');
    });

    /**
     * An empty box in the search field sends `?q=`. That is "no search", not a malformed
     * request, and a `min(1)` would make the library 400 the moment someone cleared the box.
     */
    it('treats an empty search term as no search rather than a validation error', () => {
      expect(exerciseListQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
    });

    it('rejects a search term longer than the bound', () => {
      expect(exerciseListQuerySchema.safeParse({ q: 'a'.repeat(81) }).success).toBe(false);
    });

    /**
     * The bound exists to keep an unbounded term out of a full-text query and a trigram
     * index, so it must apply to the term that actually reaches them — the trimmed one.
     * Checked before the trim, a search that is comfortably within the limit gets a 400
     * purely because of whitespace the server was about to discard anyway. Same mistake as
     * `min(1)` before the trim, in the opposite direction.
     */
    it('applies the length bound to the trimmed term, not the raw one', () => {
      const padded = `${' '.repeat(20)}${'a'.repeat(70)}${' '.repeat(20)}`;

      expect(exerciseListQuerySchema.parse({ q: padded }).q).toBe('a'.repeat(70));
    });

    it('accepts the enum filters', () => {
      const parsed = exerciseListQuerySchema.parse({
        category: 'strength',
        muscle: 'chest',
        equipment: 'barbell',
      });

      expect(parsed).toMatchObject({
        category: 'strength',
        muscle: 'chest',
        equipment: 'barbell',
      });
    });

    it('rejects a category outside the canonical vocabulary', () => {
      expect(exerciseListQuerySchema.safeParse({ category: 'stretching' }).success).toBe(false);
    });

    it('rejects a muscle outside the canonical vocabulary', () => {
      expect(exerciseListQuerySchema.safeParse({ muscle: 'gizzard' }).success).toBe(false);
    });

    it('passes a cursor through untouched, since its encoding is the API concern', () => {
      expect(exerciseListQuerySchema.parse({ cursor: 'eyJhIjoxfQ' }).cursor).toBe('eyJhIjoxfQ');
    });

    it('rejects an implausibly long cursor', () => {
      expect(exerciseListQuerySchema.safeParse({ cursor: 'a'.repeat(513) }).success).toBe(false);
    });

    it('ignores an unknown query parameter rather than failing the request', () => {
      expect(exerciseListQuerySchema.parse({ utm_source: 'x' })).not.toHaveProperty('utm_source');
    });
  });

  describe('exerciseSummarySchema', () => {
    const summary = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Barbell Bench Press',
      slug: 'barbell-bench-press',
      category: 'strength' as const,
      measure: 'weight' as const,
      primaryMuscles: ['chest' as const],
      equipment: ['barbell' as const],
      imageUrl: 'https://media.example.com/exercises/bench-0.jpg',
      isCustom: false,
      isFavourite: true,
    };

    it('accepts a catalogue row', () => {
      expect(exerciseSummarySchema.parse(summary)).toEqual(summary);
    });

    it('accepts a null imageUrl, which is what a custom exercise has', () => {
      expect(exerciseSummarySchema.parse({ ...summary, imageUrl: null }).imageUrl).toBeNull();
    });

    /** Never optional: a client must not have to distinguish "not favourited" from "absent". */
    it('requires isFavourite', () => {
      const withoutFavourite = Object.fromEntries(
        Object.entries(summary).filter(([key]) => key !== 'isFavourite'),
      );

      expect(exerciseSummarySchema.safeParse(withoutFavourite).success).toBe(false);
    });

    it('does not carry the owning user id', () => {
      const parsed = exerciseSummarySchema.parse({
        ...summary,
        ownerUserId: '22222222-2222-4222-8222-222222222222',
      });

      expect(parsed).not.toHaveProperty('ownerUserId');
    });
  });

  describe('exerciseListResponseSchema', () => {
    it('is the envelope around exercise summaries', () => {
      const parsed = exerciseListResponseSchema.parse({
        items: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Barbell Bench Press',
            slug: 'barbell-bench-press',
            category: 'strength',
            measure: 'weight',
            primaryMuscles: ['chest'],
            equipment: ['barbell'],
            imageUrl: null,
            isCustom: false,
            isFavourite: false,
          },
        ],
        nextCursor: null,
      });

      expect(parsed.items).toHaveLength(1);
      expect(parsed.nextCursor).toBeNull();
    });
  });

  describe('exerciseResponseSchema', () => {
    const detail = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Barbell Bench Press',
      slug: 'barbell-bench-press',
      category: 'strength' as const,
      goal: 'hypertrophy' as const,
      measure: 'weight' as const,
      primaryMuscles: ['chest' as const],
      secondaryMuscles: ['triceps' as const],
      equipment: ['barbell' as const],
      force: 'push' as const,
      level: 'beginner' as const,
      mechanic: 'compound' as const,
      instructions: ['Lie on the bench.', 'Press the bar up.'],
      imageUrls: ['https://media.example.com/exercises/bench-0.jpg'],
      description: null,
      isCustom: false,
      isFavourite: false,
    };

    it('accepts a full catalogue exercise', () => {
      expect(exerciseResponseSchema.parse(detail)).toEqual(detail);
    });

    /** A custom exercise has none of the source force/level/mechanic metadata. */
    it('accepts null force, level and mechanic', () => {
      const parsed = exerciseResponseSchema.parse({
        ...detail,
        force: null,
        level: null,
        mechanic: null,
        isCustom: true,
      });

      expect(parsed.force).toBeNull();
      expect(parsed.mechanic).toBeNull();
    });

    /**
     * `imageUrls`, never `imageKeys`. The database stores keys (ADR-018) and the API resolves
     * them through a configurable base URL, so replacing the stopgap media is a config change
     * rather than a wire-contract break — which only holds if the key never crosses the wire.
     */
    it('does not carry storage keys', () => {
      const parsed = exerciseResponseSchema.parse({ ...detail, imageKeys: ['a/b.jpg'] });

      expect(parsed).not.toHaveProperty('imageKeys');
      expect(parsed).toHaveProperty('imageUrls');
    });
  });
});
