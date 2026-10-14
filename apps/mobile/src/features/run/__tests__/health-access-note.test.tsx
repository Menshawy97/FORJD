// The note that replaces "looks like a quiet watch" when Health Connect has refused a read. Replica
// approved 2026-10-09: two lines in the heart-rate card, one on the finished run.
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockOpenSettings = jest.fn();
jest.mock('@/integrations/health/health-settings', () => ({
  openDeviceHealthSettings: () => mockOpenSettings(),
}));

import { HealthAccessNote } from '../health-access-note';
import { RunHeartRateCard } from '../run-heart-rate-card';

afterEach(() => mockOpenSettings.mockReset());

describe('HealthAccessNote', () => {
  it('names what is off and opens Health Connect when tapped', async () => {
    await render(<HealthAccessNote metric="heart_rate" />);

    expect(screen.getByText('Heart rate is turned off for FORJD in Health Connect.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Health Connect' }));
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('says the run uses an estimate when calories are off', async () => {
    await render(<HealthAccessNote metric="active_energy" />);

    expect(
      screen.getByText('Watch calories are turned off for FORJD in Health Connect, so this run uses an estimate.'),
    ).toBeTruthy();
  });
});

// Walk finding 19: with no estimate to show (Calories reads "—"), the note does not claim one.
describe('HealthAccessNote without an estimate', () => {
  it('says calories are off without claiming an estimate', async () => {
    await render(<HealthAccessNote metric="active_energy" hasEstimate={false} />);

    expect(screen.getByText('Watch calories are turned off for FORJD in Health Connect.')).toBeTruthy();
    expect(screen.queryByText(/uses an estimate/)).toBeNull();
  });
});

describe('RunHeartRateCard when heart rate is blocked', () => {
  it('shows the note in place of the chart and keeps the dash figure', async () => {
    await render(<RunHeartRateCard currentBpm={null} series={[]} isBlocked />);

    expect(screen.getByText('— bpm now')).toBeTruthy();
    expect(screen.getByText('Heart rate is turned off for FORJD in Health Connect.')).toBeTruthy();
  });

  it('shows no note when the watch is just quiet', async () => {
    await render(<RunHeartRateCard currentBpm={null} series={[]} />);

    expect(screen.queryByText('Heart rate is turned off for FORJD in Health Connect.')).toBeNull();
  });
});
