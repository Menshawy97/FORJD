import { render, screen } from '@testing-library/react-native';

import { VolumeBars } from '../volume-bars';

// The server sends the week in ISO order, 1 Monday through 7 Sunday (progress.ts's contract).
const zeroWeek = () =>
  Array.from({ length: 7 }, (_, index) => ({ dayOfWeek: index + 1, volumeKg: 0 }));

describe('VolumeBars', () => {
  it('labels every column with its own day, disambiguating letters a screen reader would not', async () => {
    const days = zeroWeek();
    days[0] = { dayOfWeek: 1, volumeKg: 8200 };
    await render(<VolumeBars days={days} />);

    expect(screen.getByLabelText('Monday, 8,200 kilograms lifted')).toBeTruthy();
    expect(screen.getByLabelText('Tuesday, rest')).toBeTruthy();
  });

  it('lays the bars out Saturday to Friday, whatever order the days arrive in (ADR-056)', async () => {
    const days = zeroWeek();
    days[5] = { dayOfWeek: 6, volumeKg: 7100 };
    await render(<VolumeBars days={days} />);

    expect(screen.getAllByLabelText(/, (rest|[\d,]+ kilograms lifted)$/).map((node) => node.props.accessibilityLabel)).toEqual([
      'Saturday, 7,100 kilograms lifted',
      'Sunday, rest',
      'Monday, rest',
      'Tuesday, rest',
      'Wednesday, rest',
      'Thursday, rest',
      'Friday, rest',
    ]);
    expect(screen.getAllByText(/^(Sat|Sun|Mon|Tue|Wed|Thu|Fri)$/).map((node) => node.props.children)).toEqual([
      'Sat',
      'Sun',
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
    ]);
  });
});
