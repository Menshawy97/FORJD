// RED first: `location` is the first slice-2 screen outside the `(tabs)` group that still
// shows the tab bar — the prototype's `tabbar(back==='rank'?'rank':'profile')`. The real
// bottom tab bar only exists inside `(tabs)/_layout.tsx`'s `Tabs` navigator, so a screen
// outside that group needs its own presentational copy that navigates by replacing the
// route rather than switching a tab.
import { fireEvent, render } from '@testing-library/react-native';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { replace: (...args: unknown[]) => mockReplace(...args) } }));

import { TabBar } from '../tab-bar';

describe('TabBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders all five tabs with their labels', async () => {
    const { findByText } = await render(<TabBar active="profile" />);

    expect(await findByText('Home')).toBeTruthy();
    expect(await findByText('Train')).toBeTruthy();
    expect(await findByText('Progress')).toBeTruthy();
    expect(await findByText('Rank')).toBeTruthy();
    expect(await findByText('Profile')).toBeTruthy();
  });

  it('marks only the active tab selected', async () => {
    const { findByLabelText } = await render(<TabBar active="rank" />);

    expect((await findByLabelText('Rank')).props.accessibilityState?.selected).toBe(true);
    expect((await findByLabelText('Profile')).props.accessibilityState?.selected).toBe(false);
  });

  it('navigates to the tapped tab', async () => {
    const { findByLabelText } = await render(<TabBar active="rank" />);

    fireEvent.press(await findByLabelText('Profile'));

    expect(mockReplace).toHaveBeenCalledWith('/profile');
  });

  // `active` is a design label, not the real current route -- every caller of this
  // standalone bar sets it to whichever tab the screen conceptually belongs under
  // (nutrition.tsx passes "home" per ADR-020, since nutrition is reached *from* Home, not
  // because `/nutrition` is `/`). This component is only ever rendered on a screen that
  // isn't literally one of the five tab routes -- the real tabs get the actual native bar
  // from `(tabs)/_layout.tsx` instead. Real bug found live on a device: an earlier version
  // skipped navigation whenever a tab matched `active`, which meant pressing Home from
  // Nutrition (active="home") did nothing at all.
  it('navigates even when pressing the tab marked active, since active is a design label, not the real route', async () => {
    const { findByLabelText } = await render(<TabBar active="rank" />);

    fireEvent.press(await findByLabelText('Rank'));

    expect(mockReplace).toHaveBeenCalledWith('/rank');
  });

  it('navigates Home to the tab root, not /home', async () => {
    const { findByLabelText } = await render(<TabBar active="rank" />);

    fireEvent.press(await findByLabelText('Home'));

    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});
