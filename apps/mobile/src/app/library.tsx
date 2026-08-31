import {
  EXERCISE_CATEGORIES,
  EXERCISE_CATEGORY_DISPLAY_NAMES,
  MUSCLE_GROUP_DISPLAY_NAMES,
  type ExerciseCategory,
} from '@forjd/domain';
import type { ExerciseResponse } from '@forjd/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, SectionList, Text, TextInput, View } from 'react-native';

import { getExerciseCatalogue, setExerciseFavourite } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';
import { Toast, useToast } from '@/components/toast';
import {
  ensureExerciseCatalogueSchema,
  getCachedExercise,
  listCachedExercises,
  openExerciseCatalogueDb,
  searchExercises,
  setLocalFavourite,
  syncExerciseCatalogue,
  type SqliteConnection,
} from '@/store/exercise-catalogue';
import { getRecentExerciseIds } from '@/store/recent-exercises';
import { colors } from '@/theme/tokens';

/**
 * `s_library()`, docs/design/phase2-screen-specs.md §3. Reads the on-device catalogue
 * (Phase H) rather than the network directly, offline-first per CLAUDE.md rule 6: the list
 * renders from whatever `exercise-catalogue.ts` already has cached the instant this screen
 * mounts, and a background sync (`syncExerciseCatalogue`) fills in anything new without the
 * screen ever blocking on it.
 *
 * **`pick` search param.** Ported from the prototype's `libraryPickMode` component state to
 * an expo-router search param (`?pick=workout|routine`), per §3.6's explicit instruction and
 * the `returnTo`/`back` param precedent `goals`/`location` already established. Only browse
 * mode (`pick` absent) is reachable in Phase 2 — the `builder`/`live` destinations a pick
 * mode would append to are Phase 3 screens that do not exist, so `pick` only changes the
 * header title and back destination here, never the row-tap behaviour (§8's own deviation
 * list: "Only browse mode is reachable").
 *
 * **The trailing stat column the screenshot shows ("80 kg × 8 × 4") is a deliberate
 * omission**, not a fidelity gap. It is hardcoded seed data in the prototype standing in for
 * last-performed session stats (`libraryAll()`'s literal string per row) — the exact class
 * of Phase-3-dependent data this project omits rather than fakes everywhere else (stat
 * tiles, sparklines, history on the athlete and exercise-detail screens). A row here is
 * icon, title/subtitle, star — nothing else.
 */

type LibraryFilter = 'all' | 'favourites' | ExerciseCategory;

const FILTER_CHIPS: ReadonlyArray<{ id: LibraryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'favourites', label: 'Favourites' },
  ...EXERCISE_CATEGORIES.map((category) => ({
    id: category,
    label: EXERCISE_CATEGORY_DISPLAY_NAMES[category],
  })),
];

/** A single-item sentinel so the "All exercises" section always renders through `SectionList`,
 * with its own empty-state row, rather than needing a second component outside the list. */
const EMPTY_SENTINEL = '__empty__';

function subtitleOf(exercise: ExerciseResponse): string {
  return exercise.primaryMuscles.map((muscle) => MUSCLE_GROUP_DISPLAY_NAMES[muscle]).join(' · ');
}

/** Mirrors `s_library()`'s `match`, upgraded per §8: FTS5 search when there is a query
 * (still a superset of "case-insensitive substring on the name"), plain column filters
 * otherwise -- category/favourite are not text queries, so routing them through FTS5 buys
 * nothing over the WHERE clauses `listCachedExercises` already runs. */
async function loadExercises(
  db: SqliteConnection,
  filter: LibraryFilter,
  query: string,
): Promise<ExerciseResponse[]> {
  const trimmed = query.trim();

  if (trimmed) {
    const matches = await searchExercises(db, trimmed);
    if (filter === 'favourites') {
      return matches.filter((exercise) => exercise.isFavourite);
    }
    if (filter !== 'all') {
      return matches.filter((exercise) => exercise.category === filter);
    }
    return matches;
  }

  return listCachedExercises(db, {
    category: filter !== 'all' && filter !== 'favourites' ? filter : undefined,
    favouritesOnly: filter === 'favourites',
  });
}

