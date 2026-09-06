import { render } from '@testing-library/react-native';

import { VolumeBars } from '../volume-bars';

const zeroWeek = () =>
  Array.from({ length: 7 }, (_, index) => ({ dayOfWeek: index + 1, volumeKg: 0 }));

describe('VolumeBars', () => {
  it('labels every column with its own day, disambiguating letters a screen reader would not', async () => {
    const days = zeroWeek();
    days[0] = { dayOfWeek: 1, volumeKg: 8200 };
    const { getByLabelText } = await render(<VolumeBars days={days} />);

    expect(getByLabelText('Monday, 8,200 kilograms lifted')).toBeTruthy();
    expect(getByLabelText('Tuesday, rest')).toBeTruthy();
  });

  it('renders all seven day labels even when every day is a rest day', async () => {
    const { getByLabelText } = await render(<VolumeBars days={zeroWeek()} />);
    const days = [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ];

    for (const day of days) {
      expect(getByLabelText(`${day}, rest`)).toBeTruthy();
    }
  });
});
