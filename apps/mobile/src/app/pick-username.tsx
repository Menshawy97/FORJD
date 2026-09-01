import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';

import { updateProfile, uploadAvatar } from '@/auth/apiClient';
import { classifyRequestFailure, isConflict, OFFLINE_MESSAGE } from '@/auth/failure';
import { sanitizeUsername } from '@/auth/username';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { colors } from '@/theme/tokens';

// ADR-019: a new onboarding screen, ported from the prototype's `s_pickUsername()`
// (`FORJD mobile app design/FORJD Mobile.dc.html:1883`), sits between signup and goals. It
// blocks progress until the username validates — the design's own rule, verbatim
// (`/^[a-z0-9_]{3,20}$/`), enforced client-side as a length check once sanitizing has already
// stripped anything outside that character class as the user types.
//
// Copy, geometry and the avatar-badge layout (88px circle, 30px accent camera badge at
// bottom-right, "Upload photo" orange link beneath) are transcribed from the prototype and
// verified against `screenshots/create account username.png`. That screenshot's link says
// "Upload photo" — `edit-profile.tsx`'s equivalent control says "Change photo" instead; the
// two are genuinely different strings for two genuinely different contexts (first photo vs.
// replacing one), not a copy-paste slip.
const USERNAME_HINT = '3–20 characters: letters, numbers, underscores.';
const USERNAME_TAKEN_MESSAGE = 'That username is taken.';
const USERNAME_INVALID_MESSAGE = 'Enter 3–20 letters, numbers, or underscores.';
const PHOTO_PERMISSION_MESSAGE = 'Photo access is needed to set a picture.';
const PHOTO_UPLOAD_FAILED_MESSAGE = 'Could not upload photo. Please try again.';

function describeSaveFailure(error: unknown): string {
  if (isConflict(error)) {
    return USERNAME_TAKEN_MESSAGE;
  }
  return classifyRequestFailure(error) === 'offline'
    ? OFFLINE_MESSAGE
    : 'Could not save your username. Please try again.';
}

export default function PickUsernameScreen() {
  const [username, setUsername] = useState('');
  const [avatarPreviewUri, setAvatarPreviewUri] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const handleUsernameChange = (value: string) => {
    setUsername(sanitizeUsername(value));
    if (error) setError(null);
  };

  const handlePickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.show(PHOTO_PERMISSION_MESSAGE);
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

    const uri = result.assets[0].uri;
    setAvatarPreviewUri(uri);
    try {
      const uploaded = await uploadAvatar(uri);
      setAvatarUrl(uploaded.avatarUrl);
    } catch {
      toast.show(PHOTO_UPLOAD_FAILED_MESSAGE);
    }
  };

  const handleContinue = async () => {
    if (username.length < 3 || username.length > 20) {
      setError(USERNAME_INVALID_MESSAGE);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await updateProfile({ username, ...(avatarUrl ? { avatarUrl } : {}) });
      // The prototype's own destination on success — the exact `/goals?returnTo=newAccount`
      // this screen now sits in front of (signup used to navigate here directly; see
      // signup.tsx).
      router.replace('/goals?returnTo=newAccount');
    } catch (cause) {
      setError(describeSaveFailure(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenBackground>
      <Header title="Your Profile" onBack={() => router.replace('/signup')} />
      <View className="px-screen-x">
        <Text className="mb-[22px] font-archivo text-body text-dim">
          Pick a unique username and add a photo so friends can find you.
        </Text>

        <View className="mb-[26px] items-center" style={{ gap: 12 }}>
          <View style={{ width: 88, height: 88 }}>
            {avatarPreviewUri ? (
              <Image
                source={{ uri: avatarPreviewUri }}
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: 44,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              />
            ) : (
              <View
                className="items-center justify-center rounded-full border border-border"
                style={{ width: 88, height: 88, backgroundColor: '#1c1c1e' }}>
                <Text
                  className="font-archivo text-[28px] font-bold"
                  style={{ color: colors.metadata }}>
                  {(username || '?').charAt(0).toUpperCase()}
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
                  width: 30,
                  height: 30,
                  borderWidth: 2,
                  borderColor: '#0e0e0f',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 15,
                  backgroundColor: colors.accent,
                },
                pressed && { transform: [{ scale: 0.985 }] },
              ]}>
              <Icon name="camera" color="#0e0e0f" size={15} filled />
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" onPress={handlePickAvatar}>
            <Text className="font-archivo text-[12.5px] font-semibold text-accent">
              Upload photo
            </Text>
          </Pressable>
        </View>

        <Text className="mb-[9px] font-archivo text-section-label font-semibold uppercase text-label">
          Username
        </Text>
        <TextInput
          accessibilityLabel="Username"
          value={username}
          onChangeText={handleUsernameChange}
          placeholder="e.g. jsmith"
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          className="h-[50px] rounded-field border border-border bg-fieldBg px-[15px] font-archivo text-input font-semibold text-text"
        />
        {error ? (
          <Text className="mt-[10px] font-archivo text-inline-error font-medium text-errorText">
            {error}
          </Text>
        ) : (
          <Text className="mt-[10px] font-archivo text-field-hint text-dimmer">
            {USERNAME_HINT}
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue"
          accessibilityState={{ disabled: submitting }}
          disabled={submitting}
          onPress={handleContinue}
          style={pressScale}
          className="mt-[26px] h-[52px] items-center justify-center rounded-button bg-accent shadow-primary-button">
          <Text className="font-archivo text-button font-bold text-white">Continue</Text>
        </Pressable>
      </View>
      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
