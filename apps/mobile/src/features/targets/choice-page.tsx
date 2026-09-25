import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Icon } from '@/components/icon';
import { pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { colors } from '@/theme/tokens';

interface ChoicePageProps<T extends string> {
  title: string;
  subtitle: string;
  sectionLabel: string;
  options: ReadonlyArray<{ value: T; label: string; detail: string }>;
  /** Loads the starting choice (the saved one, else a sensible start); null when it cannot load. */
  loadInitial: () => Promise<{ value: T; note: string | null }>;
  save: (value: T) => Promise<void>;
  buttonLabel: string;
  failureMessage: string;
  onBack: () => void;
  onSaved: (showToast: (message: string) => void) => void;
  /** The line under the options; `loadInitial`'s note replaces it when it has one. */
  footnote: string;
}

/**
 * One-choice page in the goals page's layout (docs/product/scan-height-age-plan.md §4.5; designs
 * approved 2026-09-25): the activity level and body goal pages, used both at sign-up and from
 * Profile. A single-select list of radio rows; saving goes through `updateProfile`.
 */
export function ChoicePage<T extends string>(props: ChoicePageProps<T>) {
  const [picked, setPicked] = useState<T | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const { loadInitial } = props;

  useEffect(() => {
    let cancelled = false;
    loadInitial().then(
      (initial) => {
        if (cancelled) return;
        setPicked((current) => current ?? initial.value);
        setNote(initial.note);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [loadInitial]);

  const handleSave = async () => {
    if (picked === null) return;
    setError(null);
    setSaving(true);
    try {
      await props.save(picked);
      props.onSaved(toast.show);
    } catch (cause) {
      setError(classifyRequestFailure(cause) === 'offline' ? OFFLINE_MESSAGE : props.failureMessage);
      setSaving(false);
    }
  };

  return (
    <ScreenBackground>
      <View className="flex-none px-screen-x pt-[14px]">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={props.onBack}
          className="h-[34px] w-[34px] items-center justify-center rounded-[10px]"
          style={({ pressed }) => [{ marginLeft: -8 }, pressed && { backgroundColor: colors.pressedGhost }]}>
          <Icon name="back" />
        </Pressable>
      </View>
      <ScrollView className="flex-1" contentContainerClassName="px-screen-x pb-[26px]" showsVerticalScrollIndicator={false}>
        <Text className="mt-[18px] font-archivo text-screen-header font-bold text-text" style={{ letterSpacing: -0.02 * 26 }}>
          {props.title}
        </Text>
        <Text className="mb-[22px] mt-[10px] font-archivo text-body text-dim">{props.subtitle}</Text>
        <Text className="mb-[10px] font-archivo text-section-label font-semibold uppercase text-label">{props.sectionLabel}</Text>
        <View style={{ gap: 8 }}>
          {props.options.map((option) => {
            const selected = picked === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={`${option.label}, ${option.detail}`}
                accessibilityState={{ selected }}
                onPress={() => setPicked(option.value)}
                className="flex-row items-center justify-between rounded-[11px] px-[15px] py-[13px]"
                style={{
                  gap: 12,
                  backgroundColor: selected ? colors.pickRowSelectedBg : colors.surface,
                  borderWidth: 1,
                  borderColor: selected ? colors.borderPickRowSelected : colors.border,
                }}>
                <View style={{ flex: 1 }}>
                  <Text
                    className="font-archivo text-[14px] font-semibold"
                    style={{ color: selected ? colors.text : colors.textTertiary }}>
                    {option.label}
                  </Text>
                  <Text className="mt-[3px] font-archivo text-[12px]" style={{ color: colors.dim, lineHeight: 12 * 1.4 }}>
                    {option.detail}
                  </Text>
                </View>
                <View
                  className="h-5 w-5 items-center justify-center rounded-[10px]"
                  style={{
                    borderWidth: selected ? 0 : 1.5,
                    borderColor: colors.borderCheckbox,
                    backgroundColor: selected ? colors.accent : 'transparent',
                  }}>
                  {selected ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' }} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        <Text className="mt-[16px] font-archivo text-[12px]" style={{ color: colors.dim, lineHeight: 12 * 1.5 }}>
          {note ?? props.footnote}
        </Text>
        {error ? (
          <Text className="mt-[16px] font-archivo text-inline-error font-medium text-errorText">{error}</Text>
        ) : null}
      </ScrollView>
      <View
        className="flex-none border-t px-screen-x pb-6 pt-3"
        style={{ borderColor: 'rgba(255,255,255,.06)', backgroundColor: colors.screenBg }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.buttonLabel}
          accessibilityState={{ disabled: picked === null || saving }}
          disabled={picked === null || saving}
          onPress={handleSave}
          style={pressScale}
          className="h-[52px] items-center justify-center rounded-button bg-accentDark shadow-primary-button">
          <Text className="font-archivo text-button font-bold text-white">{props.buttonLabel}</Text>
        </Pressable>
      </View>
      <Toast message={toast.message} />
    </ScreenBackground>
  );
}

/** Profile or the sign-up flow: only `returnTo=newAccount` changes where a page goes. */
export const isFirstRun = (returnTo: string | undefined): boolean => returnTo === 'newAccount';

