import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DISTANCE_DISPLAY_UNITS,
  WEIGHT_DISPLAY_UNITS,
  type DistanceDisplayUnit,
  type WeightDisplayUnit,
} from '@forjd/domain';

/**
 * Which unit each exercise is *displayed* in, remembered across workouts.
 *
 * The live screen's unit chip is per exercise, not per app: an athlete can think in kilograms on
 * the squat and pounds on the dumbbells, and the prototype's own `toggleUnit(name, measure)` is
 * keyed the same way. Where this deliberately goes further than the prototype is persistence —
 * the prototype forgets the choice when the session ends, and the decision here was that it
 * should stick, so setting the bench to pounds once is not a thing to redo every week.
 *
 * **This is a display preference and nothing else.** Every weight is stored in kilograms and
 * every distance in metres (ADR-016); this map only decides what the athlete reads, and how what
 * they type is interpreted. Losing it costs one tap, which is why AsyncStorage is the right home
 * — the same "a handful of values, not the relational catalogue" case `recent-exercises.ts` and
 * `notification-preferences.ts` already make — and why every read degrades to the default rather
 * than throwing.
 *
 * Keyed by exercise **id**, not name: a catalogue re-ingest can rename an exercise, and a
 * preference that silently detached from its exercise would be worse than one never set.
 */
const STORAGE_KEY = 'forjd.exerciseUnits.v1';

export type DisplayUnit = WeightDisplayUnit | DistanceDisplayUnit;

const ALL_UNITS: readonly string[] = [...WEIGHT_DISPLAY_UNITS, ...DISTANCE_DISPLAY_UNITS];

export type ExerciseUnitMap = Record<string, DisplayUnit>;

function isUnitMap(value: unknown): value is ExerciseUnitMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (unit) => typeof unit === 'string' && ALL_UNITS.includes(unit),
  );
}

/**
 * The whole map in one read.
 *
 * One read rather than one per exercise: the live screen needs every exercise's unit before its
 * first paint, and eight sequential AsyncStorage reads to render one screen is a visible stall
 * for data that fits in a single small object.
 *
 * Returns `{}` for absent, malformed and unreadable storage alike — "degrade, don't throw", the
 * same choice the neighbouring stores make. A unit preference is not worth failing a workout for.
 */
export async function getExerciseUnits(): Promise<ExerciseUnitMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    return isUnitMap(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Records one exercise's unit, merging rather than replacing.
 *
 * Re-reads before writing instead of trusting a copy held in a component: two screens could each
 * hold a stale map, and a blind write would drop whichever preference the other had set. Returns
 * whether the write landed, so a caller can tell "saved" from "storage is unavailable" — nothing
 * needs that yet, but returning void would make it unknowable later.
 */
export async function setExerciseUnit(exerciseId: string, unit: DisplayUnit): Promise<boolean> {
  try {
    const current = await getExerciseUnits();
    const next: ExerciseUnitMap = { ...current, [exerciseId]: unit };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
