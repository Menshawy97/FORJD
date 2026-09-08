import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import type { HealthObservationSeriesResponse, ReadinessResponse } from '@forjd/contracts';
import { evaluateHealthInsight, HEALTH_METRIC_TYPE_DISPLAY_NAMES, type HealthMetricType } from '@forjd/domain';

import { HEALTH_CONNECT_SUPPORTED_METRICS } from '@/integrations/health/health-connect-record-mapping';
import { Card } from '@/features/progress/card';
import { Sparkline } from '@/components/sparkline';
import { colors } from '@/theme/tokens';

/**
 * Progress -> Health tab, built against `progress health 1.png`, `progress health 2.png` and
 * `progress health change widget.png` -- three configurable headline tiles (tap one to open
 * "Choose widget", exactly `body-view.tsx`'s own per-slot picker pattern) with no title above
 * them, then a "Health metrics" title with everything else below it: the trend chart for
 * whichever tile was tapped last, followed by the scrollable metrics list.
 *
 * **Deliberate deviations from the screenshots**, by explicit user direction: the design puts
 * an accent-colored border and a highlighted background around the selected headline tile (this
 * file omits both); the design's own untitled section groups only the trend chart with the
 * headline tiles, with "Health metrics" heading just the list below it (here "Health metrics"
 * heads the trend chart too); and `hrv`/`resting_heart_rate` always appear in the metrics list
 * even though both remain selectable as headline tiles via "Choose widget".
 *
 * **`walking_heart_rate` is hidden from every list here whenever it is unsupported, driven by
 * `HEALTH_CONNECT_SUPPORTED_METRICS` (a capability flag), never by a `Platform.OS` check.**
 * This screen has no idea which OS it's running on and should not need to -- Health Connect
 * (Android) genuinely cannot supply this metric today (`health-connect-record-mapping.ts`'s own
 * docblock explains why), while Apple HealthKit (iOS, Phase 11) will be able to once that
 * provider exists. The capability list is what changes then, not this file.
 *
 * **Two other things the screenshots show that this file deliberately does not build**, because
 * building them would mean fabricating data FORJD's domain model has no way to produce
 * honestly:
 * - **Blood oxygen** -- not a metric type in `HEALTH_METRIC_TYPES`; no oxygen-saturation type
 *   exists in the domain model at all.
 * - **Sleep consistency** -- the design's "78%, +16 pts over 6 weeks" is a computed weekly
 *   statistic, not a raw observation; no such computation exists anywhere in this codebase yet.
 *
 * The "FORJD Insight" card (never "AI Insight" -- ADR-030, the design's own demo label is
 * exactly the fabrication that ADR forbids) is real: `evaluateHealthInsight` in `@forjd/domain`
 * derives it directly from `computeReadiness`'s own already-cited output, not a separate
 * heuristic -- see that file's header docblock for the full citation.
 *
 * The design's per-card device subtitles ("Apple Watch · cardio fitness", "WHOOP · sleep")
 * are also not built here -- `healthMetricSeriesPointSchema` deliberately carries no `source`
 * field (YAGNI, per its own docblock, since nothing needed it before this screen), so there is
 * no real value to show yet. Adding a source label is a real (small) contract change for a
 * later slice, not something to fabricate now -- and FORJD would show one resolved source per
 * metric either way (health-data.md's source-priority policy), never several devices side by
 * side the way the demo design implies.
 */
const FULL_WIDGET_CATALOG: ReadonlyArray<{ metric: HealthMetricType; label: string }> = [
  { metric: 'hrv', label: 'Avg HRV' },
  { metric: 'sleep_duration', label: 'Avg sleep' },
  { metric: 'resting_heart_rate', label: 'Avg RHR' },
  { metric: 'vo2_max', label: 'VO2 max' },
  { metric: 'respiratory_rate', label: 'Resp. rate' },
];
const WIDGET_CATALOG = FULL_WIDGET_CATALOG.filter((w) => HEALTH_CONNECT_SUPPORTED_METRICS.includes(w.metric));

/** Metrics shown in the scrollable list below the headline tiles -- everything Health Connect
 *  can report that isn't already a default headline tile, plus `hrv` and `resting_heart_rate`
 *  (by explicit user direction -- both stay choosable as headline tiles too via "Choose widget",
 *  but also always appear in this list). `walking_heart_rate` is included in the candidate list
 *  but filtered out below by capability, not omitted outright -- once an Apple Health provider
 *  supplies it (Phase 11), it reappears here with no code change. */
const METRICS_LIST_CANDIDATES: readonly HealthMetricType[] = [
  'hrv',
  'heart_rate',
  'resting_heart_rate',
  'walking_heart_rate',
  'vo2_max',
  'respiratory_rate',
];
const METRICS_LIST = METRICS_LIST_CANDIDATES.filter((m) => HEALTH_CONNECT_SUPPORTED_METRICS.includes(m));

