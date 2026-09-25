import { Text, TextInput, View } from 'react-native';

import { colors } from '@/theme/tokens';

const AMBER = '#c9a03c';
const AMBER_TEXT = '#a08a4e';
const AMBER_BORDER = 'rgba(201,160,60,.45)';
/** The "Required" label on the manual-entry form (approved replica): the design's muted orange. */
const REQUIRED_TEXT = '#c9906c';
/** The app's field-error border (`field()` in the prototype) and error text. */
const ERROR_BORDER = '#b8422f';
const ERROR_TEXT = '#e05a3c';

interface ScanValueRowProps {
  label: string;
  unit: string;
  value: string;
  onChange: (text: string) => void;
  /** 0-1 extraction confidence, shown as the design's bar. Absent on manual entry and segmental rows. */
  confidence?: number;
  /** Manual entry: marks weight and body fat % (the user's rule). */
  required?: boolean;
  /** Why this value blocks saving; turns the box red. */
  error?: string | null;
  /** A small note under the label: where a pre-filled value came from ("From your profile"). */
  hint?: string;
  /** Amber box and hint without a confidence bar: a value filled from the profile, to be checked. */
  checkMe?: boolean;
}

/**
 * One editable value on the Confirm-scan screen (`s_inbodyConfirm()` editRow,
 * `FORJD Mobile.dc.html:2284`) and on the manual-entry form, which reuses the same layout
 * (docs/product/manual-inbody-entry-plan.md). Shared so the two screens cannot drift apart.
 */
export function ScanValueRow({ label, unit, value, onChange, confidence, required, error, hint, checkMe }: ScanValueRowProps) {
  const confident = confidence != null && confidence >= 0.9;
  const borderColor = error
    ? ERROR_BORDER
    : checkMe || (confidence != null && confidence < 0.9)
      ? AMBER_BORDER
      : colors.border;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,.05)',
      }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: 'Archivo', fontSize: 13.5, fontWeight: '500', color: colors.text }}>{label}</Text>
        {confidence != null ? (
          <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 40, height: 3, borderRadius: 2, backgroundColor: '#26272a', overflow: 'hidden' }}>
              <View
                style={{
                  width: `${Math.round(confidence * 100)}%`,
                  height: 3,
                  backgroundColor: confident ? colors.green : AMBER,
                }}
              />
            </View>
            <Text style={{ fontFamily: 'Archivo', fontSize: 10, fontWeight: '500', color: confident ? '#6d8f76' : AMBER_TEXT }}>
              {Math.round(confidence * 100)}% confidence
            </Text>
          </View>
        ) : null}
        {hint ? (
          <Text style={{ marginTop: 6, fontFamily: 'Archivo', fontSize: 10, fontWeight: '500', color: checkMe ? AMBER_TEXT : colors.dim }}>
            {hint}
          </Text>
        ) : null}
        {error ? (
          <Text style={{ marginTop: 6, fontFamily: 'Archivo', fontSize: 10.5, fontWeight: '500', color: ERROR_TEXT }}>
            {error}
          </Text>
        ) : required ? (
          <Text style={{ marginTop: 6, fontFamily: 'Archivo', fontSize: 10, fontWeight: '600', color: REQUIRED_TEXT }}>
            Required
          </Text>
        ) : null}
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          backgroundColor: '#151517',
          borderWidth: 1,
          borderColor,
          borderRadius: 9,
          paddingVertical: 8,
          paddingHorizontal: 11,
        }}>
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          placeholder="—"
          placeholderTextColor={colors.dim}
          style={{
            width: 52,
            padding: 0,
            textAlign: 'right',
            fontFamily: 'Archivo',
            fontSize: 15,
            fontWeight: '700',
            color: colors.text,
          }}
        />
        {unit ? <Text style={{ fontFamily: 'Archivo', fontSize: 11, fontWeight: '500', color: colors.dim }}>{unit}</Text> : null}
      </View>
    </View>
  );
}
