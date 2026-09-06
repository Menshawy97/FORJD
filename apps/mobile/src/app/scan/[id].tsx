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

/** `s_scanDetail()` (`FORJD Mobile.dc.html:2231`). No dedicated screenshot -- the prototype
 *  is the sole authority, same gap `inbody-confirm.tsx` notes. */
export default function ScanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [scan, setScan] = useState<BodyScanResponse | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (id) {
        getBodyScan(id)
          .then((response) => {
            if (!cancelled) setScan(response);
          })
          .catch(() => {
            if (!cancelled) setScan(null);
          });
      }
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  return (
    <ScreenBackground>
      <Header title={scan ? formatScanDate(scan.measuredAt) : 'Scan'} onBack={() => router.back()} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        {(scan?.measurements ?? []).map((measurement) => (
          <View
            key={measurement.metric}
            style={{
              backgroundColor: '#17181A',
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              paddingVertical: 13,
              paddingHorizontal: 15,
              marginBottom: 8,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
            <Text style={{ fontFamily: 'Archivo', fontSize: 13, fontWeight: '500', color: colors.dim }}>
              {BODY_METRIC_DISPLAY_NAMES[measurement.metric as BodyMetric] ?? measurement.metric}
            </Text>
            <Text
              style={{
                fontFamily: 'Archivo',
                fontSize: 15,
                fontWeight: '700',
                color: colors.text,
                fontVariant: ['tabular-nums'],
              }}>
              {measurement.value}
              {measurement.unit ? ` ${measurement.unit}` : ''}
            </Text>
          </View>
        ))}
      </ScrollView>
    </ScreenBackground>
  );
}