interface HealthViewProps {
  series: HealthObservationSeriesResponse | null;
  readiness: ReadinessResponse | null;
}

function seriesFor(series: HealthObservationSeriesResponse | null, metricType: HealthMetricType) {
  return series?.series.find((s) => s.metricType === metricType) ?? null;
}

function formatValue(metricType: HealthMetricType, value: number, unit: string): string {
  if (metricType === 'sleep_duration') {
    const hours = Math.floor(value / 60);
    const minutes = Math.round(value % 60);
    return `${hours}h ${minutes}m`;
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)}${unit ? ` ${unit}` : ''}`;
}

function delta(points: ReadonlyArray<{ value: number }>): { text: string; good: boolean | null } {
  if (points.length < 2) return { text: '', good: null };
  const first = points[0]!.value;
  const last = points[points.length - 1]!.value;
  const d = last - first;
  if (d === 0) return { text: 'Stable', good: null };
  const rounded = Number.isInteger(d) ? d : Number(d.toFixed(1));
  return { text: `${d > 0 ? '+' : ''}${rounded}`, good: d > 0 };
}

function MetricTile({
  metric,
  label,
  series,
  onPress,
}: {
  metric: HealthMetricType;
  label: string;
  series: HealthObservationSeriesResponse | null;
  onPress: () => void;
}) {
  const s = seriesFor(series, metric);
  const latest = s && s.points.length > 0 ? s.points[s.points.length - 1]!.value : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Change ${label} widget`}
      onPress={onPress}
      style={{
        flex: 1,
        backgroundColor: '#17181A',
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 14,
        padding: 12,
      }}>
      <Text
        style={{
          fontFamily: 'Archivo',
          fontSize: 9,
          fontWeight: '600',
          letterSpacing: 0.14 * 9,
          textTransform: 'uppercase',
          color: '#77776F',
        }}>
        {label}
      </Text>
      <Text
        style={{
          marginTop: 6,
          fontFamily: 'Archivo',
          fontSize: 19,
          fontWeight: '700',
          color: colors.green,
        }}>
        {latest != null ? formatValue(metric, latest, '') : '—'}
      </Text>
      {s?.unit ? (
        <Text style={{ marginTop: 2, fontFamily: 'Archivo', fontSize: 10.5, color: colors.dim }}>{s.unit}</Text>
      ) : null}
    </Pressable>
  );
}

