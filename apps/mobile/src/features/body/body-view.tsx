import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import type { BodyScanSeriesResponse } from '@forjd/contracts';
import {
  BODY_METRIC_DISPLAY_NAMES,
  BODY_METRIC_UNITS,
  SEGMENTAL_SITES,
  SEGMENTAL_SITE_DISPLAY_NAMES,
  type BodyMetric,
  type SegmentalSite,
} from '@forjd/domain';

import { Card } from '@/features/progress/card';
import { Sparkline } from '@/components/sparkline';
import { Icon } from '@/components/icon';
import { colors } from '@/theme/tokens';

/** Metrics where a lower number is the improvement -- same rule `inbody-compare.tsx` uses. */
const HIGHER_IS_BETTER = new Set<BodyMetric>(['skeletal_muscle_mass_kg', 'inbody_score']);

/** The prototype's own `segRef` (`FORJD Mobile.dc.html:3397`) -- each segmental bar's fill
 *  percentage is the confirmed kg value divided by this reference max, not an absolute
 *  scale. Transcribed verbatim, not re-derived. */
const SEGMENTAL_REFERENCE_KG: Record<SegmentalSite, number> = {
  right_arm: 4.2,
  left_arm: 4.2,
  trunk: 34,
  right_leg: 12,
  left_leg: 12,
};

/**
 * Progress → Body tab (Phase 5F), built against `progress body 1.png`, `progress body 2.png`
 * and `progress body 3.png`, with `s_progress()`'s Body-tab markup and `metricVals()` as the
 * second authority.
 *
 * **One remaining scope trim from the design**, recorded in ADR-032: the two headline tiles
 * are fixed to Weight and Body fat rather than the design's configurable widget picker
 * (long-press to swap in muscle mass / visceral fat / BMI). `BODY_METRICS`' domain
 * vocabulary already supports any of the five; only the picker UI is missing.
 */
interface BodyViewProps {
  series: BodyScanSeriesResponse | null;
  hasAnyScan: boolean;
}

function seriesFor(series: BodyScanSeriesResponse | null, metric: BodyMetric | SegmentalSite) {
  return series?.series.find((s) => s.metric === metric) ?? null;
}

function delta(points: ReadonlyArray<{ value: number }>): number {
  if (points.length < 2) return 0;
  return points[points.length - 1].value - points[0].value;
}

function formatDelta(metric: BodyMetric, points: ReadonlyArray<{ value: number }>, unit: string) {
  const d = delta(points);
  if (d === 0) return { text: '—', good: null as boolean | null };
  const good = HIGHER_IS_BETTER.has(metric) ? d > 0 : d < 0;
  const rounded = Number.isInteger(d) ? d : Number(d.toFixed(1));
  const text = `${d > 0 ? '+' : ''}${rounded}${unit ? ` ${unit}` : ''}`;
  return { text, good };
}

