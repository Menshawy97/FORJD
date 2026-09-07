import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
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

/** The prototype's own `widgetCatalogs().body` (`FORJD Mobile.dc.html:3322`) -- the five
 *  options the "Choose widget" sheet offers, transcribed verbatim (`progress body change
 *  widget.png`). Each maps directly onto an existing BODY_METRICS entry; nothing new to
 *  capture, only a UI to pick which two of the five surface as headline tiles. */
const WIDGET_CATALOG: ReadonlyArray<{ metric: BodyMetric; label: string }> = [
  { metric: 'weight_kg', label: 'Weight' },
  { metric: 'body_fat_percent', label: 'Body fat' },
  { metric: 'skeletal_muscle_mass_kg', label: 'Muscle mass' },
  { metric: 'visceral_fat_level', label: 'Visceral fat' },
  { metric: 'bmi', label: 'BMI' },
];

/**
 * Progress → Body tab (Phase 5F), built against `progress body 1.png`, `progress body 2.png`,
 * `progress body 3.png` and `progress body change widget.png`, with `s_progress()`'s
 * Body-tab markup and `metricVals()`/`widgetCatalogs()` as the second authority.
 *
 * The two headline tiles are configurable (`WIDGET_CATALOG`, above), matching the design's
 * bottom-sheet picker exactly -- tapping a tile opens "Choose widget" with the same five
 * options the prototype offers. The selection is session-only local state, matching the
 * prototype's own lack of a persistence layer for this preference.
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
  const [bodyWidgets, setBodyWidgets] = useState<[BodyMetric, BodyMetric]>(['weight_kg', 'body_fat_percent']);
  const [pickerSlot, setPickerSlot] = useState<0 | 1 | null>(null);

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
        {bodyWidgets.map((metric, slot) => {
          const s = seriesFor(series, metric);
          const latest = s && s.points.length > 0 ? s.points[s.points.length - 1].value : null;
          const { text: deltaText, good } = s ? formatDelta(metric, s.points, s.unit) : { text: '—', good: null };
          const label = WIDGET_CATALOG.find((w) => w.metric === metric)?.label ?? BODY_METRIC_DISPLAY_NAMES[metric];
          return (
            <Pressable
              key={slot}
              accessibilityRole="button"
              accessibilityLabel={`Change ${label} widget`}
              onPress={() => setPickerSlot(slot as 0 | 1)}
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
                {label}
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
            </Pressable>
          );
        })}
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
                    setBodyWidgets((current) => {
                      const next: [BodyMetric, BodyMetric] = [...current];
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
      {SEGMENTAL_SITES.some((site) => (seriesFor(series, site)?.points.length ?? 0) > 0) ? (
        <>
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
      ) : (
        <Text style={{ fontFamily: 'Archivo', fontSize: 12.5, color: colors.dim, paddingVertical: 4 }}>
          {hasAnyScan
            ? 'This scan didn’t include segmental data.'
            : 'Confirm an InBody scan to see your arm, leg and trunk breakdown here.'}
        </Text>
      )}

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
