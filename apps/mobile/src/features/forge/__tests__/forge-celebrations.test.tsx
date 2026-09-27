// Home's Weekly Forge celebrations: for each closed week, oldest first, the celebration plays, then
// the week summary sheet, and Done acknowledges it (Phase 7 items D, G, H).
import type { ForgeWeekSummary } from '@forjd/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('../use-pending-forge-weeks', () => ({ usePendingForgeWeeks: jest.fn() }));
jest.mock('@/components/haptics', () => ({ hapticLevelUp: jest.fn(async () => undefined) }));
jest.mock('../forge-celebration-screen', () => {
  const { Pressable, Text } = require('react-native');
  return {
    ForgeCelebrationScreen: ({ ladderWeek, onContinue }: { ladderWeek: { ladder: string }; onContinue: () => void }) => (
      <Pressable accessibilityRole="button" accessibilityLabel="Continue" onPress={onContinue}>
        <Text>{`Full screen for ${ladderWeek.ladder}`}</Text>
      </Pressable>
    ),
  };
});

import { hapticLevelUp } from '@/components/haptics';
import { TOAST_DURATION_MS } from '@/components/toast';
import { ForgeCelebrations, MODAL_HANDOFF_MS } from '../forge-celebrations';
import { usePendingForgeWeeks } from '../use-pending-forge-weeks';

const hook = usePendingForgeWeeks as jest.Mock;

const levelWeek = (ladder: 'volume' | 'nourish', over: Partial<ForgeWeekSummary> = {}): ForgeWeekSummary => ({
  weekStart: '2026-09-19',
  biggest: 'level',
  biggestLadder: ladder,
  shareable: false,
  levelsGained: 1,
  marksEarned: 1,
  ladders: [
    {
      ladder,
      outcome: 'hit',
      levelBefore: ladder === 'nourish' ? 2 : 7,
      levelAfter: ladder === 'nourish' ? 3 : 8,
      bandBefore: ladder === 'nourish' ? 'ore' : 'ember',
      bandAfter: 'ember',
      total: 10,
      target: 5,
      celebration: 'level',
      rewards: [],
    },
  ],
  ...over,
});

describe('ForgeCelebrations', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows nothing when no week is waiting', async () => {
    hook.mockReturnValue({ current: null, isAcking: false, acknowledge: jest.fn() });

    await render(<ForgeCelebrations />);

    expect(screen.queryByText(/Week of/)).toBeNull();
  });

  it('strikes a level-up with the toast and a light tap, then opens the summary', async () => {
    hook.mockReturnValue({ current: levelWeek('volume'), isAcking: false, acknowledge: jest.fn() });

    await render(<ForgeCelebrations />);

    expect(screen.getByText('Struck. Volume rose to level 8.')).toBeTruthy();
    expect(hapticLevelUp).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Week of 19 – 25 Sep')).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(screen.queryByText('Struck. Volume rose to level 8.')).toBeNull();
    expect(screen.getByText('Week of 19 – 25 Sep')).toBeTruthy();
  });

  it('keeps Nourish calm: a plain toast and no tap', async () => {
    hook.mockReturnValue({ current: levelWeek('nourish'), isAcking: false, acknowledge: jest.fn() });

    await render(<ForgeCelebrations />);

    expect(screen.getByText('Nourish reached Ember.')).toBeTruthy();
    expect(hapticLevelUp).not.toHaveBeenCalled();
  });

  it('goes straight to the summary for a quiet week', async () => {
    hook.mockReturnValue({
      current: levelWeek('volume', { biggest: 'none', biggestLadder: null, levelsGained: 0, marksEarned: 0 }),
      isAcking: false,
      acknowledge: jest.fn(),
    });

    await render(<ForgeCelebrations />);

    expect(screen.getByText('Week of 19 – 25 Sep')).toBeTruthy();
    expect(hapticLevelUp).not.toHaveBeenCalled();
  });

  it('plays the full screen for a new band, then opens the summary on Continue', async () => {
    hook.mockReturnValue({
      current: levelWeek('volume', { biggest: 'band', shareable: true }),
      isAcking: false,
      acknowledge: jest.fn(),
    });

    await render(<ForgeCelebrations />);
    expect(screen.getByText('Full screen for volume')).toBeTruthy();
    expect(screen.queryByText('Week of 19 – 25 Sep')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    // One Modal at a time: nothing opens until the celebration has finished closing.
    expect(screen.queryByText('Full screen for volume')).toBeNull();
    expect(screen.queryByText('Week of 19 – 25 Sep')).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(MODAL_HANDOFF_MS);
    });
    expect(screen.getByText('Week of 19 – 25 Sep')).toBeTruthy();
    expect(hapticLevelUp).not.toHaveBeenCalled();
  });

  it('acknowledges the week from Done', async () => {
    const acknowledge = jest.fn(async () => undefined);
    hook.mockReturnValue({
      current: levelWeek('volume', { biggest: 'cooled', biggestLadder: 'volume' }),
      isAcking: false,
      acknowledge,
    });

    await render(<ForgeCelebrations />);
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));

    expect(acknowledge).toHaveBeenCalledWith('2026-09-19');
  });
});

describe('ForgeToast placement', () => {
  // Home is a tab screen: its layout already ends at the top of the floating tab bar
  // (`(tabs)/_layout.tsx` pads each scene by the bar's height). The approved mock-up puts the toast
  // 18 px above the tab bar (96 px up, over a 78 px bar), so on Home it sits 18 px up, not 96.
  it('sits 18 px above the tab bar, as in the approved mock-up', async () => {
    const { ForgeToast } = require('../forge-toast');
    const view = await render(<ForgeToast ladder="volume" band="ember" message="Struck." />);
    const pill = view.toJSON() as { props: { className?: string } };

    expect(pill.props.className).toContain('bottom-[18px]');
  });
});
