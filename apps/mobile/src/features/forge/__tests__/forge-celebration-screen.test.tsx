// The new-band and Forged full screens, as approved in the Phase 7 mock-ups (items E, F and L, with
// the 10B design notes in docs/product/weekly-forge-plan.md).
import type { ForgeWeekSummary } from '@forjd/contracts';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@/components/haptics', () => ({
  hapticNewBand: jest.fn(async () => undefined),
  hapticForged: jest.fn(async () => undefined),
}));
jest.mock('@/media/share-capture', () => ({ isExpoGo: jest.fn(() => false), shareShareCard: jest.fn() }));
jest.mock('@/media/share-card-shot', () => {
  const { View } = require('react-native');
  const react = require('react');
  return { ShareCardShot: react.forwardRef((props: { children: unknown }, ref: unknown) => <View ref={ref}>{props.children}</View>) };
});
jest.mock('@/auth/apiClient', () => ({ getMe: jest.fn() }));

import { getMe } from '@/auth/apiClient';
import { hapticForged, hapticNewBand } from '@/components/haptics';
import { isExpoGo, shareShareCard } from '@/media/share-capture';
import { ForgeCelebrationScreen } from '../forge-celebration-screen';

type LadderWeek = ForgeWeekSummary['ladders'][number];

const bandLadder: LadderWeek = {
  ladder: 'volume',
  outcome: 'hit',
  levelBefore: 3,
  levelAfter: 4,
  bandBefore: 'ore',
  bandAfter: 'ember',
  total: 4100,
  target: 4000,
  celebration: 'band',
  rewards: [{ type: 'band_badge', level: 4, band: 'ember' }],
};

const forgedLadder: LadderWeek = {
  ladder: 'distance',
  outcome: 'hit',
  levelBefore: 12,
  levelAfter: 13,
  bandBefore: 'tempered',
  bandAfter: 'forged',
  total: 92,
  target: 88,
  celebration: 'forged',
  rewards: [{ type: 'forged', level: 13, band: 'forged' }],
};

const summary = (ladder: LadderWeek, shareable = true): ForgeWeekSummary => ({
  weekStart: '2026-09-19',
  biggest: ladder.celebration,
  biggestLadder: ladder.ladder,
  shareable,
  levelsGained: 1,
  marksEarned: 1,
  ladders: [ladder],
});

describe('ForgeCelebrationScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (getMe as jest.Mock).mockResolvedValue({ profile: { username: 'mostafa' } });
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    (isExpoGo as jest.Mock).mockReturnValue(false);
    (shareShareCard as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('strikes a new band: the agreed line, the new target, its level and week, and a medium tap', async () => {
    await render(<ForgeCelebrationScreen week={summary(bandLadder)} ladderWeek={bandLadder} onContinue={jest.fn()} />);

    expect(screen.getByText('New band · Volume')).toBeTruthy();
    expect(screen.getByText('Heat rising.')).toBeTruthy();
    expect(screen.getByText('Volume reached Ember. Your target is now 5,500 kg a week.')).toBeTruthy();
    expect(screen.getByText('Level 4')).toBeTruthy();
    expect(screen.getByText('Week of 19 Sep')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(hapticNewBand).toHaveBeenCalledTimes(1);
    expect(hapticForged).not.toHaveBeenCalled();
  });

  it('marks Forged with its own line, the start of the run, and the heavy strike', async () => {
    await render(<ForgeCelebrationScreen week={summary(forgedLadder)} ladderWeek={forgedLadder} onContinue={jest.fn()} />);

    expect(screen.getByText('Forged · Distance')).toBeTruthy();
    expect(screen.getByText('Forged.')).toBeTruthy();
    expect(screen.getByText('Four weeks held in Tempered, and now Forged. 100 km a week.')).toBeTruthy();
    expect(screen.getByText('Forged 1 week')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(hapticForged).toHaveBeenCalledTimes(1);
  });

  it('draws at most 12 sparks, and none when the phone asks for reduced motion, where the tap comes at once', async () => {
    const first = await render(<ForgeCelebrationScreen week={summary(bandLadder)} ladderWeek={bandLadder} onContinue={jest.fn()} />);
    expect(screen.getAllByTestId('forge-spark', { includeHiddenElements: true }).length).toBeLessThanOrEqual(12);
    await first.unmount();

    jest.clearAllMocks();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await render(<ForgeCelebrationScreen week={summary(bandLadder)} ladderWeek={bandLadder} onContinue={jest.fn()} />);

    expect(screen.queryAllByTestId('forge-spark', { includeHiddenElements: true })).toHaveLength(0);
    expect(hapticNewBand).toHaveBeenCalledTimes(1);
  });

  it('reads the reduce-motion setting before anything moves, so a reduced-motion phone never sees a frame of animation', async () => {
    let answer: (value: boolean) => void = () => undefined;
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(new Promise<boolean>((r) => (answer = r)));
    const start = jest.fn();
    const parallel = jest.spyOn(require('react-native').Animated, 'parallel').mockReturnValue({ start, stop: jest.fn(), reset: jest.fn() });

    await render(<ForgeCelebrationScreen week={summary(bandLadder)} ladderWeek={bandLadder} onContinue={jest.fn()} />);
    expect(start).not.toHaveBeenCalled();

    await act(async () => answer(true));
    expect(start).not.toHaveBeenCalled();
    expect(hapticNewBand).toHaveBeenCalledTimes(1);
    parallel.mockRestore();
  });

  it('keeps the big badge out of the screen reader, since the words around it already say it all', async () => {
    await render(<ForgeCelebrationScreen week={summary(bandLadder)} ladderWeek={bandLadder} onContinue={jest.fn()} />);

    expect(screen.queryByLabelText('Volume, Ember')).toBeNull();
  });

  it('continues to the week summary', async () => {
    const onContinue = jest.fn();
    await render(<ForgeCelebrationScreen week={summary(bandLadder)} ladderWeek={bandLadder} onContinue={onContinue} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('opens the share sheet once, however often Share is tapped', async () => {
    await render(<ForgeCelebrationScreen week={summary(bandLadder)} ladderWeek={bandLadder} onContinue={jest.fn()} />);
    await waitFor(() => expect(getMe).toHaveBeenCalled());

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Share' }));
      fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    });

    expect(shareShareCard).toHaveBeenCalledTimes(1);
  });

  it('says so when the share sheet cannot open', async () => {
    (shareShareCard as jest.Mock).mockRejectedValue(new Error('unavailable'));
    await render(<ForgeCelebrationScreen week={summary(bandLadder)} ladderWeek={bandLadder} onContinue={jest.fn()} />);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    });

    expect(screen.getByText('Could not open the share sheet. Please try again.')).toBeTruthy();
  });

  it('offers no Share when the week may not be shared, or in Expo Go, where capture is impossible', async () => {
    const first = await render(
      <ForgeCelebrationScreen week={summary(bandLadder, false)} ladderWeek={bandLadder} onContinue={jest.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    await first.unmount();

    (isExpoGo as jest.Mock).mockReturnValue(true);
    await render(<ForgeCelebrationScreen week={summary(bandLadder)} ladderWeek={bandLadder} onContinue={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  });
});
