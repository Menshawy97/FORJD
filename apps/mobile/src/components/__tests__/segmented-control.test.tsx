// NOTE: RTL v14 -- render() returns a Promise and must be awaited (see sparkline.test.tsx).
import { fireEvent, render } from '@testing-library/react-native';

import { SegmentedControl } from '../segmented-control';

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
