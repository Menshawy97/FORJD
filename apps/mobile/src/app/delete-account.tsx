import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput } from 'react-native';

import { deleteAccount } from '@/auth/apiClient';
import { clearSession } from '@/auth/secureStorage';
import { Header } from '@/components/header';
import { ScreenBackground } from '@/components/screen-background';
import { colors } from '@/theme/tokens';

/**
 * C1 -- Apple Guideline 5.1.1(v) requires account deletion be reachable in-app, not only via a
 * support request. Typed confirmation (not a plain "Are you sure?" alert) because this is the
 * one irreversible action in the entire app: the phrase has to be typed correctly, not just
 * dismissed past.
 */
const CONFIRM_PHRASE = 'DELETE';
const DELETE_ERROR = 'Could not delete your account. Check your connection and try again.';

export default function DeleteAccountScreen() {
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirmText === CONFIRM_PHRASE && !isDeleting;

  const handleDelete = async () => {
    if (confirmText !== CONFIRM_PHRASE || isDeleting) return;
    setError(null);
    setIsDeleting(true);
    try {
      await deleteAccount();
      // Same seam `profile.tsx`'s logout uses: clearing the session notifies the root
      // layout's session listener, which redirects out of the app on its own. No parallel
      // navigation call here for the same reason that screen gives (ADR-011).
      await clearSession();
    } catch {
      setError(DELETE_ERROR);
      setIsDeleting(false);
    }
  };

  return (
    <ScreenBackground>
      <Header title="Delete account" onBack={() => router.back()} />
      <ScrollView className="flex-1 px-screen-x" showsVerticalScrollIndicator={false}>
        <Text className="mb-[10px] font-archivo text-[15px] font-semibold text-text">
          This permanently deletes your account
        </Text>
        <Text className="mb-[20px] font-archivo text-[13px] leading-[19px] text-dimmer">
          Every workout, body scan, nutrition log, and connected data source is erased and
          cannot be recovered. This cannot be undone.
        </Text>

        <Text className="mb-[8px] font-archivo text-[12px] font-semibold uppercase text-label">
          Type {CONFIRM_PHRASE} to confirm
        </Text>
        <TextInput
          accessibilityLabel="Type DELETE to confirm"
          value={confirmText}
          onChangeText={setConfirmText}
          autoCapitalize="characters"
          autoCorrect={false}
          className="mb-[16px] rounded-[12px] px-4 py-3 font-archivo text-[14px] text-text"
          style={{ backgroundColor: 'rgba(255,255,255,.06)' }}
          placeholder={CONFIRM_PHRASE}
          placeholderTextColor="#6e6e66"
        />

        {error && (
          <Text className="mb-[12px] font-archivo text-inline-error font-medium text-errorText">
            {error}
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canDelete }}
          disabled={!canDelete}
          onPress={handleDelete}
          className="items-center justify-center rounded-[12px] py-[14px]"
          style={{ backgroundColor: canDelete ? colors.destructive : 'rgba(255,255,255,.06)' }}>
          <Text className="font-archivo text-[14px] font-bold text-white">
            {isDeleting ? 'Deleting…' : 'Delete my account'}
          </Text>
        </Pressable>
      </ScrollView>
    </ScreenBackground>
  );
}
