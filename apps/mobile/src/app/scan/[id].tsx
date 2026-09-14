import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { BodyScanResponse } from '@forjd/contracts';
import { BODY_METRIC_DISPLAY_NAMES, type BodyMetric } from '@forjd/domain';

import { getBodyScan } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Header } from '@/components/header';
import { ScreenBackground } from '@/components/screen-background';
import { formatScanDate } from '@/features/body/format-scan-date';
import { colors } from '@/theme/tokens';

/** R26: distinct from the empty state (a real scan with zero measurements), and offers a
 *  retry that re-issues the request -- matching `program/[id].tsx`'s error-view shape. */
function errorMessage(error: unknown): string {
  return classifyRequestFailure(error) === 'offline'
    ? OFFLINE_MESSAGE
    : 'Could not load this scan. Please try again.';
}

/** `s_scanDetail()` (`FORJD Mobile.dc.html:2231`). No dedicated screenshot -- the prototype
 *  is the sole authority, same gap `inbody-confirm.tsx` notes. */
export default function ScanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [scan, setScan] = useState<BodyScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    setError(null);
    getBodyScan(id)
      .then((response) => {
        setScan(response);
      })
      .catch((cause: unknown) => {
        setScan(null);
        setError(errorMessage(cause));
      });
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (error) {
    return (
      <ScreenBackground>
        <Header title="Scan" onBack={() => router.back()} />
        <View className="flex-1 items-center justify-center px-screen-x">
          <Text
            className="mb-4 text-center font-archivo text-[13px]"
            style={{ color: colors.dim }}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry"
            onPress={load}
            className="rounded-button border px-4 py-2"
            style={{ borderColor: colors.border }}>
            <Text className="font-archivo text-[13px] font-semibold" style={{ color: colors.text }}>
              Retry
            </Text>
          </Pressable>
        </View>
      </ScreenBackground>
    );
  }

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
