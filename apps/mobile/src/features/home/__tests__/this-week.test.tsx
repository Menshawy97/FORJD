import { render, screen } from '@testing-library/react-native';

import { ThisWeek } from '../this-week';

describe('ThisWeek', () => {
  it('lays the week out Saturday to Friday, the Egyptian week the server counts (ADR-056)', async () => {
    await render(<ThisWeek sessionCount={0} trainedWeekdays={[]} />);

    expect(screen.getAllByLabelText(/session on /).map((node) => node.props.accessibilityLabel)).toEqual([
      'No session on Saturday',
      'No session on Sunday',
      'No session on Monday',
      'No session on Tuesday',
      'No session on Wednesday',
      'No session on Thursday',
      'No session on Friday',
    ]);
  });

  it('marks trained days by their Date#getDay() index, wherever they sit in the week', async () => {
    // Saturday is 6 and Monday is 1 in Date#getDay() terms.
    await render(<ThisWeek sessionCount={2} trainedWeekdays={[6, 1]} />);

    expect(screen.getByLabelText('Session on Saturday')).toBeTruthy();
    expect(screen.getByLabelText('Session on Monday')).toBeTruthy();
    expect(screen.getByLabelText('No session on Sunday')).toBeTruthy();
    expect(screen.getByText('2 sessions')).toBeTruthy();
  });
});
