import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { colors } from '@/theme/tokens';

/** MM/DD/YYYY -- the design's own date-box format (`confirm-inbody.png`: "08/19/2026"). */
export function formatDateBox(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

/** h:mm AM/PM -- the design's own time-box format ("09:38 AM"). */
export function formatTimeBox(d: Date): string {
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${period}`;
}

/** The date and time a scan is stored against. Combined from the two separate pickers. */
export function combineDateAndTime(date: Date, time: Date): Date {
  const combined = new Date(date);
  combined.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return combined;
}

interface ScanDateTimeFieldsProps {
  date: Date;
  time: Date;
  onDateChange: (date: Date) => void;
  onTimeChange: (time: Date) => void;
  /** "Read from sheet" on Confirm scan; "Test date" on manual entry. */
  dateLabel: string;
  /** The line under the boxes. */
  note: string;
}

/**
 * The "Scan date & time" block of `s_inbodyConfirm()` (`FORJD Mobile.dc.html:2297`), shared
 * with the manual-entry form so both screens store data against the date the user chose.
 */
export function ScanDateTimeFields({ date, time, onDateChange, onTimeChange, dateLabel, note }: ScanDateTimeFieldsProps) {
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);

  return (
    <>
      <Text
        style={{
          fontFamily: 'Archivo',
          fontSize: 9.5,
          fontWeight: '600',
          letterSpacing: 0.1 * 9.5,
          textTransform: 'uppercase',
          color: '#94948B',
          marginBottom: 9,
        }}>
        Scan date & time
      </Text>
      <View style={{ flexDirection: 'row', gap: 9 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${dateLabel}, ${formatDateBox(date)}`}
          onPress={() => setDatePickerOpen(true)}
          style={{ flex: 1, backgroundColor: '#151517', borderWidth: 1, borderColor: colors.border, borderRadius: 11, padding: 13 }}>
          <Text style={{ fontFamily: 'Archivo', fontSize: 10.5, fontWeight: '500', color: colors.dim, marginBottom: 8 }}>
            {dateLabel}
          </Text>
          <Text style={{ fontFamily: 'Archivo', fontSize: 14, fontWeight: '700', color: colors.text }}>{formatDateBox(date)}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Time, ${formatTimeBox(time)}`}
          onPress={() => setTimePickerOpen(true)}
          style={{ width: 118, backgroundColor: '#151517', borderWidth: 1, borderColor: colors.border, borderRadius: 11, padding: 13 }}>
          <Text style={{ fontFamily: 'Archivo', fontSize: 10.5, fontWeight: '500', color: colors.dim, marginBottom: 8 }}>Time</Text>
          <Text style={{ fontFamily: 'Archivo', fontSize: 14, fontWeight: '700', color: colors.text }}>{formatTimeBox(time)}</Text>
        </Pressable>
      </View>
      {datePickerOpen ? (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === 'ios' ? 'compact' : 'default'}
          onChange={(_event, picked) => {
            setDatePickerOpen(false);
            if (picked) onDateChange(picked);
          }}
        />
      ) : null}
      {timePickerOpen ? (
        <DateTimePicker
          value={time}
          mode="time"
          display={Platform.OS === 'ios' ? 'compact' : 'default'}
          onChange={(_event, picked) => {
            setTimePickerOpen(false);
            if (picked) onTimeChange(picked);
          }}
        />
      ) : null}
      <Text style={{ margin: 0, marginTop: 9, fontFamily: 'Archivo', fontSize: 11.5, lineHeight: 11.5 * 1.5, color: '#7a7a72' }}>
        {note}
      </Text>
    </>
  );
}
