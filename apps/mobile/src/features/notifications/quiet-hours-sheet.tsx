import DateTimePicker from '@react-native-community/datetimepicker';
import { DEFAULT_QUIET_HOURS, type QuietHours } from '@forjd/domain';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { pressScale } from '@/components/press-feedback';
import { dateToMinute, formatClock, formatQuietHours, minuteToDate } from './quiet-hours-format';

/**
 * The quiet-hours sheet, as approved in the mock-up (2026-10-06), drawn in the app's existing sheet style
 * (`features/forge/week-summary-sheet.tsx`): the scrim, then a sheet with 18 px top corners, a `border` top edge,
 * `surface` and 22 px gutters. A title, a From row and an Until row (each a pill showing the time, which opens the
 * phone's own time picker), Save, and a link that resets the two times to 22:00 and 07:00.
 *
 * - The pills are the only controls that change the times; Reset changes them in the sheet too, and nothing is kept
 *   until Save. Equal times are refused with a plain message, because a window of nothing or of the whole day is never
 *   what someone meant (the server refuses it as well).
 * - Tapping outside the sheet, or Android's back button, closes it without saving.
 * - It is mounted only while open, so each opening starts from what is saved, never from an abandoned edit.
 *
 * Shown in a transparent `Modal`, not drawn inside the screen: the tab bar floats over the bottom of the screen and
 * would cover Save.
 */
interface QuietHoursSheetProps {
  hours: QuietHours;
  onSave: (hours: QuietHours) => void;
  onClose: () => void;
}

type Edge = 'startMinute' | 'endMinute';

const EQUAL_TIMES_MESSAGE = 'Pick two different times.';

const ROWS: ReadonlyArray<{ edge: Edge; label: string }> = [
  { edge: 'startMinute', label: 'From' },
  { edge: 'endMinute', label: 'Until' },
];

export function QuietHoursSheet({ hours, onSave, onClose }: QuietHoursSheetProps) {
  const [draft, setDraft] = useState<QuietHours>(hours);
  const [editing, setEditing] = useState<Edge | null>(null);
  const [isEqual, setIsEqual] = useState(false);
  // A second tap on Save before the sheet has closed must not send the window again.
  const hasSaved = useRef(false);

  const change = (next: QuietHours) => {
    setDraft(next);
    setIsEqual(false);
  };

  const save = () => {
    if (hasSaved.current) return;
    if (draft.startMinute === draft.endMinute) {
      setIsEqual(true);
      // The live region below is Android-only and often missed on a node that mounts with its text: say it as well.
      AccessibilityInfo.announceForAccessibility(EQUAL_TIMES_MESSAGE);
      return;
    }
    hasSaved.current = true;
    onSave(draft);
  };

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View className="flex-1 items-end justify-end bg-scrim" accessibilityViewIsModal>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close quiet hours"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View className="w-full rounded-t-[18px] border-t border-border bg-surface px-[22px] pb-[24px] pt-[20px]">
          <Text accessibilityRole="header" className="font-archivo text-[18px] font-bold text-text">
            Quiet hours
          </Text>

          <View className="mt-[6px]">
            {ROWS.map(({ edge, label }, index) => (
              <View key={edge}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${label}, ${formatClock(draft[edge])}`}
                  accessibilityState={{ expanded: editing === edge }}
                  onPress={() => setEditing(editing === edge ? null : edge)}
                  className={`flex-row items-center justify-between py-[13px] ${
                    index === 0 ? 'border-b border-borderFaint' : ''
                  }`}>
                  <Text className="font-archivo text-row-title font-semibold text-text">{label}</Text>
                  <View className="min-w-[74px] items-center rounded-[10px] border border-border bg-screenBg px-[14px] py-[8px]">
                    <Text className="font-archivo text-[15px] font-semibold text-text">{formatClock(draft[edge])}</Text>
                  </View>
                </Pressable>
                {editing === edge ? (
                  <DateTimePicker
                    testID="quiet-hours-picker"
                    value={minuteToDate(draft[edge])}
                    mode="time"
                    is24Hour
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(event, picked) => {
                      // Android shows a dialog that closes itself; iOS keeps the wheel until the pill is tapped again.
                      if (Platform.OS === 'android') setEditing(null);
                      if (event.type === 'dismissed' || !picked) return;
                      change({ ...draft, [edge]: dateToMinute(picked) });
                    }}
                  />
                ) : null}
              </View>
            ))}
          </View>

          {isEqual ? (
            <Text
              accessibilityLiveRegion="polite"
              className="mt-[8px] font-archivo text-inline-error font-medium text-errorText">
              {EQUAL_TIMES_MESSAGE}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save"
            onPress={save}
            style={pressScale}
            className="mt-[14px] h-[52px] w-full items-center justify-center rounded-button bg-accentDark shadow-primary-button">
            <Text className="font-archivo text-button font-bold text-white">Save</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={() => change({ ...DEFAULT_QUIET_HOURS })}
            className="mt-[14px] items-center self-center">
            <Text className="font-archivo text-[12.5px] font-semibold text-accent">
              {`Reset to ${formatQuietHours(DEFAULT_QUIET_HOURS)}`}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
