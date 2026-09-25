import type { BodyMetric } from '@forjd/domain';
import { Text, View } from 'react-native';

/**
 * What a value the API worked out was worked out from (docs/product/scan-height-age-plan.md
 * §4.1–4.3), for the metrics it fills in. A calculated value is always labelled as one, never
 * shown as if it had been measured (rule 10).
 */
const CALCULATED_FROM: Partial<Record<BodyMetric, string>> = {
  bmi: 'weight and height',
  basal_metabolic_rate_kcal: 'fat-free mass',
  fat_free_mass_index: 'weight, body fat and height',
};

export function calculatedFrom(metric: string): string | null {
  return CALCULATED_FROM[metric as BodyMetric] ?? null;
}

/** The small "Calculated" tag beside a worked-out value's name (replica approved 2026-09-25). */
export function CalculatedTag() {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,.14)',
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}>
      <Text
        style={{
          fontFamily: 'Archivo',
          fontSize: 9,
          fontWeight: '700',
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: '#94948B',
        }}>
        Calculated
      </Text>
    </View>
  );
}
