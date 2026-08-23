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

  it('does not re-navigate when pressing the already-active tab', async () => {
    const { findByLabelText } = await render(<TabBar active="rank" />);

    fireEvent.press(await findByLabelText('Rank'));

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('navigates Home to the tab root, not /home', async () => {
    const { findByLabelText } = await render(<TabBar active="rank" />);

    fireEvent.press(await findByLabelText('Home'));

    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});
