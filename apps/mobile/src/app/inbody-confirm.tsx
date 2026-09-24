import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import {
  BODY_METRICS,
  BODY_METRIC_DISPLAY_NAMES,
  BODY_METRIC_UNITS,
  SEGMENTAL_SITES,
  SEGMENTAL_SITE_DISPLAY_NAMES,
  shouldPrefill,
  type BodyMetric,
  type SegmentalSite,
} from '@forjd/domain';

import { confirmBodyScan } from '@/auth/apiClient';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { combineDateAndTime, ScanDateTimeFields } from '@/features/body/scan-date-time';
import { ScanValueRow } from '@/features/body/scan-value-row';
import { takePendingScan, type PendingScan } from '@/store/pending-scan';
import { colors } from '@/theme/tokens';

/** "2026-08-19" -- the banner's own date format ("Extracted from your photo on 2026-08-19, 09:38"). */
function formatBannerDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatBannerTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * `s_inbodyConfirm()` (`FORJD Mobile.dc.html:2281`), matched pixel-by-pixel against
 * `confirm-inbody.png` and `confirm-inbody2.png`.
 *
 * **The one deliberate deviation from the design, recorded in ADR-032**: the prototype
 * pre-fills every extracted-value field regardless of confidence, including visceral fat at
 * a demo .72. This contradicts `docs/architecture/health-data.md`'s "nothing saves
 * unconfirmed" rule -- a pre-filled wrong number is exactly what a tired user taps past.
 * Below `CONFIDENCE_PREFILL_THRESHOLD` (0.9, the same number the design's own confidence bar
 * already turns amber at), the field renders **blank**, forcing a real keystroke. The amber
 * visual styling itself is untouched. This does not apply to the segmental section, which
 * the design never shows a confidence bar for at all.
 */
export default function InBodyConfirmScreen() {
  const [pending, setPending] = useState<PendingScan | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [segmentalValues, setSegmentalValues] = useState<Record<string, string>>({});
  const [scanDate, setScanDate] = useState(new Date());
  const [scanTime, setScanTime] = useState(new Date());
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

      const initialSegmental: Record<string, string> = {};
      for (const site of SEGMENTAL_SITES) {
        const field = scan.extracted.segmental[site];
        initialSegmental[site] =
          field.value != null && shouldPrefill(field.confidence) ? String(field.value) : '';
      }
      setSegmentalValues(initialSegmental);

      const now = new Date();
      setScanDate(scan.extracted.testDate ? new Date(scan.extracted.testDate) : now);
      setScanTime(now);
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
    const bodyMeasurements = BODY_METRICS.map((metric) => {
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
    });

    const segMeasurements = SEGMENTAL_SITES.map((site) => {
      const raw = segmentalValues[site]?.trim();
      if (!raw) return null;
      const value = Number(raw);
      if (!Number.isFinite(value)) return null;
      return {
        metric: site,
        value,
        unit: 'kg',
        confidence: pending.extracted.segmental[site].confidence,
      };
    });

    const measurements = [...bodyMeasurements, ...segMeasurements].filter(
      (m): m is NonNullable<typeof m> => m !== null,
    );

    if (measurements.length === 0) {
      toast.show('Enter at least one value before saving.');
      return;
    }

    setSaving(true);
    try {
      await confirmBodyScan(pending.photoUri, { measuredAt: combineDateAndTime(scanDate, scanTime).toISOString(), measurements });
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
        {/* Extraction banner */}
        <View
          style={{
            flexDirection: 'row',
            gap: 11,
            backgroundColor: '#17181A',
            borderWidth: 1,
            borderColor: 'rgba(233,113,47,.2)',
            borderRadius: 14,
            padding: 13,
            paddingHorizontal: 14,
            marginBottom: 16,
          }}>
          <View style={{ marginTop: 1 }}>
            <Icon name="bolt" color={colors.accent} size={18} />
          </View>
          <Text style={{ flex: 1, fontFamily: 'Archivo', fontSize: 12, lineHeight: 12 * 1.5, color: '#c8c8c0' }}>
            Extracted from your photo on{' '}
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {formatBannerDate(scanDate)}, {formatBannerTime(scanTime)}
            </Text>
            . Tap any value to correct it — nothing is saved until you confirm.
          </Text>
        </View>

        <ScanDateTimeFields
          date={scanDate}
          time={scanTime}
          onDateChange={setScanDate}
          onTimeChange={setScanTime}
          dateLabel="Read from sheet"
          note="Data is stored against this date, not the day you uploaded it."
        />

        {/* Extracted values */}
        <Text
          style={{
            fontFamily: 'Archivo',
            fontSize: 9.5,
            fontWeight: '600',
            letterSpacing: 0.1 * 9.5,
            textTransform: 'uppercase',
            color: '#94948B',
            marginTop: 24,
            marginBottom: 2,
          }}>
          Extracted values
        </Text>
        {BODY_METRICS.map((metric: BodyMetric) => (
          <ScanValueRow
            key={metric}
            label={BODY_METRIC_DISPLAY_NAMES[metric]}
            unit={BODY_METRIC_UNITS[metric]}
            confidence={pending.extracted.fields[metric].confidence}
            value={values[metric] ?? ''}
            onChange={(text) => setValues((v) => ({ ...v, [metric]: text }))}
          />
        ))}

        {/* Segmental lean analysis -- no confidence bar shown, per the design */}
        <Text
          style={{
            fontFamily: 'Archivo',
            fontSize: 9.5,
            fontWeight: '600',
            letterSpacing: 0.1 * 9.5,
            textTransform: 'uppercase',
            color: '#94948B',
            marginTop: 26,
            marginBottom: 2,
          }}>
          Segmental lean analysis
        </Text>
        {SEGMENTAL_SITES.map((site: SegmentalSite) => (
          <ScanValueRow
            key={site}
            label={SEGMENTAL_SITE_DISPLAY_NAMES[site]}
            unit="kg"
            value={segmentalValues[site] ?? ''}
            onChange={(text) => setSegmentalValues((v) => ({ ...v, [site]: text }))}
          />
        ))}

        {/* CTA */}
        <View style={{ marginTop: 22, gap: 11 }}>
          <Pressable
            accessibilityRole="button"
            onPress={save}
            disabled={saving}
            style={{
              height: 52,
              borderRadius: 12,
              // R19 (H13): white text on raw `accent` measured 3.06:1, below AA's 4.5:1 floor.
              backgroundColor: colors.accentDark,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: saving ? 0.6 : 1,
            }}>
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ fontFamily: 'Archivo', fontSize: 15.5, fontWeight: '700', letterSpacing: 0.01 * 15.5, color: '#fff' }}>
                Confirm & Save
              </Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/inbody')}
            style={{
              height: 52,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Text style={{ fontFamily: 'Archivo', fontSize: 15.5, fontWeight: '600', letterSpacing: 0.01 * 15.5, color: colors.dim }}>
              Retake Photo
            </Text>
          </Pressable>
        </View>
      </ScrollView>
      <Toast {...toast} />
    </ScreenBackground>
  );
}
