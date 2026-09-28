// Your own profile's Weekly Forge section: all five ladders and the Nourish privacy note, once the
// week has loaded; nothing while the feature is off or before the first answer. The loading rules
// themselves live in `useForgeWeek` and are tested through the Home section.
jest.mock('../use-forge-week', () => ({ useForgeWeek: jest.fn() }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('@/media/share-capture', () => ({ isExpoGo: jest.fn(() => true), shareShareCard: jest.fn() }));
jest.mock('@/auth/apiClient', () => ({ getMe: jest.fn(async () => ({ profile: { username: 'mostafa' } })) }));

import type { ForgeResponse } from '@forjd/contracts';
import { FORGE_LADDERS } from '@forjd/domain';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { View } from 'react-native';

import { Toast } from '@/components/toast';
import { ProfileForgeSection } from '../profile-forge-section';
import { useForgeShare } from '../use-forge-share';
import { useForgeWeek } from '../use-forge-week';

const hook = useForgeWeek as jest.Mock;

const FORGE: ForgeResponse = {
  weekStart: '2026-09-26',
  daysLeft: 3,
  timeZone: 'Africa/Cairo',
  ladders: FORGE_LADDERS.map((ladder) => ({
    ladder,
    unit: 'kg',
    band: 'ore',
    level: 1,
    maxLevel: 6,
    target: 1,
    total: 0,
    progress: 0,
    missStreak: 0,
    forgedStreak: 0,
    bestForgedStreak: 0,
    badges: ['ore'],
  })),
};

describe('ProfileForgeSection', () => {
  it('shows all five ladders and says Nourish stays private', async () => {
    hook.mockReturnValue({ isVisible: true, forge: FORGE });

    await render(<ProfileForgeSection />);

    expect(screen.getByText('Weekly Forge')).toBeTruthy();
    for (const name of ['Consistency', 'Volume', 'Distance', 'Active minutes', 'Nourish']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(screen.getByText('Nourish is only ever shown to you.')).toBeTruthy();
  });

  it('renders nothing while the feature is off', async () => {
    hook.mockReturnValue({ isVisible: false, forge: FORGE });

    await render(<ProfileForgeSection />);

    expect(screen.queryByText('Weekly Forge')).toBeNull();
  });

  it('renders nothing before the first answer', async () => {
    hook.mockReturnValue({ isVisible: true, forge: null });

    await render(<ProfileForgeSection />);

    expect(screen.queryByText('Weekly Forge')).toBeNull();
  });

  it('shares all your public ladders from the Share link, and in Expo Go says sharing needs the full app', async () => {
    hook.mockReturnValue({ isVisible: true, forge: FORGE });
    // The profile tab owns the share flow, so its toast sits above the tab bar, not inside the list.
    function ProfileTab() {
      const share = useForgeShare();
      return (
        <View>
          <ProfileForgeSection share={share} />
          <Toast message={share.toastMessage} />
        </View>
      );
    }

    await render(<ProfileTab />);
    await fireEvent.press(screen.getByRole('button', { name: 'Share your Weekly Forge' }));

    expect(screen.getByText('Sharing works in the full app, not in Expo Go.')).toBeTruthy();
  });

  it('offers no Share link when the screen gives it no way to share', async () => {
    hook.mockReturnValue({ isVisible: true, forge: FORGE });

    await render(<ProfileForgeSection />);

    expect(screen.queryByRole('button', { name: 'Share your Weekly Forge' })).toBeNull();
  });

  it("opens a ladder's levels from its row", async () => {
    hook.mockReturnValue({ isVisible: true, forge: FORGE });

    await render(<ProfileForgeSection />);
    await fireEvent.press(screen.getByRole('button', { name: /^Volume, Ore level 1\./ }));

    expect(mockPush).toHaveBeenCalledWith('/forge/volume');
  });
});