export function HealthView({ series, readiness }: HealthViewProps) {
  const insight = readiness ? evaluateHealthInsight(readiness) : null;
  const [headlineWidgets, setHeadlineWidgets] = useState<[HealthMetricType, HealthMetricType, HealthMetricType]>([
    'sleep_duration',
    'resting_heart_rate',
    'vo2_max',
  ]);
  const [pickerSlot, setPickerSlot] = useState<0 | 1 | 2 | null>(null);
  const [chartMetric, setChartMetric] = useState<HealthMetricType>('sleep_duration');

  const chartSeries = seriesFor(series, chartMetric);
  const chartPoints = chartSeries?.points.map((p) => p.value) ?? [];
  const chartLabel = WIDGET_CATALOG.find((w) => w.metric === chartMetric)?.label ?? HEALTH_METRIC_TYPE_DISPLAY_NAMES[chartMetric];

  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {headlineWidgets.map((metric, slot) => (
          <MetricTile
            key={slot}
            metric={metric}
            label={WIDGET_CATALOG.find((w) => w.metric === metric)?.label ?? HEALTH_METRIC_TYPE_DISPLAY_NAMES[metric]}
            series={series}
            onPress={() => {
              setChartMetric(metric);
              setPickerSlot(slot as 0 | 1 | 2);
            }}
          />
        ))}
      </View>

      <Modal visible={pickerSlot !== null} transparent animationType="slide" onRequestClose={() => setPickerSlot(null)}>
        <Pressable
          onPress={() => setPickerSlot(null)}
          style={{ flex: 1, backgroundColor: 'rgba(10,10,11,.72)', justifyContent: 'flex-end' }}>
          <Pressable
            style={{
              backgroundColor: '#17181a',
              borderTopWidth: 1,
              borderTopColor: 'rgba(255,255,255,.07)',
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              paddingTop: 20,
              paddingHorizontal: 22,
              paddingBottom: 24,
              gap: 8,
            }}>
            <Text style={{ marginBottom: 6, fontFamily: 'Archivo', fontSize: 18, fontWeight: '700', lineHeight: 18 * 1.2, color: colors.text }}>
              Choose widget
            </Text>
            {WIDGET_CATALOG.map((option) => (
              <Pressable
                key={option.metric}
                accessibilityRole="button"
                onPress={() => {
                  if (pickerSlot !== null) {
                    setHeadlineWidgets((current) => {
                      const next = [...current] as [HealthMetricType, HealthMetricType, HealthMetricType];
                      next[pickerSlot] = option.metric;
                      return next;
                    });
                  }
                  setPickerSlot(null);
                }}
                style={{
                  paddingVertical: 14,
                  paddingHorizontal: 15,
                  borderRadius: 11,
                  backgroundColor: '#141517',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,.07)',
                }}>
                <Text style={{ fontFamily: 'Archivo', fontSize: 14, fontWeight: '700', color: colors.text }}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      <Text
        style={{
          fontFamily: 'Archivo',
          fontSize: 9.5,
          fontWeight: '600',
          letterSpacing: 0.14 * 9.5,
          textTransform: 'uppercase',
          color: '#77776F',
          marginTop: 22,
          marginBottom: 10,
        }}>
        Health metrics
      </Text>

      <Card>
        <Text style={{ fontFamily: 'Archivo', fontSize: 13.5, fontWeight: '700', color: colors.text, marginBottom: 12 }}>
          {`${chartLabel} — ${chartPoints.length} day${chartPoints.length === 1 ? '' : 's'}`}
        </Text>
        {chartPoints.length >= 2 ? (
          <Sparkline points={chartPoints} height={100} color={colors.green} />
        ) : (
          <Text style={{ fontFamily: 'Archivo', fontSize: 12.5, color: colors.dim }}>
            Connect Health Connect or Apple Health to see this trend.
          </Text>
        )}
      </Card>

      {METRICS_LIST.map((metricType) => {
        const s = seriesFor(series, metricType);
        const points = s?.points.map((p) => p.value) ?? [];
        const latest = points.length > 0 ? points[points.length - 1] : null;
        const { text: deltaText, good } = delta(s?.points ?? []);
        // No per-point `source` in the wire contract (healthMetricSeriesPointSchema's own
        // docblock deliberately omits it -- YAGNI, since nothing in the mobile UI needed it
        // before this screen). Rather than fabricate a device/source label the API cannot
        // actually back, this card omits the subtitle the design shows until that field is
        // added deliberately, as a real (small) contract change, not guessed here.

        return (
          <Card key={metricType}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <View>
                <Text style={{ fontFamily: 'Archivo', fontSize: 13.5, fontWeight: '700', color: colors.text }}>
                  {HEALTH_METRIC_TYPE_DISPLAY_NAMES[metricType]}
                </Text>
              </View>
              <Text
                style={{
                  fontFamily: 'Archivo',
                  fontSize: 16,
                  fontWeight: '700',
                  color: colors.text,
                  fontVariant: ['tabular-nums'],
                }}>
                {latest != null ? formatValue(metricType, latest, s?.unit ?? '') : '—'}
              </Text>
            </View>
            {points.length >= 2 ? (
              <View style={{ marginTop: 11 }}>
                <Sparkline points={points} height={40} color={colors.text} />
              </View>
            ) : (
              <Text style={{ marginTop: 11, fontFamily: 'Archivo', fontSize: 11.5, color: colors.dim }}>
                Connect Health Connect or Apple Health to see this over time.
              </Text>
            )}
            {points.length >= 2 ? (
              <View style={{ marginTop: 9, flexDirection: 'row', justifyContent: 'flex-end' }}>
                <Text
                  style={{
                    fontFamily: 'Archivo',
                    fontSize: 10.5,
                    fontWeight: '600',
                    color: good === false ? '#c9503c' : good === true ? colors.green : colors.dim,
                  }}>
                  {deltaText}
                </Text>
              </View>
            ) : null}
          </Card>
        );
      })}

      <View
        style={{
          backgroundColor: '#17181A',
          borderWidth: 1,
          borderColor: 'rgba(233,113,47,.2)',
          borderRadius: 14,
          padding: 15,
          paddingHorizontal: 16,
          marginTop: 12,
        }}>
        <Text
          style={{
            fontFamily: 'Archivo',
            fontSize: 9.5,
            fontWeight: '600',
            letterSpacing: 0.14 * 9.5,
            textTransform: 'uppercase',
            color: '#E9712F',
            marginBottom: 9,
          }}>
          FORJD Insight
        </Text>
        {insight ? (
          <Text style={{ fontFamily: 'Archivo', fontSize: 13, lineHeight: 13 * 1.5, color: '#E4E2DE' }}>
            <Text style={{ fontWeight: '700' }}>{insight.headline} </Text>
            {insight.body}
          </Text>
        ) : (
          <Text style={{ fontFamily: 'Archivo', fontSize: 13, lineHeight: 13 * 1.5, color: '#E4E2DE' }}>
            Keep syncing readings and this card will start reporting real patterns once there
            is enough history to compare against.
          </Text>
        )}
      </View>
    </>
  );
}
