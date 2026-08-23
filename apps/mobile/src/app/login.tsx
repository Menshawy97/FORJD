import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { login } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { saveSession } from '@/auth/secureStorage';
import { Icon } from '@/components/icon';
import { pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { SocialAuthRow } from '@/components/social-auth-row';
import { Toast, useToast } from '@/components/toast';
import { colors } from '@/theme/tokens';

// Copy and layout from the prototype's `s_login()` in
// `FORJD mobile app design/FORJD Mobile.dc.html`. Where 01-screen-inventory.md paraphrases
// ("Log in" as the headline), the prototype is authoritative — the headline is
// "Welcome back", with "Log in to continue your training." beneath it.
//
// Wrong-credentials renders an inline error and does not navigate: the API's 401 is the
// single source of truth, not client-side guessing.
/**
 * The catch block used to assert the cause: every failure, including a request that never
 * left the device, was reported as a wrong password. A user in a lift then retypes a correct
 * password, is told again it is wrong, and stops trusting the answer.
 *
 * Only a 401 is actually evidence about the credentials — it is the API saying so. See
 * `src/auth/failure.ts` for the classification and for why "no response" alone is not
 * treated as proof of being offline.
 */
function describeLoginFailure(cause: unknown): string {
  switch (classifyRequestFailure(cause)) {
    case 'unauthorized':
      return 'Incorrect email or password. Please try again.';
    case 'offline':
      return OFFLINE_MESSAGE;
    default:
      return 'Could not log you in. Please try again.';
  }
}

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const clearErrorOnEdit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    if (error) {
      setError(null);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const session = await login({ email, password });
      await saveSession(session);
      // `welcome` was pushed under this screen and never popped by a bare `replace`, so the
      // swipe-back gesture always had a phantom entry to land on (see
      // ui-remediation-and-phase-i-plan.md §1.1). Dismiss everything below this screen before
      // replacing it so the authenticated app mounts at stack depth 1, with nothing to pop to.
      if (router.canDismiss()) router.dismissAll();
      router.replace('/');
    } catch (cause) {
      setError(describeLoginFailure(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenBackground>
      {/* Header: a 34x34 tap target pulled 8px left, over a full-bleed hairline rule. */}
      <View className="border-b border-border px-screen-x">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          // A destination, not an undo. The prototype's header calls `go('welcome')`, and
          // `router.back()` only coincides with that when login was pushed from welcome — a
          // deep link or a `replace` from signup leaves it pointing somewhere else, or
          // nowhere. `replace` rather than `push` so back does not stack up entries.
          onPress={() => router.replace('/welcome')}
          className="h-[34px] w-[34px] items-center justify-center"
          style={{ marginBottom: 8, marginLeft: -8 }}>
          <Icon name="back" />
        </Pressable>
      </View>

      <View className="px-screen-x pt-[26px]">
        <Text className="font-archivo text-auth-headline font-bold text-text">Welcome back</Text>
        <Text className="mb-[26px] mt-[9px] font-archivo text-body text-dim">
          Log in to continue your training.
        </Text>

        <View className="gap-field-gap">
          <View className="gap-[7px]">
            <Text className="font-archivo text-section-label font-semibold uppercase text-label">
              Email
            </Text>
            <TextInput
              className={`h-[52px] rounded-field border bg-fieldBg px-[15px] font-archivo text-input font-medium text-text ${
                error ? 'border-errorBorder' : 'border-border'
              }`}
              // The visible label above is a sibling <Text> with no programmatic link to
              // this input — RN has no htmlFor. Without an explicit name a screen reader
              // announces the placeholder at best, so the input carries its own.
              accessibilityLabel="Email"
              value={email}
              onChangeText={clearErrorOnEdit(setEmail)}
              placeholder="james.mitchell@example.com"
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>

          <View className="gap-[7px]">
            <Text className="font-archivo text-section-label font-semibold uppercase text-label">
              Password
            </Text>
            <View
              className={`h-[52px] flex-row items-center rounded-field border bg-fieldBg px-[15px] ${
                error ? 'border-errorBorder' : 'border-border'
              }`}
              style={{ gap: 10 }}>
              <TextInput
                className="flex-1 font-archivo text-input font-medium text-text"
                // Doubly necessary here: this field's placeholder is a row of bullets, so
                // without a name the reader announces nothing usable at all.
                accessibilityLabel="Password"
                value={password}
                onChangeText={clearErrorOnEdit(setPassword)}
                placeholder="••••••••"
                placeholderTextColor={colors.placeholder}
                secureTextEntry={!passwordVisible}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
                onPress={() => setPasswordVisible((visible) => !visible)}>
                <Icon name="eye" size={19} />
              </Pressable>
            </View>
          </View>
        </View>

        {error && (
          <Text className="mt-[10px] font-archivo text-inline-error font-medium text-errorText">
            {error}
          </Text>
        )}

        {/* The prototype's only behaviour here is `flash('Reset link sent to your email')` —
            it raises the confirmation and sends nothing. Actually requesting the reset is a
            later slice; matching the prototype is not. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => toast.show('Reset link sent to your email')}
          className="mt-[14px] self-start">
          <Text className="font-archivo text-link font-semibold text-accent">Forgot password?</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log In"
          disabled={submitting}
          onPress={handleSubmit}
          style={pressScale}
          className="mt-[26px] h-[52px] items-center justify-center rounded-button bg-accent shadow-primary-button">
          <Text className="font-archivo text-button font-bold text-white">Log In</Text>
        </Pressable>

        <SocialAuthRow
          onGooglePress={() => toast.show('Continuing with Google…')}
          onApplePress={() => toast.show('Continuing with Apple…')}
        />

        <View className="mt-5 flex-row justify-center">
          <Text className="font-archivo text-link text-dimmer">No account? </Text>
          <Pressable accessibilityRole="link" onPress={() => router.replace('/signup')}>
            <Text className="font-archivo text-link font-bold text-accent">Create one</Text>
          </Pressable>
        </View>
      </View>

      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
