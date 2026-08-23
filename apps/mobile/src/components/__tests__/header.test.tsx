import { fireEvent, render } from '@testing-library/react-native';

import { Header } from '../header';

/**
 * The prototype's `hdr(title, onBack, right)` — shared by every slice-2 screen with a title
 * and a back chevron (`editProfile`, `units`, `notifs`, `privacy`). `goals` and `location`
 * have their own bespoke bare-chevron chrome and do not use this component.
 */
describe('Header', () => {
  it('renders the title', async () => {
    const { getByText } = await render(<Header title="Units & Preferences" onBack={jest.fn()} />);

    expect(getByText('Units & Preferences')).toBeTruthy();
  });

  it('calls onBack when the back control is pressed', async () => {
    const onBack = jest.fn();
    const { getByLabelText } = await render(<Header title="Edit Profile" onBack={onBack} />);

    fireEvent.press(getByLabelText('Back'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('exposes the back control as an accessible button', async () => {
    const { getByLabelText } = await render(<Header title="Edit Profile" onBack={jest.fn()} />);

    const back = getByLabelText('Back');
    expect(back.props.accessibilityRole).toBe('button');
  });
});
