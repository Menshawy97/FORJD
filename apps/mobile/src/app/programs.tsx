import {
  PROGRAM_CATEGORIES,
  PROGRAM_CATEGORY_DISPLAY_NAMES,
  PROGRAM_LEVEL_DISPLAY_NAMES,
  type ProgramCategory,
} from '@forjd/domain';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { listPrograms } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';
import { colors } from '@/theme/tokens';

import type { ProgramSummary } from '@forjd/contracts';

/**
 * `s_catalog()` -- the program catalogue (Phase 3K4).
 *
 * **There is no screenshot for this screen.** `screenshots/program.png` is the *overview*, one
 * level down. So the prototype is the authority here, and its geometry is transcribed rather than
 * approximated: rows are `CARD` on `BRD` at radius 14 with `15px 16px` padding and `gap:9` between
 * them; the name is `700 15.5px/1.2`, the meta line `500 11px/1` in the accent colour with tabular
 * numerals, the level pill `5px 9px` at radius 7 on `#1b1c1e`, and the description `400 12px/1.45`
 * at `marginTop:9`.
 *
 * **The filter chips are the design's own, minus one.** The prototype's list is
 * `['All','Favourites','Strength','Hybrid','Running','Cross Training']`. `Favourites` is **not
 * shipped**: program favourites (`toggleFavProgram`) have no backing anywhere in this system --
 * the same gap Train's header star has had since Phase G -- and a chip that always showed an empty
 * list would be worse than one that is not there. The star on each row is omitted for the same
 * reason, and both are recorded as known gaps in `phase-3k-plan.md`.
 *
 * **`scope` is never varied here.** It defaults to `preset`, which is what stops this screen ever
 * showing a program the athlete built; Train's "My programs" (K5) is the caller that passes
 * `mine`. Forgetting the parameter yields the catalogue rather than a mixed list, which is the
 * whole reason the default is that way round.
 */

/** `All` plus the four real categories, in the prototype's order. */
type Filter = 'all' | ProgramCategory;

const FILTERS: Filter[] = ['all', ...PROGRAM_CATEGORIES];

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All',
  ...PROGRAM_CATEGORY_DISPLAY_NAMES,
};

/** The design's `4 days · 8 weeks`, assembled here so the server never ships a sentence. */
export function formatProgramMeta(daysPerWeek: number, durationWeeks: number): string {
  return `${daysPerWeek} days · ${durationWeeks} weeks`;
}

export default function ProgramsScreen() {
  const [filter, setFilter] = useState<Filter>('all');
  const [programs, setPrograms] = useState<ProgramSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (next: Filter) => {
    setError(null);
    try {
      const response = await listPrograms(
        next === 'all' ? { scope: 'preset' } : { scope: 'preset', category: next },
      );
      setPrograms(response.items);
    } catch (cause) {
      setPrograms(null);
      setError(
        classifyRequestFailure(cause) === 'offline'
          ? OFFLINE_MESSAGE
          : 'Could not load programs. Please try again.',
      );
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  return (
    <ScreenBackground>
      <Header title="Programs" onBack={() => router.back()} />

      {/* Prototype: the chip row is `flex:'none'` with `padding:'0 22px 14px'`. */}
      <View className="flex-none px-screen-x pb-[14px]">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}>
          {FILTERS.map((candidate) => {
            const isSelected = candidate === filter;
            return (
              <Pressable
                key={candidate}
                accessibilityRole="button"
                accessibilityLabel={`Show ${FILTER_LABELS[candidate]} programs`}
                accessibilityState={{ selected: isSelected }}
                onPress={() => setFilter(candidate)}
                className="rounded-[9px] px-[13px] py-[8px]"
                style={{
                  backgroundColor: isSelected ? 'rgba(233,113,47,.14)' : colors.surface,
                  borderWidth: 1,
                  borderColor: isSelected ? 'rgba(233,113,47,.45)' : colors.border,
                }}>
                <Text
                  className="font-archivo text-[12px] font-semibold"
                  style={{ color: isSelected ? colors.accent : '#8B8B83' }}>
                  {FILTER_LABELS[candidate]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        {error ? (
          <Text className="font-archivo text-[13px]" style={{ color: colors.accent }}>
            {error}
          </Text>
        ) : null}

        {/*
          An empty result is a real state -- filtering to a category with no programs -- and says
          so rather than showing a spinner that never resolves. `null` is "still loading".
        */}
        {!error && programs !== null && programs.length === 0 ? (
          <Text className="font-archivo text-[13px]" style={{ color: '#77776F' }}>
            No programs in this category yet.
          </Text>
        ) : null}

        <View style={{ gap: 9 }}>
          {(programs ?? []).map((program) => (
            <Pressable
              key={program.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${program.name}`}
              onPress={() => router.push({ pathname: '/program/[id]', params: { id: program.id } })}
              className="rounded-[14px] px-[16px] py-[15px]"
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
              }}>
              <View className="flex-row items-start justify-between" style={{ gap: 10 }}>
                <View className="min-w-0 flex-1">
                  <Text
                    className="font-archivo text-[15.5px] font-bold"
                    style={{ color: colors.text }}>
                    {program.name}
                  </Text>
                  <Text
                    className="mt-[7px] font-archivo text-[11px] font-medium"
                    style={{ color: colors.accent, fontVariant: ['tabular-nums'] }}>
                    {formatProgramMeta(program.daysPerWeek, program.durationWeeks)}
                  </Text>
                </View>

                <View
                  className="flex-none rounded-[7px] px-[9px] py-[5px]"
                  style={{ backgroundColor: '#1B1C1E' }}>
                  <Text
                    className="font-archivo text-[10px] font-semibold"
                    style={{ color: '#8B8B83' }}>
                    {PROGRAM_LEVEL_DISPLAY_NAMES[program.level]}
                  </Text>
                </View>
              </View>

              {program.description ? (
                <Text
                  className="mt-[9px] font-archivo text-[12px]"
                  style={{ color: '#6E6E66', lineHeight: 17 }}>
                  {program.description}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <TabBar active="train" />
    </ScreenBackground>
  );
}
