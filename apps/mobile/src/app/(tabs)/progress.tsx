import type { BodyScanSeriesResponse, ProgressStrengthResponse } from '@forjd/contracts';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { getBodyScanSeries, getProgressStrength } from '@/auth/apiClient';
import { ScreenBackground } from '@/components/screen-background';
import { SegmentedControl } from '@/components/segmented-control';
import { Sparkline } from '@/components/sparkline';
import { BodyView } from '@/features/body/body-view';
import { Card } from '@/features/progress/card';
import { InsightCard } from '@/features/progress/insight-card';
import { MuscleSplit } from '@/features/progress/muscle-split';
import { PrTile } from '@/features/progress/pr-tile';
import { StepCountCard } from '@/features/progress/step-count-card';
import { TrainingCalendar } from '@/features/progress/training-calendar';
import { VolumeBars } from '@/features/progress/volume-bars';
import { todayLocalDate } from '@/nutrition/date';

/**
 * The Progress tab (Phase 4). Built against `progress strength.png`, `progress strength 2.png`
 * and `progress strength 3.png`, with the prototype's template markup (`FORJD Mobile.dc.html`
 * lines 288-503) and `progVals()`/`calVals()`/`muscleVals()` view-models as the second
 * authority.
 *
 * **Only the Strength tab has a backend.** Body needs InBody (Phase 5); Health needs Health
 * Connect / HealthKit (Phase 6). Both render the segmented control's chrome with an honest
 * explanation rather than the design's demo cards -- the same standing rule Home's readiness
 * card already established.
 *
 * Loading mirrors Home's own idiom: `useFocusEffect` (not mount-only -- finishing a workout and
 * tabbing back here must not leave stale figures), a `loadGeneration` ref so a response that
 * resolves after the screen has blurred cannot commit, one `setState` per load.
 */
type ProgressTab = 'strength' | 'body' | 'health';

const TABS = [
  { label: 'Strength', value: 'strength' as const },
  { label: 'Body', value: 'body' as const },
  { label: 'Health', value: 'health' as const },
];

export default function ProgressScreen() {
  const [tab, setTab] = useState<ProgressTab>('strength');
  const [strength, setStrength] = useState<ProgressStrengthResponse | null>(null);
  const [bodySeries, setBodySeries] = useState<BodyScanSeriesResponse | null>(null);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = (loadGeneration.current += 1);
    try {
      const response = await getProgressStrength();
      if (generation === loadGeneration.current) setStrength(response);
    } catch {
      // A failed read leaves the screen in its honest-empty state, exactly as a fresh account
      // renders -- never an error toast on a tab whose whole subject is the athlete's own past.
      if (generation === loadGeneration.current) setStrength(null);
    }
    try {
      const response = await getBodyScanSeries();
      if (generation === loadGeneration.current) setBodySeries(response);
    } catch {
      if (generation === loadGeneration.current) setBodySeries(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        loadGeneration.current += 1;
      };
    }, [load]),
  );

  return (
    <ScreenBackground>
      <Text
        style={{
          paddingHorizontal: 22,
          paddingTop: 2,
          paddingBottom: 12,
          fontFamily: 'Archivo',
          fontSize: 26,
          fontWeight: '700',
          letterSpacing: -0.02 * 26,
          lineHeight: 26 * 1.15,
          color: '#F6F5F3',
        }}>
        Progress
      </Text>

      <View style={{ paddingHorizontal: 22, paddingBottom: 14 }}>
        <SegmentedControl
          options={TABS}
          value={tab}
          onChange={setTab}
          accessibilityLabel="Progress view"
        />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        {tab === 'strength' ? (
          <StrengthView data={strength} />
        ) : tab === 'body' ? (
          <BodyView series={bodySeries} hasAnyScan={(bodySeries?.series.length ?? 0) > 0} />
        ) : (
          <Card>
            <Text style={{ fontFamily: 'Archivo', fontSize: 13, color: '#9A9A92' }}>
              Health metrics need a connected wearable. Connect Health Connect or Apple Health
              to see them here.
            </Text>
          </Card>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}

function StrengthView({ data }: { data: ProgressStrengthResponse | null }) {
  const personalRecords = data?.personalRecords ?? [];
  const oneRepMaxTrend = data?.oneRepMaxTrend.map((point) => point.estimatedOneRepMaxKg) ?? [];
  const weeklyVolumeKg =
    data?.weeklyVolumeKg ??
    Array.from({ length: 7 }, (_, index) => ({ dayOfWeek: index + 1, volumeKg: 0 }));
  const trainingCalendar =
    data?.trainingCalendar ?? { month: todayLocalDate().slice(0, 7), days: [], daysTrained: 0 };
  const muscleSplit = data?.muscleSplit ?? [];

  // Always exactly two slots, honest-empty rather than hidden -- an account with fewer than
  // two personal records still sees the tile row's full chrome (PrTile's own docblock).
  const prSlots: (typeof personalRecords)[number][] | null[] = [
    personalRecords[0] ?? null,
    personalRecords[1] ?? null,
  ];

  return (
    <>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {prSlots.map((record, index) => (
          <PrTile key={record?.exerciseId ?? `empty-${index}`} record={record} />
        ))}
      </View>

      <Card title="Estimated 1RM — 8 weeks">
        {oneRepMaxTrend.length >= 2 ? (
          <Sparkline points={oneRepMaxTrend} height={86} color="#E9712F" />
        ) : (
          <Text style={{ fontFamily: 'Archivo', fontSize: 13, color: '#9A9A92' }}>
            Log a few more weeks to see your estimated one-rep max trend.
          </Text>
        )}
      </Card>

      <Card title="Weekly volume (kg)">
        <VolumeBars days={weeklyVolumeKg} />
      </Card>

      <Card>
        <TrainingCalendar data={trainingCalendar} today={todayLocalDate()} />
      </Card>

      <Card title="Muscle group split">
        <MuscleSplit rows={muscleSplit} />
      </Card>

      <Card title="Avg step count">
        <StepCountCard />
      </Card>

      <InsightCard insight={data?.insight ?? null} />
    </>
  );
}
