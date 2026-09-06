import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { BodyScanResponse } from '@forjd/contracts';
import { BODY_METRIC_DISPLAY_NAMES, type BodyMetric } from '@forjd/domain';

import { getBodyScan } from '@/auth/apiClient';
import { Header } from '@/components/header';
import { ScreenBackground } from '@/components/screen-background';
import { formatScanDate } from '@/features/body/format-scan-date';
import { colors } from '@/theme/tokens';

/** Metrics where a lower number is the improvement -- everything else, higher is. Matches
 *  `s_inbodyCompare()`'s own `(key==='smm'||key==='score')?d>0:d<0` rule, generalised to the
 *  nine BODY_METRICS keys. */
const HIGHER_IS_BETTER = new Set<BodyMetric>(['skeletal_muscle_mass_kg', 'inbody_score']);

/** `s_inbodyCompare()` (`FORJD Mobile.dc.html:2200`). No dedicated screenshot -- same gap as
 *  the confirm and scan-detail screens. */
export default function InBodyCompareScreen() {
  const { a, b } = useLocalSearchParams<{ a: string; b: string }>();
  const [scanA, setScanA] = useState<BodyScanResponse | null>(null);
  const [scanB, setScanB] = useState<BodyScanResponse | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (a && b) {
        Promise.all([getBodyScan(a), getBodyScan(b)])
          .then(([resA, resB]) => {
            if (cancelled) return;
            // Earlier first, regardless of which the user tapped first.
            if (new Date(resA.measuredAt) <= new Date(resB.measuredAt)) {
              setScanA(resA);
              setScanB(resB);
            } else {
              setScanA(resB);
              setScanB(resA);
            }
          })
          .catch(() => {
            if (!cancelled) {
              setScanA(null);
              setScanB(null);
            }
          });
      }
      return () => {
        cancelled = true;
      };
    }, [a, b]),
  );

  if (!scanA || !scanB) {
    return (
      <ScreenBackground>
        <Header title="Compare Scans" onBack={() => router.back()} />
      </ScreenBackground>
    );
  }

  const valuesOf = (scan: BodyScanResponse) => new Map(scan.measurements.map((m) => [m.metric, m]));
  const earlier = valuesOf(scanA);
  const later = valuesOf(scanB);
  const metrics = Array.from(new Set([...earlier.keys(), ...later.keys()])) as BodyMetric[];

  return (
    <ScreenBackground>
      <Header title="Compare Scans" onBack={() => router.back()} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
          {[
            ['Earlier', scanA],
            ['Later', scanB],
          ].map(([label, scan]) => (
            <View
              key={label as string}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 11,
                paddingHorizontal: 8,
                borderRadius: 11,
                backgroundColor: '#17181A',
                borderWidth: 1,
                borderColor: colors.border,
              }}>
              <Text style={{ fontFamily: 'Archivo', fontSize: 9, fontWeight: '600', letterSpacing: 0.08 * 9, textTransform: 'uppercase', color: '#77776f' }}>
                {label as string}
              </Text>
              <Text style={{ marginTop: 6, fontFamily: 'Archivo', fontSize: 13.5, fontWeight: '700', color: colors.text }}>
                {formatScanDate((scan as BodyScanResponse).measuredAt)}
              </Text>
            </View>
          ))}
        </View>

        {metrics.map((metric) => {
          const a1 = earlier.get(metric);
          const b1 = later.get(metric);
          const unit = a1?.unit ?? b1?.unit ?? '';
          const delta = a1 && b1 ? b1.value - a1.value : null;
          const better = delta === null ? null : HIGHER_IS_BETTER.has(metric) ? delta > 0 : delta < 0;
          const deltaText =
            delta === null
              ? '—'
              : `${delta === 0 ? '' : delta > 0 ? '+' : ''}${Number.isInteger(delta) ? delta : delta.toFixed(1)}${unit ? ` ${unit}` : ''}`;

          return (
            <View
              key={metric}
              style={{
                backgroundColor: '#17181A',
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                padding: 14,
                marginBottom: 8,
              }}>
              <Text style={{ fontFamily: 'Archivo', fontSize: 9.5, fontWeight: '600', letterSpacing: 0.1 * 9.5, textTransform: 'uppercase', color: '#77776f', marginBottom: 9 }}>
                {BODY_METRIC_DISPLAY_NAMES[metric]}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: 'Archivo', fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] }}>
                  {a1 ? `${a1.value}${unit ? ` ${unit}` : ''}` : '—'}
                </Text>
                <Text
                  style={{
                    fontFamily: 'Archivo',
                    fontSize: 11.5,
                    fontWeight: '600',
                    color: delta === null || delta === 0 ? colors.dim : better ? colors.green : '#c9503c',
                  }}>
                  {deltaText}
                </Text>
                <Text style={{ fontFamily: 'Archivo', fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] }}>
                  {b1 ? `${b1.value}${unit ? ` ${unit}` : ''}` : '—'}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </ScreenBackground>
  );
}
