// Weekly Forge's How it works opens by itself once, the first time Home shows the card with a week
// (docs/product/forge-how-it-works-once-plan.md).
import type { ForgeResponse } from '@forjd/contracts';
import { act, render } from '@testing-library/react-native';
import { AxiosError, type AxiosResponse } from 'axios';

const mockFocusCallbacks: (() => void | (() => void))[] = [];
const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: { push: (...args: unknown[]) => mockPush(...args) },
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockFocusCallbacks.push(callback);
      react.useEffect(() => callback(), [callback]);
    },
  };
});
jest.mock('@/auth/apiClient', () => ({ getForge: jest.fn() }));
jest.mock('@/auth/secureStorage', () => ({ getAccountId: jest.fn() }));
jest.mock('@/features/flags/feature-flags', () => ({ useFeatureFlag: jest.fn() }));
jest.mock('@/store/forge-how-it-works-shown', () => ({
  hasSeenForgeHowItWorks: jest.fn(),
  markForgeHowItWorksSeen: jest.fn(),
}));

import { getForge } from '@/auth/apiClient';
import { getAccountId } from '@/auth/secureStorage';
import { useFeatureFlag } from '@/features/flags/feature-flags';
import { hasSeenForgeHowItWorks, markForgeHowItWorksSeen } from '@/store/forge-how-it-works-shown';
import { WeeklyForgeSection } from '../weekly-forge-section';

const fetchForge = getForge as jest.Mock;
const accountId = getAccountId as jest.Mock;
const flag = useFeatureFlag as jest.Mock;
const hasSeen = hasSeenForgeHowItWorks as jest.Mock;
const markSeen = markForgeHowItWorksSeen as jest.Mock;

const week: ForgeResponse = {
  weekStart: '2026-09-26',
  daysLeft: 3,
  timeZone: 'Africa/Cairo',
  ladders: [
    {
      ladder: 'volume',
      unit: 'kg',
      band: 'ember',
      level: 7,
      maxLevel: 33,
      target: 5600,
      total: 3000,
      progress: 3000 / 5600,
      missStreak: 0,
      forgedStreak: 0,
      bestForgedStreak: 0,
      badges: ['ore', 'ember'],
    },
  ],
};

function notFound(): AxiosError {
  const error = new AxiosError('Not Found');
  error.response = { status: 404, data: {}, statusText: '', headers: {}, config: {} } as AxiosResponse;
  return error;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('Weekly Forge How it works, opened once', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocusCallbacks.length = 0;
    flag.mockReturnValue(true);
    accountId.mockResolvedValue('user-1');
    fetchForge.mockResolvedValue(week);
    hasSeen.mockResolvedValue(false);
    markSeen.mockResolvedValue(undefined);
  });

  it('opens How it works the first time the card shows a week, and notes it first', async () => {
    await render(<WeeklyForgeSection />);
    await settle();

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/forge/how-it-works');
    expect(markSeen).toHaveBeenCalledTimes(1);
    const [markedAt] = markSeen.mock.invocationCallOrder;
    const [openedAt] = mockPush.mock.invocationCallOrder;
    expect(markedAt).toBeLessThan(openedAt ?? 0);
  });

  it('does not open when it was already shown', async () => {
    hasSeen.mockResolvedValue(true);

    await render(<WeeklyForgeSection />);
    await settle();

    expect(mockPush).not.toHaveBeenCalled();
    expect(markSeen).not.toHaveBeenCalled();
  });

  it('does not open, or note anything, while the feature flag is off', async () => {
    flag.mockReturnValue(false);

    await render(<WeeklyForgeSection />);
    await settle();

    expect(mockPush).not.toHaveBeenCalled();
    expect(markSeen).not.toHaveBeenCalled();
  });

  it('does not open when the server says the feature is off (404)', async () => {
    fetchForge.mockRejectedValue(notFound());

    await render(<WeeklyForgeSection />);
    await settle();

    expect(mockPush).not.toHaveBeenCalled();
    expect(markSeen).not.toHaveBeenCalled();
  });

  it('waits for the week: nothing opens while the card still shows its dashes', async () => {
    fetchForge.mockReturnValue(new Promise<ForgeResponse>(() => undefined));

    await render(<WeeklyForgeSection />);
    await settle();

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('opens one copy when Home is refocused before the first check finishes', async () => {
    let finishRead: (seen: boolean) => void = () => undefined;
    hasSeen.mockReturnValueOnce(new Promise<boolean>((resolve) => (finishRead = resolve)));

    await render(<WeeklyForgeSection />);
    await settle();
    await act(async () => {
      mockFocusCallbacks.at(-1)?.();
    });
    await act(async () => finishRead(false));
    await settle();

    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});
