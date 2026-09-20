// RED first: the "Resend email" button's countdown. A send starts it; it ticks down once a second
// and stops at zero, so the button cannot be tapped again until the server's tight mail limit
// has had a chance to breathe.
import { act, renderHook } from '@testing-library/react-native';

import { useResendCooldown } from '../use-resend-cooldown';

describe('useResendCooldown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts idle', async () => {
    const { result } = await renderHook(() => useResendCooldown(60));

    expect(result.current.secondsLeft).toBe(0);
  });

  it('counts down from the full length once started, one second at a time', async () => {
    const { result } = await renderHook(() => useResendCooldown(60));

    await act(async () => result.current.start());
    expect(result.current.secondsLeft).toBe(60);

    await act(async () => jest.advanceTimersByTime(1000));
    expect(result.current.secondsLeft).toBe(59);

    await act(async () => jest.advanceTimersByTime(9000));
    expect(result.current.secondsLeft).toBe(50);
  });

  it('stops at zero and stays there', async () => {
    const { result } = await renderHook(() => useResendCooldown(3));

    await act(async () => result.current.start());
    await act(async () => jest.advanceTimersByTime(10_000));

    expect(result.current.secondsLeft).toBe(0);
  });

  it('starts again from the full length after it has finished', async () => {
    const { result } = await renderHook(() => useResendCooldown(3));

    await act(async () => result.current.start());
    await act(async () => jest.advanceTimersByTime(3000));
    await act(async () => result.current.start());

    expect(result.current.secondsLeft).toBe(3);
  });
});
