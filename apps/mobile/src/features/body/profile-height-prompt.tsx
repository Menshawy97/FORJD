import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { updateProfile } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { colors } from '@/theme/tokens';

interface ProfileHeightPromptProps {
  /** The saved scan's height, formatted ("177.8"). */
  scanHeight: string;
  /** The profile's height, formatted, or '' when the profile has none. */
  profileHeight: string;
  /** Closed either way; `updated` is true when the profile now holds the scan's height. */
  onDone: (updated: boolean) => void;
}

/**
 * "Update your profile height to 177.8 cm?" (docs/product/scan-height-age-plan.md §1, replica
 * approved 2026-09-25): shown on the InBody screen after a scan is saved whose height differs from
 * the profile's. The user decides; the server never changes the profile by itself, and nothing
 * changes unless Update is tapped (PATCH /users/me with the scan's height).
 */
export function ProfileHeightPrompt({ scanHeight, profileHeight, onDone }: ProfileHeightPromptProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = async () => {
    setError(null);
    setSaving(true);
    try {
      await updateProfile({ heightCm: Number(scanHeight) });
      onDone(true);
    } catch (cause) {
      setError(
        classifyRequestFailure(cause) === 'offline'
          ? OFFLINE_MESSAGE
          : 'Could not update your profile height. Check your connection and try again.',
      );
      setSaving(false);
    }
  };

  const strong = { color: colors.text, fontWeight: '600' as const };

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        backgroundColor: colors.scrim,
        justifyContent: 'flex-end',
      }}>
      <View
        accessibilityViewIsModal
        style={{
          backgroundColor: '#17181A',
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,.07)',
          paddingHorizontal: 22,
          paddingTop: 12,
          paddingBottom: 34,
        }}>
        <View style={{ alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: '#3a3b3f', marginBottom: 18 }} />
        <Text style={{ fontFamily: 'Archivo', fontSize: 19, fontWeight: '700', color: colors.text, marginBottom: 8 }}>
          Update your profile height to {scanHeight} cm?
        </Text>
        <Text style={{ fontFamily: 'Archivo', fontSize: 13, lineHeight: 13 * 1.5, color: '#c8c8c0', marginBottom: 20 }}>
          This scan says <Text style={strong}>{scanHeight} cm</Text>;{' '}
          {profileHeight ? (
            <>
              your profile says <Text style={strong}>{profileHeight} cm</Text>.
            </>
          ) : (
            'your profile has no height yet.'
          )}{' '}
          Your profile height is what the app uses when a scan has none.
        </Text>
        {error ? (
          <Text style={{ fontFamily: 'Archivo', fontSize: 12, color: colors.errorText, marginBottom: 12 }}>{error}</Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Update to ${scanHeight} cm`}
          onPress={update}
          disabled={saving}
          style={{
            height: 52,
            borderRadius: 12,
            backgroundColor: colors.accentDark,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 11,
            opacity: saving ? 0.6 : 1,
          }}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ fontFamily: 'Archivo', fontSize: 15.5, fontWeight: '700', color: '#fff' }}>
              Update to {scanHeight} cm
            </Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={profileHeight ? `Keep ${profileHeight} cm` : 'Not now'}
          onPress={() => onDone(false)}
          disabled={saving}
          style={{
            height: 52,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text style={{ fontFamily: 'Archivo', fontSize: 15.5, fontWeight: '600', color: colors.dim }}>
            {profileHeight ? `Keep ${profileHeight} cm` : 'Not now'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
