import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { UpdateProfileRequest } from '@forjd/contracts';
import type { Sex } from '@forjd/domain';

import { getMe, updateProfile, uploadAvatar } from '@/auth/apiClient';
import { classifyRequestFailure, isConflict, OFFLINE_MESSAGE } from '@/auth/failure';
import { sanitizeUsername } from '@/auth/username';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { AVATAR_MAX_DIMENSION, resizeImageForUpload } from '@/media/resize-image-for-upload';
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

const AVATAR_SIZE = 88;
const AVATAR_BADGE_SIZE = 30;

export default function EditProfileScreen() {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState<string | null>(null);
  const [sex, setSex] = useState<Sex | null>(null);
  // `avatarUrl` starts as the loaded profile's value and is only ever replaced by a fresh
  // upload's own returned URL — never set from the local picker URI, which is a device-local
  // `file://`/`content://` path `httpUrlSchema` would reject outright.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarPreviewUri, setAvatarPreviewUri] = useState<string | null>(null);
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
        setUsername(me.profile?.username ?? '');
        setDateOfBirth(me.profile?.dateOfBirth ?? null);
        setSex(me.profile?.sex ?? null);
        setAvatarUrl(me.profile?.avatarUrl ?? null);
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

  // Uploaded immediately on selection, unlike every other field here — the picker only ever
  // hands back a local device URI, and turning that into something `avatarUrl` (an
  // `http(s)`-only field) can actually hold requires the network round trip regardless of
  // when Save is pressed. The result is still only *persisted* to the profile through the
  // batched `handleSave` patch below, same as every other field on this screen.
  const handlePickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.show('Photo access is needed to set a picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) {
      return;
    }

    const asset = result.assets[0];
    setAvatarPreviewUri(asset.uri);
    try {
      // ADR-024: resize/re-encode client-side before the upload leaves the device -- a
      // bandwidth optimization, not the correctness guarantee (the server re-encodes
      // unconditionally regardless of what arrives).
      const resized = await resizeImageForUpload(
        asset.uri,
        { width: asset.width, height: asset.height },
        AVATAR_MAX_DIMENSION,
      );
      const uploaded = await uploadAvatar(resized.uri);
      setAvatarUrl(uploaded.avatarUrl);
    } catch {
      toast.show('Could not upload photo. Please try again.');
    }
  };

  const handleUsernameChange = (value: string) => setUsername(sanitizeUsername(value));

  const handleSave = async () => {
    setSaveError(null);
    setSaving(true);

    const patch: UpdateProfileRequest = {
      displayName: displayName.length > 0 ? displayName : null,
      username: username.length > 0 ? username : null,
      dateOfBirth,
      sex,
      avatarUrl,
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
              <View className="mb-[22px] items-center" style={{ gap: 12 }}>
                <View style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}>
                  {avatarPreviewUri || avatarUrl ? (
                    <Image
                      source={{ uri: avatarPreviewUri ?? avatarUrl ?? undefined }}
                      style={{
                        width: AVATAR_SIZE,
                        height: AVATAR_SIZE,
                        borderRadius: AVATAR_SIZE / 2,
                        borderWidth: 1,
                        borderColor: colors.border,
                      }}
                    />
                  ) : (
                    <View
                      className="items-center justify-center rounded-full border border-border"
                      style={{
                        width: AVATAR_SIZE,
                        height: AVATAR_SIZE,
                        backgroundColor: '#1c1c1e',
                      }}>
                      <Text
                        className="font-archivo text-[28px] font-bold"
                        style={{ color: colors.metadata }}>
                        {(displayName || '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add photo"
                    onPress={handlePickAvatar}
                    className="absolute"
                    style={({ pressed }) => [
                      {
                        right: -2,
                        bottom: -2,
                        width: AVATAR_BADGE_SIZE,
                        height: AVATAR_BADGE_SIZE,
                        borderWidth: 2,
                        borderColor: '#0e0e0f',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: AVATAR_BADGE_SIZE / 2,
                        backgroundColor: colors.accent,
                      },
                      pressed && { transform: [{ scale: 0.985 }] },
                    ]}>
                    <Icon name="camera" color="#0e0e0f" size={15} filled />
                  </Pressable>
                </View>
                <Pressable accessibilityRole="button" onPress={handlePickAvatar}>
                  <Text className="font-archivo text-[12.5px] font-semibold text-accent">
                    Change photo
                  </Text>
                </Pressable>
              </View>

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
                Username
              </Text>
              <TextInput
                accessibilityLabel="Username"
                value={username}
                onChangeText={handleUsernameChange}
                autoCapitalize="none"
                autoCorrect={false}
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

              <View style={{ height: 56 }} />

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: saving }}
                disabled={saving}
                onPress={handleSave}
                style={pressScale}
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
  // ADR-019: the profile PATCH answers 409 with `That username is taken.` on a case-insensitive
  // duplicate — the same conflict shape `isConflict` already reads for exercise names.
  if (isConflict(error)) {
    return 'That username is taken.';
  }
  return classifyRequestFailure(error) === 'offline'
    ? OFFLINE_MESSAGE
    : 'Could not update your profile. Please try again.';
}
