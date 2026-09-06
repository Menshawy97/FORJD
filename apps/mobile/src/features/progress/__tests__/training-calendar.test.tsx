import { render } from '@testing-library/react-native';

import { TrainingCalendar } from '../training-calendar';

describe('TrainingCalendar', () => {
  it('draws leading blanks for the days before the 1st, and no trailing blanks', async () => {
    // August 2026's 1st is a Saturday -- Monday-first that is 5 leading blanks, and the grid
    // ends with day 31, the same asymmetry the prototype's own loop has.
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
});
