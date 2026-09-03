import {
  EQUIPMENT_DISPLAY_NAMES,
  EXERCISE_CATEGORIES,
  EXERCISE_CATEGORY_DISPLAY_NAMES,
  MUSCLE_GROUP_DISPLAY_NAMES,
  type Equipment,
  type ExerciseCategory,
  type ExerciseMeasure,
  type MuscleGroup,
} from '@forjd/domain';
import type { CreateExerciseRequest } from '@forjd/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { createExercise, getExerciseCatalogue, updateExercise } from '@/auth/apiClient';
import { classifyRequestFailure, isConflict, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import {
  ensureExerciseCatalogueSchema,
  getCachedExercise,
  openExerciseCatalogueDb,
  syncExerciseCatalogue,
  type SqliteConnection,
} from '@/store/exercise-catalogue';
import { colors } from '@/theme/tokens';

/**
 * `s_newExercise()`, `docs/design/design-revision-screen-specs.md` §3 -- the revised,
 * authoritative spec (`docs/design/phase2-screen-specs.md` §6 was written against the
 * pre-revision sketch and is superseded). One screen serves both create and edit, keyed by
 * the `id` search param.
 *
 * **Vocabulary subset, not the full canonical enum.** `MUSCLE_SUBSET`/`EQUIPMENT_SUBSET`
 * below are the prototype's own 13/12-chip lists, confirmed against three reference
 * screenshots (`custom exercise1.png`, `custom exercise2.png`, `editcustomexercise.png`) --
 * not just the interactive prototype. `packages/domain`'s full `MUSCLE_GROUPS`/`EQUIPMENT`
 * stay reachable only through the ingest adapter (Phase D), never through this picker.
 *
 * **No delete control here.** The prototype's own header call
 * (`this.hdr(editing?'Edit Exercise':'New Exercise', this.go('library'))`) passes no `right`
 * argument, and none of the reference screenshots show one. Delete lives on the exercise
 * detail screen instead (Phase J, confirmed by `deletecustomexercise.png`).
 */

const MUSCLE_SUBSET: readonly MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'core', 'glutes', 'quads',
  'hamstrings', 'calves', 'hips', 'full_body',
];

const EQUIPMENT_SUBSET: readonly Equipment[] = [
  'barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'band', 'bodyweight', 'bench',
  'rack', 'medicine_ball', 'trx', 'sled',
];

const MEASURE_OPTIONS: ReadonlyArray<{ value: ExerciseMeasure; label: string }> = [
  { value: 'weight', label: 'Weight × reps' },
  { value: 'time', label: 'Time' },
  { value: 'distance', label: 'Distance' },
];

function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function describeFailure(error: unknown): string {
  return classifyRequestFailure(error) === 'offline'
    ? OFFLINE_MESSAGE
    : 'Could not save the exercise. Please try again.';
}

