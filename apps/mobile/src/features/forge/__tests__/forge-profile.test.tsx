// The Weekly Forge profile sections, as approved in the Phase 7 mock-ups (item I): your own profile
// shows all five ladders with the bands earned so far and the Forged record; someone else's public
// profile shows the four public ladders and never Nourish (ADR-057 decision 8).
import type { PublicForge } from '@forjd/contracts';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ForgeProfileRows, type ForgeProfileLadder } from '../forge-profile-rows';
import { PublicForgeSection } from '../public-forge-section';

const row = (over: Partial<ForgeProfileLadder>): ForgeProfileLadder => ({
  ladder: 'volume',
  band: 'ember',
  level: 7,
  forgedStreak: 0,
  bestForgedStreak: 0,
  badges: ['ore', 'ember'],
  ...over,
});

describe('ForgeProfileRows', () => {
  it('shows each ladder with its band and level', async () => {
    await render(<ForgeProfileRows ladders={[row({})]} />);

    expect(screen.getByText('Volume')).toBeTruthy();
    expect(screen.getByText('Ember · Level 7')).toBeTruthy();
  });

  it('draws a badge for every band earned and an empty slot for each one still to come', async () => {
    await render(<ForgeProfileRows ladders={[row({})]} />);

    // The row's own badge plus Ore and Ember in the strip; all decorative, so the row is one stop.
    expect(screen.getAllByTestId('forge-mark', { includeHiddenElements: true })).toHaveLength(3);
    expect(screen.queryByLabelText('Volume, Ember')).toBeNull();
    expect(screen.getAllByTestId('forge-band-slot-empty')).toHaveLength(3);
  });

  it('stops Nourish at Anvil, its highest band', async () => {
    await render(<ForgeProfileRows ladders={[row({ ladder: 'nourish', band: 'ore', level: 2, badges: ['ore'] })]} />);

    expect(screen.getAllByTestId('forge-band-slot-empty')).toHaveLength(2);
  });

  it('gives the Forged record, current and best', async () => {
    await render(
      <ForgeProfileRows
        ladders={[
          row({ ladder: 'distance', band: 'forged', level: 28, forgedStreak: 1, bestForgedStreak: 3 }),
          row({ ladder: 'minutes', band: 'tempered', level: 22, forgedStreak: 0, bestForgedStreak: 2 }),
        ]}
      />,
    );

    expect(screen.getByText('Forged 1 week · best 3')).toBeTruthy();
    expect(screen.getByText('Best Forged run: 2 weeks')).toBeTruthy();
  });

  it('says each row in one breath for a screen reader', async () => {
    await render(
      <ForgeProfileRows
        ladders={[
          row({
            ladder: 'distance',
            band: 'forged',
            level: 28,
            forgedStreak: 1,
            bestForgedStreak: 3,
            badges: ['ore', 'ember', 'anvil', 'tempered', 'forged'],
          }),
        ]}
      />,
    );

    expect(
      screen.getByLabelText(
        'Distance, Forged level 28. Bands earned: Ore, Ember, Anvil, Tempered, Forged. Forged 1 week, best 3.',
      ),
    ).toBeTruthy();
  });

  it('opens a ladder when given a handler (your own profile), saying so to a screen reader', async () => {
    const onPressLadder = jest.fn();
    await render(<ForgeProfileRows ladders={[row({ ladder: 'minutes' })]} onPressLadder={onPressLadder} />);

    await fireEvent.press(screen.getByRole('button', { name: /^Active minutes, Ember level 7\..*Opens all levels$/ }));

    expect(onPressLadder).toHaveBeenCalledWith('minutes');
  });

  it('stays a plain row without a handler, as on a public profile', async () => {
    await render(<ForgeProfileRows ladders={[row({})]} />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('PublicForgeSection', () => {
  const forge: PublicForge = {
    ladders: [
      { ladder: 'consistency', band: 'anvil', level: 4, forgedStreak: 0, bestForgedStreak: 0, badges: ['ore', 'ember', 'anvil'] },
      { ladder: 'volume', band: 'ember', level: 7, forgedStreak: 0, bestForgedStreak: 0, badges: ['ore', 'ember'] },
      { ladder: 'distance', band: 'ore', level: 3, forgedStreak: 0, bestForgedStreak: 0, badges: ['ore'] },
      { ladder: 'minutes', band: 'ore', level: 2, forgedStreak: 0, bestForgedStreak: 0, badges: ['ore'] },
    ],
  };

  it('shows the four public ladders under a Weekly Forge label', async () => {
    await render(<PublicForgeSection forge={forge} />);

    expect(screen.getByText('Weekly Forge')).toBeTruthy();
    for (const name of ['Consistency', 'Volume', 'Distance', 'Active minutes']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it('never shows Nourish, even if a response somehow carried it', async () => {
    const leaky = { ladders: [...forge.ladders, { ...forge.ladders[0]!, ladder: 'nourish' }] } as unknown as PublicForge;

    await render(<PublicForgeSection forge={leaky} />);

    expect(screen.queryByText('Nourish')).toBeNull();
  });

  it('renders nothing when the athlete has no Forge block', async () => {
    await render(<PublicForgeSection forge={null} />);

    expect(screen.queryByText('Weekly Forge')).toBeNull();
  });
});
