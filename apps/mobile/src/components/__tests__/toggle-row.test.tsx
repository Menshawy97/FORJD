// docs/design/slice2-screen-specs.md §5.4/§6.3, and the plan's whole-row-tappable deviation
// (§11 Q7 resolution box, recorded in three docs): unlike the prototype's `row(null, title,
// sub, null, toggle(...))` — where onClick is null and only the 46x27 track is tappable —
// this project's toggle rows make the WHOLE row the tap target, an accessibility
// minimum-tap-target fix. The second test here is the regression guard for that: it must fail
// against a track-only implementation.
import { fireEvent, render } from '@testing-library/react-native';

import { ToggleRow } from '../toggle-row';

describe('ToggleRow', () => {
  it('renders the title and subtitle', async () => {
    const { findByText } = await render(
      <ToggleRow
        title="Workout reminders"
        subtitle="On your program days, 30 min before"
        on
        onToggle={jest.fn()}
      />,
    );

    expect(await findByText('Workout reminders')).toBeTruthy();
    expect(await findByText('On your program days, 30 min before')).toBeTruthy();
  });

  it('toggles when the row is pressed anywhere, not just the track', async () => {
    const onToggle = jest.fn();
    const { findByText } = await render(
      <ToggleRow
        title="Workout reminders"
        subtitle="On your program days, 30 min before"
        on
        onToggle={onToggle}
      />,
    );

    // Pressing the title text, not the toggle control, must still fire onToggle — that is
    // exactly the accessibility deviation under test.
    fireEvent.press(await findByText('Workout reminders'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('exposes accessibilityRole switch and the checked state', async () => {
    const { findByRole } = await render(
      <ToggleRow title="Workout reminders" subtitle="sub" on onToggle={jest.fn()} />,
    );

    const row = await findByRole('switch');
    expect(row.props.accessibilityState).toMatchObject({ checked: true });
  });

  it('reports checked false when off', async () => {
    const { findByRole } = await render(
      <ToggleRow title="Leaderboard moves" subtitle="sub" on={false} onToggle={jest.fn()} />,
    );

    const row = await findByRole('switch');
    expect(row.props.accessibilityState).toMatchObject({ checked: false });
  });
});
