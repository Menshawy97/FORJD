import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { getFood, getMacroGoals, listNutritionLog } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { todayLocalDate } from '@/nutrition/date';
import { colors } from '@/theme/tokens';

import type { FoodResponse, MacroGoalsResponse, NutritionLogEntryResponse } from '@forjd/contracts';

/**
 * `s_nutritionShare()` -- the dashboard's share icon target. No design screenshot existed when
 * Phase G was planned, but four real ones surfaced mid-Phase-J (`nutritionShare1.png` through
 * `nutritionShare4.png`) and were used as the primary fidelity check here, over the prototype:
 * back chevron + "Share Nutrition" header, a 4:5 preview card whose gradient background and
 * inner content change per layout, three layout-thumbnail choices below it (only the selected
 * one gets the 2px accent border -- the other two keep the ordinary hairline border, not no
 * border at all), then an orange "Save Image" button and two equal-width secondary buttons.
 * The Meal Log layout's per-item kcal renders in the accent colour, not a dim grey -- confirmed
 * by `nutritionShare4.png` and already what the prototype's own `color:O` said.
 *
 * **Data.** Reuses `nutrition.tsx`'s already-fetched shapes rather than adding new client
 * functions: `listNutritionLog(today)` for the log, `getMacroGoals()` for the goal (`.catch`
 * to `null`, same as `nutrition.tsx`), and the same `foodsById` client-side name-resolution
 * pattern (`getFood` per distinct `foodId`, deduplicated) -- `NutritionLogEntryResponse` still
 * carries no food name, per that screen's own docblock.
 *
 * **Adaptation: a goals gate, not in the prototype.** The prototype's demo state always has
 * `macroGoals` populated, so `s_nutritionShare()` divides by `g.kcal` unconditionally. The real
 * app can reach this screen with no goals ever set (`nutrition.tsx` itself gates its ring the
 * same way, with "Set your daily goals"). Rather than fabricate a default goal to divide by,
 * this screen shows an honest prompt back to the dashboard instead of the preview -- the same
 * honest-empty-state principle `nutrition.tsx`'s own goals card already applies, not a new one.
 *
 * **Adaptation, a deliberate scope reduction, decided up front (see `nutrition-plan.md`):**
 * Save Image / Instagram / More are mocked exactly as the prototype's own `flash(...)` calls
 * are -- a toast-only confirmation, nothing written to the device and nothing shared. This
 * codebase has no `expo-media-library`, `react-native-view-shot`, or `react-native-share`
 * dependency, and none is added here: real device capture/sharing is out of scope for this
 * lowest-priority phase, not a bug to silently "fix" by reaching for new native permissions.
 *
 * No TabBar: like the prototype, this screen has no `this.tabbar()` call -- it is a sub-screen
 * reached via the dashboard's header icon, not a tab destination.
 */

type ShareLayoutId = 'summary' | 'macros' | 'meals';

interface ShareLayoutMeta {
  id: ShareLayoutId;
  label: string;
  description: string;
  gradientColors: [string, string];
}

// Hex values straight from the prototype's `layouts` array (`s_nutritionShare()`), one gradient
// per layout, named here rather than left as inline magic strings.
const SHARE_LAYOUTS: ShareLayoutMeta[] = [
  { id: 'summary', label: 'Daily Summary', description: 'Calories vs goal, at a glance', gradientColors: ['#1D1408', '#101011'] },
  { id: 'macros', label: 'Macro Split', description: 'Protein · Carbs · Fat breakdown', gradientColors: ['#0D1710', '#101011'] },
  { id: 'meals', label: 'Meal Log', description: 'Everything logged today', gradientColors: ['#14161D', '#101011'] },
];

// The prototype's gradients are CSS `linear-gradient(160deg, ...)`. expo-linear-gradient takes
// fractional start/end points instead of an angle, derived via the standard CSS gradient-line
// formula: direction (dx, dy) = (sin theta, -cos theta); for a unit box the line's half-length
// is (|dx| + |dy|) / 2; start = centre - direction * half-length, end = centre + direction *
// half-length. (This is the same formula that gives 135deg its well-known {0,0}->{1,1} corners
// -- verified here for the non-45-degree-multiple angle this design actually uses.)
const SHARE_GRADIENT_START = { x: 0.2808, y: -0.1022 };
const SHARE_GRADIENT_END = { x: 0.7192, y: 1.1022 };

const RING_SIZE = 110;
const RING_RADIUS = 40;
const RING_STROKE_WIDTH = 8;
const RING_CENTER = RING_SIZE / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const MAX_MEAL_ITEMS = 7;

interface MacroTotals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

const EMPTY_TOTALS: MacroTotals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

function sumTotals(entries: NutritionLogEntryResponse[]): MacroTotals {
  return entries.reduce<MacroTotals>(
    (totals, entry) => ({
      kcal: totals.kcal + entry.kcal,
      protein: totals.protein + entry.protein,
      carbs: totals.carbs + entry.carbs,
      fat: totals.fat + entry.fat,
    }),
    EMPTY_TOTALS,
  );
}

