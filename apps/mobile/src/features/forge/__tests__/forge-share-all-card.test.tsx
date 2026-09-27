// The all-ladders share card (weekly-forge-explainer-plan.md X4; mock-up F2, approved 2026-09-27):
// the approved single-ladder card's frame, glow and footer, with one row per public ladder.
import { render, screen } from '@testing-library/react-native';

import type { ForgeProfileLadder } from '../forge-profile-rows';
import { ForgeShareAllCard } from '../forge-share-all-card';

const ladder = (over: Partial<ForgeProfileLadder>): ForgeProfileLadder => ({
  ladder: 'volume',
  band: 'ember',
  level: 4,
  forgedStreak: 0,
  bestForgedStreak: 0,
  badges: ['ore', 'ember'],
  ...over,
});

const ALL: ForgeProfileLadder[] = [
  ladder({ ladder: 'consistency', band: 'tempered', level: 5 }),
  ladder({ ladder: 'volume', band: 'ember', level: 4 }),
  ladder({ ladder: 'distance', band: 'ember', level: 4 }),
  ladder({ ladder: 'minutes', band: 'ore', level: 3 }),
  ladder({ ladder: 'nourish', band: 'anvil', level: 5 }),
];

describe('ForgeShareAllCard', () => {
  it('shows every public ladder with its band and level, the username and the logo', async () => {
    await render(<ForgeShareAllCard ladders={ALL} username="mostafa" />);

    expect(screen.getByText('Weekly Forge')).toBeTruthy();
    expect(screen.getByText('Consistency')).toBeTruthy();
    expect(screen.getByText('Tempered · Level 5')).toBeTruthy();
    expect(screen.getByText('Active minutes')).toBeTruthy();
    expect(screen.getByText('Ore · Level 3')).toBeTruthy();
    expect(screen.getByText('@mostafa')).toBeTruthy();
    expect(screen.getByLabelText('FORJD symbol')).toBeTruthy();
  });

  it('never draws Nourish, whatever it is given', async () => {
    await render(<ForgeShareAllCard ladders={ALL} username="mostafa" />);

    expect(screen.queryByText('Nourish')).toBeNull();
    expect(screen.queryByText('Anvil · Level 5')).toBeNull();
  });

  it('draws nothing with no public ladder to show', async () => {
    const { toJSON } = await render(<ForgeShareAllCard ladders={[ALL[4]!]} username={null} />);

    expect(toJSON()).toBeNull();
  });
});
