import { isAxiosError } from 'axios';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { resendConfirmation } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { useResendCooldown } from '@/auth/use-resend-cooldown';
import { Icon } from '@/components/icon';
import { pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { colors } from '@/theme/tokens';

/** How long "Resend email" rests after a send. The server allows three per fifteen minutes. */
const RESEND_COOLDOWN_SECONDS = 60;

// Shown after a sign-up that answered with no session. The project keeps email confirmation
// on, so the account exists but cannot sign in until the link in the email is opened. There is
// no design screenshot for this screen: the layout borrows the auth screens' header, headline
// and primary button, and the user approved a mock of it before it was built.
const STEPS = [
  'Open the email from FORJD and tap the link.',
  'Come back here and log in.',
  'Then set your username and date of birth.',
] as const;

export default function CheckEmailScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const toast = useToast();
  const cooldown = useResendCooldown(RESEND_COOLDOWN_SECONDS);
  const [sending, setSending] = useState(false);

  const canResend = !sending && cooldown.secondsLeft === 0;
  const resendLabel =
    cooldown.secondsLeft > 0 ? `Resend in ${cooldown.secondsLeft}s` : 'Resend email';

  const handleResend = async () => {
    if (email === undefined || !canResend) return;
    setSending(true);
    try {
      await resendConfirmation(email);
      toast.show('Confirmation email sent');
      cooldown.start();
    } catch (cause) {
      if (isAxiosError(cause) && cause.response?.status === 429) {
        // The server's own limit (three a quarter-hour): the countdown says "wait" better than
        // an error that invites another tap.
        toast.show('Too many requests. Please wait a few minutes and try again.');
        cooldown.start();
      } else {
        toast.show(
          classifyRequestFailure(cause) === 'offline'
            ? OFFLINE_MESSAGE
            : 'Could not resend the email. Please try again.',
        );
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <ScreenBackground>
      <View className="border-b border-border px-screen-x">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          className="h-[34px] w-[34px] items-center justify-center"
          style={{ marginBottom: 8, marginLeft: -8 }}>
          <Icon name="back" />
        </Pressable>
      </View>

      <View className="px-screen-x pt-[54px]">
        <View
          className="mb-[26px] h-[64px] w-[64px] items-center justify-center rounded-[18px] border"
          style={{
            backgroundColor: colors.athleteAvatarBg,
            borderColor: colors.borderAthleteAvatar,
          }}>
          <Icon name="mail" size={30} color={colors.accent} strokeWidth={1.8} />
        </View>

        <Text className="font-archivo text-auth-headline font-bold text-text">Check your email</Text>
        <Text className="mt-[12px] font-archivo text-body text-dim">
          We sent a confirmation link to{' '}
          <Text className="font-semibold text-text">{email ?? 'your email address'}</Text>. Open it
          to activate your account.
        </Text>

        <View className="mt-[26px] gap-[12px]">
          {STEPS.map((step, index) => (
            <View key={step} className="flex-row items-start gap-[12px]">
              <View
                className="h-[22px] w-[22px] items-center justify-center rounded-full border border-border bg-surface">
                <Text className="font-archivo text-[11px] font-semibold text-label">{index + 1}</Text>
              </View>
              <Text
                className="flex-1 font-archivo text-[13.5px]"
                style={{ color: colors.textTertiary, lineHeight: 19.5 }}>
                {step}
              </Text>
            </View>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go to Log In"
          onPress={() => router.replace('/login')}
          style={pressScale}
          className="mt-[30px] h-[52px] items-center justify-center rounded-button bg-accentDark shadow-primary-button">
          <Text className="font-archivo text-button font-bold text-white">Go to Log In</Text>
        </Pressable>

        {email !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={resendLabel}
            accessibilityState={{ disabled: !canResend }}
            disabled={!canResend}
            onPress={handleResend}
            className="mt-[10px] h-[48px] items-center justify-center">
            <Text
              className="font-archivo text-[14px] font-semibold"
              style={{ color: canResend ? colors.accent : colors.dimmer }}>
              {resendLabel}
            </Text>
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Use a different email"
          onPress={() => router.replace('/signup')}
          className="mt-[10px] h-[48px] items-center justify-center">
          <Text className="font-archivo text-[14px] font-semibold text-label">
            Use a different email
          </Text>
        </Pressable>
      </View>

      {/* `legal` is both a fontSize and a color token, so the color comes from the token module
          directly (same reason as signup.tsx's terms line). */}
      <Text
        className="absolute bottom-[26px] left-[22px] right-[22px] text-center font-archivo text-legal"
        style={{ color: colors.legal }}>
        Can&apos;t find it? Check your spam folder.
      </Text>
      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
