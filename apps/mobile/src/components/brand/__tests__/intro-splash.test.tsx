import { AccessibilityInfo } from 'react-native';
import { act, render } from '@testing-library/react-native';

import {
  INTRO_DURATION_MS,
  INTRO_MARK_SIZE,
  INTRO_REDUCED_MOTION_MS,
  INTRO_WORDMARK_HEIGHT,
  IntroSplash,
} from '../intro-splash';

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
    const { getAllByLabelText, getByLabelText } = await render(<IntroSplash onDone={jest.fn()} />);

    // The overlay itself (one element to a screen reader) and the wordmark inside it.
    expect(getAllByLabelText('FORJD')).toHaveLength(2);
    expect(getByLabelText('FORJD symbol')).toBeTruthy();
  });

  // Device feedback: the canvas's 800px-artboard sizes (300 ring, 140 mark, 300-wide wordmark)
  // read too big and off-centre on a phone, because the ring's box held empty space below the
  // mark once the ring faded. Same design, smaller, and the lockup that remains is what is centred.
  it('draws a phone-sized lockup, with the ring around the mark taking no layout space', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const { getByLabelText, getAllByLabelText, getByTestId } = await render(<IntroSplash onDone={jest.fn()} />);

    expect(getByLabelText('FORJD symbol').props.width).toBe(INTRO_MARK_SIZE);
    const wordmark = getAllByLabelText('FORJD').find((node) => node.props.testID !== 'intro-splash');
    expect(wordmark?.props.height).toBe(INTRO_WORDMARK_HEIGHT);
    expect(INTRO_MARK_SIZE).toBeLessThanOrEqual(96);
    expect(getByTestId('intro-ring')).toHaveStyle({ position: 'absolute' });
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

  it('still finishes on time if the reduce-motion check never answers', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(new Promise(() => {}));
    const onDone = jest.fn();
    await render(<IntroSplash onDone={onDone} />);

    await act(async () => {
      jest.advanceTimersByTime(INTRO_DURATION_MS);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('is one modal element to a screen reader, so the screen beneath is not reachable', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const { getByTestId } = await render(<IntroSplash onDone={jest.fn()} />);

    const root = getByTestId('intro-splash');
    expect(root.props.accessibilityViewIsModal).toBe(true);
    expect(root.props.accessible).toBe(true);
    expect(root.props.accessibilityLabel).toBe('FORJD');
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
