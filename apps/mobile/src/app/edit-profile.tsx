import DateTimePicker from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { UpdateProfileRequest } from '@forjd/contracts';
import type { Sex } from '@forjd/domain';

import { getMe, updateProfile } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { colors } from '@/theme/tokens';

// Layout, copy and geometry from the prototype's `s_editProfile()`
// (docs/design/slice2-screen-specs.md §2). No tab bar, no icons anywhere on this screen.
//
// `inputStyle` here is height 50, not the 52 `field()`/`btn()` use elsewhere in the app —
// that is the prototype's own value for this screen specifically, not a transcription slip.

const SEX_OPTIONS: ReadonlyArray<{ value: Sex; label: string }> = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'prefer_not_to_say', label: 'Rather not say' },
];

/**
 * `YYYY-MM-DD` -> a local calendar date, deliberately not through `new Date(iso)`.
 *
 * `new Date('1990-07-04')` parses as UTC midnight. Any later call that reads it back through
 * local getters (`getDate()`, a locale formatter) in a timezone behind UTC reads July 3rd —
 * the date silently moves a day for roughly half the world's timezones. Constructing from the
 * numeric parts via the local-time constructor sidesteps the UTC interpretation entirely.
 */
export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** The inverse of `parseIsoDate`, reading local getters so the round trip cannot drift. */
function toIsoDate(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const INPUT_HEIGHT = 50;

export default function EditProfileScreen() {
  const [displayName, setDisplayName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState<string | null>(null);
  const [sex, setSex] = useState<Sex | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    getMe().then(
      (me) => {
        if (cancelled) return;
        setDisplayName(me.profile?.displayName ?? '');
        setDateOfBirth(me.profile?.dateOfBirth ?? null);
        setSex(me.profile?.sex ?? null);
        setLoaded(true);
      },
      (error: unknown) => {
        if (cancelled) return;
        setLoadError(describeFailure(error));
        setLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const goBack = () => router.replace('/profile');

  const handleSave = async () => {
    setSaveError(null);
    setSaving(true);

    const patch: UpdateProfileRequest = {
      displayName: displayName.length > 0 ? displayName : null,
      dateOfBirth,
      sex,
    };

    try {
      await updateProfile(patch);
      toast.show('Profile updated');
      goBack();
    } catch (error: unknown) {
      setSaveError(describeFailure(error));
      setSaving(false);
    }
  };

  return (
    <ScreenBackground>
      <Header title="Edit Profile" onBack={goBack} />
      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        {loadError ? (
          <Text className="mt-3 font-archivo text-inline-error font-medium text-errorText">
            {loadError}
          </Text>
        ) : (
          loaded && (
            <>
              <Text className="mb-[9px] font-archivo text-section-label font-semibold uppercase text-label">
                Name
              </Text>
              <TextInput
                accessibilityLabel="Name"
                value={displayName}
                onChangeText={setDisplayName}
                className="rounded-field border border-border bg-fieldBg px-[15px] font-archivo text-input font-semibold text-text"
                style={{ height: INPUT_HEIGHT }}
              />

              <Text className="mb-[9px] mt-[18px] font-archivo text-section-label font-semibold uppercase text-label">
                Birthday
              </Text>
              <Pressable
                accessibilityLabel="Birthday"
                accessibilityRole="button"
                onPress={() => setPickerOpen(true)}
                className="flex-row items-center justify-between rounded-field border border-border bg-fieldBg px-[15px]"
                style={{ height: INPUT_HEIGHT }}>
                <Text className="font-archivo text-input font-semibold text-text">
                  {dateOfBirth ? formatDisplayDate(dateOfBirth) : ''}
                </Text>
                <Icon name="chevron" size={18} color={colors.metadata} />
              </Pressable>
              {pickerOpen && (
                <DateTimePicker
                  value={dateOfBirth ? parseIsoDate(dateOfBirth) : new Date()}
                  mode="date"
                  // Android's default (a modal dialog) fires onChange exactly once, on
                  // OK/Cancel, so closing on the first event is correct there. iOS's default
                  // for mode="date" is an inline spinner that fires onChange continuously as
                  // the wheel scrolls — closing on the first tick there would make it nearly
                  // impossible to actually pick a date. `compact` opens a calendar popover
                  // instead, which — like Android's dialog — only fires once a day is
                  // actually tapped, giving both platforms the same single-fire contract this
                  // handler assumes. Not verified on a physical iPhone yet (ADR-007); spot
                  // check when one is available.
                  display={Platform.OS === 'ios' ? 'compact' : 'default'}
                  onChange={(_event, picked) => {
                    setPickerOpen(false);
                    if (picked) {
                      setDateOfBirth(toIsoDate(picked));
                    }
                  }}
                />
              )}

              <Text className="mb-[9px] mt-[18px] font-archivo text-section-label font-semibold uppercase text-label">
                Sex
              </Text>
              <View
                accessibilityRole="radiogroup"
                className="flex-row flex-wrap"
                style={{ gap: 8 }}>
                {SEX_OPTIONS.map((option) => {
                  const selected = sex === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="radio"
                      accessibilityLabel={option.label}
                      accessibilityState={{ selected }}
                      onPress={() => setSex(option.value)}
                      className="rounded-chip px-[15px] py-2"
                      style={{
                        backgroundColor: selected ? colors.accent : colors.elevated,
                        borderWidth: selected ? 0 : 1,
                        borderColor: colors.border,
                      }}>
                      <Text
                        className="font-archivo text-chip font-semibold"
                        style={{ color: selected ? '#fff' : colors.dim }}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text className="mb-[9px] mt-[18px] font-archivo text-section-label font-semibold uppercase text-label">
                Plan
              </Text>
              {/* Always the free state — plan is hardcoded server-side until billing (Phase
                  10). A plain View, not Pressable: there is no onPress to justify the
                  touchable, and Pressable can still show Android ripple/highlight feedback
                  with no handler, implying interactivity this row deliberately has none of. */}
              <View
                className="flex-row items-center justify-between rounded-[13px] border border-border bg-surface px-4 py-[14px]"
                style={{ gap: 10 }}>
                <View className="flex-1">
                  <Text className="font-archivo text-row-title font-bold text-text">
                    Free plan
                  </Text>
                  <Text className="mt-[3px] font-archivo text-row-subtitle text-dimmer">
                    Upgrade for unlimited access
                  </Text>
                </View>
                <View className="flex-none rounded-chip bg-accent px-[13px] py-2">
                  <Text className="font-archivo text-chip font-bold text-white">Go Pro</Text>
                </View>
              </View>

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
                style={({ pressed }) => [{ marginTop: 56 }, pressScale({ pressed })]}
                className="h-[52px] items-center justify-center rounded-button bg-accent shadow-primary-button">
                <Text className="font-archivo text-button font-bold text-white">
                  Save Changes
                </Text>
              </Pressable>
            </>
          )
        )}
      </ScrollView>
      <Toast message={toast.message} />
    </ScreenBackground>
  );
}

function describeFailure(error: unknown): string {
  return classifyRequestFailure(error) === 'offline'
    ? OFFLINE_MESSAGE
    : 'Could not update your profile. Please try again.';
}
