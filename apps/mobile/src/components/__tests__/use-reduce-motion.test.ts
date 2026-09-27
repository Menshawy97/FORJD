// Weekly Forge's celebrations play a static frame when the phone asks for reduced motion (the
// approved reduce-motion versions, Phase 7 item L). The hook reads the setting and follows it live.
import { AccessibilityInfo } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useReduceMotion } from '../use-reduce-motion';

describe('useReduceMotion', () => {
  let listener: ((enabled: boolean) => void) | undefined;
  const remove = jest.fn();

  beforeEach(() => {
    listener = undefined;
    remove.mockClear();
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
      _event: string,
      handler: (enabled: boolean) => void,
    ) => {
      listener = handler;
      return { remove };
    }) as unknown as typeof AccessibilityInfo.addEventListener);
  });

  afterEach(() => jest.restoreAllMocks());

  it('reports the phone setting', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

    const { result } = await renderHook(() => useReduceMotion());

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('follows the setting when it changes, and stops listening on unmount', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const { result, unmount } = await renderHook(() => useReduceMotion());
    await waitFor(() => expect(listener).toBeDefined());

    await act(async () => listener?.(true));
    expect(result.current).toBe(true);

    await unmount();
    expect(remove).toHaveBeenCalled();
  });

  it('assumes motion is fine when the setting cannot be read', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockRejectedValue(new Error('unavailable'));

    const { result } = await renderHook(() => useReduceMotion());

    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
