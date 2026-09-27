// The week summary sheet, as approved in the Phase 7 mock-ups (item H): the Saturday-to-Friday
// dates, levels gained and marks earned, one row per ladder, and Done.
import type { ForgeWeekSummary } from '@forjd/contracts';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { WeekSummarySheet } from '../week-summary-sheet';

const WEEK: ForgeWeekSummary = {
  weekStart: '2026-09-19',
  biggest: 'band',
  biggestLadder: 'volume',
  shareable: true,
  levelsGained: 5,
  marksEarned: 1,
  ladders: [
    {
      ladder: 'volume',
      outcome: 'hit',
      levelBefore: 6,
      levelAfter: 7,
      bandBefore: 'ore',
      bandAfter: 'ember',
      total: 5100,
      target: 5000,
      celebration: 'band',
      rewards: [{ type: 'band_badge', level: 7, band: 'ember' }],
    },
    {
      ladder: 'distance',
      outcome: 'miss',
      levelBefore: 5,
      levelAfter: 5,
      bandBefore: 'ore',
      bandAfter: 'ore',
      total: 6.2,
      target: 11,
      celebration: 'none',
      rewards: [],
    },
  ],
};

describe('WeekSummarySheet', () => {
  it('names the week and totals what it earned, in the right number', async () => {
    await render(<WeekSummarySheet week={WEEK} isBusy={false} onDone={jest.fn()} />);

    expect(screen.getByText('Week of 19 – 25 Sep')).toBeTruthy();
    expect(screen.getByText('5 levels gained · 1 mark earned')).toBeTruthy();
  });

  it('gives each ladder its result and detail, spoken as one row', async () => {
    await render(<WeekSummarySheet week={WEEK} isBusy={false} onDone={jest.fn()} />);

    expect(screen.getByText('New band')).toBeTruthy();
    expect(screen.getByText('5,100 of 5,000 kg · level 6 → 7')).toBeTruthy();
    expect(screen.getByLabelText('Distance: Held. 6.2 of 11 km · stays at level 5')).toBeTruthy();
  });

  it('calls Done once, and not at all while an acknowledgement is already on its way', async () => {
    const onDone = jest.fn();
    const view = await render(<WeekSummarySheet week={WEEK} isBusy={false} onDone={onDone} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledTimes(1);

    await view.rerender(<WeekSummarySheet week={WEEK} isBusy onDone={onDone} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('opens above everything, the tab bar included, and treats Android back as Done', async () => {
    const onDone = jest.fn();
    await render(<WeekSummarySheet week={WEEK} isBusy={false} onDone={onDone} />);

    const modal = screen.getByTestId('forge-week-summary');
    expect(modal.props.transparent).toBe(true);
    modal.props.onRequestClose();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('says "no levels" plainly for a quiet week', async () => {
    await render(<WeekSummarySheet week={{ ...WEEK, levelsGained: 0, marksEarned: 0 }} isBusy={false} onDone={jest.fn()} />);

    expect(screen.getByText('No levels gained this week')).toBeTruthy();
  });
});
