import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { registerRequestSchema } from '@forjd/contracts';

import { signup } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { saveSession } from '@/auth/secureStorage';
import { Icon } from '@/components/icon';
import { pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { colors } from '@/theme/tokens';

// Copy and layout from the prototype's `s_signup()`; validation order from
// 01-screen-inventory.md's `signup` section:
//   1. any field empty -> "All fields are required."
//   2. email fails the simple regex -> "Enter a valid email address."
//   3. password fails the *real* contract (min 8 + upper + lower + digit + symbol) -> the
//      contract's own message, not the hint's paraphrase — "The real contract is stricter
//      ... Mirror the contract, not this hint."
// registerRequestSchema.shape.password is that exact contract (newPasswordSchema, not
// exported directly), so validating against it is what keeps this screen honest if the
// contract ever changes. The hint line below is the design's wording verbatim and is
// deliberately looser than what is enforced — that mismatch is the design's, not a bug here.
//
// The social auth row the prototype draws under the CTA is out of Phase 1 scope; the legal
// footnote it draws below that is kept, since it is one line of static text.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PASSWORD_HINT = 'Must be at least 8 characters, with a number and a letter.';

type FieldName = 'name' | 'email' | 'password';

/**
 * A validation failure names the fields it implicates, not just its message. `hasError` used
 * to be re-derived per field as "this field is empty", which only ever agreed with the first
 * of the three branches below: a non-empty-but-malformed email, or a non-empty-but-weak
 * password, left every border calm grey while the message said something was wrong — telling
 * the user there is a problem and declining to say where.
 *
 * `fields` is a list rather than a single name because the empty-fields branch genuinely
 * implicates several at once, and must mark only the ones actually empty. It is empty for
 * failures that belong to no field at all (the network/server branch).
 */
interface SubmitError {
  fields: readonly FieldName[];
  message: string;
}

/**
 * "Could not create your account" is true of every failure and useful for almost none of
 * them: for a request that never reached the server it reads as a refusal, when the account
 * is probably creatable a minute later. There is no `unauthorized` case here — registration
 * has no credentials to reject — so only the offline branch is distinguished.
 */
function describeSignupFailure(cause: unknown): string {
  return classifyRequestFailure(cause) === 'offline'
    ? OFFLINE_MESSAGE
    : 'Could not create your account. Please try again.';
}

export default function SignupScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<SubmitError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const clearErrorOnEdit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    if (error) {
      setError(null);
    }
  };

  const failed = (fields: readonly FieldName[], message: string) => setError({ fields, message });

  const handleSubmit = async () => {
    const empty: FieldName[] = [];
    if (!name.trim()) empty.push('name');
    if (!email.trim()) empty.push('email');
    if (!password) empty.push('password');
    if (empty.length > 0) {
      failed(empty, 'All fields are required.');
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      failed(['email'], 'Enter a valid email address.');
      return;
    }
    const passwordCheck = registerRequestSchema.shape.password.safeParse(password);
    if (!passwordCheck.success) {
      failed(
        ['password'],
        passwordCheck.error.issues[0]?.message ?? 'Password does not meet requirements.',
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await signup({ email, password, displayName: name.trim() });
      if (result.session) {
        await saveSession(result.session);
      }
      router.replace('/');
    } catch (cause) {
      // No field is implicated: the input passed every client-side rule, so nothing on the
      // screen is the thing to point at.
      failed([], describeSignupFailure(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const marks = (field: FieldName) => error?.fields.includes(field) ?? false;

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

      <View className="px-screen-x pt-[26px]">
        <Text className="font-archivo text-auth-headline font-bold text-text">Create account</Text>
        <Text className="mb-[26px] mt-[9px] font-archivo text-body text-dim">
          Start tracking everything in one place.
        </Text>

        <View className="gap-field-gap">
          <Field
            label="Full name"
            value={name}
            onChangeText={clearErrorOnEdit(setName)}
            placeholder="Your name"
            hasError={marks('name')}
          />
          <Field
            label="Email"
            value={email}
            onChangeText={clearErrorOnEdit(setEmail)}
            placeholder="you@email.com"
            autoCapitalize="none"
            keyboardType="email-address"
            hasError={marks('email')}
          />
          <Field
            label="Password"
            value={password}
            onChangeText={clearErrorOnEdit(setPassword)}
            placeholder="Min. 8 characters"
            secureTextEntry
            hint={PASSWORD_HINT}
            hasError={marks('password')}
          />
        </View>

        {error && (
          <Text className="mt-[10px] font-archivo text-inline-error font-medium text-errorText">
            {error.message}
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create Account"
          disabled={submitting}
          onPress={handleSubmit}
          style={pressScale}
          className="mt-[22px] h-[52px] items-center justify-center rounded-button bg-accent shadow-primary-button">
          <Text className="font-archivo text-button font-bold text-white">Create Account</Text>
        </Pressable>

        {/* `legal` is both a fontSize and a color token, so `text-legal` would collide as a
            class name — the color comes from the token module directly instead. */}
        <Text
          className="mt-[18px] text-center font-archivo text-legal"
          style={{ color: colors.legal }}>
          By creating an account you agree to our Terms of Service and Privacy Policy.
        </Text>
      </View>
    </ScreenBackground>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'email-address';
  secureTextEntry?: boolean;
  hint?: string;
  hasError?: boolean;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize,
  keyboardType,
  secureTextEntry,
  hint,
  hasError,
}: FieldProps) {
  return (
    <View className="gap-[7px]">
      <Text className="font-archivo text-section-label font-semibold uppercase text-label">
        {label}
      </Text>
      <TextInput
        className={`h-[52px] rounded-field border bg-fieldBg px-[15px] font-archivo text-input font-medium text-text ${
          hasError ? 'border-errorBorder' : 'border-border'
        }`}
        // The <Text> above is a sibling with no programmatic link to this input — RN has no
        // htmlFor — so the input carries the same name itself. Derived from `label` rather
        // than passed separately so the two can never drift apart.
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
      />
      {hint && <Text className="font-archivo text-field-hint text-dimmer">{hint}</Text>}
    </View>
  );
}
