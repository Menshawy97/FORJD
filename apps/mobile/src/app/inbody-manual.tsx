import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import {
  BODY_METRICS,
  BODY_METRIC_DISPLAY_NAMES,
  BODY_METRIC_UNITS,
  SEGMENTAL_SITES,
  SEGMENTAL_SITE_DISPLAY_NAMES,
  type BodyMetric,
  type SegmentalSite,
} from '@forjd/domain';

import { createManualBodyScan } from '@/auth/apiClient';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { rangeError } from '@/features/body/range-error';
import { combineDateAndTime, ScanDateTimeFields } from '@/features/body/scan-date-time';
import type { ScanProfileField } from '@/features/body/scan-profile';
import { ScanProfileRows, useScanProfile } from '@/features/body/scan-profile-rows';
import { ScanValueRow } from '@/features/body/scan-value-row';
import { colors } from '@/theme/tokens';

/** Weight must be entered (the user's rule), as must height and age (the rows above the values,
 *  `ScanProfileRows`); everything else, body fat % included since 2026-09-25, is optional. */
const REQUIRED: Partial<Record<BodyMetric, string>> = {
  weight_kg: 'Enter your weight',
};

const SECTION_LABEL = {
  fontFamily: 'Archivo',
  fontSize: 9.5,
  fontWeight: '600',
  letterSpacing: 0.1 * 9.5,
  textTransform: 'uppercase',
  color: '#94948B',
} as const;

function parseValue(raw: string | undefined): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/**
 * Manual InBody entry (docs/product/manual-inbody-entry-plan.md): the user types their results
 * in, with no photo and no AI. The layout is the Confirm-scan screen's, starting empty, as the
 * user approved in the design replica: no confidence bars, weight labelled "Required" (body fat %
 * too until 2026-09-25, when the user made it optional), and a red box with a reason when it is
 * missing at save.
 */
export default function InBodyManualScreen() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [segmentalValues, setSegmentalValues] = useState<Record<string, string>>({});
  const [date, setDate] = useState(() => new Date());
  const [time, setTime] = useState(() => new Date());
  const [errors, setErrors] = useState<Partial<Record<BodyMetric | SegmentalSite | ScanProfileField, string>>>({});
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const toast = useToast();
  // Height and age, filled from the profile; the age follows the test date (scan-height-age-plan.md §3).
  const scanProfile = useScanProfile(null, date, true);

  const setValue = (metric: BodyMetric, text: string) => {
    setValues((current) => ({ ...current, [metric]: text }));
    if (errors[metric]) setErrors((current) => ({ ...current, [metric]: undefined }));
  };

  const save = async () => {
    const missing: Partial<Record<BodyMetric | SegmentalSite | ScanProfileField, string>> = scanProfile.errors();
    for (const [metric, message] of Object.entries(REQUIRED) as [BodyMetric, string][]) {
      if (parseValue(values[metric]) === null) missing[metric] = message;
    }
    for (const metric of BODY_METRICS) {
      const value = parseValue(values[metric]);
      const problem = value === null ? null : rangeError(metric, value, BODY_METRIC_UNITS[metric]);
      if (problem) missing[metric] = problem;
    }
    for (const site of SEGMENTAL_SITES) {
      const value = parseValue(segmentalValues[site]);
      const problem = value === null ? null : rangeError(site, value, 'kg');
      if (problem) missing[site] = problem;
    }
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      // The required values sit at the top of the list; start there so the first red row is in view.
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    const measurements = [
      ...BODY_METRICS.map((metric) => {
        const value = parseValue(values[metric]);
        return value === null ? null : { metric, value, unit: BODY_METRIC_UNITS[metric] };
      }),
      ...SEGMENTAL_SITES.map((site) => {
        const value = parseValue(segmentalValues[site]);
        return value === null ? null : { metric: site, value, unit: 'kg' };
      }),
    ].filter((m): m is NonNullable<typeof m> => m !== null);

    setSaving(true);
    try {
      const heightCm = Number(scanProfile.height.text);
      await createManualBodyScan({
        measuredAt: combineDateAndTime(date, time).toISOString(),
        heightCm,
        ageYears: Number(scanProfile.age.text),
        measurements,
      });
      router.replace({ pathname: '/inbody', params: { saved: 'manual', ...scanProfile.heightPromptParams(heightCm) } });
    } catch {
      toast.show('Could not save these values. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenBackground>
      <Header title="Enter values" onBack={() => router.replace('/inbody')} />
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled">
        <View
          style={{
            flexDirection: 'row',
            gap: 11,
            backgroundColor: '#17181A',
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 14,
            padding: 13,
            paddingHorizontal: 14,
            marginBottom: 16,
          }}>
          <View style={{ marginTop: 1 }}>
            <Icon name="pencil" color={colors.accent} size={18} />
          </View>
          <Text style={{ flex: 1, fontFamily: 'Archivo', fontSize: 12, lineHeight: 12 * 1.5, color: '#c8c8c0' }}>
            Type the values from your InBody result.{' '}
            <Text style={{ color: colors.text, fontWeight: '600' }}>Height, age and weight</Text> are required — add
            any others your sheet shows.
          </Text>
        </View>

        <ScanDateTimeFields
          date={date}
          time={time}
          onDateChange={setDate}
          onTimeChange={setTime}
          dateLabel="Test date"
          note="Data is stored against this date, not the day you entered it."
        />

        <Text style={{ ...SECTION_LABEL, marginTop: 24, marginBottom: 2 }}>Values</Text>
        <ScanProfileRows
          mode="manual"
          scanProfile={scanProfile}
          errors={errors}
          onEdit={(field) => setErrors((current) => ({ ...current, [field]: undefined }))}
        />
        {BODY_METRICS.map((metric: BodyMetric) => (
          <ScanValueRow
            key={metric}
            label={BODY_METRIC_DISPLAY_NAMES[metric]}
            unit={BODY_METRIC_UNITS[metric]}
            value={values[metric] ?? ''}
            onChange={(text) => setValue(metric, text)}
            required={metric in REQUIRED}
            error={errors[metric]}
          />
        ))}

        <Text style={{ ...SECTION_LABEL, marginTop: 26, marginBottom: 2 }}>Segmental lean analysis · optional</Text>
        {SEGMENTAL_SITES.map((site: SegmentalSite) => (
          <ScanValueRow
            key={site}
            label={SEGMENTAL_SITE_DISPLAY_NAMES[site]}
            unit="kg"
            value={segmentalValues[site] ?? ''}
            onChange={(text) => {
              setSegmentalValues((current) => ({ ...current, [site]: text }));
              if (errors[site]) setErrors((current) => ({ ...current, [site]: undefined }));
            }}
            error={errors[site]}
          />
        ))}

        <View style={{ marginTop: 22, gap: 11 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save"
            onPress={save}
            disabled={saving}
            style={{
              height: 52,
              borderRadius: 12,
              // Same fill as Confirm & Save: white on raw `accent` fails AA (R19).
              backgroundColor: colors.accentDark,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: saving ? 0.6 : 1,
            }}>
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ fontFamily: 'Archivo', fontSize: 15.5, fontWeight: '700', letterSpacing: 0.01 * 15.5, color: '#fff' }}>
                Save
              </Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
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
              Cancel
            </Text>
          </Pressable>
        </View>
      </ScrollView>
      <Toast {...toast} />
    </ScreenBackground>
  );
}
