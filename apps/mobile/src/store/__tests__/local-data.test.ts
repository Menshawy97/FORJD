jest.mock('@react-native-async-storage/async-storage', () => ({
  getAllKeys: jest.fn(),
  multiRemove: jest.fn(),
}));
jest.mock('../workout-session', () => ({ deleteWorkoutSessionDb: jest.fn() }));
jest.mock('../exercise-catalogue', () => ({ deleteExerciseCatalogueDb: jest.fn() }));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { deleteExerciseCatalogueDb } from '../exercise-catalogue';
import { clearLocalUserData } from '../local-data';
import { deleteWorkoutSessionDb } from '../workout-session';

describe('clearLocalUserData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([
      'forjd.recentExercises.v1',
      'forjd.exerciseUnits.v1',
      'someOtherLibrary.cache',
    ]);
    (AsyncStorage.multiRemove as jest.Mock).mockResolvedValue(undefined);
    (deleteWorkoutSessionDb as jest.Mock).mockResolvedValue(undefined);
    (deleteExerciseCatalogueDb as jest.Mock).mockResolvedValue(undefined);
  });

  it('removes both on-device databases', async () => {
    await clearLocalUserData();

    expect(deleteWorkoutSessionDb).toHaveBeenCalledTimes(1);
    expect(deleteExerciseCatalogueDb).toHaveBeenCalledTimes(1);
  });

  it('removes every forjd.* AsyncStorage key and leaves other libraries keys alone', async () => {
    await clearLocalUserData();

    expect(AsyncStorage.multiRemove).toHaveBeenCalledWith([
      'forjd.recentExercises.v1',
      'forjd.exerciseUnits.v1',
    ]);
  });

  it('still clears everything else when one step fails, and never throws', async () => {
    (deleteWorkoutSessionDb as jest.Mock).mockRejectedValue(new Error('locked'));

    await expect(clearLocalUserData()).resolves.toBeUndefined();

    expect(deleteExerciseCatalogueDb).toHaveBeenCalled();
    expect(AsyncStorage.multiRemove).toHaveBeenCalled();
  });
});