export default function NewExerciseScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = Array.isArray(params.id) ? params.id[0] : params.id;
  const editing = typeof editingId === 'string';

  const [name, setName] = useState('');
  const [muscles, setMuscles] = useState<MuscleGroup[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ExerciseCategory>('strength');
  const [measure, setMeasure] = useState<ExerciseMeasure>('weight');
  const [loaded, setLoaded] = useState(!editing);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const dbRef = useRef<SqliteConnection | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const db = await openExerciseCatalogueDb();
      if (cancelled) return;
      await ensureExerciseCatalogueSchema(db);
      dbRef.current = db;

      if (editing) {
        const existing = await getCachedExercise(db, editingId);
        if (cancelled || !existing) return;
        setName(existing.name);
        setMuscles([...existing.primaryMuscles]);
        setEquipment([...existing.equipment]);
        setDescription(existing.description ?? '');
        setCategory(existing.category);
        setMeasure(existing.measure);
        setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editing, editingId]);

  const goBack = () => router.replace('/library');

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.show('Give the exercise a name first');
      return;
    }
    if (muscles.length === 0) {
      toast.show('Pick at least one muscle worked');
      return;
    }
    if (equipment.length === 0) {
      toast.show('Pick at least one piece of equipment');
      return;
    }

    const body: CreateExerciseRequest = {
      name: trimmedName,
      category,
      measure,
      primaryMuscles: muscles,
      equipment,
      description: description.trim() || undefined,
    };

    setSaving(true);
    try {
      if (editing) {
        await updateExercise(editingId, body);
      } else {
        await createExercise(body);
      }

      const db = dbRef.current;
      if (db) {
        try {
          await syncExerciseCatalogue(db, getExerciseCatalogue);
        } catch {
          // Offline-first: the save itself already succeeded against the server: a failed
          // re-sync just means the local mirror catches up on the next successful one.
        }
      }

      router.replace({
        pathname: '/library',
        params: { toast: `${trimmedName}${editing ? ' updated' : ' added to your library'}` },
      });
    } catch (cause) {
      setSaving(false);
      toast.show(isConflict(cause) ? 'An exercise with that name already exists' : describeFailure(cause));
    }
  };

  if (editing && !loaded) {
    return (
      <ScreenBackground>
        <Header title="Edit Exercise" onBack={goBack} />
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <Header title={editing ? 'Edit Exercise' : 'New Exercise'} onBack={goBack} />

      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 16 }}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled">
        <Text className="font-archivo text-section-label font-semibold uppercase text-label">
          Exercise name
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Landmine Press"
          placeholderTextColor={colors.placeholder}
          className="h-[50px] rounded-field border border-border bg-fieldBg px-[15px] font-archivo text-[14.5px] font-semibold text-text"
          style={{ marginTop: 9 }}
        />

        <Text
          className="font-archivo text-section-label font-semibold uppercase text-label"
          style={{ marginTop: 24, marginBottom: 4 }}>
          Muscles worked
        </Text>
        <Text
          className="font-archivo text-[11px] text-legal"
          style={{ lineHeight: 15.4, marginBottom: 10 }}>
          Pick one or more
        </Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {MUSCLE_SUBSET.map((muscle) => (
            <SelectChip
              key={muscle}
              label={MUSCLE_GROUP_DISPLAY_NAMES[muscle]}
              // "Back" the muscle would otherwise collide with the header's own "Back"
              // button -- every chip gets the same disambiguating suffix for consistency.
              accessibilityLabel={`${MUSCLE_GROUP_DISPLAY_NAMES[muscle]} muscle`}
              selected={muscles.includes(muscle)}
              onPress={() => setMuscles((current) => toggleIn(current, muscle))}
            />
          ))}
        </View>

        <Text
          className="font-archivo text-section-label font-semibold uppercase text-label"
          style={{ marginTop: 24, marginBottom: 4 }}>
          Equipment used
        </Text>
        <Text
          className="font-archivo text-[11px] text-legal"
          style={{ lineHeight: 15.4, marginBottom: 10 }}>
          Pick one or more
        </Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {EQUIPMENT_SUBSET.map((item) => (
            <SelectChip
              key={item}
              label={EQUIPMENT_DISPLAY_NAMES[item]}
              accessibilityLabel={`${EQUIPMENT_DISPLAY_NAMES[item]} equipment`}
              selected={equipment.includes(item)}
              onPress={() => setEquipment((current) => toggleIn(current, item))}
            />
          ))}
        </View>

        <Text
          className="font-archivo text-section-label font-semibold uppercase text-label"
          style={{ marginTop: 24, marginBottom: 4 }}>
          Description
        </Text>
        <Text
          className="font-archivo text-[11px] text-legal"
          style={{ lineHeight: 15.4, marginBottom: 10 }}>
          Optional — cues, setup or form notes
        </Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="e.g. Brace the core, elbows tucked at 45°, drive through the mid-foot."
          placeholderTextColor={colors.placeholder}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          className="min-h-[96px] rounded-field border border-border bg-fieldBg px-[15px] py-[13px] font-archivo text-[13.5px] text-text"
          style={{ lineHeight: 21.6 }}
        />

        <Text
          className="font-archivo text-section-label font-semibold uppercase text-label"
          style={{ marginTop: 24, marginBottom: 10 }}>
          Category
        </Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {EXERCISE_CATEGORIES.map((value) => {
            const selected = category === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={EXERCISE_CATEGORY_DISPLAY_NAMES[value]}
                accessibilityState={{ selected }}
                onPress={() => setCategory(value)}
                className="rounded-chip px-[14px] py-[9px]"
                style={{
                  backgroundColor: selected ? colors.accent : colors.elevated,
                  borderWidth: 1,
                  borderColor: selected ? colors.accent : colors.border,
                }}>
                <Text
                  className="font-archivo text-[12.5px] font-semibold"
                  style={{ color: selected ? '#fff' : colors.dim }}>
                  {EXERCISE_CATEGORY_DISPLAY_NAMES[value]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text
          className="font-archivo text-section-label font-semibold uppercase text-label"
          style={{ marginTop: 24, marginBottom: 10 }}>
          Measured by
        </Text>
        <View className="flex-row" style={{ gap: 8 }}>
          {MEASURE_OPTIONS.map((option) => {
            const selected = measure === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ selected }}
                onPress={() => setMeasure(option.value)}
                className="flex-1 items-center rounded-[10px] px-[6px] py-[12px]"
                style={{
                  minWidth: 0,
                  backgroundColor: selected ? colors.pickRowSelectedBg : colors.surface,
                  borderWidth: 1,
                  borderColor: selected ? colors.accent : colors.border,
                }}>
                <Text
                  className="font-archivo text-[12px] font-semibold"
                  style={{ color: selected ? colors.accent : colors.textTertiary }}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text className="font-archivo text-[11.5px] text-legal" style={{ lineHeight: 17.25, marginTop: 14 }}>
          Time-based exercises get a set timer during a live workout; distance exercises log
          metres.
        </Text>
      </ScrollView>

      <View className="flex-none border-t px-screen-x pb-6 pt-3" style={{ borderColor: colors.borderCell }}>
        <View style={{ opacity: name.trim() && muscles.length > 0 && equipment.length > 0 ? 1 : 0.5 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Save Changes' : 'Save Exercise'}
            accessibilityState={{ disabled: saving }}
            onPress={handleSave}
            disabled={saving}
            className="h-[52px] items-center justify-center rounded-button bg-accent shadow-primary-button">
            <Text className="font-archivo text-button font-bold text-white">
              {editing ? 'Save Changes' : 'Save Exercise'}
            </Text>
          </Pressable>
        </View>
      </View>
      <Toast message={toast.message} />
    </ScreenBackground>
  );
}

interface SelectChipProps {
  label: string;
  /** Defaults to `label`. Callers pass an explicit, disambiguated value where the visible
   * label alone could collide with another control -- e.g. the "Back" muscle chip against
   * the header's own "Back" button. */
  accessibilityLabel?: string;
  selected: boolean;
  onPress: () => void;
}

/** The multi-select chip both `Muscles worked` and `Equipment used` share -- a checkmark
 * glyph when selected, per §3's own "selected chips gain a checkmark". */
function SelectChip({ label, accessibilityLabel, selected, onPress }: SelectChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      onPress={onPress}
      className="flex-row items-center rounded-chip px-[13px] py-[9px]"
      style={{
        gap: 7,
        backgroundColor: selected ? colors.pickRowSelectedBg : colors.elevated,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
      }}>
      {selected && <Icon name="check" size={11} color={colors.accent} strokeWidth={3} />}
      <Text
        className="font-archivo text-[12.5px] font-semibold"
        style={{ color: selected ? colors.accent : colors.dim }}>
        {label}
      </Text>
    </Pressable>
  );
}