const MACRO_ROWS: Array<{ label: string; key: 'protein' | 'carbs' | 'fat'; color: string }> = [
  { label: 'Protein', key: 'protein', color: colors.accent },
  { label: 'Carbs', key: 'carbs', color: colors.nutritionCarbs },
  { label: 'Fat', key: 'fat', color: colors.green },
];

function errorMessage(error: unknown): string {
  return classifyRequestFailure(error) === 'offline' ? OFFLINE_MESSAGE : 'Something went wrong. Try again.';
}

export default function NutritionShareScreen() {
  const toast = useToast();
  const today = useMemo(() => todayLocalDate(), []);

  const [log, setLog] = useState<NutritionLogEntryResponse[]>([]);
  const [goals, setGoals] = useState<MacroGoalsResponse | null>(null);
  const [foodsById, setFoodsById] = useState<Record<string, FoodResponse>>({});
  const [layout, setLayout] = useState<ShareLayoutId>('summary');

  const loadAll = useCallback(async () => {
    try {
      const [logResult, goalsResult] = await Promise.all([listNutritionLog(today), getMacroGoals().catch(() => null)]);
      const foodIds = [...new Set(logResult.items.map((entry) => entry.foodId))];
      const foods = await Promise.all(foodIds.map((id) => getFood(id)));
      const nextFoodsById: Record<string, FoodResponse> = {};
      foods.forEach((food) => {
        nextFoodsById[food.id] = food;
      });
      setLog(logResult.items);
      setGoals(goalsResult);
      setFoodsById(nextFoodsById);
    } catch (error) {
      toast.show(errorMessage(error));
    }
    // Same rationale as nutrition.tsx's loadAll: `toast` is a fresh object every render, only
    // `toast.show` is stable -- depending on the whole object would refetch forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, toast.show]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const totals = useMemo(() => sumTotals(log), [log]);
  const pct = goals ? Math.min(1, totals.kcal / goals.kcal) : 0;
  const activeLayout = SHARE_LAYOUTS.find((candidate) => candidate.id === layout) ?? SHARE_LAYOUTS[0];

  const selectLayout = (id: ShareLayoutId) => () => setLayout(id);
  const saveImage = () => toast.show('Image saved to Photos');
  const shareTo = (label: string) => () => toast.show(`Sharing to ${label}…`);

  return (
    <ScreenBackground>
      <Header title="Share Nutrition" onBack={() => router.push('/nutrition')} />

      <ScrollView className="flex-1 px-screen-x" showsVerticalScrollIndicator={false}>
        {goals ? (
          <>
            <View style={{ borderRadius: 18, overflow: 'hidden' }}>
              <LinearGradient
                colors={activeLayout.gradientColors}
                start={SHARE_GRADIENT_START}
                end={SHARE_GRADIENT_END}
                className="border border-border"
                style={{ aspectRatio: 4 / 5, borderRadius: 18, paddingVertical: 26, paddingHorizontal: 20 }}>
                <Text className="font-archivo text-[13px] font-extrabold uppercase text-accent" style={{ letterSpacing: 0.8 }}>
                  FORJD
                </Text>
                <View className="flex-1">
                  {layout === 'summary' ? (
                    <SummaryPreview totals={totals} goals={goals} pct={pct} />
                  ) : layout === 'macros' ? (
                    <MacrosPreview totals={totals} goals={goals} />
                  ) : (
                    <MealsPreview totals={totals} items={log} foodsById={foodsById} />
                  )}
                </View>
              </LinearGradient>
            </View>

            <Text className="mb-[10px] mt-[22px] font-archivo text-[11px] font-semibold uppercase tracking-wide text-label">
              Choose a layout
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row" style={{ gap: 10 }}>
                {SHARE_LAYOUTS.map((candidate) => {
                  const selected = candidate.id === layout;
                  return (
                    <Pressable
                      key={candidate.id}
                      accessibilityRole="button"
                      accessibilityLabel={candidate.label}
                      onPress={selectLayout(candidate.id)}
                      style={{ width: 100 }}>
                      <LinearGradient
                        colors={candidate.gradientColors}
                        start={SHARE_GRADIENT_START}
                        end={SHARE_GRADIENT_END}
                        style={{
                          width: 100,
                          height: 125,
                          borderRadius: 12,
                          borderWidth: selected ? 2 : 1,
                          borderColor: selected ? colors.accent : colors.border,
                        }}
                      />
                      <Text
                        className="mt-[7px] font-archivo text-[11.5px] font-semibold"
                        style={{ color: selected ? colors.accent : colors.text }}>
                        {candidate.label}
                      </Text>
                      <Text className="mt-[3px] font-archivo text-[10px] text-dimmer">{candidate.description}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            <View style={{ gap: 10, marginTop: 24, marginBottom: 24 }}>
              <Pressable
                accessibilityRole="button"
                onPress={saveImage}
                className="h-[52px] items-center justify-center rounded-button bg-accent">
                <Text className="font-archivo text-[14px] font-bold text-white">Save Image</Text>
              </Pressable>
              <View className="flex-row" style={{ gap: 10 }}>
                {['Instagram', 'More'].map((label) => (
                  <Pressable
                    key={label}
                    accessibilityRole="button"
                    onPress={shareTo(label)}
                    className="h-12 flex-1 items-center justify-center rounded-[11px] border border-border bg-surface">
                    <Text className="font-archivo text-[12.5px] font-semibold text-text">{label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/nutrition')}
            className="mt-1.5 rounded-card border border-border bg-surface p-[18px]">
            <Text className="font-archivo text-[15px] font-bold text-text">Set your daily goals first</Text>
            <Text className="mt-1 font-archivo text-[12.5px] text-dimmer">
              A share card needs a calorie goal to compare against. Set one on the nutrition dashboard.
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <Toast message={toast.message} />
    </ScreenBackground>
  );
}

interface SummaryPreviewProps {
  totals: MacroTotals;
  goals: MacroGoalsResponse;
  pct: number;
}

function SummaryPreview({ totals, goals, pct }: SummaryPreviewProps) {
  return (
    <View className="flex-1 items-center justify-center" style={{ gap: 14 }}>
      <View style={{ width: RING_SIZE, height: RING_SIZE }}>
        <View style={{ width: RING_SIZE, height: RING_SIZE, transform: [{ rotate: '-90deg' }] }}>
          <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
            <Circle
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_RADIUS}
              fill="none"
              stroke="rgba(255,255,255,.1)"
              strokeWidth={RING_STROKE_WIDTH}
            />
            <Circle
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_RADIUS}
              fill="none"
              stroke={colors.accent}
              strokeWidth={RING_STROKE_WIDTH}
              strokeLinecap="round"
              strokeDasharray={`${RING_CIRCUMFERENCE}`}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - pct)}
            />
          </Svg>
        </View>
        <View className="absolute inset-0 items-center justify-center">
          <Text className="font-archivo text-[22px] font-bold text-text" style={{ fontVariant: ['tabular-nums'] }}>
            {Math.round(totals.kcal)}
          </Text>
          <Text className="mt-0.5 font-archivo text-[10px] text-dimmer">{`/ ${goals.kcal} kcal`}</Text>
        </View>
      </View>
      <Text className="font-archivo text-[15px] font-bold text-text" style={{ textAlign: 'center' }}>
        Today’s intake
      </Text>
    </View>
  );
}

interface MacrosPreviewProps {
  totals: MacroTotals;
  goals: MacroGoalsResponse;
}

function MacrosPreview({ totals, goals }: MacrosPreviewProps) {
  return (
    <View className="flex-1 justify-center" style={{ gap: 16 }}>
      <Text className="font-archivo text-[22px] font-bold text-text">{`${Math.round(totals.kcal)} kcal`}</Text>
      {MACRO_ROWS.map(({ label, key, color }) => {
        const value = totals[key];
        const goal = goals[key];
        const width = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
        return (
          <View key={label}>
            <View className="flex-row items-center justify-between" style={{ marginBottom: 6 }}>
              <Text className="font-archivo text-[12px] font-semibold text-text">{label}</Text>
              <Text className="font-archivo text-[12px] text-dimmer">{`${Math.round(value)}g / ${goal}g`}</Text>
            </View>
            <View style={{ height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,.1)', overflow: 'hidden' }}>
              <View style={{ width: `${width}%`, height: 7, borderRadius: 4, backgroundColor: color }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

interface MealsPreviewProps {
  totals: MacroTotals;
  items: NutritionLogEntryResponse[];
  foodsById: Record<string, FoodResponse>;
}

function MealsPreview({ totals, items, foodsById }: MealsPreviewProps) {
  const shown = items.slice(0, MAX_MEAL_ITEMS);
  return (
    <View className="flex-1" style={{ gap: 10, marginTop: 4, overflow: 'hidden' }}>
      <Text className="font-archivo text-[17px] font-bold text-text">{`${Math.round(totals.kcal)} kcal total`}</Text>
      {shown.map((item) => (
        <View key={item.id} className="flex-row items-center" style={{ gap: 10 }}>
          <Text
            className="flex-1 font-archivo text-[12.5px] font-semibold text-text"
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ minWidth: 0 }}>
            {foodsById[item.foodId]?.name ?? '…'}
          </Text>
          <Text className="font-archivo text-[11.5px] font-semibold text-accent" style={{ flexShrink: 0 }}>
            {`${Math.round(item.kcal)} kcal`}
          </Text>
        </View>
      ))}
    </View>
  );
}
