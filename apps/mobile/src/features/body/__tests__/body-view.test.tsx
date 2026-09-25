// Slice E of docs/product/scan-height-age-plan.md (replica approved 2026-09-25): the Body tab
// tracks the fat-free mass index and BMI like every other metric, and marks a value the app
// worked out as "Calculated" rather than presenting it as measured (rule 10).
import { render } from '@testing-library/react-native';
import type { BodyScanSeriesResponse } from '@forjd/contracts';

import { BodyView } from '../body-view';

const at = (day: number) => `2026-0${day < 10 ? 7 : 8}-${String(day).padStart(2, '0')}T09:00:00.000Z`;
const point = (day: number, value: number, calculated: boolean, heightAdjusted?: number) => ({
  measuredAt: at(day),
  value,
  calculated,
  ...(heightAdjusted === undefined ? {} : { heightAdjusted }),
});

function seriesWith(extra: BodyScanSeriesResponse['series']): BodyScanSeriesResponse {
  return {
    series: [{ metric: 'weight_kg', unit: 'kg', points: [point(1, 88, false), point(2, 86.6, false)] }, ...extra],
  };
}

const ffmi = (calculated: boolean): BodyScanSeriesResponse['series'][number] => ({
  metric: 'fat_free_mass_index',
  unit: '',
  points: [point(1, 22.8, calculated, 22.9), point(2, 23.1, calculated, 23.2)],
});
const bmi: BodyScanSeriesResponse['series'][number] = {
  metric: 'bmi',
  unit: '',
  points: [point(1, 27.8, true), point(2, 27.3, true)],
};

describe('BodyView: fat-free mass index and calculated values', () => {
  it('shows an FFMI card with its latest value, how it was worked out, and the height-adjusted value', async () => {
    const { getByText } = await render(<BodyView series={seriesWith([ffmi(true)])} hasAnyScan />);

    expect(getByText('Fat-free mass index')).toBeTruthy();
    expect(getByText('23.1')).toBeTruthy();
    expect(getByText('From weight, body fat and height')).toBeTruthy();
    expect(getByText(/Height-adjusted/)).toBeTruthy();
    expect(getByText('23.2')).toBeTruthy();
  });

  it('tracks BMI on the tab, marked calculated when the app worked it out', async () => {
    const { getByText, getAllByText } = await render(<BodyView series={seriesWith([bmi])} hasAnyScan />);

    expect(getByText('Body mass index')).toBeTruthy();
    expect(getByText('27.3')).toBeTruthy();
    expect(getByText('From weight and height')).toBeTruthy();
    expect(getAllByText('Calculated')).toHaveLength(1);
  });

  it('marks nothing when every value came from the sheet', async () => {
    const { queryByText, getByText } = await render(<BodyView series={seriesWith([ffmi(false)])} hasAnyScan />);

    expect(queryByText('Calculated')).toBeNull();
    expect(queryByText('From weight, body fat and height')).toBeNull();
    // The height adjustment is arithmetic on the printed FFMI, so it is still shown.
    expect(getByText(/Height-adjusted/)).toBeTruthy();
  });
});
