import { render, screen } from '@testing-library/react-native';

import { leadingBlanks, TrainingCalendar } from '../training-calendar';

describe('TrainingCalendar', () => {
  it('draws leading blanks for the days before the 1st, and no trailing blanks', async () => {
    // The grid ends with day 31 and no trailing blanks, the same asymmetry the prototype's own
    // loop has.
    const { getByLabelText, queryByLabelText } = await render(
      <TrainingCalendar
        data={{ month: '2026-08', days: [], daysTrained: 0 }}
        today="2026-08-19"
      />,
    );

    expect(getByLabelText('2026-08-01, rest day')).toBeTruthy();
    expect(getByLabelText('2026-08-31, rest day')).toBeTruthy();
    expect(queryByLabelText('2026-09-01, rest day')).toBeNull();
  });

  it("labels a trained day by its logged activity, not by 'rest'", async () => {
    const { getByLabelText } = await render(
      <TrainingCalendar
        data={{
          month: '2026-08',
          days: [
            { date: '2026-08-03', activity: 'strength' },
            { date: '2026-08-06', activity: 'run' },
          ],
          daysTrained: 2,
        }}
        today="2026-08-19"
      />,
    );

    expect(getByLabelText('2026-08-03, strength day')).toBeTruthy();
    expect(getByLabelText('2026-08-06, run day')).toBeTruthy();
  });

  it('reports the singular "1 day trained" rather than "1 days"', async () => {
    const { getByText } = await render(
      <TrainingCalendar
        data={{ month: '2026-08', days: [{ date: '2026-08-03', activity: 'strength' }], daysTrained: 1 }}
        today="2026-08-19"
      />,
    );

    expect(getByText('1 day trained')).toBeTruthy();
  });

  it('heads the columns Saturday to Friday (ADR-056)', async () => {
    await render(
      <TrainingCalendar data={{ month: '2026-09', days: [], daysTrained: 0 }} today="2026-09-30" />,
    );

    expect(screen.getAllByText(/^[SMTWF]$/).map((node) => node.props.children)).toEqual([
      'S',
      'S',
      'M',
      'T',
      'W',
      'T',
      'F',
    ]);
  });
});

describe('leadingBlanks', () => {
  it('counts the Saturday-first blanks before the 1st', () => {
    expect(leadingBlanks(2026, 7)).toBe(0); // 1 August 2026 is a Saturday.
    expect(leadingBlanks(2026, 8)).toBe(3); // 1 September 2026 is a Tuesday.
    expect(leadingBlanks(2026, 4)).toBe(6); // 1 May 2026 is a Friday.
  });
});
