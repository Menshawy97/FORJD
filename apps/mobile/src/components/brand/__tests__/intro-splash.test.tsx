import { AccessibilityInfo } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { INTRO_DURATION_MS, INTRO_REDUCED_MOTION_MS, IntroSplash } from '../intro-splash';

/** Animation #9 "Readiness ring", trimmed to ~3.3s (ADR-052). */
describe('IntroSplash', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('runs for about 3.3 seconds', () => {
    expect(INTRO_DURATION_MS).toBe(3300);
  });

  it('shows the symbol and the wordmark', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const { getByLabelText } = await render(<IntroSplash onDone={jest.fn()} />);

    expect(getByLabelText('FORJD')).toBeTruthy();
    expect(getByLabelText('FORJD symbol')).toBeTruthy();
  });

  it('calls onDone once the animation has finished, not before', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const onDone = jest.fn();
    await render(<IntroSplash onDone={onDone} />);

    await act(async () => {
      jest.advanceTimersByTime(INTRO_DURATION_MS - 100);
    });
    expect(onDone).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('finishes quickly and without motion when reduce motion is on', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const onDone = jest.fn();
    await render(<IntroSplash onDone={onDone} />);

    await act(async () => {
      jest.advanceTimersByTime(INTRO_REDUCED_MOTION_MS);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
