import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getFood, getMacroGoals, listNutritionLog } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { ConcentricRings, type RingBand } from '@/nutrition/concentric-rings';
import { todayLocalDate } from '@/nutrition/date';
import { type MacroTotals, sumTotals } from '@/nutrition/totals';
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
 *
 * **Background photo picker (post-Phase-J addition).** A small icon button on the preview
 * card itself opens a bottom sheet -- the same absolute-inset scrim + rounded-top sheet shape
 * `nutrition.tsx`'s own Log Meal / Save Meal / Set Goals sheets already use -- offering
 * `expo-image-picker`'s gallery flow (the exact `requestMediaLibraryPermissionsAsync` +
 * `launchImageLibraryAsync` pattern `edit-profile.tsx`/`pick-username.tsx` already established)
 * alongside a new camera flow (`requestCameraPermissionsAsync` + `launchCameraAsync`, nothing
 * else in the app calls yet). The picked/captured photo is downsized client-side with
 * `expo-image-manipulator`'s `manipulateAsync` -- a lightweight resize to `BACKGROUND_PHOTO_MAX_
 * WIDTH`, not a formal pipeline -- before it ever becomes the card's background, so an arbitrary
 * multi-megapixel photo never sits in memory at full resolution behind a preview this small.
 * One photo is shared across all three layouts (`backgroundPhotoUri` lives above `layout`, and
 * nothing about picking or clearing it touches `layout`), replacing the gradient entirely when
 * set, with a `colors.scrim` overlay behind the text/graphics for legibility -- reusing the
 * exact token every other modal backdrop in this app already uses for a dark overlay, rather
 * than inventing a new one. Never uploaded or persisted anywhere: purely local component state,
 * gone on unmount, matching this screen's existing "no backend involvement" scope.
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

// Sized larger than the single ring this replaced (110px/r40) for the same reason as
// nutrition.tsx's dashboard ring: nesting three more bands inward eats into the space the
// centered kcal number needs, so the box grows to protect that legibility rather than
// shrinking the text around the new rings.
const RING_SIZE = 160;
const RING_OUTER_RADIUS = 60;
const RING_STROKE_WIDTH = 6;
const RING_GAP = 2;
const MAX_MEAL_ITEMS = 7;

function ratio(value: number, goal: number): number {
  return goal <= 0 ? 0 : Math.min(1, value / goal);
}

// The card renders at most a phone-screen width tall (its aspect ratio is fixed at 4:5), so a
// resize target well above any real device's share-card render size still gives headroom for
// pinch-zoom in the OS photo viewer without keeping a multi-megapixel original in memory.
const BACKGROUND_PHOTO_MAX_WIDTH = 1080;
const GALLERY_PERMISSION_MESSAGE = 'Photo access is needed to set a background.';
const CAMERA_PERMISSION_MESSAGE = 'Camera access is needed to take a photo.';
const PHOTO_SET_FAILED_MESSAGE = 'Could not set that photo. Please try again.';

const MACRO_ROWS: Array<{ label: string; key: 'protein' | 'carbs' | 'fat'; color: string }> = [
  { label: 'Protein', key: 'protein', color: colors.protein },
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
  // Deliberately independent of `layout` -- one photo behind the card regardless of which
  // preview is showing, per the feature's own "shared, not per-layout" requirement.
  const [backgroundPhotoUri, setBackgroundPhotoUri] = useState<string | null>(null);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);

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
  const activeLayout = SHARE_LAYOUTS.find((candidate) => candidate.id === layout) ?? SHARE_LAYOUTS[0];

  const selectLayout = (id: ShareLayoutId) => () => setLayout(id);
  const saveImage = () => toast.show('Image saved to Photos');
  const shareTo = (label: string) => () => toast.show(`Sharing to ${label}…`);

  const openPhotoSheet = () => setPhotoSheetOpen(true);
  const closePhotoSheet = () => setPhotoSheetOpen(false);
  const removeBackgroundPhoto = () => {
    setBackgroundPhotoUri(null);
    closePhotoSheet();
  };

  // Shared by both the gallery and camera flows below: a lightweight client-side downsize
  // (not a formal pipeline) so an arbitrary multi-megapixel original never sits behind this
  // small preview card at full resolution.
  const applyPickedPhoto = async (uri: string) => {
    try {
      const resized = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: BACKGROUND_PHOTO_MAX_WIDTH } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
      );
      setBackgroundPhotoUri(resized.uri);
      closePhotoSheet();
    } catch {
      toast.show(PHOTO_SET_FAILED_MESSAGE);
    }
  };

  const pickFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.show(GALLERY_PERMISSION_MESSAGE);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 5],
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) {
      return;
    }

    await applyPickedPhoto(result.assets[0].uri);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      toast.show(CAMERA_PERMISSION_MESSAGE);
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 5],
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) {
      return;
    }

    await applyPickedPhoto(result.assets[0].uri);
  };

  return (
    <ScreenBackground>
      <Header title="Share Nutrition" onBack={() => router.push('/nutrition')} />

      <ScrollView className="flex-1 px-screen-x" showsVerticalScrollIndicator={false}>
        {goals ? (
          <>
            <View
              className="border border-border"
              style={{ aspectRatio: 4 / 5, borderRadius: 18, overflow: 'hidden' }}>
              {backgroundPhotoUri ? (
                <Image
                  testID="share-card-background-photo"
                  source={{ uri: backgroundPhotoUri }}
                  resizeMode="cover"
                  style={StyleSheet.absoluteFillObject}
                />
              ) : (
                <LinearGradient
                  colors={activeLayout.gradientColors}
                  start={SHARE_GRADIENT_START}
                  end={SHARE_GRADIENT_END}
                  style={StyleSheet.absoluteFillObject}
                />
              )}
              {/* The legibility scrim -- only over a photo background, since the gradients are
                  already dark enough on their own. Reuses `colors.scrim`, the exact token every
                  other modal backdrop in this app already uses for a dark overlay. */}
              {backgroundPhotoUri && (
                <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.scrim }]} />
              )}
              <View style={{ flex: 1, paddingVertical: 26, paddingHorizontal: 20 }}>
                <Text className="font-archivo text-[13px] font-extrabold uppercase text-accent" style={{ letterSpacing: 0.8 }}>
                  FORJD
                </Text>
                <View className="flex-1">
                  {layout === 'summary' ? (
                    <SummaryPreview totals={totals} goals={goals} />
                  ) : layout === 'macros' ? (
                    <MacrosPreview totals={totals} goals={goals} />
                  ) : (
                    <MealsPreview totals={totals} items={log} foodsById={foodsById} />
                  )}
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Background photo"
                onPress={openPhotoSheet}
                className="absolute items-center justify-center rounded-full"
                style={{ right: 12, top: 12, width: 34, height: 34, backgroundColor: colors.scrim }}>
                <Icon name="camera" color={colors.text} size={16} />
              </Pressable>
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

      {photoSheetOpen ? (
        <View
          testID="background-photo-sheet"
          className="absolute inset-0 z-20 items-end justify-end"
          style={{ backgroundColor: colors.scrim }}>
          <View
            className="w-full rounded-t-[18px] border-t border-border bg-surface px-[22px] pb-[24px] pt-[20px]"
            style={{ gap: 10 }}>
            <Text className="font-archivo text-[18px] font-bold text-text">Background photo</Text>
            <Text className="mb-[4px] font-archivo text-[13px] text-dimmer">
              Use a photo of your own behind the card, in place of the gradient.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={takePhoto}
              className="h-[52px] flex-row items-center rounded-button border border-border bg-elevated px-[16px]"
              style={{ gap: 12 }}>
              <Icon name="camera" color={colors.text} size={18} />
              <Text className="font-archivo text-[14px] font-semibold text-text">Take Photo</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={pickFromGallery}
              className="h-[52px] flex-row items-center rounded-button border border-border bg-elevated px-[16px]"
              style={{ gap: 12 }}>
              <Icon name="upload" color={colors.text} size={18} />
              <Text className="font-archivo text-[14px] font-semibold text-text">Choose from Gallery</Text>
            </Pressable>
            {backgroundPhotoUri && (
              <Pressable
                accessibilityRole="button"
                onPress={removeBackgroundPhoto}
                className="h-[52px] flex-row items-center rounded-button border border-border bg-elevated px-[16px]"
                style={{ gap: 12 }}>
                <Icon name="x" color={colors.destructive} size={18} />
                <Text className="font-archivo text-[14px] font-semibold" style={{ color: colors.destructive }}>
                  Remove Photo
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={closePhotoSheet}
              className="mt-[4px] h-[52px] items-center justify-center rounded-button border border-border">
              <Text className="font-archivo text-[14px] font-bold text-dim">Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Toast message={toast.message} />
    </ScreenBackground>
  );
}

interface SummaryPreviewProps {
  totals: MacroTotals;
  goals: MacroGoalsResponse;
}

function SummaryPreview({ totals, goals }: SummaryPreviewProps) {
  return (
    <View className="flex-1 items-center justify-center" style={{ gap: 14 }}>
      <ConcentricRings
        size={RING_SIZE}
        outerRadius={RING_OUTER_RADIUS}
        strokeWidth={RING_STROKE_WIDTH}
        gap={RING_GAP}
        trackColor={colors.shareRingTrack}
        bands={
          [
            { key: 'calories', color: colors.accent, filled: ratio(totals.kcal, goals.kcal) },
            { key: 'protein', color: colors.protein, filled: ratio(totals.protein, goals.protein) },
            { key: 'carbs', color: colors.nutritionCarbs, filled: ratio(totals.carbs, goals.carbs) },
            { key: 'fat', color: colors.green, filled: ratio(totals.fat, goals.fat) },
          ] satisfies RingBand[]
        }>
        <Text className="font-archivo text-[22px] font-bold text-text" style={{ fontVariant: ['tabular-nums'] }}>
          {Math.round(totals.kcal)}
        </Text>
        <Text className="mt-0.5 font-archivo text-[10px] text-dimmer">{`/ ${goals.kcal} kcal`}</Text>
      </ConcentricRings>
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
