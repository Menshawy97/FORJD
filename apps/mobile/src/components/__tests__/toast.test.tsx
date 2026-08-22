// RED first: the app had no toast, so the one control that raises one in the prototype —
// login's "Forgot password?" — was left as inert text with a comment saying so.
//
// From the prototype's render of `this.state.toast`:
//   position:absolute; left:22; right:22; bottom:96
//   padding:'13px 16px'; borderRadius:12
//   background:'rgba(28,29,32,.97)'; border:'1px solid rgba(255,255,255,.1)'
//   boxShadow:'0 10px 30px rgba(0,0,0,.5)'; font:'600 13px/1'; color:#f6f5f3
// and from `flash()`: `setTimeout(()=>this.setState({toast:null}), 1900)`.
//
// Geometry and colour are NativeWind classes, which do not compile to style under Jest — so
// those are asserted as classes. The 1900ms dismissal is real behaviour and is asserted as
// behaviour, on fake timers.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Toast, TOAST_DURATION_MS, useToast } from '../toast';

/** A minimal host for the hook, so the timer is exercised the way a screen would. */
function Harness({ message }: { message: string }) {
  const toast = useToast();
  return (
    <>
      <Text onPress={() => toast.show(message)}>trigger</Text>
      <Toast message={toast.message} />
    </>
  );
}

describe('Toast', () => {
  it('renders nothing when there is no message', async () => {
    const { queryByText } = await render(<Toast message={null} />);

    expect(queryByText('anything')).toBeNull();
  });

  it('carries the prototype geometry and ground', async () => {
    const { findByText } = await render(<Toast message="Reset link sent to your email" />);

    const label = await findByText('Reset link sent to your email');
    // The pill is the label's parent — the styled container.
    const pill = label.parent as { props: { className?: unknown } };
    const classes = String(pill.props.className);

    expect(classes).toContain('absolute');
    expect(classes).toContain('bottom-[96px]');
    expect(classes).toContain('left-[22px]');
    expect(classes).toContain('right-[22px]');
    expect(classes).toContain('bg-toastBg');
    expect(classes).toContain('border-borderToast');
    expect(classes).toContain('shadow-toast');

    expect(String(label.props.className)).toContain('text-toast');
  });
});

describe('useToast', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows a message and clears it after the design interval', async () => {
    const { findByText, queryByText } = await render(<Harness message="Saved" />);

    expect(queryByText('Saved')).toBeNull();

    const trigger = await findByText('trigger');
    await act(async () => {
      (trigger.props.onPress as () => void)();
    });

    expect(queryByText('Saved')).not.toBeNull();

    // One tick short of the interval it is still up — otherwise "dismisses eventually" would
    // pass against any duration at all, including 0.
    await act(async () => {
      jest.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(queryByText('Saved')).not.toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(queryByText('Saved')).toBeNull();
  });

  it('is 1900ms, per flash()', () => {
    expect(TOAST_DURATION_MS).toBe(1900);
  });
});
