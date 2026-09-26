// NOTE: RTL v14 -- render() returns a Promise and must be awaited (see sparkline.test.tsx).
import { fireEvent, render } from '@testing-library/react-native';

import { SegmentedControl } from '../segmented-control';
import { TIGHT_TEXT_MAX_FONT_SCALE } from '@/theme/text-scale';

const OPTIONS = [
  { label: 'Strength', value: 'strength' as const },
  { label: 'Body', value: 'body' as const },
  { label: 'Health', value: 'health' as const },
];

describe('SegmentedControl', () => {
  it('renders every option label', async () => {
    const { getByText } = await render(
      <SegmentedControl options={OPTIONS} value="strength" onChange={jest.fn()} />,
    );

    expect(getByText('Strength')).toBeTruthy();
    expect(getByText('Body')).toBeTruthy();
    expect(getByText('Health')).toBeTruthy();
  });

  it('marks only the current value as selected', async () => {
    const { getByText } = await render(
      <SegmentedControl options={OPTIONS} value="body" onChange={jest.fn()} />,
    );

    const bodyTab = getByText('Body').parent;
    const strengthTab = getByText('Strength').parent;
    expect(bodyTab?.props.accessibilityState.selected).toBe(true);
    expect(strengthTab?.props.accessibilityState.selected).toBe(false);
  });

  // 8.5 S8, L8-2: the prototype's segments are 38px (default) and 30px (mini) tall, under the
  // 44pt minimum touch target. The drawn height stays exactly the prototype's; `hitSlop` makes
  // up the difference so the tappable area reaches 44 without changing a pixel.
  it.each([
    ['default', 38],
    ['mini', 30],
  ] as const)('gives each %s segment a touch target of at least 44', async (size, drawnHeight) => {
    const { getAllByRole } = await render(
      <SegmentedControl options={OPTIONS} value="strength" onChange={jest.fn()} size={size} />,
    );

    for (const tab of getAllByRole('tab')) {
      const style = Object.assign({}, ...[tab.props.style].flat(Infinity));
      const slop = tab.props.hitSlop as { top: number; bottom: number };
      expect(style.height).toBe(drawnHeight);
      expect(style.height + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
    }
  });

  it('caps how far a segment label grows with the system text size (8.5 S8, L8-4)', async () => {
    const { getByText } = await render(
      <SegmentedControl options={OPTIONS} value="strength" onChange={jest.fn()} />,
    );

    expect(getByText('Body').props.maxFontSizeMultiplier).toBe(TIGHT_TEXT_MAX_FONT_SCALE);
  });

  it("calls onChange with the tapped option's value", async () => {
    const onChange = jest.fn();
    const { getByText } = await render(
      <SegmentedControl options={OPTIONS} value="strength" onChange={onChange} />,
    );

    fireEvent.press(getByText('Health'));

    expect(onChange).toHaveBeenCalledWith('health');
  });

  it('exposes tab roles for screen readers, and names the whole control', async () => {
    const { getAllByRole, getByLabelText } = await render(
      <SegmentedControl
        options={OPTIONS}
        value="strength"
        onChange={jest.fn()}
        accessibilityLabel="Progress view"
      />,
    );

    // The container's own role is `tablist`, but React Native Testing Library's role matcher
    // does not resolve that role to an element -- `getByLabelText` is the reliable way to
    // reach the same node in this RN/RNTL version.
    expect(getByLabelText('Progress view')).toBeTruthy();
    expect(getAllByRole('tab')).toHaveLength(3);
  });
});
