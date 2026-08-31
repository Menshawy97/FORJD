jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { getRecentExerciseIds, recordExerciseOpened } from '../recent-exercises';

describe('recent exercises store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRecentExerciseIds', () => {
    it('returns an empty array when nothing is stored', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

      await expect(getRecentExerciseIds()).resolves.toEqual([]);
    });

    it('returns the stored ids', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(['a', 'b']));

      await expect(getRecentExerciseIds()).resolves.toEqual(['a', 'b']);
    });

    it('degrades to an empty array rather than throwing on malformed JSON', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue('not json');

      await expect(getRecentExerciseIds()).resolves.toEqual([]);
    });

    it('degrades to an empty array when the stored value is not a string array', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ oops: true }));

      await expect(getRecentExerciseIds()).resolves.toEqual([]);
    });
  });

  describe('recordExerciseOpened', () => {
    it('prepends the newly opened id', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(['a', 'b']));

      await recordExerciseOpened('c');

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'forjd.recentExercises.v1',
        JSON.stringify(['c', 'a', 'b']),
      );
    });

    it('moves a re-opened id to the front rather than duplicating it', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(['a', 'b', 'c']));

      await recordExerciseOpened('b');

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'forjd.recentExercises.v1',
        JSON.stringify(['b', 'a', 'c']),
      );
    });

    it('caps the list at three entries', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(['a', 'b', 'c']));

      await recordExerciseOpened('d');

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'forjd.recentExercises.v1',
        JSON.stringify(['d', 'a', 'b']),
      );
    });

    it('resolves false rather than throwing when the write fails', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
      (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('disk full'));

      await expect(recordExerciseOpened('a')).resolves.toBe(false);
    });
  });
});