export function BodyView({ series, hasAnyScan }: BodyViewProps) {
  const weight = seriesFor(series, 'weight_kg');
  const bodyFat = seriesFor(series, 'body_fat_percent');

  const metrics: BodyMetric[] = [
    'weight_kg',
    'skeletal_muscle_mass_kg',
    'body_fat_percent',
    'body_fat_mass_kg',
    'total_body_water_l',
    'visceral_fat_level',
    'basal_metabolic_rate_kcal',
    'inbody_score',
  ];

  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        {(
          [
            ['weight_kg', weight],
            ['body_fat_percent', bodyFat],
          ] as const
        ).map(([metric, s]) => {
          const latest = s && s.points.length > 0 ? s.points[s.points.length - 1].value : null;
          const { text: deltaText, good } = s ? formatDelta(metric, s.points, s.unit) : { text: '—', good: null };
          return (
            <View
              key={metric}
              style={{
                flex: 1,
                backgroundColor: '#17181A',
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 14,
                padding: 15,
              }}>
              <Text
                style={{
                  fontFamily: 'Archivo',
                  fontSize: 9.5,
                  fontWeight: '600',
                  letterSpacing: 0.14 * 9.5,
                  textTransform: 'uppercase',
                  color: '#77776F',
                }}>
                {metric === 'weight_kg' ? 'Weight' : 'Body fat'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 6 }}>
                <Text style={{ fontFamily: 'Archivo', fontSize: 25, fontWeight: '700', color: colors.green }}>
                  {latest != null ? latest : '—'}
                </Text>
                {latest != null ? (
                  <Text style={{ fontFamily: 'Archivo', fontSize: 13, fontWeight: '500', color: colors.dim, marginLeft: 4 }}>
                    {BODY_METRIC_UNITS[metric]}
                  </Text>
                ) : null}
              </View>
              <Text
                style={{
                  marginTop: 7,
                  fontFamily: 'Archivo',
                  fontSize: 11,
                  fontWeight: '500',
                  color: good === false ? '#c9503c' : colors.green,
                }}>
                {latest != null ? `${deltaText} since first scan` : 'No scans yet'}
              </Text>
            </View>
          );
        })}
      </View>

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
        InBody metrics over time
      </Text>

      {metrics.map((metric) => {
        const s = seriesFor(series, metric);
        const points = s?.points.map((p) => p.value) ?? [];
        const latest = points.length > 0 ? points[points.length - 1] : null;
        const { text: deltaText, good } = s ? formatDelta(metric, s.points, s.unit) : { text: '—', good: null };
        return (
          <Card key={metric}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
              <Text style={{ fontFamily: 'Archivo', fontSize: 12.5, fontWeight: '600', color: '#C8C8C0' }}>
                {BODY_METRIC_DISPLAY_NAMES[metric]}
              </Text>
              <Text
                style={{
                  fontFamily: 'Archivo',
                  fontSize: 16,
                  fontWeight: '700',
                  color: colors.text,
                  fontVariant: ['tabular-nums'],
                }}>
                {latest != null ? `${latest}${BODY_METRIC_UNITS[metric] ? ` ${BODY_METRIC_UNITS[metric]}` : ''}` : '—'}
              </Text>
            </View>
            {points.length >= 2 ? (
              <View style={{ marginTop: 11 }}>
                <Sparkline points={points} height={40} color={colors.text} />
              </View>
            ) : (
              <Text style={{ marginTop: 11, fontFamily: 'Archivo', fontSize: 11.5, color: colors.dim }}>
                Needs at least two scans to chart a trend.
              </Text>
            )}
            <View style={{ marginTop: 9, flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: 'Archivo', fontSize: 10.5, fontWeight: '500', color: '#5c5c55' }}>
                {points.length >= 2 ? 'First → latest scan' : ''}
              </Text>
              <Text
                style={{
                  fontFamily: 'Archivo',
                  fontSize: 10.5,
                  fontWeight: '600',
                  color: good === false ? '#c9503c' : good === true ? colors.green : colors.dim,
                }}>
                {points.length >= 2 ? deltaText : ''}
              </Text>
            </View>
          </Card>
        );
      })}

      {SEGMENTAL_SITES.some((site) => (seriesFor(series, site)?.points.length ?? 0) > 0) ? (
        <>
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
            Segmental lean analysis
          </Text>
          {SEGMENTAL_SITES.map((site) => {
            const s = seriesFor(series, site);
            const latest = s && s.points.length > 0 ? s.points[s.points.length - 1].value : null;
            const pct = latest != null ? Math.round((latest / SEGMENTAL_REFERENCE_KG[site]) * 100) : 0;
            return (
              <View
                key={site}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 11,
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: 'rgba(255,255,255,.05)',
                }}>
                <Text style={{ width: 66, fontFamily: 'Archivo', fontSize: 12.5, fontWeight: '500', color: '#b4b4ac' }}>
                  {SEGMENTAL_SITE_DISPLAY_NAMES[site]}
                </Text>
                <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: '#26272a', overflow: 'hidden' }}>
                  <View style={{ width: `${Math.min(pct, 100)}%`, height: 6, backgroundColor: colors.accent }} />
                </View>
                <Text
                  style={{
                    width: 56,
                    textAlign: 'right',
                    fontFamily: 'Archivo',
                    fontSize: 12.5,
                    fontWeight: '600',
                    color: colors.text,
                    fontVariant: ['tabular-nums'],
                  }}>
                  {latest != null ? `${latest} kg` : '—'}
                </Text>
                <Text
                  style={{
                    width: 34,
                    textAlign: 'right',
                    fontFamily: 'Archivo',
                    fontSize: 11,
                    fontWeight: '600',
                    color: colors.accent,
                  }}>
                  {latest != null ? `${pct}%` : ''}
                </Text>
              </View>
            );
          })}
        </>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/inbody')}
        style={{
          marginTop: 16,
          backgroundColor: '#17181A',
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 14,
          padding: 15,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 13,
        }}>
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#1c1d20', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="upload" color="#a9a9a1" size={19} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'Archivo', fontSize: 14.5, fontWeight: '600', color: colors.text }}>
            Import InBody Scan
          </Text>
          <Text style={{ marginTop: 5, fontFamily: 'Archivo', fontSize: 11.5, color: '#6e6e66' }}>
            {hasAnyScan ? 'View history or add a new scan' : 'No scans yet'}
          </Text>
        </View>
        <Icon name="chevron" color="#8b8b83" size={18} />
      </Pressable>
    </>
  );
}
