import AsyncStorage from '@react-native-async-storage/async-storage';

import { getExerciseUnits, setExerciseUnit } from '../exercise-unit-preferences';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

const mockStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

/**
 * The contract this store owes the live screen is narrow: never throw, never hand back something
 * that is not a unit, and never lose a preference already set. A unit preference is a
 * convenience — failing a workout over one would be absurd — so every failure path degrades to
 * the metric default rather than propagating.
 */
describe('exercise unit preferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getExerciseUnits', () => {
    it('returns an empty map before anything has been stored', async () => {
      mockStorage.getItem.mockResolvedValue(null);
      expect(await getExerciseUnits()).toEqual({});
    });

    it('returns the stored map', async () => {
      mockStorage.getItem.mockResolvedValue(
        JSON.stringify({ 'exercise-a': 'lb', 'exercise-b': 'mi' }),
      );
      expect(await getExerciseUnits()).toEqual({ 'exercise-a': 'lb', 'exercise-b': 'mi' });
    });

    /** Malformed storage is not a crash: the athlete simply gets the metric default back. */
    it.each([
      ['unparseable JSON', 'not json at all'],
      ['an array rather than an object', '["lb"]'],
      ['a value that is not a unit', '{"exercise-a":"stones"}'],
      ['a non-string value', '{"exercise-a":42}'],
      ['a bare null', 'null'],
    ])('degrades to an empty map on %s', async (_label, raw) => {
      mockStorage.getItem.mockResolvedValue(raw);
      expect(await getExerciseUnits()).toEqual({});
    });

    it('degrades to an empty map when storage itself throws', async () => {
      mockStorage.getItem.mockRejectedValue(new Error('storage unavailable'));
      expect(await getExerciseUnits()).toEqual({});
    });
  });

  describe('setExerciseUnit', () => {
    /**
     * Merging, not replacing. Setting the bench to pounds must not silently reset every other
     * exercise the athlete had already chosen a unit for.
     */
    it('keeps every other exercise preference when recording one', async () => {
      mockStorage.getItem.mockResolvedValue(JSON.stringify({ 'exercise-a': 'lb' }));
      mockStorage.setItem.mockResolvedValue(undefined);

      expect(await setExerciseUnit('exercise-b', 'mi')).toBe(true);

      const [, written] = mockStorage.setItem.mock.calls[0]!;
      expect(JSON.parse(written)).toEqual({ 'exercise-a': 'lb', 'exercise-b': 'mi' });
    });

    it('overwrites the same exercise rather than accumulating entries', async () => {
      mockStorage.getItem.mockResolvedValue(JSON.stringify({ 'exercise-a': 'lb' }));
      mockStorage.setItem.mockResolvedValue(undefined);

      await setExerciseUnit('exercise-a', 'kg');

      const [, written] = mockStorage.setItem.mock.calls[0]!;
      expect(JSON.parse(written)).toEqual({ 'exercise-a': 'kg' });
    });

    /** The caller can tell "saved" from "storage is unavailable" instead of assuming. */
    it('reports false rather than throwing when the write fails', async () => {
      mockStorage.getItem.mockResolvedValue(null);
      mockStorage.setItem.mockRejectedValue(new Error('disk full'));

      expect(await setExerciseUnit('exercise-a', 'lb')).toBe(false);
    });

    /** Corrupt storage must not block a new preference from being written. */
    it('still records a preference when the existing map is unreadable', async () => {
      mockStorage.getItem.mockResolvedValue('garbage');
      mockStorage.setItem.mockResolvedValue(undefined);

      expect(await setExerciseUnit('exercise-a', 'lb')).toBe(true);

      const [, written] = mockStorage.setItem.mock.calls[0]!;
      expect(JSON.parse(written)).toEqual({ 'exercise-a': 'lb' });
    });
  });
});
