import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { BODY_METRICS, BODY_METRIC_DISPLAY_NAMES, BODY_METRIC_UNITS, shouldPrefill } from '@forjd/domain';

import { confirmBodyScan } from '@/auth/apiClient';
import { Header } from '@/components/header';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { takePendingScan, type PendingScan } from '@/store/pending-scan';
import { colors } from '@/theme/tokens';

const AMBER = '#c9a03c';
const AMBER_TEXT = '#a08a4e';
const AMBER_BORDER = 'rgba(201,160,60,.45)';

/**
 * `s_inbodyConfirm()` (`FORJD Mobile.dc.html:2281`). No dedicated screenshot exists for this
 * screen (only `inbody update and history.png` was captured) -- the prototype is the sole
 * authority for its exact geometry, per the plan's own note on this gap.
 *
 * **The one deliberate deviation from the design, recorded in ADR-032**: the prototype
 * pre-fills every field regardless of confidence, including visceral fat at .72. This
 * contradicts `docs/architecture/health-data.md`'s "nothing saves unconfirmed" rule -- a
 * pre-filled wrong number is exactly what a tired user taps past. Below `CONFIDENCE_PREFILL_
 * THRESHOLD` (0.9, the same number the design's own confidence bar already turns amber at),
 * the field renders **blank**, forcing a real keystroke. The amber styling itself is
 * untouched -- only the value is withheld.
 */
export default function InBodyConfirmScreen() {
  const [pending, setPending] = useState<PendingScan | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useFocusEffect(
    useCallback(() => {
      const scan = takePendingScan();
      if (!scan) {
        router.replace('/inbody');
        return;
      }
      setPending(scan);
      const initial: Record<string, string> = {};
      for (const metric of BODY_METRICS) {
        const field = scan.extracted.fields[metric];
        initial[metric] =
          field.value != null && shouldPrefill(field.confidence) ? String(field.value) : '';
      }
      setValues(initial);
    }, []),
  );

  if (!pending) {
    return (
      <ScreenBackground>
        <Header title="Confirm scan" onBack={() => router.replace('/inbody')} />
      </ScreenBackground>
    );
  }

  const save = async () => {
    const measurements = BODY_METRICS.map((metric) => {
      const raw = values[metric]?.trim();
      if (!raw) return null;
      const value = Number(raw);
      if (!Number.isFinite(value)) return null;
      return {
        metric,
        value,
        unit: BODY_METRIC_UNITS[metric],
        confidence: pending.extracted.fields[metric].confidence,
      };
    }).filter((m): m is NonNullable<typeof m> => m !== null);

    if (measurements.length === 0) {
      toast.show('Enter at least one value before saving.');
      return;
    }

    setSaving(true);
    try {
      await confirmBodyScan(pending.photoUri, { measuredAt: new Date().toISOString(), measurements });
      router.replace('/inbody');
    } catch {
      toast.show('Could not save this scan. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenBackground>
      <Header title="Confirm scan" onBack={() => router.replace('/inbody')} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled">
        <View
          style={{
            backgroundColor: '#17181A',
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 14,
            padding: 15,
          }}>
          {BODY_METRICS.map((metric) => {
            const field = pending.extracted.fields[metric];
            const confident = field.confidence >= 0.9;
            const barColor = confident ? colors.green : AMBER;
            return (
              <View
                key={metric}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: 'rgba(255,255,255,.05)',
                }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: 'Archivo', fontSize: 13.5, fontWeight: '500', color: colors.text }}>
                    {BODY_METRIC_DISPLAY_NAMES[metric]}
                  </Text>
                  <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 40, height: 3, borderRadius: 2, backgroundColor: '#26272a', overflow: 'hidden' }}>
                      <View
                        style={{
                          width: `${Math.round(field.confidence * 100)}%`,
                          height: 3,
                          backgroundColor: barColor,
                        }}
                      />
                    </View>
                    <Text
                      style={{
                        fontFamily: 'Archivo',
                        fontSize: 10,
                        fontWeight: '500',
                        color: confident ? '#6d8f76' : AMBER_TEXT,
                      }}>
                      {Math.round(field.confidence * 100)}% confidence
                    </Text>
                  </View>
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    backgroundColor: '#151517',
                    borderWidth: 1,
                    borderColor: confident ? colors.border : AMBER_BORDER,
                    borderRadius: 9,
                    paddingVertical: 8,
                    paddingHorizontal: 11,
                  }}>
                  <TextInput
                    value={values[metric] ?? ''}
                    onChangeText={(text) => setValues((v) => ({ ...v, [metric]: text }))}
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
                  {BODY_METRIC_UNITS[metric] ? (
                    <Text style={{ fontFamily: 'Archivo', fontSize: 11, fontWeight: '500', color: colors.dim }}>
                      {BODY_METRIC_UNITS[metric]}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={save}
          disabled={saving}
          style={{
            marginTop: 20,
            height: 52,
            borderRadius: 12,
            backgroundColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: saving ? 0.6 : 1,
          }}>
          {saving ? (
            <ActivityIndicator color="#101011" />
          ) : (
            <Text style={{ fontFamily: 'Archivo', fontSize: 14, fontWeight: '700', color: '#101011' }}>
              Save Scan
            </Text>
          )}
        </Pressable>
      </ScrollView>
      <Toast {...toast} />
    </ScreenBackground>
  );
}
