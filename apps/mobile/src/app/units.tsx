import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { DistanceUnit, EnergyUnit, UnitSystem, WeightUnit } from '@forjd/domain';

import { getMe, updateProfile } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { colors } from '@/theme/tokens';

function describeFailure(error: unknown): string {
  return classifyRequestFailure(error) === 'offline'
    ? OFFLINE_MESSAGE
    : 'Could not update your preferences. Please try again.';
}

// docs/design/slice2-screen-specs.md §3. Four identical option groups, then Save. No icons,
// no tab bar. `unitSystem` writes weight+distance together (ADR-016) and is otherwise a
// display-only preset — the three real fields are what the screen actually edits.

interface Group<T extends string> {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
}

const SYSTEM_GROUP: Group<UnitSystem> = {
  label: 'Measurement system',
  options: [
    { value: 'metric', label: 'Metric' },
    { value: 'imperial', label: 'Imperial' },
  ],
};
const WEIGHT_GROUP: Group<WeightUnit> = {
  label: 'Weight',
  options: [
    { value: 'kg', label: 'kg' },
    { value: 'lb', label: 'lb' },
  ],
};
const DISTANCE_GROUP: Group<DistanceUnit> = {
  label: 'Distance',
  options: [
    { value: 'km', label: 'km' },
    { value: 'mi', label: 'mi' },
  ],
};
const ENERGY_GROUP: Group<EnergyUnit> = {
  label: 'Energy',
  options: [
    { value: 'kcal', label: 'kcal' },
    { value: 'kJ', label: 'kJ' },
  ],
};

/** The system preset's own writes — weight and distance, never energy. See ADR-016. */
const SYSTEM_PRESET: Record<UnitSystem, { weightUnit: WeightUnit; distanceUnit: DistanceUnit }> =
  {
    metric: { weightUnit: 'kg', distanceUnit: 'km' },
    imperial: { weightUnit: 'lb', distanceUnit: 'mi' },
  };

export default function UnitsScreen() {
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('metric');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>('km');
  const [energyUnit, setEnergyUnit] = useState<EnergyUnit>('kcal');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    getMe().then((me) => {
      if (cancelled) return;
      // A profile row should always exist (Phase A creates one transactionally), but this
      // must not hang forever if it somehow does not — same defensive stance as
      // edit-profile.tsx. The component's own useState defaults (metric/kg/km/kcal) already
      // match the schema's column defaults, so leaving them untouched is correct here.
      if (me.profile) {
        setUnitSystem(me.profile.unitSystem);
        setWeightUnit(me.profile.weightUnit);
        setDistanceUnit(me.profile.distanceUnit);
        setEnergyUnit(me.profile.energyUnit);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const goBack = () => router.replace('/profile');

  // The prototype's own documented inconsistency, preserved deliberately: picking a system
  // writes weight+distance immediately, but picking a unit does NOT pull the system chip
  // along — so the screen can show `Metric` next to `lb`. See spec §3.5.
  const handleSystem = (value: UnitSystem) => {
    setUnitSystem(value);
    setWeightUnit(SYSTEM_PRESET[value].weightUnit);
    setDistanceUnit(SYSTEM_PRESET[value].distanceUnit);
  };

  const handleSave = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      await updateProfile({ unitSystem, weightUnit, distanceUnit, energyUnit });
      toast.show('Preferences updated');
      goBack();
    } catch (error: unknown) {
      setSaveError(describeFailure(error));
      setSaving(false);
    }
  };

  return (
    <ScreenBackground>
      <Header title="Units & Preferences" onBack={goBack} />
      {loaded && (
        <View className="flex-1 px-screen-x pb-[26px]">
          <OptionGroup group={SYSTEM_GROUP} value={unitSystem} onPick={handleSystem} />
          <OptionGroup group={WEIGHT_GROUP} value={weightUnit} onPick={setWeightUnit} />
          <OptionGroup group={DISTANCE_GROUP} value={distanceUnit} onPick={setDistanceUnit} />
          <OptionGroup group={ENERGY_GROUP} value={energyUnit} onPick={setEnergyUnit} />

          {saveError && (
            <Text className="mt-[10px] font-archivo text-inline-error font-medium text-errorText">
              {saveError}
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            onPress={handleSave}
            style={({ pressed }) => [
              { marginTop: 26, height: 52, shadowColor: colors.accent },
              pressScale({ pressed }),
            ]}
            className="items-center justify-center rounded-button bg-accent shadow-primary-button">
            <Text className="font-archivo text-button font-bold text-white">Save Changes</Text>
          </Pressable>
        </View>
      )}
      <Toast message={toast.message} />
    </ScreenBackground>
  );
}

interface OptionGroupProps<T extends string> {
  group: Group<T>;
  value: T;
  onPick: (value: T) => void;
}

/**
 * Every label, including the first, uses the same top margin (18px) — spec §3.3 calls this
 * out explicitly, so nothing here collapses it away for the first group.
 */
function OptionGroup<T extends string>({ group, value, onPick }: OptionGroupProps<T>) {
  return (
    <View>
      <Text className="mb-[9px] mt-[18px] font-archivo text-section-label font-semibold uppercase text-label">
        {group.label}
      </Text>
      <View accessibilityRole="radiogroup" className="flex-row" style={{ gap: 8 }}>
        {group.options.map((option) => {
          const selected = value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected }}
              onPress={() => onPick(option.value)}
              className="flex-1 items-center rounded-field py-[11px]"
              style={{
                backgroundColor: selected ? colors.accent : colors.surface,
                borderWidth: selected ? 0 : 1,
                borderColor: colors.border,
              }}>
              <Text
                className="font-archivo text-chip font-semibold"
                style={{ color: selected ? '#fff' : colors.text }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