async function loadRecent(
  db: SqliteConnection,
  filter: LibraryFilter,
  query: string,
): Promise<ExerciseResponse[]> {
  // §3.1: "The Favourites filter suppresses the Recent section entirely."
  if (filter === 'favourites') {
    return [];
  }

  const ids = await getRecentExerciseIds();
  const found = await Promise.all(ids.map((id) => getCachedExercise(db, id)));
  const trimmedQuery = query.trim().toLowerCase();

  return found.filter((exercise): exercise is ExerciseResponse => {
    if (!exercise) return false;
    if (filter !== 'all' && exercise.category !== filter) return false;
    if (trimmedQuery && !exercise.name.toLowerCase().includes(trimmedQuery)) return false;
    return true;
  });
}

export default function LibraryScreen() {
  const params = useLocalSearchParams<{ pick?: string }>();
  const pick = Array.isArray(params.pick) ? params.pick[0] : params.pick;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [items, setItems] = useState<ExerciseResponse[]>([]);
  const [recentItems, setRecentItems] = useState<ExerciseResponse[]>([]);
  const toast = useToast();
  const dbRef = useRef<SqliteConnection | null>(null);

  const refresh = useCallback(async (nextFilter: LibraryFilter, nextQuery: string) => {
    const db = dbRef.current;
    if (!db) return;
    const [list, recent] = await Promise.all([
      loadExercises(db, nextFilter, nextQuery),
      loadRecent(db, nextFilter, nextQuery),
    ]);
    setItems(list);
    setRecentItems(recent);
  }, []);

  // Cache-first render, then a background sync that quietly upgrades the list if the
  // catalogue changed -- ADR-022's whole point: the network is never in this screen's
  // critical path.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const db = await openExerciseCatalogueDb();
      if (cancelled) return;
      // `syncExerciseCatalogue` also calls this, but not until *after* a fetch -- on a
      // fresh device (no cache yet) this screen's own first `refresh()` below would query
      // `exercises_cache`/`exercises_fts` before either table exists. Caught on-device via
      // Expo Go: "no such table: exercises_cache".
      await ensureExerciseCatalogueSchema(db);
      dbRef.current = db;
      await refresh(filter, query);

      try {
        const { synced } = await syncExerciseCatalogue(db, getExerciseCatalogue);
        if (!cancelled && synced) {
          await refresh(filter, query);
        }
      } catch {
        // Offline-first: a failed sync leaves the existing local cache exactly as it was.
        // There is nothing here worth interrupting the browse experience for.
      }
    })();

    return () => {
      cancelled = true;
    };
    // `filter`/`query` deliberately excluded: this effect opens the db and runs once on
    // mount, reading whatever `filter`/`query` are at that instant. Their later changes are
    // handled by the effect below, which reuses the same db handle rather than re-opening it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh(filter, query);
  }, [filter, query, refresh]);

  const title = pick ? 'Add Exercise' : 'Exercise Library';
  // §3.2's table sends `builder`/`live` pick modes back to their own screens, neither of
  // which exists yet (Phase 3) -- every mode goes to `train` until they do, since a pick
  // mode is unreachable in Phase 2 in the first place (§8: only browse mode is reachable).
  const goBack = () => router.replace('/train');

  const onPressRow = (exercise: ExerciseResponse) => {
    // §3.6: only browse mode is reachable in Phase 2 -- `pick` plumbing is carried on the
    // param but the builder/live append destinations do not exist yet.
    router.push(`/exercise/${exercise.id}`);
  };

  const onToggleFavourite = async (exercise: ExerciseResponse) => {
    const db = dbRef.current;
    if (!db) return;
    const next = !exercise.isFavourite;

    // Optimistic: the star flips immediately, and reverts only if the request actually fails.
    await setLocalFavourite(db, exercise.id, next);
    await refresh(filter, query);

    try {
      await setExerciseFavourite(exercise.id, next);
    } catch (cause) {
      await setLocalFavourite(db, exercise.id, !next);
      await refresh(filter, query);
      toast.show(
        classifyRequestFailure(cause) === 'offline'
          ? OFFLINE_MESSAGE
          : 'Could not update favourite. Please try again.',
      );
    }
  };

  const sections = useMemo(() => {
    const built: Array<{ key: string; title: string | null; data: Array<ExerciseResponse | typeof EMPTY_SENTINEL> }> =
      [];
    if (recentItems.length > 0) {
      built.push({ key: 'recent', title: 'Recent', data: recentItems });
    }
    built.push({
      key: 'all',
      title: 'All exercises',
      data: items.length > 0 ? items : [EMPTY_SENTINEL],
    });
    return built;
  }, [items, recentItems]);

  return (
    <ScreenBackground>
      <Header
        title={title}
        onBack={goBack}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New exercise"
            onPress={() => router.push('/new-exercise')}
            className="h-[34px] flex-none flex-row items-center gap-[6px] rounded-[10px] bg-[rgba(233,113,47,.14)] px-[12px]"
            style={({ pressed }) => (pressed ? { backgroundColor: 'rgba(233,113,47,.26)' } : null)}>
            <Icon name="plus" size={14} color={colors.accent} strokeWidth={2} />
            <Text className="font-archivo text-[11.5px] font-bold text-accent">New</Text>
          </Pressable>
        }
      />

      <View className="flex-none px-screen-x pb-[12px]">
        <View
          className="h-[46px] flex-row items-center rounded-field px-[14px]"
          style={{ backgroundColor: colors.fieldBg, borderWidth: 1, borderColor: colors.border, gap: 10 }}>
          <Icon name="search" size={18} color={colors.dimmer} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search exercises…"
            placeholderTextColor={colors.placeholder}
            className="flex-1 font-archivo text-[14px] font-medium text-text"
            style={{ padding: 0 }}
          />
        </View>

        <View className="mt-[12px] flex-row flex-wrap" style={{ gap: 8 }}>
          {FILTER_CHIPS.map((chip) => {
            const selected = filter === chip.id;
            return (
              <Pressable
                key={chip.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setFilter(chip.id)}
                className="rounded-chip px-[15px] py-2"
                style={{
                  backgroundColor: selected ? colors.accent : colors.elevated,
                  borderWidth: selected ? 0 : 1,
                  borderColor: colors.border,
                }}>
                <Text
                  className="font-archivo text-chip font-semibold"
                  style={{ color: selected ? '#fff' : colors.dim }}>
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <SectionList
        className="flex-1 px-screen-x"
        sections={sections}
        keyExtractor={(item, index) => (item === EMPTY_SENTINEL ? `empty-${index}` : item.id)}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 26 }}
        renderSectionHeader={({ section }) => (
          <Text
            className="font-archivo text-section-label font-semibold uppercase text-label"
            style={{ marginTop: section.key === 'recent' ? 6 : 20, marginBottom: 2 }}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => {
          if (item === EMPTY_SENTINEL) {
            return (
              <Text className="font-archivo text-[13px] text-dimmer" style={{ paddingVertical: 26 }}>
                {filter === 'favourites'
                  ? 'No favourite exercises yet — tap a star to add one.'
                  : 'No exercises match.'}
              </Text>
            );
          }

          const exercise = item;
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => onPressRow(exercise)}
              className="flex-row items-center gap-[16px] border-b border-b-borderFaint py-[13px]"
              style={({ pressed }) => (pressed ? { backgroundColor: 'rgba(255,255,255,.025)' } : null)}>
              <View
                className="h-[38px] w-[38px] flex-none items-center justify-center rounded-[9px]"
                style={{ backgroundColor: colors.elevated2 }}>
                <Icon name="dumb" size={20} color={colors.metadata} />
              </View>
              <View className="flex-1" style={{ minWidth: 0 }}>
                <Text className="font-archivo text-row-title font-semibold text-text" numberOfLines={1}>
                  {exercise.name}
                </Text>
                <Text
                  className="mt-[5px] font-archivo text-[11.5px] text-dimmer"
                  numberOfLines={1}>
                  {subtitleOf(exercise)}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={exercise.isFavourite ? 'Remove favourite' : 'Add favourite'}
                onPress={() => onToggleFavourite(exercise)}
                className="h-[32px] w-[32px] flex-none items-center justify-center rounded-[9px]"
                style={({ pressed }) => pressed && { backgroundColor: 'rgba(255,255,255,.07)' }}>
                <Icon
                  name="star"
                  size={19}
                  filled={exercise.isFavourite}
                  color={exercise.isFavourite ? colors.accent : colors.metadata}
                />
              </Pressable>
              <View className="flex-none opacity-50">
                <Icon name="chevron" size={15} color={colors.metadata} />
              </View>
            </Pressable>
          );
        }}
      />

      <TabBar active="train" />
      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
